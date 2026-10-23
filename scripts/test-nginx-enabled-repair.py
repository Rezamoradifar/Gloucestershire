"""Exercise the pinned Global Nginx repair without contacting a real host."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
repo = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('global_nginx_repair', repo/'scripts/repair-global-nginx.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

CANON = 'sites-available/globaldroptrade.com'
MAIN = 'sites-enabled/globaldroptrade.com'
BACKUP_LINK = 'sites-enabled/globaldroptrade.com.bak.1792627288'
BACKUP_FILE = 'sites-enabled/globaldroptrade.com.bak.1792627441'
KNOWN = (CANON, MAIN, BACKUP_LINK, BACKUP_FILE)


def digest(content):
    return hashlib.sha256(content).hexdigest()


class Fixture:
    def __init__(self, root, failure=None, api_healthy=True):
        self.root = root
        self.nginx = root/'etc/nginx'
        self.failure = failure
        self.api_healthy = api_healthy
        self.calls = []
        self.logs = []
        for name in ('sites-available', 'sites-enabled', 'snippets'):
            (self.nginx/name).mkdir(parents=True)
        (root/'var/backups/globaldroptrade').mkdir(parents=True)
        self.homepage = b'<!doctype html><title>Current Global frontend</title>\n'
        for name, content in [('ACTIVE', self.homepage), ('OLD', b'Old frontend\n'), ('OTHER', b'Previous theme\n')]:
            release = root/'var/www/globaldroptrade/releases'/name
            release.mkdir(parents=True)
            (release/'index.html').write_bytes(content)
        self.active = self.configuration('ACTIVE')
        self.canonical = self.configuration('OLD')
        self.previous = self.configuration('OTHER')
        (self.nginx/CANON).write_bytes(self.canonical)
        (self.nginx/MAIN).write_bytes(self.active)
        (self.nginx/BACKUP_LINK).symlink_to('../sites-available/globaldroptrade.com')
        (self.nginx/BACKUP_FILE).write_bytes(self.previous)
        self.unrelated = self.nginx/'sites-enabled/another-project.conf'
        self.unrelated.write_text('server { listen 8080; server_name unrelated.example; return 204; }\n')
        (self.nginx/'snippets/globaldroptrade-api.conf').write_text('location /api/ { proxy_pass http://127.0.0.1:3115; }\n')
        self.expected = {name: digest((self.nginx/name).read_bytes()) for name in KNOWN}

    def configuration(self, release):
        return (f'''# Preserved {release} configuration
server {{
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name globaldroptrade.com www.globaldroptrade.com;
    root {self.root}/var/www/globaldroptrade/releases/{release};
    ssl_certificate /etc/letsencrypt/live/globaldroptrade.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/globaldroptrade.com/privkey.pem;
    include /etc/nginx/snippets/globaldroptrade-api.conf;
    location / {{ try_files $uri $uri/ /index.html; }}
    location /existing-private-route/ {{ proxy_set_header Authorization "private-upstream-secret"; return 204; }}
}}
server {{
    listen 80;
    listen [::]:80;
    server_name globaldroptrade.com www.globaldroptrade.com;
    return 301 https://$host$request_uri;
}}
''').encode()

    def normalized(self):
        main = self.nginx/MAIN
        return main.is_symlink() and main.resolve() == (self.nginx/CANON).resolve()

    def runner(self, args, **kwargs):
        args = [str(arg) for arg in args]
        self.calls.append(args)
        command = Path(args[0]).name
        normalized = self.normalized()
        if command == 'nginx':
            if '-T' in args:
                dump = ''.join('# configuration file '+str(file)+':\n'+file.read_text()+'\n'
                               for file in sorted((self.nginx/'sites-enabled').iterdir()))
                return subprocess.CompletedProcess(args, 0, dump.encode(), b'')
            if '-t' not in args:
                raise AssertionError('Unexpected Nginx command: '+repr(args))
            if normalized and self.failure == 'nginx-check':
                return subprocess.CompletedProcess(args, 1, b'', b'nginx: configuration test failed\n')
            if normalized and self.failure == 'remaining-conflict':
                return subprocess.CompletedProcess(args, 0, b'', b'nginx: [warn] conflicting server name "www.globaldroptrade.com" on [::]:443, ignored\n')
            warnings = b'' if normalized else b'nginx: [warn] conflicting server name "globaldroptrade.com" on 0.0.0.0:443, ignored\n'
            return subprocess.CompletedProcess(args, 0, b'', warnings+b'nginx: configuration test is successful\n')
        if command == 'systemctl':
            if args[1:] != ['reload', 'nginx']:
                raise AssertionError('Unexpected service command: '+repr(args))
            failed = normalized and self.failure == 'reload'
            return subprocess.CompletedProcess(args, 1 if failed else 0, b'', b'reload failed\n' if failed else b'')
        if command == 'curl':
            if '--noproxy' not in args or '*' not in args or '--resolve' not in args:
                raise AssertionError('HTTPS probe must bypass proxies and pin the local origin')
            if '-k' in args or '--insecure' in args:
                raise AssertionError('TLS certificate validation must remain enabled')
            url = next((arg for arg in args if arg.startswith('https://')), '')
            if url.endswith('/api/health'):
                healthy = self.api_healthy and not (normalized and self.failure == 'api-health')
                content = json.dumps({'status': 'ok' if healthy else 'unavailable', 'configured': True}).encode()
                return subprocess.CompletedProcess(args, 0 if healthy else 22, content, b'')
            if url not in ('https://globaldroptrade.com/', 'https://www.globaldroptrade.com/'):
                raise AssertionError('Unexpected HTTPS probe: '+repr(args))
            if normalized and self.failure == 'https':
                return subprocess.CompletedProcess(args, 60, b'', b'TLS verification failed\n')
            content = b'Unexpected frontend release\n' if normalized and self.failure == 'content' else self.homepage
            return subprocess.CompletedProcess(args, 0, content, b'')
        raise AssertionError('Unexpected external command: '+repr(args))

    def helper(self):
        return module.GlobalNginxRepair(prefix=self.root, expected=self.expected, runner=self.runner,
                                       owner_uid=os.getuid(), pause=lambda _: None, log=self.logs.append)

    def snapshot(self):
        entries = {}
        for file in sorted(self.nginx.rglob('*')):
            name = str(file.relative_to(self.nginx))
            if file.is_symlink():
                entries[name] = ('link', os.readlink(file))
            elif file.is_file():
                entries[name] = ('file', file.read_bytes(), stat.S_IMODE(file.stat().st_mode))
            elif file.is_dir():
                entries[name] = ('directory', stat.S_IMODE(file.stat().st_mode))
        return entries


class GlobalNginxRepairTests(unittest.TestCase):
    def fixture(self, failure=None, api_healthy=True):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        return Fixture(Path(temporary.name), failure=failure, api_healthy=api_healthy)

    def test_success_preserves_active_config_and_removes_only_known_duplicates(self):
        fixture = self.fixture()
        unrelated = fixture.unrelated.read_bytes()
        helper = fixture.helper()
        before = helper.preflight()
        self.assertFalse(before['alreadyNormalized'])
        self.assertEqual(before['homepageHash'], digest(fixture.homepage))
        self.assertTrue(before['apiHealthy'])
        result = helper.apply()
        self.assertFalse(result['alreadyNormalized'])
        self.assertEqual((fixture.nginx/CANON).read_bytes(), fixture.active)
        self.assertTrue((fixture.nginx/MAIN).is_symlink())
        self.assertEqual((fixture.nginx/MAIN).resolve(), fixture.nginx/CANON)
        for name in (BACKUP_LINK, BACKUP_FILE):
            self.assertFalse(os.path.lexists(fixture.nginx/name))
        self.assertEqual(fixture.unrelated.read_bytes(), unrelated)
        backup = Path(result['backup'])
        self.assertTrue(backup.is_dir())
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode) & 0o077, 0)
        saved_links = list(backup.rglob(Path(BACKUP_LINK).name))
        saved_files = list(backup.rglob(Path(BACKUP_FILE).name))
        self.assertTrue(any(file.is_symlink() for file in saved_links))
        self.assertTrue(any(file.is_file() and file.read_bytes() == fixture.previous for file in saved_files))
        self.assertNotIn('private-upstream-secret', '\n'.join(map(str, fixture.logs)))
        snapshot = fixture.snapshot()
        again = helper.apply()
        self.assertTrue(again['alreadyNormalized'])
        self.assertEqual(fixture.snapshot(), snapshot)

    def test_manual_restore_recovers_original_regular_and_symlink_kinds(self):
        fixture = self.fixture()
        original = fixture.snapshot()
        helper = fixture.helper()
        result = helper.apply()
        helper.restore(Path(result['backup']), reload=True)
        self.assertEqual(fixture.snapshot(), original)
        self.assertFalse((fixture.nginx/MAIN).is_symlink())
        self.assertTrue((fixture.nginx/MAIN).is_file())
        self.assertEqual((fixture.nginx/MAIN).read_bytes(), fixture.active)
        self.assertEqual((fixture.nginx/CANON).read_bytes(), fixture.canonical)
        self.assertEqual(os.readlink(fixture.nginx/BACKUP_LINK), '../sites-available/globaldroptrade.com')

    def test_hash_drift_and_missing_backup_fail_before_changes(self):
        for scenario in ('hash-drift', 'missing-backup'):
            with self.subTest(scenario=scenario):
                fixture = self.fixture()
                if scenario == 'hash-drift':
                    with (fixture.nginx/BACKUP_FILE).open('ab') as out:
                        out.write(b'# Changed after diagnosis\n')
                else:
                    (fixture.nginx/BACKUP_FILE).unlink()
                before = fixture.snapshot()
                with self.assertRaises(module.RepairError):
                    fixture.helper().apply()
                self.assertEqual(fixture.snapshot(), before)

    def test_post_mutation_failures_restore_original_config(self):
        for failure in ('remaining-conflict', 'nginx-check', 'reload', 'https', 'content', 'api-health'):
            with self.subTest(failure=failure):
                fixture = self.fixture(failure=failure)
                before = fixture.snapshot()
                with self.assertRaises(module.RepairError):
                    fixture.helper().apply()
                self.assertEqual(fixture.snapshot(), before)

    def test_preexisting_unhealthy_api_does_not_prevent_frontend_repair(self):
        fixture = self.fixture(api_healthy=False)
        helper = fixture.helper()
        self.assertFalse(helper.preflight()['apiHealthy'])
        self.assertFalse(helper.apply()['alreadyNormalized'])
        self.assertEqual((fixture.nginx/CANON).read_bytes(), fixture.active)

    def test_unsafe_source_path_kinds_are_rejected(self):
        for name in (MAIN, CANON):
            with self.subTest(path=name):
                fixture = self.fixture()
                source = fixture.nginx/name
                alternate = fixture.root/('external-'+source.parent.name+'.conf')
                alternate.write_bytes(source.read_bytes())
                source.unlink()
                source.symlink_to(alternate)
                before = fixture.snapshot()
                with self.assertRaises(module.RepairError):
                    fixture.helper().apply()
                self.assertEqual(fixture.snapshot(), before)

    def test_group_writable_source_is_rejected(self):
        fixture = self.fixture()
        (fixture.nginx/MAIN).chmod(0o664)
        before = fixture.snapshot()
        with self.assertRaises(module.RepairError):
            fixture.helper().apply()
        self.assertEqual(fixture.snapshot(), before)

    def test_concurrent_edit_before_first_mutation_is_preserved(self):
        fixture = self.fixture()
        helper = fixture.helper()
        snapshot = helper._snapshot
        concurrent = {}

        def capture_then_edit(report):
            backup = snapshot(report)
            active = fixture.nginx/MAIN
            active.write_bytes(active.read_bytes()+b'# Concurrent administrator edit\n')
            concurrent.update(fixture.snapshot())
            return backup

        helper._snapshot = capture_then_edit
        with self.assertRaises(module.RepairError):
            helper.apply()
        self.assertEqual(fixture.snapshot(), concurrent)
        self.assertFalse((fixture.nginx/MAIN).is_symlink())

    def test_changed_private_snapshot_is_rejected_before_mutation(self):
        fixture = self.fixture()
        before = fixture.snapshot()
        helper = fixture.helper()
        snapshot = helper._snapshot

        def capture_then_corrupt(report):
            backup = snapshot(report)
            saved = backup/'originals'/MAIN
            saved.write_bytes(saved.read_bytes()+b'# Unexpected snapshot change\n')
            return backup

        helper._snapshot = capture_then_corrupt
        with self.assertRaises(module.RepairError):
            helper.apply()
        self.assertEqual(fixture.snapshot(), before)

    def test_concurrent_path_kind_change_is_not_overwritten(self):
        fixture = self.fixture()
        helper = fixture.helper()
        snapshot = helper._snapshot
        concurrent = {}

        def capture_then_replace(report):
            backup = snapshot(report)
            alternate = fixture.root/'concurrent-active.conf'
            alternate.write_bytes(fixture.active)
            active = fixture.nginx/MAIN
            active.unlink()
            active.symlink_to(alternate)
            concurrent.update(fixture.snapshot())
            return backup

        helper._snapshot = capture_then_replace
        with self.assertRaises(module.RepairError):
            helper.apply()
        self.assertEqual(fixture.snapshot(), concurrent)

    def test_mixed_domain_config_is_rejected_even_with_a_matching_pin(self):
        for name in (MAIN, CANON, BACKUP_FILE):
            with self.subTest(path=name):
                fixture = self.fixture()
                source = fixture.nginx/name
                source.write_bytes(source.read_bytes()+b'\nserver { listen 8080; server_name other.example; return 204; }\n')
                fixture.expected[name] = digest(source.read_bytes())
                if name == CANON:
                    fixture.expected[BACKUP_LINK] = fixture.expected[CANON]
                before = fixture.snapshot()
                with self.assertRaises(module.RepairError):
                    fixture.helper().apply()
                self.assertEqual(fixture.snapshot(), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
