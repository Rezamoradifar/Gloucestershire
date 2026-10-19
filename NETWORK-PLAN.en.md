# Network rules — v0.7.0, October 11, 2026

These release-specific rules replace the v0.6.0 70/20/10 rules and reward table. The contract is immutable: adopting new rules on-chain requires a new deployment. Editing source or installing the website does not change an old contract or its balances.

## Sales commissions

| Seller tier | Level 1 | Level 2 | Level 3 | Level 4 |
|---|---:|---:|---:|---:|
| 1 | 8% | 4% | 2% | 0 |
| 2 | 10% | 5% | 3% | 0 |
| 3 | 12% | 6% | 4% | 0 |
| 4 | 14% | 7% | 5% | 0 |
| VIP | 16% | 8% | 6% | 4% |

In referral model 2, rates apply to actual funded gross profit in `settleSalesProfit`, not deposited principal or total sales. The seller tier determines rates. Uplines must be active; VIP uplines require KYC, and level four remains restricted to qualifying VIP recipients. The seller receives the entire gross settlement. Eligible commissions are funded separately from the reward budget of the same asset; ineligible shares remain in that budget. For example, Starter gross profit of 100 plus a referral budget of 14 credits 114 in total. Insufficient budget or liquidity reverts the entire settlement. The model requires a new deployment. The maximum combined commission configuration is 34%; non-VIP tiers cannot configure level four. Configuration changes still require partner votes and a two-day delay.

## Volume aggregation across multiple branches

Branch count is not restricted to three. Qualification for each target is:

`sum(min(branch volume, target × per-branch cap)) >= target`

| Target volume, USD | Branch cap | Maximum from one branch, USD | Reward rate | Reward, USD |
|---:|---:|---:|---:|---:|
| 500 | 60% | 300 | 7% | 35 |
| 1,000 | 60% | 600 | 7% | 70 |
| 3,000 | 60% | 1,800 | 7% | 210 |
| 5,000 | 60% | 3,000 | 7% | 350 |
| 10,000 | 60% | 6,000 | 7% | 700 |
| 30,000 | 45% | 13,500 | 6% | 1,800 |
| 50,000 | 45% | 22,500 | 6% | 3,000 |
| 100,000 | 45% | 45,000 | 6% | 6,000 |
| 300,000 | 35% | 105,000 | 5% | 15,000 |
| 500,000 | 35% | 175,000 | 5% | 25,000 |
| 1,000,000 | 35% | 350,000 | 5% | 50,000 |
| 3,000,000 | 35% | 1,050,000 | 3% | 90,000 |
| 5,000,000 | 35% | 1,750,000 | 3% | 150,000 |
| 10,000,000 | 35% | 3,500,000 | 3% | 300,000 |

For a 10,000 target, 6,000+2,000+2,000 or five branches of 2,000 qualify. A distribution of 8,000+1,000+1,000 contributes only 8,000 eligible volume. Excess volume is retained.

## Rank and profit targets

`rankQualified` aggregates all independent direct branches using these caps, rather than only the largest three. Caps are 60% for targets through 10,000, 45% above that through 100,000, and 35% above 100,000. Existing capital-tier targets of 2,500, 10,000, 50,000, 250,000 and 1,000,000 remain, as do requirements for 4/6/8/10/12 directs with at least $100 current principal. These are separate from the fourteen reward stages. Daily rates are targets and do not accrue automatic yield.

`networkBranchCount` and `networkBranch` enumerate branches with volume. `rankVolumePage` returns eligible volume in pages of at most 64; the final total must be capped at the target. The old `largestBranches` interface was removed.

## Reward stages and volume preservation

A group can contain any number of independent branches. `createRewardGroup` accepts `address[]`, with at most 64 branches added per transaction. `addRewardBranches` adds more. This is a processing limit, not a total group limit. A branch cannot belong to two groups for the same user. Branch removal, reassignment and stage reset are unavailable.

Volume consumption remains sequential: after the $500 reward stage, the next stage requires another $1,000 of unused volume. Each stage is claimed once in order; stage fourteen ends the group. Historical rank volume is independent of reward consumption. Group volume is consumed in branch registration order, subject to the cap, with the remainder preserved.

For large groups, `prepareNetworkReward(group, steps)` reserves volume for the current stage in batches of at most 64 steps. Repeated preparation cannot exceed a branch cap and does not itself credit profit or transfer funds. `consumedUsd` includes current-stage reservations. `rewardProgress` and `rewardBranch` expose progress without reading the whole group. Reservations remain attached to their stage until the reward is claimed; they cannot be withdrawn or moved to another group.

`claimNetworkReward` prepares and claims small groups in one transaction. Large groups must finish preparation until the target is met. In this release, insufficient budget, liquidity, a valid price, or a paused contract prevents stage advancement. Earlier successful reservations remain available; changes in a reverted transaction are fully rolled back. The `consume` values in `rewardPreview` include current-stage reservations.

## Preserved rules

Deposits, consumed-profit reinvestments and authorized reporter-attested sales create volume. Volume follows the correct direct branch and propagates to eight ancestors automatically. Deeper ancestry is completed by `processNetworkVolume` in batches of at most 64 steps. Completed jobs cannot count twice. Capital returns and reward claims do not create new volume.

In this release, rewards credit USDT profit from `fundRewards` at the oracle price. Separate withdrawals follow the initial 5% fee, the 10% cap based on deposits plus reinvestments of the same asset, and the configured cooldown. The 80/10/10 deposit split, capital lock, seven partners, absence of internal transfers and owner liquidity powers remain. Recorded volume or profit does not guarantee liquidity or independently verified sales. This release was reviewed through local tests; it did not establish a mainnet deployment or independent audit.
