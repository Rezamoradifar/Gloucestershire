# Deferred network rewards — candidate new deployment

This branch adds `DeferredRewardsVault` and `ProfitWithdrawalQueue`. The existing `DropshippingVault` retains its funded-reward behavior. Existing deployed contracts cannot be upgraded. Do not point the live site to a fresh empty vault as a migration.

## Behavior

- A volume-qualified network reward credits earned USDT profit with zero cash and zero reward budget. A valid oracle is still required for USD conversion.
- Available reward budget is consumed up to the award amount; the unfunded remainder increases recorded liabilities. Treasury shortfall includes these liabilities.
- `claimNetworkRewards(group, expectedStage, count)` unlocks up to 14 consecutive stages atomically. Every selected stage must qualify after previous stage consumption and caps. An incomplete stage reverts the entire batch.
- Unclaimed volume is carried forward. Reinvestment uses recorded available profit, creates a locked principal position and does not require cash.
- `withdrawProfit` on the new vault records a request instead of transferring money. Existing withdrawal caps and cooldown remain enforced at request time. One pending request per user/asset is allowed.
- Requests reserve gross profit, snapshot the fee and recipient, and set a deadline 72 hours after request creation. Payment can happen before the deadline; this is not a mandatory three-day lock.
- Anyone can call queue `pay(id)`; funds always go to the recorded recipient and fee wallet. Payment requires treasury cash. Failed payment leaves the request and debt intact.
- After the deadline only the requesting user can `cancel(id)` to restore the full reserved profit. Requests are never silently deleted or marked paid when cash is missing.
- Queue pending amounts are included in `accounted`; reinvestment, cancellation and request creation preserve total liabilities. Successful payment reduces them exactly by gross payment.
- Operator funding uses `returnCapital(asset,amount)` to restore liquidity without creating new principal or reward-budget credit. For token assets approve the vault first. No funding has been executed by this change.
- Principal withdrawals and funded seller/referral commission logic retain their existing rules. Owner treasury powers are unchanged. A 72-hour deadline records the obligation; it cannot guarantee external funding or autonomous payment.

## Frontend

The client detects `REWARD_ACCRUAL_VERSION()==1`. Old contracts keep their funding checks. New contracts allow earned rewards without cash, expose a two-stage review button, show request capacity independently of liquidity, and provide paginated personal/operator request lists with payment/cancellation controls. Each action is simulated and wallet-confirmed. Treasury funding and payment need transactions; no keeper is silently enabled.

## Verification

Run `npm run compile`, `node --test test/deferred-rewards.test.mjs test/vault.test.mjs`, `npm test --prefix website`, and `npm run build --prefix website`.

## Deployment boundary

No live contract or balances were changed. Deployment must explicitly select `DeferredRewardsVault`; existing deployment scripts continue selecting the original vault. Before production activation, a separate migration plan must account for existing principal, profit, positions, immutable referral parents, branch volume, groups and already consumed reward volume. A frontend install alone cannot enable the new accounting on the existing contract.
