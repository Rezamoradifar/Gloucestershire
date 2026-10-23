"""Exercise managed paths, immutable assets and the public status metadata link."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


spec = importlib.util.spec_from_file_location('zero_status', Path(__file__).with_name('install-zero-start-status.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class StatusConsoleInstallation(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.prefix = Path(self.temporary.name)
        self.source = self.prefix/'source'
        self.source.mkdir()
        for name in installer.ASSETS:
            (self.source/name).write_text('reviewed '+name)
        (self.source/'zero-start-activation-core.js').write_text('canceled wallet actions')
        (self.source/'wallet-bundle').mkdir()
        (self.source/'wallet-bundle/wallet-client.js').write_text('wallet actions')
        self.root = self.prefix/'var/www/globaldroptrade/releases/reviewed-release'
        self.root.mkdir(parents=True)
        (self.root/'index.html').write_text('existing frontend')
        available = self.prefix/'etc/nginx/sites-available'
        available.mkdir(parents=True)
        enabled = self.prefix/'etc/nginx/sites-enabled'
        enabled.mkdir()
        self.conf = available/'globaldroptrade.com'
        self.configuration = 'server { server_name globaldroptrade.com www.globaldroptrade.com; root /var/www/globaldroptrade/releases/reviewed-release; }\n'
        self.conf.write_text(self.configuration)
        self.enabled = enabled/'globaldroptrade.com'
        self.enabled.symlink_to('../sites-available/globaldroptrade.com')
        self.status = self.prefix/installer.STATUS_RELATIVE
        self.status.parent.mkdir(mode=0o755, parents=True)
        self.status.write_text(json.dumps({'version': 1, 'chainId': 97, 'ready': False}))
        self.status.chmod(0o644)

    def tearDown(self):
        self.temporary.cleanup()

    def install(self):
        return installer.install_status_console(source=self.source, prefix=self.prefix)

    def test_content_address_and_idempotence_with_only_read_only_assets(self):
        folder = self.install()
        digest = hashlib.sha256()
        for name in installer.ASSETS:
            digest.update(name.encode()+b'\0'+(self.source/name).read_bytes())
        self.assertEqual(folder, 'zero-status-'+digest.hexdigest()[:20])
        target = self.root/'deploy'/folder
        self.assertEqual({file.name for file in target.iterdir()}, set(installer.ASSETS))
        self.assertFalse((target/'wallet-bundle').exists())
        self.assertFalse((target/'zero-start-activation-core.js').exists())
        before = {file.name: file.stat().st_ino for file in target.iterdir()}
        redirect = self.root/'deploy/zero-start-activation.html'
        redirect_inode = redirect.stat().st_ino
        self.assertEqual(self.install(), folder)
        self.assertEqual(before, {file.name: file.stat().st_ino for file in target.iterdir()})
        self.assertEqual(redirect.stat().st_ino, redirect_inode)
        self.assertEqual(self.conf.read_text(), self.configuration)
        (target/'ethers.js').chmod(0o600)
        with self.assertRaises(ValueError):
            self.install()

    def test_metadata_link_updates_without_changing_asset_hash(self):
        folder = self.install()
        link = self.root/'deploy/zero-start-activation.json'
        self.assertTrue(link.is_symlink())
        self.assertEqual(os.readlink(link), str(self.status))
        self.assertEqual(link.read_bytes(), self.status.read_bytes())
        self.status.write_text('{"version":1,"chainId":97,"ready":true}\n')
        self.assertEqual(self.install(), folder)
        self.assertEqual(json.loads(link.read_text())['ready'], True)

    def test_changed_asset_has_new_folder_and_private_redirect_backup(self):
        first = self.install()
        redirect = self.root/'deploy/zero-start-activation.html'
        previous = redirect.read_bytes()
        (self.source/'zero-start-activation.js').write_text('updated read-only status')
        second = self.install()
        self.assertNotEqual(first, second)
        self.assertTrue((self.root/'deploy'/first).is_dir())
        self.assertIn(second, redirect.read_text())
        backups = list((self.prefix/'var/backups/globaldroptrade').glob('zero-status-console-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0]/redirect.name).read_bytes(), previous)
        self.assertEqual(backups[0].stat().st_mode & 0o777, 0o700)
        self.assertEqual((backups[0]/redirect.name).stat().st_mode & 0o777, 0o600)

    def test_rejects_unknown_and_traversing_nginx_roots_or_enabled_target(self):
        for path in ['/var/www/unknown', '/var/www/globaldroptrade/releases/../escape', '/var/www/globaldroptrade/releases/reviewed-release/child']:
            with self.subTest(path=path):
                self.conf.write_text('server { root '+path+'; }')
                with self.assertRaises(ValueError):
                    self.install()
        self.conf.write_text(self.configuration+'server { root /var/www/other; }')
        with self.assertRaises(ValueError):
            self.install()
        self.conf.write_text(self.configuration)
        self.enabled.unlink()
        self.enabled.symlink_to(self.status)
        with self.assertRaises(ValueError):
            self.install()
        self.assertFalse((self.root/'deploy').exists())

    def test_rejects_symlinked_paths_and_unexpected_metadata_entries(self):
        self.install()
        metadata = self.root/'deploy/zero-start-activation.json'
        metadata.unlink()
        metadata.write_text('unexpected regular file')
        with self.assertRaises(ValueError):
            self.install()
        metadata.unlink()
        metadata.symlink_to(self.root/'index.html')
        with self.assertRaises(ValueError):
            self.install()
        metadata.unlink()
        metadata.symlink_to('../automation-data/activation.json')
        with self.assertRaises(ValueError):
            self.install()
        metadata.unlink()
        redirect = self.root/'deploy/zero-start-activation.html'
        redirect.unlink()
        redirect.symlink_to(self.root/'index.html')
        with self.assertRaises(ValueError):
            self.install()
        self.assertEqual((self.root/'index.html').read_text(), 'existing frontend')

    def test_rejects_asset_or_release_symlinks_and_unexpected_existing_assets(self):
        original = self.source/'ethers.js'
        data = original.read_bytes()
        original.unlink()
        original.symlink_to(self.status)
        with self.assertRaises(OSError):
            self.install()
        original.unlink()
        original.write_bytes(data)
        folder = self.install()
        (self.root/'deploy'/folder/'wallet-client.js').write_text('unexpected asset')
        with self.assertRaises(ValueError):
            self.install()
        moved = self.root.with_name('actual-release')
        self.root.rename(moved)
        self.root.symlink_to(moved, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.install()

    def test_public_permissions_under_private_root_umask(self):
        previous = os.umask(0o077)
        try:
            folder = self.install()
        finally:
            os.umask(previous)
        deploy = self.root/'deploy'
        self.assertEqual(deploy.stat().st_mode & 0o777, 0o755)
        self.assertEqual((deploy/folder).stat().st_mode & 0o777, 0o755)
        for name in installer.ASSETS:
            self.assertEqual((deploy/folder/name).stat().st_mode & 0o777, 0o644)
        self.assertEqual((deploy/'zero-start-activation.html').stat().st_mode & 0o777, 0o644)

    def test_transactional_backup_restores_previous_redirect_and_metadata(self):
        deploy = self.root/'deploy'
        deploy.mkdir(mode=0o755)
        redirect, metadata = deploy/'zero-start-activation.html', deploy/'zero-start-activation.json'
        redirect.write_bytes(b'previous reviewed status redirect\n')
        metadata.symlink_to(self.status)
        backup = self.prefix/'private-status-backup'
        folder = installer.install_status_console(self.source, self.prefix, backup_dir=backup)
        manifest = json.loads((backup/'manifest.json').read_text())
        self.assertEqual(manifest['webRoot'], '/var/www/globaldroptrade/releases/reviewed-release')
        self.assertEqual(manifest['entries'][metadata.name], {'kind': 'symlink', 'linkTarget': str(self.status)})
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual((backup/'manifest.json').stat().st_mode & 0o777, 0o600)
        self.assertIn(folder, redirect.read_text())
        installer.restore_status_console(backup, self.prefix)
        self.assertEqual(redirect.read_bytes(), b'previous reviewed status redirect\n')
        self.assertEqual(os.readlink(metadata), str(self.status))
        self.assertTrue((deploy/folder).is_dir())

    def test_restores_absent_entries_and_propagates_remove_failure(self):
        backup = self.prefix/'private-status-backup'
        folder = installer.install_status_console(self.source, self.prefix, backup_dir=backup)
        deploy = self.root/'deploy'
        redirect, metadata = deploy/'zero-start-activation.html', deploy/'zero-start-activation.json'
        real_unlink = Path.unlink
        def deny_metadata(path, *args, **kwargs):
            if path == metadata:
                raise PermissionError('simulated removal failure')
            return real_unlink(path, *args, **kwargs)
        with mock.patch.object(Path, 'unlink', deny_metadata):
            with self.assertRaises(PermissionError):
                installer.restore_status_console(backup, self.prefix)
        self.assertTrue(metadata.is_symlink())
        self.assertTrue(redirect.is_file())
        installer.restore_status_console(backup, self.prefix)
        self.assertFalse(metadata.exists() or metadata.is_symlink())
        self.assertFalse(redirect.exists() or redirect.is_symlink())
        self.assertTrue((deploy/folder).is_dir())
        installer.restore_status_console(backup, self.prefix)

    def test_restore_rejects_changed_root_or_unexpected_current_metadata(self):
        backup = self.prefix/'private-status-backup'
        installer.install_status_console(self.source, self.prefix, backup_dir=backup)
        deploy = self.root/'deploy'
        redirect, metadata = deploy/'zero-start-activation.html', deploy/'zero-start-activation.json'
        expected = redirect.read_bytes()
        metadata.unlink()
        metadata.write_text('unrelated current metadata file')
        with self.assertRaises(ValueError):
            installer.restore_status_console(backup, self.prefix)
        self.assertEqual(redirect.read_bytes(), expected)
        self.assertEqual(metadata.read_text(), 'unrelated current metadata file')
        metadata.unlink()
        metadata.symlink_to(self.status)
        other = self.root.with_name('other-managed-release')
        other.mkdir()
        (other/'index.html').write_text('other active frontend')
        self.conf.write_text(self.configuration.replace('reviewed-release', 'other-managed-release'))
        with self.assertRaises(ValueError):
            installer.restore_status_console(backup, self.prefix)
        self.assertEqual(redirect.read_bytes(), expected)


if __name__ == '__main__':
    unittest.main()
