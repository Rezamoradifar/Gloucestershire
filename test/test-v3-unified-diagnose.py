"""Check the operator diagnosis without reading wallets or changing host state."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "scripts/resume-v3-unified-wallet-site.sh"
UNIT = "global-v3-unified-wallet-1795008224-860350"
HARNESS = r"""
source "$SOURCE"
state=$SANDBOX/state
public_state=$SANDBOX/public
id() { echo 0; }
hostname() { echo vps-luna-2585; }
systemctl() {
  printf '%s\n' "$*" >> "$SANDBOX/service-calls"
  [[ $1 == show ]] || return 99
  printf 'LoadState=loaded\nActiveState=inactive\nResult=exit-code\nExecMainStatus=1\n'
}
journalctl() {
  local count=0 marker=0 previous=''
  printf '%s\n' "$*" >> "$SANDBOX/journal-calls"
  for arg in "$@"; do
    [[ $previous != -n ]] || count=$arg
    [[ $arg != --grep=* ]] || marker=1
    previous=$arg
  done
  if (( marker )); then printf 'UNIFIED_RESUME_EXIT=1\n'; else tail -n "$count" "$SANDBOX/journal"; fi
}
git() { echo forbidden-git >> "$SANDBOX/mutations"; return 99; }
node() { echo forbidden-node >> "$SANDBOX/mutations"; return 99; }
systemd-run() { echo forbidden-systemd-run >> "$SANDBOX/mutations"; return 99; }
mkdir() { echo forbidden-mkdir >> "$SANDBOX/mutations"; return 99; }
install() { echo forbidden-install >> "$SANDBOX/mutations"; return 99; }
resume_main --diagnose
"""


class DiagnoseRuntime(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.env = dict(os.environ, SOURCE=str(SOURCE), SANDBOX=str(self.root))
        (self.root / "journal").write_text("Error: actual failure before a long stack\n" +
                                           "    at redacted.js:1:1\n" * 35 +
                                           "Node.js v22.23.3\nUNIFIED_RESUME_EXIT=1\n")

    def invoke(self):
        return subprocess.run(["bash", "-c", HARNESS], env=self.env, capture_output=True, text=True)

    def test_diagnosis_does_not_create_state_or_run_mutations(self):
        proc = self.invoke()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse((self.root / "state").exists())
        self.assertFalse((self.root / "mutations").exists())
        self.assertIn("NO_CHANGES_NO_CHAIN_OR_WEBSITE_VERIFICATION", proc.stdout)
        calls = (self.root / "service-calls").read_text().splitlines()
        self.assertEqual(len(calls), 8)
        for profile in ["global-v3-compound", "global-v3-routed-compound",
                        "global-v3-hourly-compound", "global-v3-unified"]:
            self.assertTrue(any(f"{profile}-keeper-testnet.timer" in call for call in calls))
        self.assertTrue(all(call.startswith("show ") for call in calls))

    def test_failed_resume_keeps_first_error_beyond_fifteen_lines(self):
        state = self.root / "state"
        state.mkdir(mode=0o700)
        (state / "latest").write_text(UNIT + "\n")
        (state / (UNIT + ".result")).write_text("1\n")
        proc = self.invoke()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Error: actual failure before a long stack", proc.stdout)
        self.assertIn("UNIFIED_RESUME_EXIT=1", proc.stdout)

    def test_only_valid_public_proof_fields_are_printed(self):
        directory = self.root / "public/v3-unified-testnet"
        directory.mkdir(parents=True)
        address = "0x" + "1" * 40
        secret = "do-not-copy-this-secret"
        (directory / "deployment-proof.json").write_text(json.dumps({
            "vault": address, "chainId": 97, "deploymentBlock": 123,
            "privateKey": secret, "password": secret, "unknown": secret,
            "runtimeHash": secret, "sourceSha": secret, "manager": secret,
        }))
        proc = self.invoke()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn(secret, proc.stdout + proc.stderr)
        records = [json.loads(line.split(" ", 1)[1]) for line in proc.stdout.splitlines()
                   if line.startswith("UNIFIED_DIAGNOSE_LOCAL_PROOF ")]
        unified = next(record for record in records if record["profile"] == "unified")
        self.assertEqual(unified, {"profile": "unified", "record": "present", "vault": address,
                                   "chainId": 97, "deploymentBlock": 123})

    def test_sensitive_log_values_and_urls_are_redacted(self):
        secret = "sensitive-string"
        (self.root / "journal").write_text(
            'Error: still useful\n{"privateKey":"' + secret + '"}\n' +
            'authorization: Bearer ' + secret + '\n' +
            '0x' + 'a' * 64 + '\n' +
            'https://user:' + secret + '@example.com/rpc?api_key=' + secret + '\n')
        proc = self.invoke()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Error: still useful", proc.stdout)
        self.assertNotIn(secret, proc.stdout + proc.stderr)
        self.assertNotIn("a" * 64, proc.stdout)

    def test_symlink_proof_is_not_read(self):
        directory = self.root / "public/v3-unified-testnet"
        directory.mkdir(parents=True)
        private = self.root / "private"
        private.write_text('{"vault":"0x' + 'e' * 40 + '"}')
        (directory / "deployment-proof.json").symlink_to(private)
        proc = self.invoke()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn("0x" + "e" * 40, proc.stdout)
        self.assertIn('"record": "unreadable_or_invalid"', proc.stdout)


if __name__ == "__main__":
    unittest.main()
