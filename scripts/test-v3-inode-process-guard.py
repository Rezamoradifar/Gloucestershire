import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location('inode_guard', Path(__file__).with_name('v3-inode-process-guard.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class ProcessGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.release = root / 'release'
        self.release.mkdir()
        self.proc = root / 'proc'
        self.proc.mkdir()
        self.process = self.proc / '12345'
        self.process.mkdir()
        (self.process / 'cmdline').write_bytes(b'node\0server.js\0')
        (self.process / 'fd').mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def check(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return guard.check(str(self.release), self.proc)

    def test_unrelated_process_is_allowed(self):
        (self.process / 'cwd').symlink_to(self.proc)
        self.assertEqual(self.check(), 0)

    def test_process_working_directory_stops_cleanup(self):
        (self.process / 'cwd').symlink_to(self.release)
        self.assertEqual(self.check(), 1)

    def test_process_command_stops_cleanup(self):
        (self.process / 'cmdline').write_bytes(b'node\0' + bytes(str(self.release), 'utf8') + b'/script.js\0')
        self.assertEqual(self.check(), 1)

    def test_open_file_stops_cleanup(self):
        (self.process / 'fd' / '3').symlink_to(self.release / 'node_modules' / 'package.js')
        self.assertEqual(self.check(), 1)

    def test_missing_proc_directory_fails_closed(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.check(str(self.release), self.proc / 'missing'), 2)

    def test_sibling_with_common_prefix_is_not_the_release(self):
        self.assertFalse(guard.in_release(str(self.release) + '-other/file', str(self.release)))

    def test_webroot_symlink_stops_cleanup(self):
        webroot = self.proc.parent / 'web'
        webroot.mkdir()
        (webroot / 'current').symlink_to(self.release)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.check_web_links(str(self.release), webroot), 1)

    def test_unrelated_webroot_is_allowed(self):
        webroot = self.proc.parent / 'web'
        webroot.mkdir()
        (webroot / 'other').symlink_to(self.proc)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.check_web_links(str(self.release), webroot), 0)


if __name__ == '__main__':
    unittest.main()
