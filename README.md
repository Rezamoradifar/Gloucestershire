## Fresh zero-state contract

For a new independent contract with empty accounts, automatic first-group branch assignment and administrator-approved withdrawals, use [FRESH-ZERO-RELEASE.md](FRESH-ZERO-RELEASE.md) and `bash ubuntu-deploy-zero-start.sh --execute`. Then run `bash ubuntu-connect-zero-start.sh` to verify the fresh deployment and connect its compatible frontend/API with backup and rollback. Run `bash ubuntu-enable-zero-daily.sh` to install the existing-server-key worker and read-only activation status page. This chain-97 flow does not import previous vault data. Daily scheduling starts only after reporter authority, funding and historical-state checks pass; missing prerequisites are reported as waiting without wallet prompts.

For initial reporter authorization on the connected `0x23C32Bb326DB63f89532f80e757B8463c75655b8` deployment, `bash ubuntu-zero-permission.sh` installs a small SafePal-browser permission page. The owner proposes, two configured partners vote, and the owner enables the role after the existing 48-hour delay. Each governance action requires its own reviewed wallet confirmation; installation does not sign or send a transaction.

## Sales referral model 2

The unified 0.8.0 release combines the current financial frontend, API-derived contract connection, glass day/night theme, funded daily plan worker and administrator-approved withdrawals. See [UNIFIED-RELEASE.md](UNIFIED-RELEASE.md) for exact behavior, verified installation and the immutable-contract activation boundary. Run `bash ubuntu-unified.sh` on the existing server to update frontend/API while preserving the active contract.

The seller receives 100% of the funded gross settlement. Eligible upline commissions are additive, debited from the separately funded reward budget of the same asset. Ineligible shares remain in that budget. A Starter settlement of 100 plus 14 of funded referral budget credits 100 to the seller and 8/4/2 to eligible uplines. No tokens are minted. Insufficient budget or gross cash rolls back the entire settlement. The immutable existing testnet contract is unchanged; redeployment is required. Connection preflight now checks SALES_REFERRAL_MODEL_VERSION=2 as well as the rate and stage tables.

## Current release: v0.7.0 — 2026-10-11

Updated seller rates, capped aggregation across any number of lines, new reward schedule, image upgrades, FAQ and a read-only settlement API. [Release and installation guide](UPGRADE-2026-10-11.md) · [Network rules](NETWORK-PLAN.en.md). The older notes below describe release history and may be superseded by these current rules. No production deployment is implied.

## v0.5.3 — reinvestment increases the profit withdrawal cap

Gross cap per withdrawal = 10% of lifetime external deposits plus completed reinvestments, separately per asset. Personal profit and credited network commissions share the reinvestable profit balance. Merely earning profit does not raise the cap. Principal withdrawals do not reduce this cumulative basis. Reinvestment consumes profit once, opens a locked position, and does not repeat the deposit split. Initial withdrawal fee remains 5%; liquidity, profit balance and cooldown still apply. See reinvest-cap-test-results.txt.

## v0.5.2 — profit withdrawal fee capped at 10%

Initial profit withdrawal fee is 5%. Owner configuration permits 0–10% with the existing partner quorum and two-day delay. Values above 1000 basis points revert even after approval. Principal penalty limits are unchanged. See fee-cap-test-results.txt.

## v0.5.1 — no member-to-member transfers

Removed `transferProfit` and `InternalTransfer`. Legacy calldata reverts for both BNB and USDT. Withdrawals to the caller and reinvestment remain available. See `no-transfer-test-results.txt`. Existing deployments are immutable and require a new deployment to adopt this change.

> **v0.5.0 — partner role change:** Seven partners vote on configuration only. Surplus withdrawals were removed. Changes require two votes and a two-day delay. The earlier v0.4.0 testnet contract is immutable.

# GLOBAL — BNB Testnet contract

Contracts, tests and Ubuntu setup for GLOBAL. [Detailed release notes and setup](README.en.md)

## Ubuntu

After cloning the repository and entering the project directory:

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates xz-utils
bash ubuntu-setup.sh
```

Fund the `TEST-ONLY DEPLOYER` address with testnet tBNB only, then run:

```bash
bash ubuntu-testnet.sh deploy
```

This route creates a mock token and mock price feeds on BNB Testnet; it is unsuitable for real funds. The owner, seven partners and operations destination are in `config.example.json`. The payer wallet is created only on the server. Keys, private settings, journals and runtimes are excluded by `.gitignore`. Share only `deployment-public.json`.

## Validation

See governance-test-results.txt for the v0.5.0 local test run. Server and health-check integration tests use local EVM simulations. Public-chain deployment has not been performed by this package's author. No independent audit has been completed.

## Install directly from GitHub

```bash
git clone https://github.com/Rezamoradifar/Gloucestershire.git ~/global-bnb
cd ~/global-bnb
bash ubuntu-setup.sh
# After funding the test wallet with tBNB:
bash ubuntu-testnet.sh deploy
```

After reviewing the changes, update with:

```bash
cd ~/global-bnb
git pull --ff-only
bash ubuntu-setup.sh
```

Rerunning setup preserves the test-wallet key. Deployment checks previous receipts and stops if constructor settings changed.

`deployment-console/` is a SafePal browser deployment page; serve it over HTTPS. It creates four owner-signed test transactions as an alternative to the server flow, which uses an independent test payer. The contract does not include a commerce frontend or retailer API execution.

## Live testing of the deployed contract

```bash
cd ~/global-bnb
git pull --ff-only
bash ubuntu-health.sh
```

This command targets only `0x8C77C442F6CB8C2462a12bB395186be944259504` on chain 97, using the separate server test key. Required balance: 0.03 tBNB, including a 0.02 test deposit and fee margin. It mints and deposits 100 test tokens and deposits 0.02 test BNB. Destinations are actual addresses of that testnet contract. All amounts are for testing.

Before interaction, the script compares creation input against compiled source and the intended owner/partner/operations addresses. It refreshes mock feeds if needed. Checks cover 80/10/10 splits, principal accounting, invalid minimums, principal locks and unauthorized calls. Rejection checks use eth_call and accept only the expected contract error. Owner signing, real-profit settlement, VIP commission and principal withdrawal after 90 days are outside this live test.

Shareable report:

```bash
cat .testnet-server/health-public.json
```

After success, rerunning returns the saved result without new deposits. If interrupted or failed, preserve `health-run.json` and report the error; interruption can occur after broadcast. A completed report marks only this limited test suite, not full security or guaranteed liquidity.

## Mainnet deployment — real BNB fees

The mainnet configuration uses `config.mainnet.json`: 18-decimal Binance-Peg USDT, Chainlink BNB/USD and USDT/USD feeds, a 3,600-second price-age limit and the configured owner/partners. Address references: https://reference-data-directory.vercel.app/feeds-bsc-mainnet.json and https://explorer.bnbchain.org/asset/USDT-6D8 .

```bash
git pull --ff-only
bash ubuntu-mainnet.sh prepare
```

Prepare creates a separate wallet under `.mainnet-server` with a mode-600 key, checks the network/token/feeds and produces an unsigned transaction and gas estimate. Review `deployment-preview.json`. No funds or transactions are sent during prepare. RPC or stale-price failures stop the process.

After reviewing the `MAINNET DEPLOYER` address and funding that exact address with real BNB for gas:

```bash
bash ubuntu-mainnet.sh deploy
```

Deploy publishes one GLOBAL contract on chain 56, without mock tokens or feeds. Transaction value is zero; only actual gas is paid. The signed maximum gas cost is capped at 0.02 BNB; the estimate may be much lower. No owner key is needed; ownership is assigned to the configured address. The signed transaction is saved before broadcast for safe resumption. After interruption, preserve files and repeat the same command. Share only `.mainnet-server/deployment-public.json`, never the directory or private key.

Limitations: no independent audit; complete live profit/withdrawal and VIP testing remains outstanding. All deposits leave the vault while full principal claims remain, and the owner can access all cash. Deployment starts unpaused. Mainnet deployment does not certify security, profitability or frontend readiness.

Automated prepare tests cover wrong networks, invalid addresses, stale prices and the gas ceiling. The recorded development-environment live check timed out; server-side prepare must pass live verification.

## Run the updated release

```bash
cd ~/global-bnb
git pull --ff-only
bash ubuntu-setup.sh
```

This compiles and tests without deploying. Do not use the v0.4.0 deployment page or old verification report for a new version. Historical live-test tooling is pinned to its old contract and intentionally rejects changed artifacts; update its pins only after identifying the intended new test deployment. If a mainnet transaction was already signed, preserve the journal and stop for review.

## v0.6.0 — Three-line ranks and funded sequential rewards
See `NETWORK-PLAN.en.md` for the complete rules. Deposits, consumed-profit reinvestments and reporter-attested sales create cumulative USD branch volume. Rank targets use the three largest independent branches (70/20/10) and 4/6/8/10/12 directs with current principal >= $100. Daily targets do not accrue automatic yield.
Users explicitly create permanent, disjoint triplets. Each triplet has fourteen sequential rewards and independent consumed volume; excess carries forward and cannot be reused in another group for that user. Reward claims credit USDT profit from `fundRewards`, using the existing oracle, withdrawal fee, per-asset cap and cooldown. BNB deposits do not create USDT withdrawal capacity. Stage 14 terminates the group. Rank historical volume is independent of reward consumption.
Volume propagates eight ancestors automatically; operators or any caller must finish deeper jobs through `processNetworkVolume(job, steps)` (1–64 steps). Monitor queued jobs before displaying qualification as complete. Sales are reporter assertions, and cumulative business volume is not cash or profit. Existing owner access to all cash remains. No mainnet deployment or independent audit is claimed.

## Health review
See `HEALTH-REVIEW.en.md` and `health-test-results.txt` for the expanded local review and remaining trust/liquidity risks. `npm test` now compiles first; a regression gate verifies deployment-console bytecode and verification-source consistency. Use `npm ci --include=dev --ignore-scripts` for tests, or `npm ci --omit=dev --ignore-scripts` in a separate execution environment using the committed artifacts. Ganache remains test-only and has known bundled dependency advisories; never expose it publicly or use real keys/funds. The sanitized lock excludes Ganache's extraneous entries that otherwise break clean Linux installation with macOS-only fsevents. Solidity source and compiler version were not changed by this review.
