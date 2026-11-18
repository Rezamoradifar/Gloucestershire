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
fi
node() {
  printf '%s\n' "${*:2}" >> "$TRACE"
  case "$2" in
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
apply_release "$REVISION" "$TEST_PROOF"
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
                   CHECK_RESULT="0", SITE_RESULT="0", DEPLOY_RESULT="0", RECOVER_RESULT="0")
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


if __name__ == "__main__":
    unittest.main()
