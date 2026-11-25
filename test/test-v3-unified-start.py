import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/start-v3-unified-release.sh"
PIN = "abcdef1234" * 4


class PinnedBootstrap(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        self.tools = self.root / "bin"
        self.tools.mkdir()
        self.stages = self.root / "stages"
        self.stages.mkdir()
        self.log = self.root / "apply.log"
        self.env = dict(os.environ, PATH=f"{self.tools}{os.pathsep}{os.environ['PATH']}",
                        RECEIVED_SHA=PIN, APPLY_LOG=str(self.log), APPLY_STATUS="0")
        self.mock("id", 'echo 0')
        self.mock("hostname", 'echo vps-luna-2585')
        # Redirect only the temp allocation requested by the production entry point.
        self.mock("mktemp", f'''test "$3" = "/opt/global-v3-unified-run.XXXXXXXX"
exec /usr/bin/mktemp -d -- {shlex.quote(str(self.stages))}/global-v3-unified-run.XXXXXXXX''')
        self.mock("git", '''case " $* " in
  *" init "*) mkdir -p -- "${!#}/.git" ;;
  *" fetch "*) [[ " $* " == *" https://github.com/Rezamoradifar/Gloucestershire.git "* &&
                  " $* " == *" --depth=1 "* ]] ;;
  *" rev-parse "*) echo "$RECEIVED_SHA" ;;
  *" checkout "*) mkdir -p "$2/scripts"
cat > "$2/scripts/apply-v3-unified-testnet.sh" <<'SH'
printf '%s %s%s\\n' "$1" "$PWD" "${2:+ $2}${3:+ $3}" > "$APPLY_LOG"
exit "$APPLY_STATUS"
SH
    ;;
  *) exit 91 ;;
esac''')

    def mock(self, name, body):
        target = self.tools / name
        target.write_text("#!/bin/bash\nset -eu\n" + body + "\n")
        target.chmod(0o755)

    def invoke(self, *args):
        return subprocess.run(["bash", str(SCRIPT), *args], env=self.env, capture_output=True, text=True)

    def test_exact_pin_and_exit_status_reach_apply_and_checkout_is_released(self):
        self.env["APPLY_STATUS"] = "42"
        result = self.invoke(PIN)
        self.assertEqual(result.returncode, 42, result.stderr)
        reported, stage = self.log.read_text().split()
        self.assertEqual(reported, PIN)
        self.assertEqual(Path(stage).parent.parent, self.stages)
        self.assertEqual(list(self.stages.iterdir()), [])

    def test_plan_portfolio_forwards_isolated_actions_and_preserves_primary(self):
        for flags in [(), ("--deploy-testnet",)]:
            with self.subTest(flags=flags):
                result = self.invoke(PIN, "--plan-portfolio", *flags)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.log.read_text().split()[2:], ["--plan-portfolio", *flags])
                self.log.unlink()
        for primary in ["--primary", "--primary-with-commerce"]:
            self.assertIn("UNIFIED_START_INVALID_PROFILE", self.invoke(PIN, "--plan-portfolio", primary).stderr)
            self.assertFalse(self.log.exists())

    def test_mismatch_and_wrong_host_never_start_apply(self):
        self.env["RECEIVED_SHA"] = "0" * 40
        self.assertIn("UNIFIED_START_FETCHED_SHA_MISMATCH", self.invoke(PIN).stderr)
        self.assertEqual(list(self.stages.iterdir()), [])
        self.mock("hostname", "echo other-host")
        self.assertIn("UNIFIED_START_WRONG_SERVER", self.invoke(PIN).stderr)
        self.assertIn("UNIFIED_START_EXPECTED_PINNED_SHA", self.invoke("main").stderr)
        self.assertFalse(self.log.exists())

    def test_explicit_single_capital_deployment_flag_is_forwarded_only_with_its_profile(self):
        result = self.invoke(PIN, "--single-capital", "--deploy-testnet")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.log.read_text().split()[2:], ["--single-capital", "--deploy-testnet"])
        self.log.unlink()
        for flags in [("--deploy-testnet",), ("--single-capital", "--other")]:
            self.assertNotEqual(self.invoke(PIN, *flags).returncode, 0)
            self.assertFalse(self.log.exists())

    def test_primary_publication_is_forwarded_for_the_single_capital_profile(self):
        result = self.invoke(PIN, "--single-capital", "--primary")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.log.read_text().split()[2:], ["--single-capital", "--primary"])
        self.log.unlink()
        self.assertNotEqual(self.invoke(PIN, "--primary").returncode, 0)
        self.assertFalse(self.log.exists())

    def test_referral_profiles_keep_deployment_and_promotion_explicit(self):
        for profile in ["--referral-profit", "--manual-reinvest", "--upline-rates", "--account-reinvest"]:
            for options in [(), ("--deploy-testnet",), ("--primary",)]:
                result = self.invoke(PIN, profile, *options)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.log.read_text().split()[2:], [profile, *options])

    def test_primary_with_commerce_only_accepts_the_existing_account_profile(self):
        result = self.invoke(PIN, "--account-reinvest", "--primary-with-commerce")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.log.read_text().split()[2:], ["--account-reinvest", "--primary-with-commerce"])
        self.log.unlink()
        self.assertNotEqual(self.invoke(PIN, "--single-capital", "--primary-with-commerce").returncode, 0)
        self.assertFalse(self.log.exists())


if __name__ == "__main__":
    unittest.main()
