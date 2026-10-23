"""Verify scoped permission-console publication and recovery on an isolated web root."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('permission_console', Path(__file__).with_name('install-zero-start-permission.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PermissionInstallerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for name in ('etc/nginx/sites-available', 'etc/nginx/sites-enabled', 'var/www/globaldroptrade/releases/test/deploy', 'var/www/globaldroptrade/automation-data', 'source', 'backups'):
            (self.root/name).mkdir(parents=True, exist_ok=True)
        self.web = self.root/'var/www/globaldroptrade/releases/test'
        self.deploy = self.web/'deploy'
        self.conf = self.root/'etc/nginx/sites-available/globaldroptrade.com'
        self.conf.write_text('server { server_name globaldroptrade.com; root /var/www/globaldroptrade/releases/test; }\n')
        (self.root/'etc/nginx/sites-enabled/globaldroptrade.com').symlink_to(self.conf)
        (self.web/'index.html').write_text('Existing frontend')
        self.status = self.root/module.shared.STATUS_RELATIVE
        self.status.write_text(json.dumps({'version': 1, 'kind': 'fresh-zero-daily-readiness', 'chainId': 97, 'target': module.TARGET, 'contractAddress': module.TARGET, 'siteConnected': True}))
        self.status.chmod(0o644)
        self.metadata = self.deploy/'zero-start-activation.json'
        self.metadata.symlink_to(self.status)
        (self.deploy/'zero-start-activation.html').write_text('Existing read-only status')
        self.source = self.root/'source'
        for asset in module.ASSETS:
            file = self.source/asset
            file.write_text('Asset fixture: '+asset)
            file.chmod(0o600)
        self.backup = self.root/'backups/first'
        self.redirect = self.deploy/module.REDIRECT
        self.unchanged = {file: file.read_bytes() for file in (self.conf, self.web/'index.html', self.status, self.deploy/'zero-start-activation.html')}

    def tearDown(self):
        self.temporary.cleanup()

    def install(self, backup=None):
        return module.install_permission_console(backup or self.backup, self.source, self.root)

    def assert_other_entries_unchanged(self):
        for file, contents in self.unchanged.items():
            self.assertEqual(file.read_bytes(), contents)
        self.assertTrue(self.metadata.is_symlink())
        self.assertEqual(os.readlink(self.metadata), str(self.status))

    def test_exact_assets_public_modes_private_manifest_and_absence_restore(self):
        original = os.umask(0o077)
        try:
            folder = self.install()
        finally:
            os.umask(original)
        contents = self.deploy/folder
        self.assertEqual({file.name for file in contents.iterdir()}, set(module.ASSETS))
        self.assertEqual(contents.stat().st_mode & 0o777, 0o755)
        for name in module.ASSETS:
            self.assertEqual((contents/name).read_bytes(), (self.source/name).read_bytes())
            self.assertEqual((contents/name).stat().st_mode & 0o777, 0o644)
        self.assertEqual(self.redirect.stat().st_mode & 0o777, 0o644)
        self.assertEqual(self.backup.stat().st_mode & 0o777, 0o700)
        for name in ('manifest.json', 'installed.json'):
            self.assertEqual((self.backup/name).stat().st_mode & 0o777, 0o600)
        self.assertIn(folder, self.redirect.read_text())
        self.assert_other_entries_unchanged()
        module.restore_permission_console(self.backup, self.root)
        self.assertFalse(self.redirect.exists())
        self.assertTrue(contents.is_dir())
        self.assert_other_entries_unchanged()

    def test_idempotent_assets_and_exact_prior_redirect_restoration(self):
        self.redirect.write_text('Prior permission entrypoint')
        self.redirect.chmod(0o600)
        folder = self.install()
        second = self.root/'backups/second'
        self.assertEqual(self.install(second), folder)
        module.restore_permission_console(second, self.root)
        self.assertIn(folder, self.redirect.read_text())
        module.restore_permission_console(self.backup, self.root)
        self.assertEqual(self.redirect.read_text(), 'Prior permission entrypoint')
        self.assertEqual(self.redirect.stat().st_mode & 0o777, 0o600)
        self.assert_other_entries_unchanged()

    def test_unknown_redirect_symlink_preserved(self):
        self.redirect.symlink_to(self.web/'index.html')
        with self.assertRaises(ValueError):
            self.install()
        self.assertTrue(self.redirect.is_symlink())
        self.assert_other_entries_unchanged()

    def test_bad_source_symlink_or_missing_asset_never_publishes(self):
        asset = self.source/module.ASSETS[0]
        asset.unlink()
        with self.assertRaises(OSError):
            self.install()
        self.assertFalse(self.redirect.exists())
        asset.symlink_to(self.web/'index.html')
        with self.assertRaises(OSError):
            self.install()
        self.assertFalse(self.redirect.exists())
        self.assert_other_entries_unchanged()

    def test_existing_immutable_assets_are_verified(self):
        folder = self.install()
        (self.deploy/folder/module.ASSETS[1]).write_text('Unexpected mutation')
        before = self.redirect.read_bytes()
        with self.assertRaises(ValueError):
            self.install(self.root/'backups/second')
        self.assertEqual(self.redirect.read_bytes(), before)
        self.assert_other_entries_unchanged()

    def test_wrong_status_target_is_rejected_without_publication(self):
        value = json.loads(self.status.read_text())
        value['target'] = '0x'+'11'*20
        self.status.write_text(json.dumps(value))
        with self.assertRaises(ValueError):
            self.install()
        self.assertFalse(self.redirect.exists())

    def test_failure_before_redirect_publication_can_restore_old_entry(self):
        self.redirect.write_text('Old entry remains')
        actual = module.shared._atomic_file
        def refuse_publish(path, contents, mode=0o644):
            if path == self.redirect:
                raise OSError('Fixture publication failure')
            actual(path, contents, mode)
        with patch.object(module.shared, '_atomic_file', side_effect=refuse_publish):
            with self.assertRaises(OSError):
                self.install()
        self.assertEqual(self.redirect.read_text(), 'Old entry remains')
        module.restore_permission_console(self.backup, self.root)
        self.assertEqual(self.redirect.read_text(), 'Old entry remains')
        self.assert_other_entries_unchanged()

    def test_changed_root_or_unexpected_redirect_blocks_recovery(self):
        self.install()
        original = self.conf.read_bytes()
        (self.root/'var/www/globaldroptrade/releases/other/deploy').mkdir(parents=True)
        (self.root/'var/www/globaldroptrade/releases/other/index.html').write_text('Other frontend')
        self.conf.write_text('server { root /var/www/globaldroptrade/releases/other; }')
        with self.assertRaisesRegex(ValueError, 'WEB_ROOT_MISMATCH'):
            module.restore_permission_console(self.backup, self.root)
        self.conf.write_bytes(original)
        self.redirect.write_text('Unexpected later replacement')
        with self.assertRaisesRegex(ValueError, 'REDIRECT_CHANGED'):
            module.restore_permission_console(self.backup, self.root)
        self.assertEqual(self.redirect.read_text(), 'Unexpected later replacement')

    def test_recovery_does_not_depend_on_the_live_status_payload(self):
        self.install()
        self.status.write_text('{"kind":"fresh-zero-automation-error"}')
        module.restore_permission_console(self.backup, self.root)
        self.assertFalse(self.redirect.exists())

    def test_wrapper_checks_served_bytes_and_restores_only_redirect_on_https_mismatch(self):
        repo = Path(__file__).resolve().parent.parent
        project = self.root/'wrapper-source'
        (project/'scripts').mkdir(parents=True)
        (project/'deployment-console').mkdir()
        for name in module.ASSETS:
            shutil.copy(self.source/name, project/'deployment-console'/name)
        for name in ('install-zero-start-permission.py', 'install-zero-start-status.py'):
            code = (repo/'scripts'/name).read_text().replace("prefix=Path('/')", 'prefix=Path('+repr(str(self.root))+')')
            (project/'scripts'/name).write_text(code)
        script = (repo/'ubuntu-zero-permission.sh').read_text()
        script = script.replace('/var/backups/globaldroptrade', str(self.root/'var/backups/globaldroptrade'))
        script = script.replace("Path('/')", 'Path('+repr(str(self.root))+')')
        (project/'ubuntu-zero-permission.sh').write_text(script)
        binaries = self.root/'bin'
        binaries.mkdir()
        commands = {'node': 'exit 0', 'npm': 'exit 0',
                    'curl': '''out='';url=''
while [ "$#" -gt 0 ]; do
 case "$1" in -o)out=$2;shift 2;; https://*)url=$1;shift;; *)shift;;esac
done
relative=${url#https://globaldroptrade.com/}
if [ -f 'FAIL_FLAG' ] && [[ "$relative" = *.js ]]; then printf 'Unexpected served bytes' > "$out";
else cp 'WEB_ROOT/'"$relative" "$out";fi'''.replace('FAIL_FLAG', str(self.root/'https-fail')).replace('WEB_ROOT/', str(self.web)+'/')}
        for name, body in commands.items():
            file = binaries/name
            file.write_text('#!/usr/bin/env bash\n'+body+'\n')
            file.chmod(0o755)
        environment = {**os.environ, 'PATH': str(binaries)+':'+os.environ['PATH']}
        self.redirect.write_text('Prior wallet permission redirect')
        run = lambda: subprocess.run(['bash', str(project/'ubuntu-zero-permission.sh')], cwd=project, env=environment, capture_output=True, text=True, timeout=30)
        result = run()
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        self.assertIn('ZERO_START_PERMISSION_PAGE_READY', result.stdout)
        installed = self.redirect.read_bytes()
        (self.source/'zero-start-permission.js').write_text('New UI fixture')
        shutil.copy(self.source/'zero-start-permission.js', project/'deployment-console/zero-start-permission.js')
        (self.root/'https-fail').touch()
        result = run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('HTTPS_PERMISSION_ASSET_MISMATCH', result.stderr)
        self.assertIn('recoveryVerified=1', result.stdout)
        self.assertEqual(self.redirect.read_bytes(), installed)
        self.assert_other_entries_unchanged()


if __name__ == '__main__':
    unittest.main()
