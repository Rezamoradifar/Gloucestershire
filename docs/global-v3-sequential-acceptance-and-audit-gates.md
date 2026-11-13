# Global V3 — sequence of remediation and release gates

**Status:** isolated BNB Testnet (chain 97) source-code prototype. **NOT DEPLOYED**. No user money, vault balance, existing V2 contract, production website or user records have been changed by this PR.

## Why the existing installed V2 cannot implement the requested economic model

The immutable V2 address \`0xA98D8d3709f5D3730BAD5d76C334731784e7CF07\` has \`settleFundedEarnings\`, which requires an incoming funded token transfer in the same transaction as each credit. The V2 contract also requires cash backing of **all existing accrued profit liabilities** before any profit withdrawal can be paid. Updating the website alone cannot change these on-chain conditions.

## 1. Daily accrual as a recorded, potentially unfunded test claim

The new \`GlobalV3DeferredTestnet.accrueDaily(who, positionId)\` records **one conditional period**, never hidden catch-up, only after at least 24 hours have elapsed and the investor has signed a recent 24-hour check-in. An authorized funder is not required to pre-fund accrual. Position and asset liabilities are updated together, with event evidence. A new accrual does **not** imply that money was earned through trading, that the payment is funded, or that the user has received tokens. A separate reconciliation displays the actual cash gap.

A single `checkInAndAccrue(positionIds)` wallet signature can check in and record a bounded list (maximum 20) of mature positions. Independent keepers may also call permissionless `accrueDaily`, but neither route creates funds.

The test base rates are 0.50%, 0.70%, 0.90%, 1.10% and 1.30%. The documented qualified maxima are 1.00%, 1.20%, 1.50%, 1.80% and 2.00%, requiring the corresponding counts of qualified direct accounts and branch-capped volume. The test contract maintains bounded incremental qualification totals and permits staged milestone claims; token-to-USD parity is simulated, not an oracle. **These rates require independent commercial evidence and legal review before any real use; they are not guaranteed yields.**

## 2. Profit on profit, without double counting

Each position has \`principal\` and \`compoundedBasis\` for eligible, outstanding, on-chain **test claims**. After the first day, \`personal = principal × bps / 10000\` and \`compounded = compoundedBasis × bps / 10000\`. The credited increase is exactly \`personal + compounded\`. The credited increase becomes the new compounding basis for subsequent qualifying days.

Example: A position holding 1,000 mock USDT at the 0.70% test tier receives a day-one accrued claim of 7. Day two adds 7 in base accrual plus 0.049 profit-on-profit, yielding **14.049 accumulated mock-unit claims**, before any withdrawal or reinvestment. These are contract-accounting figures, **not demonstrated economic returns or a representation that the cash exists**. Pending withdrawals stop compounding their reserved portion. Separate on-chain `claimableDaily(user,positionId)` and `claimableCompound(user,positionId)` track **remaining** component claims, decrement on request and reinvest, and restore exactly on rejection/cancellation.

Manual \`reinvest\` moves previously accrued profits into a distinct new locked principal position with no new token transfer. The total principal/profit liabilities and shortage are updated; no phantom incoming cash appears.

## 3. Withdrawal, approval, just-in-time escrow and payout

A user submits a specific claim against a position (\`requestProfit\`), a matured principal position (\`requestPrincipal\`), or existing referral earnings (\`requestReferral\`). One pending request per user and a 72-hour per-user cooldown limit concurrent/repeat requests. Management must independently approve a specific request. A role-restricted funder then supplies **exactly that request's gross amount** through \`fundWithdrawal(id)\` to an escrow tracked in \`reservedForPayout\`. No fixed 1m mock-token deposit is required. Where verified unescrowed liquidity is already available, `reserveExistingCash(id)` earmarks it without another token transfer. Profit reserves cannot consume the unescrowed principal backing; multiple requests cannot spend the same escrow. A later, separate \`payWithdrawal(id)\` transfers to the **immutable original beneficiary** and fee recipient only; the same request cannot pay twice.

The cash paid is not a frontend display change. A successful local or public-chain transfer requires a real token balance, independent signatures, adequate gas and verifiable receipt. Profit withdrawal fee: 3%. Principal lock: 90 days, followed by a 30% contractual penalty. User-request profit cap: 10% of cumulative mock test deposits + reinvestments (same as V2; any proposed different cap requires governance review).

## 4. Financial reconciliation

At all times on the test prototype:
- \`principalLiability\` and \`profitLiability\` are separate, explicit on-chain obligations.
- \`principalEscrowed\` identifies the already-earmarked principal subset, protecting it from use by another claim.
- \`reservedForPayout\` is an escrow earmarked to already manager-approved cash-backed requests, not freely spendable treasury cash.
- \`cashStatus()\` returns actual token cash and the **shortfall** \`max(principalLiability + profitLiability − cash, 0)\`.
- V3 routes external mock-token deposits 10% + 10% + 80% to the original fixed destinations. Gross principal remains a liability while zero of the deposit remains in the vault; the resulting cash shortfall is explicit.
- When an unfunded profit claim is reinvested, principal liability may grow without cash; **display this uncovered principal explicitly** and forbid claims of fully backed principal unless proven.
- No money or user data should be migrated from V2 without individually verifiable, independently reviewed authorization and a reconciliation plan.

## 5. Acceptance testing and panel validation

The local Ganache test creates 100 independent, actually signing mock wallets and checks actual \`deposit\` transfers; 24-hour check-in; daily and cumulative compounding; referral credits; no backfill/replay; permissions; early principal-lock rejection; withdrawal request/approval; exact separate token transfer to escrow; immutable user beneficiary and fee receipt; rejected, duplicate or redirected payouts; and accounted liabilities/cash shortfall.

**A passing local simulation is not a successful public BNB Testnet payment or a real financial audit.** Before user acceptance, verify mobile and desktop wallet connectors, BNB Testnet RPC code hashes, per-position balance and reward screens, withdrawal status on confirmed chain blocks and the original beneficiary receiving mock tokens.

## 6. Security, economics and legal audit — REQUIRED, NOT AUTOMATED

Independent reviewers must evaluate: reentrancy and ERC20 behavior; token decimals and mutable/minter risk; 24h check-in/scheduler fairness; admin/funder role segregation and loss of keys; fees and KYC constraints; compounding rate sustainability and evidence of revenue; order-of-operations cash allocation; unreconciled principal, referral and profit obligations; exact reserved-escrow invariant; pausing and incident response; user withdrawal rights and consumer disclosures; contracts and licensing in target jurisdictions. Obtain a signed report and closure evidence before any mainnet deployment.

## 7. Release and production controls

Do not merge or deploy V3 onto the existing live site merely because tests pass. Release only after:
1. Reconcile the fixed deposit routing, reward economics and independent liquidity plan;
2. Independent review/audit plus resolved critical findings;
3. Complete 100-wallet LOCAL acceptance **and** controlled public TESTNET receipt verification;
4. On-chain liquidity reconciliation and a sustainable revenue source, including a defined source for accrued but unfunded claims;
5. Wallet-signed operator acceptance, safe key management, public-chain contract verification, DNS/rollback plan and regulated-finance compliance where applicable.

The old Global vault, V2 bytecode, existing users and server journals remain untouched throughout V3 development.
