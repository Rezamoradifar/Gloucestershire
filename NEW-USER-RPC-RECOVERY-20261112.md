# Global: New depositor Testnet RPC recovery (2026-11-12)

The original new-user diagnostic used only `TRADES_RPC_URL`, so a slow,
pruned, throttled or wrong-history endpoint could fail diagnosis without
revealing which RPC capability was missing.

## Changed

- `scripts/testnet-rpc-doctor.mjs` runs a **read-only** BNB Testnet
  chain-97 historical RPC check without opening a signing key. It tests:
  chain 97, code at the exact V1 deployment block, code at a confirmed
  head, code hash against the old journal, a bounded log request, and
  historical block lookup for the newest indexed position.
- The new-user diagnostic retries the **entire report** on the next
  configured candidate if the first RPC cannot read historical blocks
  or account state. It never merges snapshots from two different RPCs.
- The tool prints only candidate numbers and a sanitized reason
  (e.g. `HISTORICAL_STATE_UNAVAILABLE`, `TIMEOUT`,
  `TRANSPORT_UNAVAILABLE`, `RATE_LIMITED`). No RPC URLs,
  API keys or user activity signatures are printed.
- Wrong network, changed runtime code and inconsistent account/activity
  evidence stop safely. A failed historical calculation is **not**
  shown as a zero payment.
- No financial journal cursors, stored positions, user deposits,
  account balances, timers, reward payments or contracts are modified.

## Run in a pinned checkout with Node >=22.12

```bash
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/testnet-rpc-doctor.mjs
node scripts/diagnose-new-user-testnet.mjs 2
```

If a fallback has been configured through `TRADES_RPC_URLS`, the
diagnostic uses it automatically after first verifying its chain and
immutable old-vault code. If only one RPC is configured and it has
pruned/unsupported historical data, **no code change can recover
unavailable chain history**. Supply a working private archive RPC
capable of BNB **Testnet** historical `eth_getCode`,
`eth_getBlockByNumber`, `eth_call` and bounded `eth_getLogs`
for the original vault; never substitute a Mainnet RPC.

Configure additional endpoints securely in the root-owned
`/etc/globaldroptrade/trades.env` (the normal server configuration).
`TRADES_RPC_URLS` is a JSON string array of HTTPS URLs. Use a private
editor, ensure permissions remain root-owned mode 600, and **do not
paste any RPC URL or API key into a chat**. Verify with the read-only
doctor before considering a controlled service restart.

Note: this PR does not change the live signing worker's RPC.
It improves forensic diagnosis and includes the separate
new-user-index refresh patch, which must pass CI and receive
review before any live worker deployment. A missing Daily Activity
check-in must be signed by the actual wallet owner; it cannot be
created by an RPC repair or credited retroactively.
