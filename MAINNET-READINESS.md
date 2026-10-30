# Mainnet preparation status

This release prepares GlobalDropTrade for a reviewed BNB Chain 56 launch. It
does not deploy a contract, activate a mainnet signer, connect the live site to
mainnet, or prove that a user has received an on-chain payment. The existing
testnet repair and its private checkpoints remain separate.

## Prepared behavior

| Area | Result |
| --- | --- |
| Contract | Pinned ordinary `AutomaticGroupVault`, approval queue and automatic groups; no fast testnet deployment |
| Owner | `0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632` |
| Assets | Production chain 56 USDT and BNB/USD, USDT/USD feed proxies from `config.mainnet.json` |
| Daily plan | 86,400-second periods, period-start principal including completed reinvestment, separate personal and referral batches |
| Identity | Planning and execution bind the chain, vault address, runtime and historical snapshot; new batches recheck identity |
| Large networks | Mainnet rank qualification reads bounded historical pages without truncating branches or falling back to a base rate on RPC failure |
| Funding estimate | Version 2 includes a conservative bound for personal credits and separately funded referral allocations; exact execution funding is checked again |
| Wallets | Runtime chain selection supports chain 56; SafePal direct and multi-wallet injections are detected |
| Preparation | Unsigned constructor report and optional read-only RPC, feed, checkpoint and gas checks; no signer access |
| Testnet isolation | Fast profiles, hourly policies, mock maintenance and existing testnet signing entrypoints remain chain 97 only |

## Financial behavior retained from the approved contract

Each external deposit records the full amount as principal. It sends 10% to each
of the two fee wallets and the remaining 80%, including rounding remainder, to
the operations wallet. The deposit itself retains no principal cash in the
vault. Principal recorded in an account is a claim; it is not proof of liquid
backing. Returning capital or separately funding rewards restores cash without
changing this original routing rule.

The owner can withdraw liquid assets, including cash assigned to user claims or
reward reserves. This operation does not require partner votes or a delay.
Reporter authority permits funded profit allocation and customer-status updates;
daily percentages and timing are enforced by the reviewed off-chain planner,
not by `batchProfit` itself. Network claims can create unfunded liabilities.

Daily personal and referral credits are accounting entries funded from the
reward budget. They are distinct from payment to an external wallet. Profit
withdrawal requests require approval by the current owner and sufficient gross
liquidity before payment; an approved request alone does not prove payment.
The existing delay, fees, limits, KYC and referral eligibility rules are retained.

Changing any of these financial rules requires an explicit separate economic
decision and a new reviewed contract. This preparation does not silently change
them or promise funded returns.

## Verification scope

Local chain 56 tests deploy the ordinary fresh artifact and exercise deposits,
daily credits, referral allocations, completed reinvestment, repeat protection,
role checks, oracle failures and approval-gated withdrawals. They are local
transactions, not mainnet or public-testnet payment evidence. The frontend's
local chain 56 integration and production build are checked separately.

The offline preparation binds the unsigned constructor and artifact. The online
preflight additionally checks one selected RPC at a confirmed checkpoint; its
report explicitly does not claim independent canonical proof. The public sender
used for estimation is a simulation address, not a generated deployment wallet.

An actual chain 56 read-only preflight passed on 2026-10-26 at block 129802358.
It verified the configured production token and fresh feed rounds and estimated
the unsigned constructor below its gas cap. The observed report is saved at
[reports/mainnet-preflight-20261026.json](reports/mainnet-preflight-20261026.json).
It records zero keys read, signatures and sent transactions, and remains blocked
for deployment. Its historical success does not replace fresh checks at launch.

## Remaining launch evidence

The preparation report remains `readyToDeploy: false`. Before a real launch,
the exact partner and operations recipients and liquidity authority need review;
the current public testnet run needs confirmed daily/referral credit and an
approved payout receipt. A separately reviewed activation must verify the new
mainnet creation, site/API target, reporter permission, 24-hour policy, operator
gas, funded reward cash and historical RPC coverage. No mainnet worker has been
activated by this release. Mainnet balances and journals must start separately
from testnet; no test tokens or test claims are migrated.

Use `bash ubuntu-mainnet.sh plan` for the unsigned offline report, or
`bash ubuntu-mainnet.sh prepare --from PUBLIC_ADDRESS` for the read-only RPC
preflight. Reports explain unresolved blockers; neither command authorizes or
performs deployment.

## Updated preparation package

See [the 2026-10-31 preparation package](MAINNET-PREPARATION-20261031.md)
for the new purchased-RPC historical-state/log check, reproduced artifact, local
verification and remaining production timing/activation requirements. Public
RPC current-state success is not accepted as an archive-readiness claim.
