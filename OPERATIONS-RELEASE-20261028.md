# Existing fast-testnet operational fixes

This release continues the existing chain-97 fast vault and its one-hour test
policy. It does not deploy a contract, change economic rules, reset periods,
replace financial journals, grant roles or move the site to mainnet.

## Historical call timeouts

The worker, archive preflight and member-index repair use the same selected RPC.
Only `eth_call` at an explicit numeric historical block retries a proven transport
TIMEOUT, at most twice, with 500/1500 ms backoff. Parameters and block are kept
identical. Broadcasts, latest/pending simulations, log queries, authentication,
provider RPC errors, missing history and contract reverts gain no retries.
Canonical checkpoints, exact principal reconciliation, budget checks, signed nonce
journals and duplicate batch protections remain required.

## Completed-credit evidence

A later waiting/no-credit run includes a separate `lastDailyCredit` record when
the completed period's IDs and receipt hashes match confirmed entries in the
existing canonical transaction journal. It publishes only period, batch ID,
transaction hash, block and block hash; raw signed bytes and provider credentials
are excluded. The status page distinguishes earlier receipts from new credits,
provides BscScan links and labels an installed but waiting worker correctly.
An old completed receipt never makes the current worker active.

## Support and withdrawal verification

Support login also accepts the official HTTPS www alias with the canonical
GlobalDropTrade support challenge. Other origins, accounts, chains and targets
remain rejected. Sign-in does not depend on vault/oracle RPC calls and requires
only a wallet message signature.

Local frontend integration now exercises the actual withdrawal reader/executor
against a deployed fast vault: private per-user queues, unauthorized approval,
owner approval and exact net payment, repeat-payment rejection, overdue
cancellation and restoration of recorded profit. These are local test receipts,
not public-chain user withdrawals.

## Install on the existing server

Use this release's pinned revision and run as root:

```bash
bash ubuntu-support.sh
bash ubuntu-zero-archive-rpc.sh --execute --candidate-file /etc/globaldroptrade/archive-rpc-url
```

The support installer accepts only the existing fast testnet target and preserves
its API release and versioned status/deployment consoles. Archive repair takes
its existing connection/setup/run locks, uses private RPC input already on the
server, stages reviewed immutable worker sources and the matching status parser,
then verifies API identity and starts the existing timer. Private backups and
rollback behavior remain in place. An indexing result preserves progress for the
same unpaid period; do not remove or reset its policy or financial journal.

A successful code test is not evidence that the VPS has installed this release.
Actual new public-chain credits require confirmed transaction receipts; exact
per-wallet personal/referral amounts must be checked against period-start state.
Mainnet launch readiness is not established by this testnet upgrade.

## Read-only public receipt observation

The existing first credit transaction was checked against the selected public
BNB Testnet RPC. Its successful receipt, canonical block, expected vault/operator,
zero native value, batch calldata and all ten matching ProfitCredited events
were verified. It recorded 1,484.546 Test USDT as the epoch-0 personal batch.
This observation does not recalculate historical tier entitlements or prove
referral payments, current balances, withdrawals or mainnet readiness. The
allowlisted aggregate observation is saved in
`reports/zero-first-credit-verification-20261028.json`.
