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

## This is not a deployed fix

The deployed hourly V3 contract creates a separate position for every manual
reinvestment and has no upgrade or migration method. This prototype is NOT
wired into that contract, the public website, or the existing keeper. It is not
deployed on any network; it is not production-ready or a security audit. It
does not change or transfer any existing user position or test token.

A future vault would need to atomically debit a verified source claim before
recording a lot; derive the approved rate and eligibility; update principal,
profit and network liabilities; handle paginated keeper processing and
per-lot referral rounding; enforce withdrawal caps, cooldown, manager approval
and actual funding; and connect verified read/actions to the website. Only the
trusted vault can mutate this book; it cannot protect against a faulty vault.
Those integration properties have not yet been proven by this prototype.

## Existing accounts

Do not point the current site at a new contract or copy old balances merely
from a snapshot. Existing principal, profit, pending requests, escrow, referral
links, timestamps and lock dates remain in the current contract. Any proposed
migration requires explicit user-account reconciliation, an anti-replay and
double-claim design, funding evidence, contract and keeper integration tests,
and a verified plan for users with pending withdrawals. Pausing the old V3
contract does not itself prove that every payout path and liability is closed.
The local `unified-v3-migration-boundary` test demonstrates a previously
funded withdrawal succeeding after the old vault is paused, changing profit
liability and the user's pending flag. No migration is performed by these
prototype tests.
