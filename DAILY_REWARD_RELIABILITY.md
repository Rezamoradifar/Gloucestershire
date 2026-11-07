# Daily reward reliability release

This release extends `codex/global-mainnet-preparation-20261026` at
`67fde7fa4d9893523aaae4d4a111a6eae5098065`. It does not replace that release with
the older `main`-based daily reward prototype. It uses the deployed vault's
existing funded `batchProfit` operation and existing approved withdrawal queue.
No contract deployment, account reset, principal migration, rate change or token
funding is performed by this release installer.

## Calculation and settlement

For each eligible completed period, the personal allocation is:

```
personal allocation units = floor(principal units at period start * rate bps / 10000)
referral allocation units = floor(source personal allocation units * referral bps / 10000)
```

Each asset uses its own historical principal and native integer precision.
Unrealized profit does not compound automatically. Completed reinvestments are
included only in periods whose opening snapshot includes the reinvestment.
The existing tier, referral-level, customer-activity and KYC rules are retained.
An ineligible referral recipient does not promote a higher ancestor to a new
level. Referral allocations are calculated from personal profit, never from
another referral allocation.

The entire remaining personal and referral obligation is checked against the
reward budget before a period's first transaction. Asset addresses are normalized
before combining amounts. No code debits the principal ledger to fund rewards.
Cash coverage also preserves the existing profit, fee-reserve and pending
withdrawal claims. The existing owner-managed capital-deployment authority and
principal-liquidity policy are unchanged; the release does not introduce a
guarantee that all principal remains in the treasury.

Mainnet policy validation still requires 86,400-second periods. The connected
BNB testnet release intentionally retains its existing accelerated 900- or
3,600-second test schedule and test-rate behavior. Those test results are not
production daily yields.

## Daily activity

The dashboard provides a gas-free wallet-message check-in. The exact message
binds the website origin, network, vault, wallet, one-use nonce, expiry and
observed confirmed block. No token approval or transaction is requested.

The API records the confirmed chain time and its own receipt time. Both must
precede a period's end. An eligible check-in has a chain timestamp within
`[periodEnd - 86400, periodEnd)`. Canonical block number, hash and timestamp are
checked again by the worker. Late clicks cannot acquire an already completed
period. Old check-in proofs are retained for unpaid historical periods.

The installer creates a separate activity policy with a cutoff 24 hours after
its fresh verified block. The rule applies only to earning periods beginning at
or after that cutoff. Earlier periods keep their original rules. Reinstallation
preserves the cutoff and history. Missing, corrupt or mismatched enabled history
blocks new reward calculations; it is never interpreted as unrestricted access.

The existing non-upgradeable contract is unchanged. The authenticated payment
worker enforces this new activity condition. Existing on-chain reporter and
owner privileges remain as previously deployed; this is not a new on-chain
restriction on every possible administrative operation.

## Restart and outage behavior

A complete plan is saved in the private financial journal before any payment
transaction. Its exact recipients, amounts, snapshot, policy identity and batch
identifiers are immutable during retry. A partial success resumes the remaining
batches and reconciles already-used identifiers against the contract. It never
changes membership under a previously used identifier.

Completed empty periods advance once. A later check-in cannot backfill a period
that was skipped under the enabled activity rule. The last actual confirmed
credit is retained when an empty period is processed. Existing ungated frozen
plans can finish only when their period starts before a newly installed cutoff.

The ordered coordinator runs indexing before payment work and waits for active
financial services. The installer stops timers and waits; it does not kill a
signer or erase an in-flight journal. A missing initial status report no longer
prevents the first recovery cycle. Approved withdrawals remain independently
processed, including fair bounded rechecks of previously pending requests.
The worker never approves a withdrawal on the administrator's behalf.

Insufficient reward funding, absent reporter authority, a reorganization,
unavailable historical RPC data, insufficient operator gas, or the existing fee
budget limit cause a visible waiting or blocked state. The cumulative testnet
fee limit remains 0.1 test BNB; this release does not silently increase it or
reset its accounting. A restarted timer alone is not evidence of a payment.

## API and deployment verification

- `/api/health` remains basic process health.
- `/api/config` exposes only the connected network and vault address.
- `/api/trades` serves verified complete settlement snapshots and explicitly
  labels stale or unavailable data. Configured fallback RPCs cannot silently
  substitute another network.
- `/api/daily-activity/status?wallet=...` reports the wallet's recorded activity,
  expiry, and whether the payout requirement is enabled or still in its grace period.
- `/api/automation/status` returns a sanitized report with freshness, scheduling,
  blockers and confirmed transaction references. A system-batch reference is not
  a claim that a particular user's wallet received a withdrawal.

`scripts/install-daily-reliability.py` defaults to `--check`. `--apply` stages
dependencies and the frontend, verifies the exact existing chain-97 deployment,
backs up configuration, and switches the managed worker, API and web release.
It preserves existing financial policies, journals, activity proofs and keys.
Rollback restores code and configuration before new execution begins; it never
rewinds financial state. Its result explicitly distinguishes installed scheduling
from a verified credit receipt.

Use an exact reviewed Git revision with `--expected-revision`. The release is
ready for live confirmation only after its installed API reports fresh worker
results and corresponding successful on-chain credit receipts have been checked.

The existing-server prerequisites, read-only checks, deployment sequence and
failure diagnostics are documented in
[`docs/daily-reliability-release.md`](docs/daily-reliability-release.md).
