# Global account history repair — 2026-11-12

## Before

The Overview showed only the last 10 transactions emitted by the current browser
session. It was cleared on disconnect or reload. It was **not** an on-chain
account history, and a recorded credit could appear equivalent to a wallet payment.

## After

The Overview previews the latest 5 verified events. The **Full history** tab
reads the active contract's confirmed logs from the API. Older blocks can be
loaded on demand; each page carries a deterministic block-plus-log-index
cursor so busy blocks do not silently drop entries.

Included event types: registration, deposit, profit credit, reinvestment,
executed profit/principal withdrawal, funded reward budget, treasury cash,
customer status, network milestone, sale settlement, and withdrawal request.
Requested withdrawals are labeled pending / approved / paid / cancelled
using the actual approval queue's status at the confirmed head.

This is **history for the currently configured contract**, not a merge of
older archived contracts. Historical checks on a removed or unavailable RPC
return an error, not a fabricated empty history.

### Financial semantics

- ProfitCredited is a ledger entry, **not a wallet transfer**.
- Requested is not a paid withdrawal.
- Approved is not a paid withdrawal.
- Withdrawal emitted on resolution is the confirmed payment event.
- SaleSettled and NetworkRewardEarned can also have separate
  ProfitCredited events; these are not additional cash flows.
- Deposited records full principal while the original deposit's funds are
  routed to two fee wallets (10% each) and operations (80%).
- Off-chain Daily Activity check-ins have no corresponding on-chain event
  and are not represented as a blockchain transaction.

### API

\`\`\`
GET /api/account-history?wallet=0x...&limit=30
GET /api/account-history?wallet=0x...&limit=30&before=BLOCK:LOG_INDEX
\`\`\`

The API requires a valid EVM address and exact request arguments, chain
identity, vault code, stable canonical block hash, queue/vault identity,
and complete adaptive log responses. It returns only confirmed events
and event-level amounts with their original asset precision. No JSON
response includes any RPC endpoint or credential.

For each request, a bounded number of confirmed block windows are searched.
If a page is empty but \`nextCursor\` is non-null, the user must load older
windows; an empty page does not mean the account has never transacted.
Identical concurrent requests share one scan and a bounded concurrency gate
protects RPC capacity.

### Release and verification

Changes are staged in the source repository and must not be described as
live until an immutable frontend build and API release have both been deployed
with the existing target and rollback checks. Do **not** run an old
\`ubuntu-website.sh\` that unpacks a prebuilt site bundle: that bundle does
not contain the new TypeScript history code.

Before install:
1. Confirm all CI frontend / node / installation jobs pass.
2. Backup current nginx, served site, API release and environment.
3. Confirm \`/api/config\` remains on the reviewed vault and chain 97.
4. Verify build output of \`website npm test && npm run build\`.
5. Verify server tests for pagination, queue states and reorg rejection.
6. Stage server and static frontend as separate immutable releases;
   switch with backup/rollback and verify the actual served page + API.
7. Test a wallet with a deposit, a credited profit, an approved withdrawal
   and an actual paid withdrawal, comparing receipts and row counts.
8. Do not clear the active financial journal or modify any rewards timer.

Local, read-only route verification once installed:

\`\`\`bash
curl -fsS https://globaldroptrade.com/api/config
curl -fsS 'https://globaldroptrade.com/api/account-history?wallet=WALLET_ADDRESS&limit=30'
\`\`\`

A 200 response does not prove completeness without checking
\`nextCursor\` and earlier blocks; a 503 must never be displayed as
"No history found".
