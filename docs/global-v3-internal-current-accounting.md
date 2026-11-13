# Global V3 TESTNET — Internal Current (account credit), not wallet transfer

## Authorized product behavior

**Internal Current = the user's actually recorded, outstanding V3 test profit claims.**

On-chain source of each component, read at the **same confirmed BNB Testnet block** after runtime and deployment receipt verification:

| Field | Contract ledger source | Included in Internal Current? |
|---|---|---|
| Daily profit | Sum of claimableDaily(user, positionId) for all verified positions | Yes |
| Profit on profit | Sum of claimableCompound(user, positionId) | Yes, **exactly once** |
| Referral profit | users(user).referralAvailable | Yes |
| Pending withdrawal | Sum of position.reservedProfit + users(user).referralReserved | **No**, shown separately |
| Principal | Sum of position.principal or users(user).capital | No, separate principal field |
| Wallet's actual token balance | ERC-20 balanceOf(user) | **No**, separate wallet field |
| Contract treasury cash | ERC-20 balanceOf(vault) | No, separate vault field |

Internal Current is a **recorded, potentially unfunded TESTNET obligation**. It is not withdrawable ERC-20 cash in the wallet, proof of operating income, or a guaranteed return. A request may be bounded by a 72-hour cooldown and a 10% per-request cap. Do not label the full Current as immediately transferable or paid.

At each eligible daily accrual (one per matured position per qualified 24-hour period):
- The **daily** component is principal × reviewed daily basis-point rate.
- The **automatic profit-on-profit** component is the existing outstanding compounded basis × rate, without another deposit, click or manager approval. This is included once in the period total.
- The contract updates position.availableProfit, position.compoundedBasis, claimableDaily and claimableCompound, and global profitLiability together.
- No ERC-20 transfer occurs on accrual. A separate network transaction from the user's daily check-in or the testnet gas-only keeper is still required to update the ledger.
- When user requests withdrawal, the amount moves to the **pending/reserved internal bucket** and stops compounding while pending. Rejection/cancellation restores internal available claims. Approval does not send a wallet token.
- Only a separately approved and actually funded/escrowed withdrawal may call payWithdrawal, which sends TEST tokens to the immutable beneficiary and to the disclosed fee receiver.

## Display requirements

1. Top hero: **Current داخلی حساب** (numeric, TEST USDT INTERNAL).
2. Breakdown: **سود روزانه**, **سود از سود**, **سود معرفی**, **درخواست برداشت در انتظار** (all numeric).
3. Separate line: **Actual wallet token balance** from token.balanceOf, with an explanation that internal credit has **not** entered it.
4. Separate line: global **cash shortfall** and withdrawal cap/cooldown.
5. Always fail closed if the chain-97 deployment, code hash, connected wallet, confirmed RPC block, or ledger balances do not reconcile. Never synthesize an amount on frontend, in localStorage or in a backend database to mimic a settled on-chain claim.

## Deployment and compatibility

This PR is a **UI and read-only aggregation change only**; it does NOT modify deployed V2 contract, V3 Solidity bytecode, 10/10/80 economic terms or fee rates. It can reuse an actually deployed V3 *of the same pinned source* after testnet receipts and code hash checks. Site activation stays blocked until those checks pass; old V2 #v2-dashboard remains accessible.

Passing CI is not proof of V3 deployment or economic sustainability. Public TESTNET end-to-end acceptance and independent security/economic review are required before real-money use.
