"""Run the operator bootstrap with a simulated checkout and no host services."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "scripts/resume-v3-unified-wallet-site.sh"
PIN = "605cac9898c1e661d7ba9ce481f258ba0e289136"
PREPARE = r"""
source "$SOURCE"
proof=$SANDBOX/proof
keeper_key=$SANDBOX/key
state=$SANDBOX/state
mkdir -p "$state"
mktemp() { command mktemp -d -- "$SANDBOX/checkout.XXXXXXXX"; }
git() {
  case " $* " in
    *" init "*) mkdir -p -- "${!#}/scripts" ;;
    *" fetch "*) [[ " $* " == *" $repository $release_sha "* ]] ;;
    *" rev-parse "*) echo "$FETCHED" ;;
    *" checkout "*)
      printf '%s\n' 'echo "$1" > "$SANDBOX/applied-sha"; exit "$APPLY_RC"' > "$2/scripts/apply-v3-unified-testnet.sh" ;;
    *) return 91 ;;
  esac
}
systemctl() { echo inactive; }
journalctl() { :; }
"""


class ResumeTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.sandbox = Path(temp.name)
        self.env = dict(os.environ, SANDBOX=str(self.sandbox), SOURCE=str(SOURCE), FETCHED=PIN, APPLY_RC="0")

    def invoke(self, command):
        return subprocess.run(["bash", "-c", PREPARE + command], env=self.env, capture_output=True, text=True)

    def supply_files(self):
        for name in ["proof", "key"]:
            (self.sandbox / name).write_text("fixture")

    def test_absent_existing_state_is_named_and_nothing_is_applied(self):
        p = self.invoke('run_service testunit')
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("UNIFIED_RESUME_EXISTING_PROOF_MISSING", p.stderr)
        self.assertIn("UNIFIED_RESUME_EXISTING_KEEPER_KEY_MISSING", p.stderr)
        self.assertFalse((self.sandbox / "applied-sha").exists())

    def test_wrong_fetched_sha_aborts_before_apply(self):
        self.supply_files()
        self.env["FETCHED"] = "0" * 40
        p = self.invoke('run_service testunit')
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("UNIFIED_RESUME_FETCHED_SHA_MISMATCH", p.stderr)
        self.assertFalse((self.sandbox / "applied-sha").exists())
        self.assertEqual(list(self.sandbox.glob("checkout.*")), [])

    def test_exit_and_status_match_underlying_application(self):
        self.supply_files()
        for code in [0, 17, 42]:
            with self.subTest(code=code):
                self.env["APPLY_RC"] = str(code)
                self.assertEqual(self.invoke('run_service testunit').returncode, code)
                self.assertEqual((self.sandbox / "applied-sha").read_text().strip(), PIN)
                self.assertEqual(self.invoke('report testunit').returncode, code)
                self.assertEqual(list(self.sandbox.glob("checkout.*")), [])

    def test_missing_completion_never_reports_success_for_stopped_unit(self):
        p = self.invoke('report previous-unit')
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("UNIFIED_RESUME_NO_COMPLETION_RESULT", p.stderr)


if __name__ == "__main__":
    unittest.main()
