"""Exercise the release sequencing without any wallet, provider, system service or live website."""
from hashlib import sha256
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "scripts/apply-v3-unified-testnet.sh"
REVISION = "a" * 40
PROOF = b'{"vault":"isolated"}\n'
DIGEST = sha256(PROOF).hexdigest()
SIGN_RPC = "https://bsc-testnet-dataseed.bnbchain.org"
READ_RPC = "https://bsc-testnet-rpc.publicnode.com"

# Record only arguments to the external deployment/publishing programs. Use the
# actual orchestration, SHA-256 check, existing-proof test and exit handling.
HARNESS = r"""
source "$SOURCE"
if [[ ${SINGLE_CAPITAL:-0} == 1 ]]; then
  profile=(--single-capital)
  route_name=single-capital-test
elif [[ ${REFERRAL_PROFIT:-0} == 1 ]]; then
  profile=(--referral-profit)
  route_name=referral-profit-test
elif [[ ${MANUAL_REINVEST:-0} == 1 ]]; then
  profile=(--manual-reinvest)
  route_name=manual-reinvest-test
elif [[ ${UPLINE_RATES:-0} == 1 ]]; then
  profile=(--upline-rates)
  route_name=upline-rates-test
fi
node() {
  printf '%s\n' "${*:2}" >> "$TRACE"
  case "$2" in
    --install) return "$PRIMARY_RESULT" ;;
    --check) return "$CHECK_RESULT" ;;
    --deploy-testnet) printf '{"vault":"isolated"}\n' > "$TEST_PROOF"; return "$DEPLOY_RESULT" ;;
    --recover-existing)
      if [[ $RECOVER_RESULT == 0 ]]; then printf '{"vault":"isolated"}\n' > "$TEST_PROOF"; fi
      return "$RECOVER_RESULT" ;;
    --verify-existing) printf 'UNIFIED_DEPLOYMENT_PROOF_SHA256=%s\n' "$DIGEST"; return "$VERIFY_RESULT" ;;
    *) return 99 ;;
  esac
}
bash() {
  case "$1" in
    scripts/install-v3-unified-worker.sh) echo "worker ${*:2}" >> "$TRACE"; return "$WORKER_RESULT" ;;
    scripts/install-v3-unified-test-site.sh) printf '%s\n' "$*" >> "$TRACE"; return "$SITE_RESULT" ;;
    *) return 99 ;;
  esac
}
sleep() { :; }
apply_release "$REVISION" "$TEST_PROOF" "${DEPLOY_OPTION:-}"
"""


class ApplyTestnet(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.proof = Path(self.temp.name) / "proof"
        self.trace = Path(self.temp.name) / "trace"

    def apply(self, **settings):
        env = dict(os.environ, SOURCE=str(SOURCE), REVISION=REVISION, TEST_PROOF=str(self.proof),
                   TRACE=str(self.trace), DIGEST=DIGEST, WORKER_RESULT="0", VERIFY_RESULT="0",
                   CHECK_RESULT="0", SITE_RESULT="0", DEPLOY_RESULT="0", RECOVER_RESULT="0", PRIMARY_RESULT="0")
        env.update(settings)
        self.trace.write_text("")
        proc = subprocess.run(["bash", "-c", HARNESS], env=env, capture_output=True, text=True)
        return proc, self.trace.read_text().splitlines()

    def test_release_then_repeat(self):
        first, calls = self.apply()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(calls[:3], [f"--check {READ_RPC}", f"--deploy-testnet {SIGN_RPC}", f"--verify-existing {READ_RPC}"])
        self.assertEqual(calls[3], f"worker {REVISION}")
        publish = f"scripts/install-v3-unified-test-site.sh --install-prepared {REVISION} {self.proof} {DIGEST} {SIGN_RPC} --enable-testnet-wallets"
        self.assertEqual(calls[4], publish)
        repeat, calls = self.apply()
        self.assertEqual(repeat.returncode, 0, repeat.stderr)
        self.assertEqual(calls, [f"--verify-existing {READ_RPC}", f"worker {REVISION}", publish])

    def test_preview_then_retry_after_funding(self):
        first, calls = self.apply(WORKER_RESULT="42")
        self.assertEqual(first.returncode, 42, first.stderr)
        self.assertIn("UNIFIED_TESTNET_READ_ONLY_AVAILABLE", first.stdout)
        self.assertNotIn("--enable-testnet-wallets", calls[-1])
        repeat, calls = self.apply()
        self.assertEqual(repeat.returncode, 0, repeat.stderr)
        self.assertFalse(any("--deploy-testnet" in call for call in calls))
        self.assertTrue(calls[-1].endswith("--enable-testnet-wallets"))

    def test_fails_closed_on_rpc_or_receipt_ambiguity(self):
        first, calls = self.apply(CHECK_RESULT="1")
        self.assertEqual(first.returncode, 1)
        self.assertEqual(calls, [f"--check {READ_RPC}"])
        ambiguous, calls = self.apply(DEPLOY_RESULT="1")
        self.assertEqual(ambiguous.returncode, 1)
        self.assertEqual(calls, [f"--check {READ_RPC}", f"--deploy-testnet {SIGN_RPC}"])
        unavailable, calls = self.apply(VERIFY_RESULT="1")
        self.assertNotEqual(unavailable.returncode, 0)
        self.assertEqual(calls, [f"--verify-existing {READ_RPC}"] * 4)

    def test_recovers_journal_without_another_signature(self):
        (self.proof.parent / "pending.json").write_text("{}")
        pending, calls = self.apply(RECOVER_RESULT="1")
        self.assertNotEqual(pending.returncode, 0)
        self.assertEqual(calls, [f"--recover-existing {READ_RPC}"])
        confirmed, calls = self.apply()
        self.assertEqual(confirmed.returncode, 0, confirmed.stderr)
        self.assertEqual(calls[:2], [f"--recover-existing {READ_RPC}", f"--verify-existing {READ_RPC}"])
        self.assertFalse(any("--deploy-testnet" in call for call in calls))

    def test_mismatched_proof_and_failed_worker_do_not_publish(self):
        self.proof.write_bytes(PROOF)
        mismatch, calls = self.apply(DIGEST="0" * 64)
        self.assertNotEqual(mismatch.returncode, 0)
        self.assertEqual(calls, [f"--verify-existing {READ_RPC}"])
        broken, calls = self.apply(WORKER_RESULT="12")
        self.assertEqual(broken.returncode, 12)
        self.assertEqual(calls, [f"--verify-existing {READ_RPC}", f"worker {REVISION}"])

    def test_site_error_is_visible_to_operator(self):
        failed, calls = self.apply(SITE_RESULT="17")
        self.assertEqual(failed.returncode, 17)
        self.assertIn("--enable-testnet-wallets", calls[-1])
        self.assertNotIn("UNIFIED_TESTNET_WALLET_DASHBOARD_AVAILABLE", failed.stdout)

    def test_single_capital_only_releases_an_existing_separate_deployment(self):
        missing, calls = self.apply(SINGLE_CAPITAL="1")
        self.assertEqual(missing.returncode, 1)
        self.assertIn("SINGLE_CAPITAL_VERIFIED_DEPLOYMENT_REQUIRED", missing.stderr)
        self.assertEqual(calls, [])
        self.proof.write_bytes(PROOF)
        installed, calls = self.apply(SINGLE_CAPITAL="1")
        self.assertEqual(installed.returncode, 0, installed.stderr)
        self.assertEqual(calls[:2], [f"--verify-existing {READ_RPC} --single-capital",
                                     f"worker {REVISION} --single-capital"])
        self.assertIn("scripts/install-v3-unified-test-site.sh --single-capital --install-prepared", calls[2])
        self.assertIn("UNIFIED_TESTNET_WALLET_DASHBOARD_AVAILABLE=https://globaldroptrade.com/single-capital-test/",
                      installed.stdout)

    def test_explicit_single_capital_install_deploys_only_once_and_resumes_after_funding(self):
        options = dict(SINGLE_CAPITAL="1", DEPLOY_OPTION="--deploy-testnet")
        first, calls = self.apply(**options, WORKER_RESULT="42")
        self.assertEqual(first.returncode, 42, first.stderr)
        self.assertEqual(calls[:3], [f"--check {READ_RPC} --single-capital",
                                     f"--deploy-testnet {SIGN_RPC} --single-capital",
                                     f"--verify-existing {READ_RPC} --single-capital"])
        self.assertIn("UNIFIED_TESTNET_READ_ONLY_AVAILABLE=https://globaldroptrade.com/single-capital-test/", first.stdout)
        retry, calls = self.apply(**options)
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertFalse(any("--deploy-testnet" in call for call in calls))
        self.assertTrue(calls[-1].endswith("--enable-testnet-wallets"))

    def test_single_capital_pending_receipt_never_rebroadcasts(self):
        (self.proof.parent / "pending.json").write_text("{}")
        options = dict(SINGLE_CAPITAL="1", DEPLOY_OPTION="--deploy-testnet")
        pending, calls = self.apply(**options, RECOVER_RESULT="1")
        self.assertNotEqual(pending.returncode, 0)
        self.assertEqual(calls, [f"--recover-existing {READ_RPC} --single-capital"])
        recovered, calls = self.apply(**options)
        self.assertEqual(recovered.returncode, 0, recovered.stderr)
        self.assertEqual(calls[:2], [f"--recover-existing {READ_RPC} --single-capital",
                                     f"--verify-existing {READ_RPC} --single-capital"])

    def test_primary_reuses_the_existing_proof_and_reports_only_verified_publication(self):
        self.proof.write_bytes(PROOF)
        options = dict(SINGLE_CAPITAL="1", DEPLOY_OPTION="--primary")
        result, calls = self.apply(**options)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [f"--verify-existing {READ_RPC} --single-capital",
                                f"worker {REVISION} --single-capital",
                                f"--install {REVISION} {DIGEST} {SIGN_RPC} --single-capital"])
        self.assertIn("GLOBAL_SINGLE_CAPITAL_PRIMARY_AVAILABLE", result.stdout)
        failure, calls = self.apply(**options, PRIMARY_RESULT="7")
        self.assertEqual(failure.returncode, 7)
        self.assertNotIn("GLOBAL_SINGLE_CAPITAL_PRIMARY_AVAILABLE", failure.stdout)

    def test_referral_profit_requires_its_own_deployment_before_primary(self):
        result, calls = self.apply(REFERRAL_PROFIT="1", DEPLOY_OPTION="--primary")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])
        self.proof.write_bytes(PROOF)
        result, calls = self.apply(REFERRAL_PROFIT="1", DEPLOY_OPTION="--primary")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [f"--verify-existing {READ_RPC} --referral-profit",
                                 f"worker {REVISION} --referral-profit",
                                 f"--install {REVISION} {DIGEST} {SIGN_RPC} --referral-profit"])


    def test_upline_rates_deploys_once_and_reuses_its_own_proof_for_primary(self):
        first, calls = self.apply(UPLINE_RATES="1", DEPLOY_OPTION="--deploy-testnet")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn(f"--deploy-testnet {SIGN_RPC} --upline-rates", calls)
        second, calls = self.apply(UPLINE_RATES="1", DEPLOY_OPTION="--primary")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(calls, [f"--verify-existing {READ_RPC} --upline-rates",
                                 f"worker {REVISION} --upline-rates",
                                 f"--install {REVISION} {DIGEST} {SIGN_RPC} --upline-rates"])

    def test_manual_reinvest_reuses_its_own_proof_and_worker_for_primary(self):
        result, calls = self.apply(MANUAL_REINVEST="1", DEPLOY_OPTION="--primary")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])
        self.proof.write_bytes(PROOF)
        result, calls = self.apply(MANUAL_REINVEST="1", DEPLOY_OPTION="--primary")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [f"--verify-existing {READ_RPC} --manual-reinvest",
                                 f"worker {REVISION} --manual-reinvest",
                                 f"--install {REVISION} {DIGEST} {SIGN_RPC} --manual-reinvest"])


class InodeWorkspace(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.parent = Path(temp.name)
        self.work = self.parent / "global-v3-unified-run.ABCDef12"
        self.checkout = self.work / "release"
        scripts = self.checkout / "scripts"
        scripts.mkdir(parents=True)
        self.trace = self.parent / "trace"
        self.env = dict(os.environ, SOURCE=str(SOURCE), WORK=str(self.work), TRACE=str(self.trace),
                        TEST_INODES="92667", TEST_KIB="10037276", REVISION=REVISION, INSTALL_STATUS="0")
        # In a real private mount, exercise the production capacity check and verify
        # that only the build moved. Stop before calling npm or any service.
        (scripts / SOURCE.name).write_text(SOURCE.read_text() + r"""
install_and_apply() {
  check_capacity "$1" "$build_inodes" 2097152
  mountpoint -q "$1"
  [[ $(stat -f -c %T "$1") == ext2/ext3 && $(stat -c %a "$1") == 700 ]]
  [[ $(stat -c %d "$1") != $(stat -c %d "$WORK") && $PWD == "$1/release" ]]
  [[ -f scripts/apply-v3-unified-testnet.sh ]]
  printf '%s\n' "$@" > "$TRACE"
  exit "$INSTALL_STATUS"
}
""")

    def invoke(self, **changes):
        harness = r"""
source "$SOURCE"
df() {
  if [[ ${!#} != "$WORK" ]]; then command df "$@"; return; fi
  local value=$TEST_INODES
  if [[ $1 == -Pk ]]; then value=$TEST_KIB; fi
  printf 'Filesystem total used available\nfixture 0 0 %s\n' "$value"
}
install_and_apply() { printf '%s\n' "$@" > "$TRACE"; }
install_with_available_storage "$WORK" "$REVISION" single-capital-test /var/lib/example/proof.json --primary
"""
        env = dict(self.env, **changes)
        return subprocess.run(["bash", "-c", harness], cwd=self.checkout, env=env,
                              capture_output=True, text=True)

    def assert_clean(self):
        self.assertEqual(list(self.work.iterdir()), [self.checkout])
        self.assertEqual(set(self.parent.iterdir()) - {self.trace}, {self.work})

    def test_normal_storage_without_image_and_persistent_space_floor(self):
        result = self.invoke(TEST_INODES="95000")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.trace.read_text().splitlines(), [
            str(self.work), REVISION, "single-capital-test", "/var/lib/example/proof.json", "--primary"])
        self.trace.unlink()
        for changes in [{"TEST_KIB": "4194303"}, {"TEST_INODES": "9999"}, {"TEST_INODES": "-"}]:
            with self.subTest(changes=changes):
                result = self.invoke(**changes)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.trace.exists())
                self.assert_clean()

    @unittest.skipUnless(os.geteuid() == 0, "the private ext4 mount needs root")
    def test_reported_shortfall_uses_private_ext4_and_cleans_up_after_success_and_failure(self):
        for status in (0, 37):
            with self.subTest(status=status):
                result = self.invoke(INSTALL_STATUS=str(status))
                self.assertEqual(result.returncode, status, result.stdout + result.stderr)
                self.assertIn("UNIFIED_USING_PRIVATE_INODE_WORKSPACE", result.stdout)
                stage, *args = self.trace.read_text().splitlines()
                self.assertNotEqual(stage, str(self.work))
                self.assertEqual(args, [REVISION, "single-capital-test", "/var/lib/example/proof.json", "--primary"])
                self.assert_clean()
                self.trace.unlink()


class WorkerGasInstallation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tools = self.root / "bin"
        self.tools.mkdir()
        self.units = self.root / "system"
        self.units.mkdir()
        config = self.root / "config"
        config.mkdir()
        source = SOURCE.with_name("install-v3-unified-worker.sh").read_text()
        source = source.replace("/etc/globaldroptrade", str(config))
        source = source.replace("/etc/systemd/system", str(self.units))
        source = source.replace("/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin", str(self.tools))
        for label in ["unified", "single-capital", "daily-capital"]:
            release_root = self.root / (label + "-worker")
            release = release_root / REVISION
            release.mkdir(parents=True)
            (release / ".release").write_text(REVISION + "\n")
            proof = self.root / (label + "-state")
            proof.mkdir()
            (proof / "deployment-proof.json").write_bytes(PROOF)
            source = source.replace("/opt/global-v3-" + label + "-worker", str(release_root))
            source = source.replace("/var/lib/globaldroptrade/v3-" + label + "-testnet", str(proof))
        source = source.replace("/opt/global-v3-$name-worker", str(self.root / "$name-worker"))
        source = source.replace("/var/lib/globaldroptrade/v3-$name-testnet", str(self.root / "$name-state"))
        self.script = self.root / "worker.sh"
        self.script.write_text(source)
        self.env = dict(os.environ, PATH=str(self.tools) + os.pathsep + os.environ["PATH"],
                        REVISION=REVISION, TRACE=str(self.root / "calls"), GAS_STATUS="0")
        self.mock("hostname", "echo vps-luna-2585")
        self.mock("git", 'if [[ $1 == rev-parse ]]; then echo "$REVISION"; fi')
        self.mock("id", """case "$1:$#" in
  -u:1) echo 0 ;;
  -u:2) echo 1001 ;;
  -Gn:2) echo "$2" ;;
  *) exit 99 ;;
esac""")
        self.mock("stat", 'if [[ $2 == %u ]]; then echo 0; else exec /usr/bin/stat "$@"; fi')
        self.mock("npm", "exit 99")
        self.mock("node", """echo "$*" >> "$TRACE"
if [[ $2 == --check ]]; then exit "$GAS_STATUS"; fi""")
        self.mock("getent", 'echo "$2:x:1001:1001::/nonexistent:/usr/sbin/nologin"')
        self.mock("systemd-analyze", 'echo "verify $*" >> "$TRACE"')
        self.mock("systemctl", 'echo "systemctl $*" >> "$TRACE"')

    def mock(self, name, code):
        script = self.tools / name
        script.write_text("#!/bin/bash\nset -eu\n" + code + "\n")
        script.chmod(0o755)

    def invoke(self, status, *profile):
        self.env["GAS_STATUS"] = str(status)
        return subprocess.run(["bash", str(self.script), REVISION, *profile],
                              env=self.env, capture_output=True, text=True)

    def test_single_capital_installs_timer_for_zero_gas_and_checks_again_after_funding(self):
        waiting = self.invoke(42, "--single-capital")
        self.assertEqual(waiting.returncode, 0, waiting.stderr)
        self.assertIn("UNIFIED_TESTNET_WORKER_WAITING_FOR_TEST_GAS", waiting.stdout)
        unit = "global-v3-single-capital-keeper-testnet"
        self.assertIn("SuccessExitStatus=42", (self.units / (unit + ".service")).read_text())
        calls = (self.root / "calls").read_text()
        self.assertIn("systemctl start " + unit + ".service", calls)
        self.assertIn("systemctl enable --now " + unit + ".timer", calls)
        funded = self.invoke(0, "--single-capital")
        self.assertEqual(funded.returncode, 0, funded.stderr)
        self.assertIn("UNIFIED_TESTNET_WORKER_ACTIVE", funded.stdout)

    def test_daily_worker_uses_its_own_deployment_and_timer(self):
        result = self.invoke(0, "--daily-capital")
        self.assertEqual(result.returncode, 0, result.stderr)
        unit = self.units / "global-v3-daily-capital-keeper-testnet.service"
        self.assertIn(str(self.root / "daily-capital-state" / "deployment-proof.json"), unit.read_text())
        self.assertIn("--tick --daily-capital", unit.read_text())
        self.assertFalse((self.units / "global-v3-single-capital-keeper-testnet.timer").exists())

    def test_other_errors_and_the_legacy_gas_gate_still_stop_before_installation(self):
        for status, profile in [(1, ("--single-capital",)), (42, ())]:
            result = self.invoke(status, *profile)
            self.assertEqual(result.returncode, status, result.stderr)
            self.assertEqual(list(self.units.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
