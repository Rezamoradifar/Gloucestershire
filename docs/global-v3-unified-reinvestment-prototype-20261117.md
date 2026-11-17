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

The integrated local-EVM tests use the pinned mock-token address and normal
EVM code-size rules. They exercise deposits, repeated reinvestment from two
sources, reinvestment of group profit, accrual, independent 90-day locks,
reservation release, funded payouts and network/referral behavior. The
separate read-only `plan-v3-unified-accrual.mjs` can propose bounded lot
pages after a caller has independently verified deployment, account and block.
It does not read a chain, sign transactions, or run a keeper. The compile-only
`scripts/compile-global-v3-unified-testnet.mjs` checks compiler and bytecode
size for the parent and both components; it does not install or deploy them.

The read-only unified keeper preflight now verifies a supplied testnet
deployment receipt and all three pinned runtime hashes, checks that the book
and network component are bound to the vault, and reads at one confirmed
block. A bounded three-part cursor scans normal positions and each group's lot
pages without using the group's misleading aggregate accrual timestamp. It
rechecks the block hash after the scan and reports candidate calls only; it
never loads a key or submits a transaction. Local tests cover 70 group lots,
resumption, no duplicate due pages, mismatched components and reorganization.
The deployment proof must ultimately come from a separately authenticated,
verified deployment; a caller-supplied hash alone is not proof of correctness.
An additional no-key simulation verifies a candidate against the pinned
deployment, enforces an unprivileged gas payer and bounded estimated fee, and
checks the account again. It still does not persist a pending transaction,
sign or broadcast; the eventual sender must recheck everything at send time.

The website also has an opt-in, read-only unified preview. It requires an
explicit hourly-testnet profile plus separately pinned book and network
addresses and runtime hashes, verifies their vault links, and reads a bounded
page of additions at the same confirmed block. The existing V3 configuration
continues to use its original vault for network reads. The preview displays
individual lock times rather than treating the group's first timestamp as the
lock for every addition; it hides the unsupported group-wide live estimate.
All three site wallet-writing entry points reject unified-preview actions
before requesting a wallet operation. No preview is installed on the site.

## This is not a deployed fix

The deployed hourly V3 contract creates a separate position for every manual
reinvestment and has no upgrade or migration method. These components are NOT
wired into that contract, the public website, or the existing keeper. They are
not deployed on any network, production-ready, or independently audited. They
do not change or transfer any existing user position or test token.

The network component exposes branch and reward-group reads/actions at a new
address. The opt-in site preview can read it, but wallet actions, history of
network events and the network-volume keeper are not yet adapted. The
existing accrual keeper only sees a position-level timestamp: it cannot
correctly schedule the grouped position's independent lots. The prototype's
default accrual call covers only the first eight lots; later lots require
explicit bounded-page processing. The current preflight does not execute
transactions or persist keeper cursors; production-grade sending, receipt
handling, cursor recovery and gas controls are still required. Group profit/principal reservations and
group-profit reinvestments are currently limited to one page per request;
amounts spread over more than 64 lots cannot yet be handled in one request.
In a local test with 70 one-TEST lots, an eight-lot page used up to 697,626
gas; the current legacy keeper's 500,000 transaction-gas cap is insufficient
for that scenario. This measurement is not a bound for network gas use.
Do not install or point the current site or keepers at this prototype.

The integrated prototype debits source claims, derives rate/eligibility,
records per-lot referral rounding, and applies the existing approval/funding
mechanism in the tested local scenarios. It still requires full regression
and adversarial testing, gas bounds and keeper integration, a verified website
adapter, safe handling of requests spanning pages, and an independent review.
Only the trusted vault can mutate the book; the book cannot protect against a
faulty vault. Passing the focused tests is not a security audit.

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
