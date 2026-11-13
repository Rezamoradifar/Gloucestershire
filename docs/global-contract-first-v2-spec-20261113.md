# GLOBAL V2 — Contract-first protocol and admin visibility specification (13 November 2026)

Status: **design only**, not deployed, not investment-ready. Build new contracts, tests, and migration tooling only after an explicit economic and security review. This document supersedes any suggestion that the existing `Reporter` role can be made strictly KYC-only with a wrapper.

## Baseline verified from current source

- The current BNB testnet target is chain 97, vault `0x4C0F6141b18971db4b14e45c0bE8CddB09febc14`. The deployed vault is not shown to be upgradeable; changes to its role checks and financial functions require a **new deployment** and carefully verified optional migration, not source edits to the old address.
- `contracts/fresh/DropshippingVault.sol`: one `reporters` role and `setCustomerStatus(user,active,kyc)`; a Reporter can set *both* fields. `batchProfit(id,asset,recipients,amounts)` takes amounts from a privileged Reporter rather than independently verifying economic calculations. `ownerWithdrawCapital` can move liquid user-liability funds. Current deposit flow sends 20% to fee wallets, 80% to the operations wallet, while recording 100% user principal.
- `contracts/fresh/ProfitWithdrawalQueue.sol`: the owner must approve pending withdrawals; anyone can pay only after approval. The 72h window is a cancelability deadline, not a guaranteed funding date.
- `scripts/position-profit.mjs`: the testnet hourly worker calls `dailyProfitAmount(principal,dailyTargetBps)` once per hour, without a 24-hour divisor. The intended *economic* meaning of `dailyTargetBps` must be fixed before V2. `profit-referrals` is calculated separately; source tier sets percentage, while uplines must be active, activity-eligible and VIP-KYC verified when required.
- Observed VPS snapshots earlier in this discussion: 525 journal batches classified as personal and zero as referrals; do not infer a universal referral failure without full historical position eligibility audit.

## Primary invariant and operating principle

**The smart contract owns entitlement calculations, cash/liability accounting and access controls. The server supplies no authoritative profit amounts or activation flags.**

An EVM contract **cannot invoke itself at an arbitrary future time**. On-chain functions run only when a transaction invokes them. Avoid mandatory background bots by using wallet-initiated actions and permissionless bounded keepers as optional redundancy. The protocol MUST remain usable if the VPS is offline.

### A. On-chain eligibility and KYC separation

1. Registration: `register(referrer)` or `deposit(referrer)`, immutable validated referrer (with anti-cycle rules). Persist block/event of registration.
2. Active funding: `activePrincipalUsd(user)` read from currently outstanding positions; use the *current* principal, not lifetime deposits.
3. Optional user activity: user sends a direct `checkIn()` transaction to the vault (or a gas-sponsored, replay-protected signed meta-tx). Record `lastCheckIn` in contract. A purely off-chain signature is **not** known to the chain until someone submits it.
4. Eligibility should be **derived**, not a long-lived manually written `active` boolean:
   `isEligible(user, timestamp) = registered && activePrincipalUsd >= policy.minActiveCapitalUsd && !suspended && activityRequirementSatisfied(lastCheckIn, timestamp)`.
   A failure is not guessed to be active; no amount of registrations alone enables payouts.
5. Enforce KYC only on the VIP-restricted operations chosen by policy, not as a mandatory daily action. Human KYC review is controlled by a separate admin role; documents remain encrypted off-chain. Do not disclose identity documents or imply the on-chain boolean proves full verification.
6. Roles: `KYC_ADMIN_ROLE` may call **only** `setVipKyc`; `SECURITY_GUARDIAN_ROLE` can freeze compromised accounts with timelimited appeals; `REVENUE_FUNDER_ROLE` can fund/attest revenue but **cannot mint liabilities without escrow**; `TREASURY_ROLE` may move only explicitly distributable surplus, not protected backing. Avoid giving automatic activation any KYC power.
7. Expiry is dynamic: do not maintain an always-accurate `activeDirect` counter via a 24h expiry flag because time passing triggers no transaction. Report **registered directs**, **capital-qualified directs**, and **currently activity-qualified directs** as distinct numbers. For rank use bounded lookup/cached verified checkpoints; a stale counter must not authorize extra payouts.
8. Policy activation timestamp applies forward; no automatic backdating of old earning windows. Track versioned policies and history.

### B. Correct profit and referral allocation

1. Resolve the economics **first**: is `dailyTargetBps` a daily rate or an hourly rate? Rate unit and compounding must be unambiguous. Example: if rate is 50 bps/day (0.5%/day), 1000 USD at a simple 24h interval yields 5 USD, not 5 USD every hour. If accruing hourly, apply precise elapsed-time math with fixed-point remainder handling, avoiding `uint` overflow and rounding-based arbitrage.
2. Never treat an advertised target as realized profit. If the business generates revenue off-chain, a trusted, independently auditable external funding/attestation step remains necessary. A smart contract cannot independently verify off-chain earnings or fund a reward promise.
3. For a fully funded, attributable on-chain profit event (the preferred V2 default), define an atomic operation conceptually like `settleFundedEarnings(source, asset, grossEarned, revenueReference, periodId)` that **receives or verifies reserved backing** before granting any liability. The contract itself calculates personal amount and up to four upline referral shares, checks same-period eligibility and tier rules, and credits both sides **in the same transaction**. Keep personal profit unchanged by referral allocation; referral amount comes from a separately funded, accounted pool rather than reducing user principal or silently creating unfunded promises.
4. Prohibit arbitrary `batchProfit` by a broad Reporter with arbitrary `recipients` and `amounts` in the production V2 path. If batch import is required, enforce committed liabilities, authorization, time window, per-recipient reconciliation and independent review. Never reuse testnet batch hashes on another contract as if funds had transferred.
5. Per-source period identifiers: `keccak256(chainId, vault, positionId, source, asset, periodStart, policyVersion, revenueReference)`. At most one settlement per identifier; prevent reentrancy, replay across chains/contracts, and duplicate personal/referral allocations. Emit rich events:
   - `EarningFunded(source,asset,periodId,revenueReference,fundedTotal)`
   - `PersonalProfitCredited(source,asset,periodId,amount)`
   - `ReferralProfitCredited(upline,source,level,asset,periodId,rateBps,amount)`
   - `ProfitSkipped(source,upline,level,periodId,reason)` as appropriate, or surface computed read-only skip reasons without permanent expensive logs.
6. Define referral percentage owner **once** in immutable/spec version (current code uses the *source earner's tier*, not the upline's tier). Define maximum 4 levels and KYC rules. Zero-match or unsuitable levels must not silently redirect commission to other recipients.
7. Prefer lazy accrual or settlement on specific user/position events to mass distribution across every user, which is unbounded in gas. Optionally expose `settleNextPositionPeriod(user,positionId)` permissionlessly callable by any keeper **only if** funded and policy-bound. Funding exhaustion must result in clear `unfunded` / `not-settled` status, not a false success.
8. Source-of-yield proof and solvency checks are required. Do not automatically pay referrers from new deposits if earnings are not verified and funded.

### C. Deposits, principal, treasury and withdrawals (user decisions, 13 Nov 2026)

**User-approved design constraints:**
- **Every withdrawal request must be explicitly approved by the authorized administrator.** No automatic approval by eligibility worker, payout worker, user or permissionless keeper. On-chain approval is an auditable administrator wallet transaction; after approval, execution may be permissionless to the fixed, original requesting wallet only if sufficient backing/liquidity exists.
- **Withdrawal cooldown: 72 hours (once per three days)**, preserving the existing per-user/per-asset notion unless a later explicit economic decision changes its scope. The *cooldown between withdrawal requests* is distinct from any 72-hour payment queue deadline; do not suggest 72 hours guarantees settlement or that the admin must only log in every third day. In the V2 design the on-chain queue cannot approve on its own.
- **Profit withdrawal fee is exactly 3% (300 basis points) of the gross amount**, replacing the former 5% rate **for the proposed V2 only**. Example: a gross 100-unit profit withdrawal has a 3-unit fee and 97 units payable once approved and funded. Store the exact fee and net amount within each request at submission so later policy changes cannot change already-requested payments. Principal withdrawal penalty is a distinct rule and is not changed by the 3% fee decision.
- **Reinvestment is strictly manual, user-initiated and opt-in**: user explicitly requests each `reinvest(asset,amount)` transaction from *already credited, available profit*. It creates a new position under clearly displayed current lock and capital rules. No automatic compounding, recurring reinvestments, administrator reinvestment or hidden reinvest toggle. On-chain beneficiary consent/signature is required; prevent the server from reinvesting user earnings without their action.
- Other existing proposed plan parameters remain unchanged by these two edits: 90-day principal lock, current 30% principal-withdrawal penalty, 10%-of-external-deposits-plus-reinvestments profit withdrawal cap per asset, approved referral tier configuration and 72-hour withdrawal cooldown. These unchanged rules must still be disclosed and independently reviewed for fairness and solvency.
- **Deposit routing follows the prior deployed model**, not the earlier proposed automatic-withdrawal redesign: current contract charges two separate 10% payments to fee wallets and routes the remaining 80% to the operations wallet while displaying 100% user gross principal. The agreed instruction is to **preserve the prior routing economics for design**, not a declaration that the resulting 100% credited principal is safely cash-backed.
- KYC/VIP remains **manual** and under a dedicated admin-only role, independently of withdrawal approval. Account activity / referral eligibility can be contract-derived.

**Non-negotiable solvency disclosure and implementation constraints:**
1. Do not silently change existing 10%+10%+80% routing. Produce a per-deposit, per-asset reconciliation of amounts moved to fee/operations wallets, gross user principal liability and cash/strategy backing. No promised guaranteed 100% redemption unless independently funded. Existing routing currently creates liabilities in excess of cash retained at vault.
2. No unilateral owner sweep of reserved principal, credited profit or approved/pending withdrawals; treasury draws restricted to independently verifiable surplus and managed with multisig/timelocks where appropriate. Any claims on operations wallet assets require enforceable custody/escrow or observable return funding; do not claim the balance is safely segregated if it is not.
3. **Withdrawal state machine:** `requested -> awaiting_admin_approval -> approved -> payable_when_funded -> paid` (plus `cancelled`, `rejected_with_reason`, `unfunded`). Administrator approves the exact request; cannot change recipient, gross amount or asset. The contract enforces eligibility, lock, fee, per-asset 72h cooldown and anti-double-spend. Approved payment can be called by anyone but pays only the user, never the caller. Unapproved requests cannot be paid.
4. Funding/liquidity is required before actual payout; 72 hours is not an unconditional transfer guarantee. Overdue requests and funding gaps must appear clearly in admin and customer panels with exact reasons. Define a fair and secure cancellation/rejection policy before launch.
5. **Approved V2 economics:** 3% profit withdrawal fee (300 bps); reinvestment only from available user profit via explicit user action; retain the current 30% principal withdrawal penalty even after the 90-day lock, a 10% profit-withdrawal cap of cumulative external deposits plus completed reinvestments in the same asset, and a per-asset 72h withdrawal cooldown. These figures are specific to proposed V2, not deployed-vault settings. Show all terms clearly, especially the continuing 30% principal penalty after the lock, and independently review them for fairness. A principal penalty even after the lock is particularly important to disclose or redesign.
6. Public balances distinguish `accountedPrincipal`, actually backed assets/custody, credited profit, reserved/requested withdrawals, approved yet unfunded amounts, and `paidToWallet`. No misleading cash-sufficiency claims.
7. No retrospective change to prior deposits, receipt identifiers, 72-hour clocks, wallet balances or old deployment without a separately audited and consented migration.

### D. Admin UX & indexing

1. Build a signer-free, canonical, reorg-safe event indexer backed by a durable database, with unique event key `(chainId,vault,txHash,logIndex)` and block hash/cursor/coverage metadata. Never permit unverified API data to control contract payouts.
2. Admin list: all registered wallets, paginated; registry age; referrer and levels; capital USD; BNB/USDT funded principal; positions; personal vs referral earnings; last signed on-chain check-in; on-chain activity status; VIP/KYC review status; transaction histories; withdrawals and their hash/receipt; errors and reason for skipped profit.
3. User file: show `eligibleNow` and `eligibleAtPeriod` separately with evidence block, last check-in, tier/source rate, active principal, direct registrations vs qualified directs, and per-level referral credits.
4. Admin ledger must distinguish calculated, funded/credited, queued, and actually paid. KYC files remain access-controlled and confidential. Capture audit trail of admin decisions and role changes.
5. Alerts: stale chain RPC; indexer lag; lost signer gas; no reward funding; insolvent backing; queued overdue withdrawals; rejected check-ins; no referral payouts due to eligibility vs configuration. The server's failure affects visibility, not permissioned accounting.

### E. Required tests and change gates

- Four on-chain activity cases (registered no capital, invested without check-in, valid check-in, expired check-in), ensuring no static active flag remains paid forever.
- KYC privilege adversarial tests: activation/user cannot set KYC; KYC admin cannot move assets/allocate rewards; a stolen generic reporter cannot set either field.
- Fixed 24h economics: one 1000-USD position at a 50-bps/day **sample rate** does not accrue 120 USD over 24h; regression test catches hourly multiplication.
- 1–4 referral depth, source-tier vs upline-tier policy, KYC gating, zero/unqualified levels, distinct BNB/USDT assets; personal/referral credits atomic, funded and unique.
- Manual reinvestment: only the beneficiary explicitly triggers reinvest of already credited, available profit; no auto-compound, admin-initiated or background reinvest; new position locked under disclosed rules.
- Unfunded period: no event suggests paid reward; no negative budget or unfunded user claim.
- Withdrawal: admin alone approves *every* exact request; 3% profit fee is fixed in the request at creation (e.g. gross 100, fee 3, net 97); payment of an unapproved request must revert; once approved and funded, anyone may trigger payment to the immutable recipient; 72-hour per-asset cooldown, anti-double-spend, unauthorized-admin, queue rejection/cancellation, race, reentrancy and bounded-gas tests; owner cannot sweep backing.
- Indexing: historical reconciliation; block reorg rollback; 10k users without full on-chain iteration; server outage does not block contract use.
- Existing journal: never reset or mutate previous epoch IDs or user balances; export snapshot before any voluntary migration. Separate old/new networks and addresses.
- Independent security and economic audit, release-by-release E2E testnet rehearsal, and documented migration consent before public real-capital launch.

## Milestones

- **M0 (now):** freeze economic terms and precise daily/hourly basis, withdrawal policy, data/privacy requirements; audit the existing state. No new contract.
- **M1:** detailed on-chain V2 interfaces, threat model, funding invariant and test vectors. Keep PR #55's reporter automation **off** pending V2 review.
- **M2:** implement new contract with role separation, on-chain check-in and atomic funded personal+referral settlement, admin-approved bounded withdrawals with permissionless *execution after approval* and events.
- **M3:** deploy isolated testnet V2, register two-plus consented test wallets, verify scenarios including real funded referral event and receipt, wallet independence from VPS, and measured gas.
- **M4:** publish user/admin frontend with canonical history index; stage and independently audit migration from current vault. **Never silently move client funds**.
- **M5:** only after audit, solvency review and legal review consider real funds.

## Deployment and status

This file is a technical specification. It is **not** new contract code, not a green light to invest, and has not changed the current chain 97 vault, role assignments, historical profits, payouts or timers. Prior PR #55 contains an opt-in *reporter-based* prototype; its backend must not be installed with a production authority until the V2 on-chain roles are evaluated.
