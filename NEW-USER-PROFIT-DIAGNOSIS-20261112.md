# Read-only diagnosis of new BNB Testnet depositors (2026-11-12)

This release does not authorize a deposit, credit or withdrawal. It neither
changes journal cursors nor starts a signer.

## Observed problem

Two newly opened testnet wallets had registered positions, while the public
automation status returned `credited`. Their submitted snapshots showed:

- Newest wallet A: 1,000 TEST_USDT account principal, 2 completed position
  cursors, 0 account profit, `activityCurrent=false`.
- Newest wallet B: 1,100 TEST_USDT account principal, 2 completed position
  cursors, 1 TEST_USDT account profit, `activityCurrent=true`.

`activityCurrent` is the eligibility **at the request time**, not proof of
eligibility at any historical period end. Likewise, `positionPaid` is a
processed cursor and may include an ineligible hour with zero credit.

## Diagnostic

From a clean pinned checkout with Node 22 and package dependencies:

```bash
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/diagnose-new-user-testnet.mjs 2
```

The script verifies chain 97 and the existing vault, reads the verified
private activity history (never prints signatures), inspects the two most
recent distinct wallets in the immutable contract-bound index, and shows:

- each wallet's current principal and recorded account profit;
- each position's processed cursor and next due time;
- activity evidence at **each of the last three processed period ends**,
  evaluated with the activation timestamp and receipt time;
- exact historical rate and principal at each snapshot, when archive
  RPC can supply it;
- the `usedRewardBatch` flag for the deterministic personal batch ID,
  showing whether an on-chain personal-profit batch was executed.

It never reads a private key, sends an RPC transaction, clears a cursor or
changes the user activity policy.

## Interpretation

- `activityEligible=false` and `confirmedPersonalBatch=false`: no personal
  credit was due in that period. The wallet owner must use **Check in for
  24 hours** and sign the message for later eligible periods.
- `activityEligible=true`, `expectedPersonal>0` and
  `confirmedPersonalBatch=true`: batch was processed on chain.
  Wallet-level `walletProfit` might differ because of withdrawal,
  reinvestment or other wallet positions.
- `activityEligible=true`, `expectedPersonal>0` and
  `confirmedPersonalBatch=false` despite a processed position cursor:
  **investigate before making any manual payment**. Preserve current
  journal/receipts and check for an exceptional earlier run.
- `snapshotIssue` indicates that the selected RPC did not supply the
  required historical data. Do not replace history with current values.
- `indexedThrough<confirmedHead`: the new-depositor history may still lag.
  The accompanying index-refresh patch needs CI and reviewed worker deployment
  before it is used. Catch-up must not rewrite processed financial cursors.

A current check-in does not backdate eligibility. Existing liabilities of
the V1 testnet vault persist irrespective of the separate V2 launch effort.
