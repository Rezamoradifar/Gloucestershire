# GLOBAL detailed release notes and setup

These notes preserve the historical release details. Later release-specific rules can supersede them.

## Sales referral model 2

The seller receives 100% of funded gross settlement profit. Eligible upline commissions are funded separately from `ledgers[asset].rewards`; they do not reduce seller profit. Ineligible shares remain in the budget. For Starter gross profit of 100 with a budget of 14, the seller receives 100 and uplines receive 8/4/2, totaling 114. Existing settlement-asset tokens back these credits; nothing is minted. Insufficient budget or liquidity reverts the entire settlement. Rates, fees and withdrawal caps are unchanged. Old contracts are immutable, so the model requires a new deployment.

## Release v0.7.0 — October 11, 2026

Updated seller rates, capped aggregation across any number of branches, reward schedule, images, FAQ and a read-only settlement API. See [release and installation instructions](UPGRADE-2026-10-11.md) and [network rules](NETWORK-PLAN.en.md). Older notes below may be superseded. This historical release note does not establish production deployment.

## Version 0.5.3

Reinvesting credited personal profit or network commissions increases the basis for each profit-withdrawal cap. Only profit actually consumed by reinvestment counts; earning profit alone does not increase the cap. The basis is cumulative and per asset; principal withdrawals do not reduce it. Example: 1,000 USDT deposited plus 500 USDT reinvested gives a gross cap of 150 USDT per withdrawal, before the initial 5% fee. Profit balance, cash liquidity and cooldown still apply.

## Version 0.5.2

The initial profit-withdrawal fee is 5%. The owner can configure 0–10% through partner voting and a two-day delay. Rates above 10% revert even after approval. Principal-penalty limits are unchanged.

## Version 0.5.1

Member-to-member profit transfers were removed. `transferProfit` and `InternalTransfer` are absent, and legacy calls revert. Withdrawals to the user's own wallet and reinvestment remain available. Adopting the change requires a new deployment.

## Version 0.5.0

The previous testnet deployment was immutable. Earlier local deployment reports described v0.4.0. This package at that release contained contracts, tests and unsigned-transaction preparation tools. The frontend still displayed an older model and needed separate integration. No public deployment or real transaction was established by those notes.

### Three changes

1. Each external BNB or configured-USDT deposit transfers 10% to the first fixed wallet, 10% to the second and the remainder, including rounding, to `dropshippingWallet`. Deposits no longer require or consume a prior reserve credit. A failed transfer rolls back the deposit, registration, position, fees and operations-capital accounting.
2. Principal penalties remain in the contract instead of transferring to another wallet. Initial penalty: 30%; initial lock: 90 days. A withdrawal of 1,000 principal pays 700 and retains 300. Gross cash is required so that retention is real. `retainedPrincipalPenalties` is historical accounting, not a withdrawable or guaranteed cash balance. Penalties do not create new profit allocations or user debt.
3. Level-four commission requires the recipient's current VIP tier, active status and valid KYC. This replaces the old active-direct condition. If VIP status, activity or KYC is lost, that share stays in the reward budget. Seller tier still sets the rates; historical VIP qualification is not permanent eligibility.

### Addresses

- First fixed share: `0x7037Cc199499D7A3431285a01E435454EaE51265`
- Second fixed share: `0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632`
- Profit-withdrawal fee: `0x74015deDF36677485793f1714Ec7bD4893907b26`
- 80% operations wallet: `0x8c4AC9b009808a0B49Ba77b58e3871e7cDba463c`, supplied by the user in the example configuration. This constructor parameter is required and immutable; zero and the three fee destinations are rejected.

Each 10% share uses integer division, with all remaining units sent to operations. The initial 5% profit fee uses the third destination and is independent of principal-penalty changes.

### Accounting and limitations

Full deposits remain recorded as principal and deposit history, although all deposited cash leaves the vault. Without prior cash, the post-deposit vault balance is zero. Withdrawals require returned capital or actual funding. The two 10% shares are expenses, not recoverable operations capital.

The 80% operations amount automatically increases `ownerCapitalOutstanding`. This combines direct owner capital withdrawals and automatic operations transfers; it does not prove external assets or profit. `returnCapital` restores cash without new principal/profit and reduces this indicator up to its recorded amount. Returned principal must not be reported as sales profit.

The owner's existing ability to withdraw any vault cash, including retained penalties, remains. Penalties are not a locked guarantee fund. Partners have no dedicated balance or surplus withdrawal path. Principal, returns, timing and dropshipping profitability are not guaranteed. Sending 80% to a wallet does not execute retailer APIs or automated commerce.

### Preserved rules

- BNB and the configured USDT have separate accounts. The token and feeds are chosen at deployment.
- Five plans and their rate table remain; daily targets do not automatically become profit.
- Sales profit must be funded; reporters attest customer identity and activity.
- Per-withdrawal gross profit cap: 10% of lifetime external deposits plus consumed-profit reinvestments, per asset. Initial cooldown: 72 hours.
- The initial 30% principal penalty remains after the 90-day lock. Each position preserves its own rate and deadline.
- Reinvestment moves profit to principal without repeating the external-deposit split.
- Seven fixed partners vote only on configuration changes. The owner queues a proposal, at least two partners vote, and the owner executes the same change after two days. Partner status grants no automatic financial share or withdrawal path. Voting does not restrict direct owner cash withdrawals.
- Rate, withdrawal-rule, minimum-deposit, reporter, plan and quorum changes require votes and delay. Fee destinations and operations wallet are immutable. Emergency pause, ownership transfer and direct owner withdrawals are outside that vote path.
- Bridges, exchanges and invitation-count rewards remain excluded.

## Run and review

```sh
npm ci --ignore-scripts
npm test
npm run compile
```

`governance-test-results.txt` records the v0.5.0 tests; `validation.json` summarizes them. Local tests are not an independent audit or a perfection guarantee.

Prepare a deployment configuration with the owner, seven actual partners, token, feeds and operations wallet. No private key is needed to prepare unsigned input:

```sh
BSC_RPC_URL=https://YOUR_RPC node scripts/prepare-deployment.mjs config.json
```

The seventh constructor argument is `operationsWallet`; older scripts/ABIs do not match this version. Public testnet validation, independent review and liquidity-model review are required before a mainnet launch.

## Historical local deployment

The release was deployed to a local chain 31337, where mock-token and simulated-BNB deposit splits were checked. Receipts are in `deployment-local.json`. These are not public BNB Testnet addresses and cannot be used on BscScan. Owner and partners were temporary lab accounts; the operations destination was user-supplied.

```sh
node scripts/deploy-local.mjs
```

The lab listens only on `127.0.0.1:8545`. Stopping it loses in-memory state; restarting creates a fresh deployment. Tokens and feeds are mocks. This does not establish public-chain reliability. Public testnet deployment needs a funded tBNB signer and the intended owner/partner configuration.

## Historically supplied partner wallets

These addresses were recorded for the next deployment at the time; they did not modify the earlier lab deployment. The owner supplied in those historical notes was `0xeBfbE2348a0edD7D643ffA441cF6F7B1F2425Be5`.

1. `0xA7705F5c98263Caae042626a5d49528Dd982Af5F`
2. `0x2F980aC9ae92DB23cA2AEAd1CE8188A5764a7Bfa`
3. `0x730C4664C58aE506C05b50e06c1CE73f71D82b87`
4. `0xa63AD5EEe7907D76B22eb140cC4009fDc3a6c977`
5. `0xba869ec421be39c5F5410033Cf7Ec203298B151a`
6. `0x4274d411FF49Cfd2FCf1eC97Fb05f51099d5E0A3`
7. `0x63c5B98AEfd69658B652d5F35FFda3C6c06847E3`

## Ubuntu and public testnet deployment

`ubuntu-setup.sh` installs Node.js 22.23.3 locally without changing other projects' Node versions. Install prerequisites with `sudo apt-get install -y curl ca-certificates xz-utils unzip`, then upload and extract the archive.

```sh
cd bnb-contracts
bash ubuntu-setup.sh
```

Setup installs dependencies, runs tests and creates a separate test wallet, printing only its `TEST-ONLY DEPLOYER` address. Its key stays in `.testnet-server/deployer.key` with mode 600. Do not share the key or use a production wallet. Fund this address only with testnet tBNB. Official faucet documentation: https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/

```sh
bash ubuntu-testnet.sh deploy
```

This signs and publishes four contracts on chain 97: test token, two mock feeds and GLOBAL. Owner, partners and operations address come from the supplied configuration; the gas payer is separate from the owner. The script checks testnet and zero transaction value. It does not operate a dropshipping business or generate profit. Mock feeds expire after 24 hours and are for testing only.

Repeat the same command after disconnection. Signed transactions are persisted before broadcast and reused. Never delete the journal. A reverted transaction stops the process for diagnosis. On success share only `.testnet-server/deployment-public.json` or the `VERIFIED CONTRACT` link, not the full private directory.

```sh
bash ubuntu-testnet.sh address
```

Recorded local server-tool tests covered chain-56 rejection, intended ownership with a separate payer, receipt-based resumption without duplicate deployment, and configuration-change rejection. Results are in `server-test-results.txt`. Those local results did not establish public transactions.

## Version 0.5.0 governance details

Only the owner calls `queueConfiguration` for the exact configuration calldata hash. Each partner casts at most one `voteConfiguration` per round. The owner has no automatic vote, but can vote normally if also a partner. The owner executes after quorum and two days from proposal creation. Each proposal snapshots its quorum; later quorum changes affect only future proposals.

The owner may cancel a proposal. Requeueing starts a new round without old votes. Active proposals cannot be overwritten. Successful execution consumes the proposal. Proposals do not expire automatically; the owner may cancel them. Governance cannot upgrade immutable contract code.

`proposeSurplusWithdrawal`, `voteSurplusWithdrawal` and `executeSurplusWithdrawal` were removed. Partner membership grants no automatic payment or withdrawal authority. The two fixed 10% destinations are independent and unchanged.

## Version 0.6.0 and health review

[Network rules](NETWORK-PLAN.en.md) describe ranks, independent groups, volume consumption, reward funding and queue processing. New contract rules require a new deployment.

[Health review](HEALTH-REVIEW.en.md) and `health-test-results.txt` record expanded tests, clean installation and dependency review. `npm test` compiles the current source first. Use `npm ci --include=dev --ignore-scripts` for tests and `npm ci --omit=dev --ignore-scripts` for separate execution environments. Ganache is local-test tooling with remaining dependency advisories.
