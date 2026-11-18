"""Exercise hourly account archival, atomic promotion, retries and rollback."""

import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/publish-v3-hourly-account-route.py"
spec = importlib.util.spec_from_file_location("hourly_account", SCRIPT)
hourly = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hourly)


class HourlyPublication(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="global-hourly-promotion-")
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.root, self.dist = self.work / "root", self.work / "dist"
        self.root.mkdir()
        self.target = self.root / "hourly-test"
        self.history = self.root / hourly.HISTORY
        for directory, script in ((self.target, hourly.OLD_VAULT), (self.dist, "new account")):
            (directory / "assets").mkdir(parents=True)
            (directory / "index.html").write_text('<script type="module" src="./assets/index-test.js"></script>')
            (directory / "assets/index-test.js").write_text(script)
        self.expected = hourly.index_hash(self.target)
        self.original = hourly.atomic.release_digest(self.target)
        self.checked = []

    def verify(self, directory, work, url):
        served = self.history if url == hourly.HISTORY_URL else self.target
        self.assertEqual(hourly.atomic.release_digest(directory), hourly.atomic.release_digest(served))
        self.checked.append(url)

    def publish(self, verify=None):
        return hourly.publish(self.root, self.dist, self.expected, verify or self.verify)

    def test_archives_old_account_before_promoting_and_allows_verified_retries(self):
        self.publish()
        self.assertEqual(hourly.atomic.release_digest(self.history), self.original)
        self.assertTrue(hourly.atomic.marked_release(self.history))
        self.assertTrue(hourly.atomic.marked_release(self.target))
        self.assertEqual(self.checked, [hourly.HISTORY_URL, hourly.ACTIVE_URL])
        (self.dist / "assets/index-test.js").write_text("updated account")
        self.expected = hourly.index_hash(self.target)
        self.publish()
        self.assertEqual((self.target / "assets/index-test.js").read_text(), "updated account")
        self.assertEqual(hourly.atomic.release_digest(self.history), self.original)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["hourly-test", hourly.HISTORY])

    def test_failed_live_verification_restores_the_original_and_retry_succeeds(self):
        def fail_live(directory, work, url):
            self.verify(directory, work, url)
            if url == hourly.ACTIVE_URL:
                raise ValueError("SIMULATED_BAD_ASSET")
        with self.assertRaisesRegex(ValueError, "SIMULATED_BAD_ASSET"):
            self.publish(fail_live)
        self.assertEqual(hourly.atomic.release_digest(self.target), self.original)
        self.assertTrue(hourly.atomic.marked_release(self.history))
        self.publish()
        self.assertEqual((self.target / "assets/index-test.js").read_text(), "new account")

    def test_unserved_archive_does_not_switch_the_live_account(self):
        def fail_archive(directory, work, url):
            self.assertEqual(url, hourly.HISTORY_URL)
            raise ValueError("ARCHIVE_UNREACHABLE")
        with self.assertRaisesRegex(ValueError, "ARCHIVE_UNREACHABLE"):
            self.publish(fail_archive)
        self.assertEqual(hourly.atomic.release_digest(self.target), self.original)
        self.publish()

    def test_changed_live_index_does_not_create_an_archive(self):
        (self.target / "index.html").write_text("concurrently replaced")
        with self.assertRaisesRegex(ValueError, "SOURCE_CHANGED"):
            self.publish()
        self.assertFalse(self.history.exists())

    def test_existing_unowned_archive_is_preserved(self):
        self.history.mkdir()
        (self.history / "index.html").write_text("operator content")
        with self.assertRaisesRegex(ValueError, "HISTORY_NOT_OWNED"):
            self.publish()
        self.assertEqual((self.history / "index.html").read_text(), "operator content")
        self.assertEqual(hourly.atomic.release_digest(self.target), self.original)

    def test_changed_archived_asset_and_live_unmarked_asset_are_rejected(self):
        self.publish()
        (self.history / "assets/index-test.js").write_text("changed archive")
        with self.assertRaisesRegex(ValueError, "HISTORY_NOT_OWNED"):
            self.publish()
        (self.history / "assets/index-test.js").write_text(hourly.OLD_VAULT)
        (self.target / hourly.atomic.MANIFEST).unlink()
        with self.assertRaisesRegex(ValueError, "TARGET_NOT_OWNED"):
            self.publish()

    def test_source_symlinks_and_non_hourly_account_are_rejected(self):
        (self.dist / "assets/link.js").symlink_to(self.target / "assets/index-test.js")
        with self.assertRaisesRegex(ValueError, "UNSAFE_FILE|PERMISSIONS_INVALID"):
            self.publish()
        self.assertFalse(self.history.exists())
        (self.dist / "assets/link.js").unlink()
        (self.target / "assets/index-test.js").write_text("another account")
        with self.assertRaisesRegex(ValueError, "PREVIOUS_ACCOUNT_INVALID"):
            self.publish()


if __name__ == "__main__":
    unittest.main()
