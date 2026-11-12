# GlobalDropTrade consolidated testnet repair / acceptance release
2026-11-12 — BNB Testnet, chain ID 97

## Verified code and what has actually been changed

This branch is based on the combined **referral + wallet-independent History**
release. The existing wallet address remains the permanent on-chain
referrer, and invites are prefilled only for the first deposit.
Historical finance scans now use the Global API and its verified private
RPC candidates rather than the mobile wallet's unsupported `eth_getLogs`.

The new-deployer worker's completed position-index target is advanced
to a fresh **confirmed** head during integrated scans. The indexer
already had a completed-target refresh. New registrations and deposits
must remain discoverable even while older users have overdue periods.
Paid cursors, deterministic batch IDs, stored receipts and fee schedules
are NOT reset. Regression tests confirm a later depositor is indexed.

The isolated new-user diagnostic and RPC doctor were brought in from
the reviewed new-depositor branch, with support for both:
- 3,600-second first-generation testnet position hours; and
- 900-second testnet quarter periods after an explicit contract-bound cutover.

The diagnostic uses the correct `positionPaid` or
`positionQuarterPaid` cursor and computes the exact corresponding
personal batch ID, preserving the cutover hash domain.
A missing historical receipt or archive RPC is never presented as a
confirmed zero profit.

The new read-only payout audit examines the owner's approval queue
and current USDT cash relative to queued profit liabilities.
It distinguishes **pending / approved / paid / cancelled**, labels
the queue's paid state as distinct from a wallet-confirmed transfer
receipt, and never calls a signer. Importantly, cash greater than
queued withdrawals does **not** imply all credited profit, principal
and referral liabilities are funded.

The independent V2-zero contract **preflight and deployment tools** have
been staged for audit only; they do not automatically deploy, reset,
fund, connect or cut over any existing contract or worker.

## Read-only commands (from this checked-out commit)

```bash
bash ubuntu-global-complete-readiness.sh --local
bash ubuntu-global-complete-readiness.sh --live-readonly

# Independently:
node scripts/check-live-worker-index.mjs
node scripts/testnet-rpc-doctor.mjs
node scripts/diagnose-new-user-testnet.mjs 5
node scripts/testnet-withdrawal-audit.mjs
node scripts/preflight-testnet-zero-v2.mjs --check
node scripts/testnet-zero-v2-deploy.mjs --plan
```

The live check reads the currently configured chain-97 API status,
verified event-history endpoint, timer health, current accounts,
historical Activity evidence, queue statuses and V1 liabilities.
It prints no RPC secrets or user activity signatures. A missing
prerequisite is a blocker, not an excuse to replace the production
journal or deploy a new contract.

## Acceptance checklist (requires a REAL VPS / wallet smoke test)

- [ ] Source CI 5/5 passed for the exact reviewed commit, including
      contract/worker tests and frontend build.
- [ ] Live API points to the same 97 vault before and after site release.
- [ ] Open the Team tab with a **registered** wallet; copy/share referral
      link and confirm it is `?ref=PUBLIC_WALLET#dashboard`.
- [ ] Open the invite with a fresh wallet; the inviter pre-fills the
      referrer before the first deposit. Verify self/unregistered
      referrals are rejected and that the ledger referrer is immutable.
- [ ] Check the active systemd worker release with `check-live-worker-index.mjs` and verify `indexRefreshInLiveWorker=true`; GitHub code alone does not update the signer release.\n- [ ] Check a new depositor with an eligible 24-hour signed check-in.
      Verify the personal batch ID, `ProfitCredited` event and no replay.
- [ ] Check one unqualified period; it must record **no credit** and
      must never be backdated or fabricated.
- [ ] Check all eligible upline amounts as **percentages of the source
      member's personal earned profit**, not as freshly paid external
      funds. Ineligible ancestors remain skipped without compression.
- [ ] Reinvest exactly the explicitly requested earned profit; the
      new position has its own clock. There is no automatic compounding
      unless users explicitly enable and authorise such a feature.
- [ ] Request and approve a withdrawal; verify status and liquidity.
      Mark it paid only after a successful canonical on-chain transfer
      receipt. Never manually credit or fabricate a payment record.
- [ ] Compare vault cash, reward budget, credited profit, queued
      withdrawals and principal obligations in the V1 audit.
- [ ] Test V2 zero-state deployment **plan only**. V2 actual deployment
      and cutover need a separate owner-approved migration plan.
- [ ] Production/mainnet remains **blocked** pending independent audit,
      legal/financial eligibility review, sustainable funding model,
      explicit liability coverage and reviewed launch configuration.

## Non-negotiable boundaries

The previously connected V1 positions and claims cannot be erased from
BNB Testnet by journal deletion. No user financial records should be
overwritten in order to produce a zero-balance dashboard.

A GitHub PR or green CI is evidence of tested **source**, not evidence
that server deployment occurred. Actual server work must happen on the
user's VPS with logged preflight, immutable releases, a reversible
API/website switch and per-wallet checks. No tool in this branch
automatically restarts the signing worker, installs the new bundle,
deploys V2, changes on-chain referral percentages or moves funds.

The system should not describe fast testnet reward rates as safe,
sustainable or guaranteed mainnet investment returns.
