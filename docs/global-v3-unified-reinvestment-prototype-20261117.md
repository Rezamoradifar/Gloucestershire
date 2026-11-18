# One reinvestment position: isolated testnet accounting prototype

## What is implemented

`UnifiedReinvestmentBook` is an isolated chain-97-only accounting component.
It records at most one logical reinvestment position per wallet, while each
addition remains an internal lot with its original timestamp. Internal lots
preserve each addition's one-hour test cycle and 90-day principal lock. A new
addition never restarts an older lot's lock or earns before its own cycle.
Daily and profit-on-profit accrual are rounded per lot and do not backfill
missed periods. A bounded page can process at most 64 lots per call; there is
no fixed limit on the lifetime number of lots.

Profit can be moved to a new lot of the same logical position using a bounded
page. Principal and profit reservations are tracked separately: reserved
profit stops compounding and is restored on release, while reserved principal
continues accruing until settlement as in the existing V3 contract. A request
ID cannot be reused or settled twice. The book holds no tokens and has no
ability to make an actual payout.

`test/fixtures/UnifiedVaultHarness.sol` is a local-EVM fixture with synthetic
claims. It demonstrates atomic source-claim debiting and consolidation, but
does not implement deposits, the original V3 account ledger or migration.

`GlobalV3UnifiedTestnet` is a separate experimental testnet-only vault derived
from the V3 ledger. It creates one additional position for all of a member's
manual reinvestments and uses the book to retain each addition's separate
opening, accrual and maturity times. Deposits remain separate positions. It
mirrors group balances into the V3 account ledger, updates principal/profit
liabilities and referral volume, and uses the book during group withdrawal
reservation, release and settlement. `UnifiedNetworkPlan` holds the network
state and is created by, and bound to, the new vault.

## Reinvesting from the dashboard

On the transaction-enabled `/unified-test/` dashboard, a registered member
enters an amount from recorded position profit. The site selects the eligible
source claims and simulates `reinvestMany` before requesting a signature. A
confirmed transaction debits the source claims atomically and adds one lot to
the member's reinvestment position. The next reinvestment uses the same position.
Deposits remain individual positions. Each lot retains its own hourly accrual
clock and 90-day lock. The contract limits a single transaction to 16 sources
and 128 grouped lot slots. A larger operation needs separate transactions.

The dashboard reads the vault, book and network plan at a confirmed block.
The read-only build is used when the gas-only worker needs test BNB. The
transaction-enabled build also checks the release SHA, deployment proof and
active worker timer on the host. Registration, check-in, deposits, grouped
reinvestment and withdrawal actions require a connected chain-97 test wallet.
Withdrawal settlement requires the applicable approval and test-token funding.
A grouped profit or principal withdrawal can cover one page of up to 64 lots.
The previously deployed hourly contract retains its own position selector.

## Hourly accrual and network volume

The dedicated systemd service runs bounded scans using separate persistent
cursors and pending transaction records for accrual and referral-network
volume. Its common lock covers both routines. Each accrual page contains up
to eight reinvestment lots. The service records the hash before broadcast,
checks a canonical receipt and the expected event, and persists its cursor
before archiving the confirmed accrual. An ambiguous result holds subsequent
writes. An interrupted volume broadcast can resume with exactly the signed
bytes; an unresolved accrual hash can require operator review. The service
runs 15 seconds after its preceding invocation finishes. Operators can inspect
the timer and the service journal using the name `global-v3-unified-keeper-testnet`.
The one-hour cycle does not backfill missed periods after an outage. Public
RPC availability, gas funding and account count govern actual sweep time.
An eight-lot page used up to 697,626 gas in the 70-lot local test.

## Existing accounts

Do not point the current site at a new contract or copy old balances merely
from a snapshot. Existing principal, profit, pending requests, escrow, referral
links, timestamps and lock dates remain in the current contract. Any proposed
migration requires explicit user-account reconciliation, an anti-replay and
double-claim design, funding evidence, contract and keeper integration tests,
and a verified plan for users with pending withdrawals. Pausing the old V3
contract does not itself prove that every payout path and liability is closed.
The local `unified-v3-migration-boundary` tests demonstrate a previously
funded withdrawal succeeding after the old vault is paused, changing profit
liability and the user's pending flag. They also demonstrate that queued
network volume can still be processed and users can still create reward
groups while paused. Those changes can invalidate a referral-network snapshot.
No migration is performed by these prototype tests.

The book records each new lot at the current block time. It currently has no
method to import a historical lot with its original opening time, accrual
time, claim split and reservations. Do not use it to copy existing positions:
doing so could change their maturity or accrual and allow the same old claim to
be counted twice. Preserving existing accounts requires a reviewed import design
and a proven way to prevent all relevant old-state changes and double claims;
those capabilities are not yet implemented.

## Additional isolated testnet tooling

The chain-97 deployer, `deploy-v3-unified-isolated.mjs`, verifies the compiled
creation bytecode and constructor arguments against the release hash in
`v3-unified-release-pins.mjs`. It checks the TEST token runtime against the
Sourcify exact match reproduced from the project's original mock-token artifact.
On the Global VPS, `--deploy-testnet` uses the designated gas-only signer and
records the signed hash and nonce in a private journal before broadcasting.
An existing journal or deployment proof blocks a second broadcast.
`--verify-existing` checks the receipt, creation transaction, deployed contracts
and management roles before returning the SHA-256 digest of the proof file.
If the process exits after broadcast and before the proof is written,
`--recover-existing` reconstructs it from the original transaction once its
receipt is confirmed. An unknown or unconfirmed receipt leaves the journal
available for later checks. All four modes take one additional argument, the supported BNB Testnet RPC URL. A public deployment
is confirmed only after verification succeeds against the chain.

Run `scripts/apply-v3-unified-testnet.sh` from the pinned, private release
checkout on `vps-luna-2585`. It checks the existing site, installs the two
locked dependency trees once, verifies the signed deployment independently,
and installs the worker before publishing the isolated route. On its first
run it prints the dedicated public keeper address. If this wallet has less
than 0.001 tBNB, the installer publishes the read-only dashboard and exits 42.
Fund that address on BNB Testnet and repeat the same release command to enable
wallet actions. An existing verified deployment is reused.

The publisher accepts only its own prior release or an empty destination.
It checks the entry HTML, JavaScript, stylesheet and dashboard chunk over
HTTPS and restores the preceding route if post-publication verification fails.
A completed host run reports `UNIFIED_TESTNET_WALLET_DASHBOARD_AVAILABLE`.
The source commit and CI results alone do not establish deployment on the VPS.
