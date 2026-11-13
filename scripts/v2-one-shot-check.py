#!/usr/bin/env python3
"""One-shot, read-only V2 cutover diagnosis. Never writes state or sends a transaction."""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

REPORT = Path("/var/lib/globaldroptrade/v2-prototype/deployment.json")
ENV = Path("/etc/globaldroptrade/trades.env")
OLD = "0x4c0f6141b18971db4b14e45c0be8cddb09febc14"

def read_env():
    # Do not print secrets. Preserve the last assignment, matching common dotenv behavior.
    result = {}
    for raw in ENV.read_text().splitlines():
        match = re.match(r"^\s*(TRADES_[A-Z0-9_]+)\s*=\s*(.*)\s*$", raw)
        if match:
            val = match.group(2).strip()
            result[match.group(1)] = val.strip('"').strip("'")
    return result

def rpc(url, method, params):
    data = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=12) as response:
        body = json.load(response)
    if "error" in body:
        raise RuntimeError("RPC error for " + method)
    if "result" not in body:
        raise RuntimeError("RPC result missing for " + method)
    return body["result"]

def report(label, value):
    print(f"{label}: {value}", flush=True)

def main():
    if len(sys.argv) != 2 or sys.argv[1] != "--check":
        raise RuntimeError("Usage: python3 scripts/v2-one-shot-check.py --check")
    state = json.loads(REPORT.read_text())
    env = read_env()
    chain = state.get("chainId")
    tx = state.get("txHash")
    predicted = state.get("predictedAddress")
    if str(chain) != "97":
        raise RuntimeError("V2 report is not the expected chain 97 profile")
    if not isinstance(tx, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", tx):
        raise RuntimeError("Invalid deployment transaction hash")
    if not isinstance(predicted, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", predicted):
        raise RuntimeError("Invalid predicted address")
    url = env.get("TRADES_RPC_URL", "")
    if not url.startswith(("https://", "http://")):
        raise RuntimeError("Missing valid TRADES_RPC_URL")
    active = env.get("TRADES_VAULT_ADDRESS", "")
    report("REPORT_STATUS", state.get("status", "unknown"))
    report("EXPECTED_V2_ADDRESS", predicted)
    report("CONFIGURED_API_ADDRESS", active)
    report("OLD_VAULT_IN_CONFIG", active.lower() == OLD)
    actual_chain = int(rpc(url, "eth_chainId", []), 16)
    report("RPC_CHAIN", actual_chain)
    if actual_chain != 97:
        raise RuntimeError("RPC is not on BNB Testnet")
    receipt = rpc(url, "eth_getTransactionReceipt", [tx])
    if receipt is None:
        report("DEPLOYMENT", "PENDING_OR_NOT_FOUND")
        report("CUTOVER", "BLOCKED")
        return 2
    ok = int(receipt.get("status", "0x0"), 16) == 1
    actual = receipt.get("contractAddress")
    report("TRANSACTION_SUCCESS", ok)
    report("RECEIPT_CONTRACT", actual or "none")
    if not ok or not actual or actual.lower() != predicted.lower():
        report("CUTOVER", "BLOCKED_WRONG_OR_FAILED_DEPLOYMENT")
        return 3
    code = rpc(url, "eth_getCode", [predicted, "latest"])
    if not isinstance(code, str) or code == "0x":
        report("CUTOVER", "BLOCKED_NO_CONTRACT_CODE")
        return 4
    report("V2_BYTECODE", "PRESENT")
    try:
        with urllib.request.urlopen("http://127.0.0.1:3115/api/config", timeout=5) as response:
            live = json.load(response)
        report("LIVE_API_ADDRESS", live.get("vaultAddress", "missing"))
        report("LIVE_API_CHAIN", live.get("chainId", "missing"))
    except Exception:
        report("LIVE_API", "UNAVAILABLE")
    report("CUTOVER", "BLOCKED_PENDING_ARTIFACT_ABI_LEDGER_AND_FULL_E2E_VALIDATION")
    print("READ_ONLY_NO_CHANGES: No services restarted; no funds, files, or chain state modified.")
    return 5

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        report("CUTOVER", "BLOCKED")
        report("CHECK_ERROR", str(exc).splitlines()[0][:240])
        sys.exit(1)
