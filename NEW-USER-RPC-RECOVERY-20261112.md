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


## Configure several verified read-only RPCs (testnet only)

The main server configuration supports **at most four RPC URLs total**:
the unchanged primary `TRADES_RPC_URL` plus up to three fallbacks under
`TRADES_RPC_URLS`. The primary remains the signer worker's selected
RPC. The additional alternatives help the API and forensic diagnostics.

A guarded script is included:

```bash
node scripts/configure-testnet-rpc-fallbacks.mjs --check
node scripts/configure-testnet-rpc-fallbacks.mjs --apply
```

The script verifies the exact old vault, chain 97, recorded immutable runtime,
a known canonical checkpoint, one bounded `eth_getLogs` probe and historical
`eth_getCode` / `eth_call` capability. It keeps the original primary,
selects up to three verified alternatives, and prints **only candidate indexes,
result classifications and counts**, not private URLs or credentials.

The fallback candidates come from the official BNB Chain testnet set
`data-seed-prebsc-1-s1.bnbchain.org:8545` and
`data-seed-prebsc-2-s1.bnbchain.org:8545`, plus the publicly listed
`bsc-testnet-rpc.publicnode.com`. Any existing custom configured
alternatives are evaluated before these. Invalid/wrong-network candidates
are omitted. Public endpoints are not assumed to be archival; the result
distinguishes `FULL_HISTORY_VERIFIED` from `RECENT_READS_ONLY`.

`--check` never changes files or services; `--apply` creates a root-only
backed-up copy under `/var/backups/globaldroptrade` and atomically replaces
only the root-owned `/etc/globaldroptrade/trades.env`.
It does **not** restart the API or signing worker. The new API fallbacks
take effect after a separate, controlled API-only restart:

```bash
systemctl restart globaldroptrade-api.service
curl -fsS --max-time 15 https://globaldroptrade.com/api/config
```

Check that chain 97 and the known vault remain unchanged. If API restart
fails, restore the saved backup reported by the script and restart only
the API again. Do not restart the financial worker automatically or
change its primary RPC during an in-flight signed transaction.
Do not share the env file, any private RPC URL or credentials.
