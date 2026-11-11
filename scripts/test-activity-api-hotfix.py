"""Local filesystem and rollback tests; no systemd, RPC, signer, or network."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import os
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('activity_hotfix', Path(__file__).with_name('install-activity-api-hotfix.py'))
hotfix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hotfix)


class TestHotfix(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'api'
        self.old = self.root / 'releases' / 'previous'
        (self.old / 'server').mkdir(parents=True)
        self.old_source = self.old / 'server' / 'daily-activity.mjs'
        self.old_source.write_text('old code')
        (self.old / 'server' / 'trades-api.mjs').write_text('api code')
        self.first = Path(self.temp.name) / 'first.mjs'
        self.first.write_text('first patch code')
        (self.root / 'current').symlink_to(self.old)
        self.fixed = Path(self.temp.name) / 'fixed.mjs'
        self.fixed.write_text('fixed code')
        self.data = Path(self.temp.name) / 'history.json'
        self.data.write_text('unchanged activity')
        self.patches = [patch.object(hotfix, 'ROOT', self.root),
                        patch.object(hotfix, 'ROOT_SOURCE', self.fixed),
                        patch.object(hotfix, 'OLD_SHA', hotfix.sha(self.old_source)),
                        patch.object(hotfix, 'FIRST_SHA', hotfix.sha(self.first)),
                        patch.object(hotfix, 'FIX_SHA', hotfix.sha(self.fixed)),
                        patch.object(hotfix, 'API_SHA', hotfix.sha(self.old / 'server/trades-api.mjs')),
                        patch.object(hotfix.os, 'geteuid', return_value=0),
                        patch.object(hotfix.time, 'sleep', return_value=None)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def verify(self):
        current = (self.root / 'current').resolve(strict=True)
        if current != self.old or hotfix.sha(current / 'server/daily-activity.mjs') not in (hotfix.OLD_SHA, hotfix.FIRST_SHA, hotfix.FIX_SHA):
            raise RuntimeError('ACTIVITY_API_VERSION_MISMATCH')
        return current

    def test_check_only_never_switches(self):
        with patch.object(hotfix, 'verified_path', side_effect=self.verify), patch.object(hotfix, 'command') as command:
            hotfix.run('--check')
            self.assertEqual((self.root / 'current').resolve(), self.old)
            command.assert_not_called()

    def test_install_preserves_old_release_and_data(self):
        with patch.object(hotfix, 'verified_path', side_effect=self.verify), patch.object(hotfix, 'command', return_value='active'), patch.object(hotfix, 'verify_http'):
            hotfix.run('--execute')
        active = (self.root / 'current').resolve()
        self.assertNotEqual(active, self.old)
        self.assertEqual((active / 'server/daily-activity.mjs').read_text(), 'fixed code')
        self.assertEqual(self.old_source.read_text(), 'old code')
        self.assertEqual(self.data.read_text(), 'unchanged activity')

    def test_failed_postcheck_restores_previous_release(self):
        with patch.object(hotfix, 'verified_path', side_effect=self.verify), patch.object(hotfix, 'command', return_value='active'), patch.object(hotfix, 'verify_http', side_effect=[RuntimeError('down')]*10+[None]):
            with self.assertRaisesRegex(RuntimeError, 'POSTCHECK_FAILED'):
                hotfix.run('--execute')
        self.assertEqual((self.root / 'current').resolve(), self.old)
        self.assertEqual(self.old_source.read_text(), 'old code')
        self.assertEqual(self.data.read_text(), 'unchanged activity')

    def test_mismatched_installed_source_stops_before_switch(self):
        self.old_source.write_text('unexpected version')
        with patch.object(hotfix, 'verified_path', side_effect=self.verify), patch.object(hotfix, 'command') as command:
            with self.assertRaisesRegex(RuntimeError, 'VERSION_MISMATCH'):
                hotfix.run('--execute')
            command.assert_not_called()
        self.assertEqual((self.root / 'current').resolve(), self.old)

    def test_rejects_wrong_chain_and_vault(self):
        good = {'version':1, 'chainId':97, 'vaultAddress':hotfix.TARGET}
        hotfix.validate_config(good)
        with self.assertRaisesRegex(RuntimeError, 'TARGET_MISMATCH'):
            hotfix.validate_config({**good, 'chainId':56})
        with self.assertRaisesRegex(RuntimeError, 'TARGET_MISMATCH'):
            hotfix.validate_config({**good, 'vaultAddress':'0x' + '1'*40})

    def test_first_patch_can_be_upgraded_and_restored(self):
        self.old_source.write_text('first patch code')
        with patch.object(hotfix, 'verified_path', side_effect=self.verify), patch.object(hotfix, 'command', return_value='active'), patch.object(hotfix, 'verify_http', side_effect=[RuntimeError('down')]*10+[None]):
            with self.assertRaisesRegex(RuntimeError, 'POSTCHECK_FAILED'):
                hotfix.run('--execute')
        self.assertEqual((self.root / 'current').resolve(), self.old)
        self.assertEqual(self.old_source.read_text(), 'first patch code')

    def test_already_fixed_never_restarts_or_switches(self):
        self.old_source.write_text('fixed code')
        with patch.object(hotfix, 'verified_path', side_effect=self.verify), patch.object(hotfix, 'command') as command:
            hotfix.run('--execute')
            command.assert_not_called()
        self.assertEqual((self.root / 'current').resolve(), self.old)

    def test_race_between_two_known_versions_stops_before_switch(self):
        calls = 0
        def changing():
            nonlocal calls
            calls += 1
            if calls == 2:
                self.old_source.write_text('first patch code')
            return self.verify()
        with patch.object(hotfix, 'verified_path', side_effect=changing), patch.object(hotfix, 'command', return_value='active'):
            with self.assertRaisesRegex(RuntimeError, 'RELEASE_CHANGED'):
                hotfix.run('--execute')
        self.assertEqual((self.root / 'current').resolve(), self.old)

    def test_verified_path_rejects_unexpected_entrypoint_and_versions(self):
        real_lstat = Path.lstat
        def owned(path, *args, **kwargs):
            result = real_lstat(path, *args, **kwargs)
            values = list(result)
            values[4] = 0  # tests do not require running as root
            return os.stat_result(values)
        def service(*args):
            if args[1] == 'is-active': return 'active'
            if 'WorkingDirectory' in args: return str(self.root / 'current')
            return str(self.root / 'current/server/trades-api.mjs')
        with patch.object(Path, 'lstat', owned), patch.object(hotfix, 'command', side_effect=service), patch.object(hotfix, 'verify_http'):
            for text in ('old code', 'first patch code', 'fixed code'):
                self.old_source.write_text(text)
                self.assertEqual(hotfix.verified_path(), self.old)
            self.old_source.write_text('unknown')
            with self.assertRaisesRegex(RuntimeError, 'VERSION_MISMATCH'):
                hotfix.verified_path()
            self.old_source.write_text('old code')
            (self.old / 'server/trades-api.mjs').write_text('unexpected API')
            with self.assertRaisesRegex(RuntimeError, 'ENTRYPOINT_MISMATCH'):
                hotfix.verified_path()

    def test_preflight_allows_rate_limit_but_postcheck_requires_healthy_api(self):
        good = {'version':1, 'chainId':97, 'vaultAddress':hotfix.TARGET}
        limited = urllib.error.HTTPError('http://127.0.0.1/status', 429, 'rate limit', {}, None)
        with patch.object(hotfix, 'fetch', side_effect=[good, limited]):
            hotfix.verify_http(allow_limited=True)
        with patch.object(hotfix, 'fetch', side_effect=[good, limited]):
            with self.assertRaises(urllib.error.HTTPError):
                hotfix.verify_http()


if __name__ == '__main__':
    unittest.main()
