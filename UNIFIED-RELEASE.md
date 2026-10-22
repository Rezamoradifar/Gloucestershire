# Global unified release 0.8.0

The browser now loads the active contract from the same-origin API before opening the dashboard. This repairs the unconfigured 0.5.3 frontend without replacing the deployed vault. The current financial frontend, SafePal/WalletConnect integration, support tickets and referral features are combined with persistent day/night selection and the glass daylight surface.

## Daily plan

The daily worker reads `dailyTargetBps` from the contract at the beginning of each completed 24-hour period. Current defaults remain:

| Level | Base daily rate | Qualified daily rate |
| --- | --- | --- |
| Level 1 | 0.5% | 1.0% |
| Level 2 | 0.7% | 1.2% |
| Level 3 | 0.9% | 1.5% |
| Level 4 | 1.1% | 1.8% |
| VIP | 1.3% | 2.0% |

The deployed plan controls tier eligibility and rate changes; the worker does not hardcode a replacement plan. Each asset earns its own percentage on active principal at the period-start block, including completed reinvestments. A change during a period first affects the next snapshot. Principal requested for withdrawal remains invested until payment. There is no credit for periods before automation activation. The first allocation is due after 24 hours, with three block confirmations.

Allocations consume the funded `ledgers(asset).rewards` budget through `batchProfit`; they do not mint tokens or transfer money to wallets. `fundRewards` supplies that budget. Withdrawals are separate requests. Low budget or cash stops the affected allocation without marking it credited. A retained epoch cursor and historical snapshots catch up missed periods with the original balances and rates. Registration events are indexed in bounded pages; summed principal must match the historical ledger before any allocation. Archive-capable historical RPC reads are required.

Recipients are sorted, batches contain at most 100 recipients, and IDs bind the network, vault, activation time, period, asset and batch. The contract's `usedRewardBatch` prevents double credit after a restart. Signed transactions are persisted before broadcast and resumed with the same nonce. The worker pins the runtime hash and chain 97 and has a cumulative 0.1 test-BNB transaction fee ceiling per retained journal.

## Administrator-approved withdrawals

New `DeferredRewardsVault` deployments create a queue exposing `APPROVAL_VERSION()==1`. Only the current two-step vault owner can approve a request. Approval does not permit changing the recipient, amount or fee. After approval any executor can pay the fixed request; the scheduled worker does this when funded. The administrator can also approve and pay atomically.

Both profit and principal withdrawals require approval. Profit is reserved at request time. Principal remains in its original position until the approved payment, preserving the original lock, penalty and capital accounting. One pending request per user/asset prevents duplicate requests. An unapproved request cannot be paid. The requesting user may cancel an overdue request after 72 hours; profit is restored and principal retains its original position. Failed payment keeps the approved debt pending. Existing caps, profit fees and withdrawal cooldowns remain enforced.

The frontend detects legacy queues and explicitly labels their old permissions. It cannot change an immutable deployed contract's rules.

## Installation

Run `bash ubuntu-unified.sh` from this reviewed checkout on the existing server. It installs the checksum-verified prebuilt frontend and current API, preserving TLS, the active contract, private configuration and community data. Node 22.12+ is required; the existing system-readable runtime is reused. No frontend dependency build is required on the server. Read-only chain and fee-destination checks run before activation. HTTPS must serve the exact packaged HTML and the API must return the verified target. Failure restores the previous API release, service and Nginx configuration. Backups are retained under `/var/backups/globaldroptrade`.

The API adds `GET /api/config` with only the public network and contract address. Old APIs can be used through the confirmed `/api/trades` response. A build with an explicit address stops if it conflicts with the API. The runtime address is locked for the browser session. RPC credentials are never returned to the browser.

## Contract activation boundary

The currently verified live testnet vault is `0x731Ba0644e8f44BbBd48124F945724ba534431eb`, owned by `0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632`. Its queue does not enforce administrator approval. Installing frontend files does not upgrade it.

Prepare an unsigned candidate request with `node scripts/prepare-deployment.mjs CONFIG.json --approved-withdrawals` and `BSC_RPC_URL` set privately. This selects the new `DeferredRewardsVault`. It is a fresh candidate, not a state migration. The script does not sign, broadcast, move accounts or switch the live target. A deployment and an explicit plan for existing positions, balances, groups and pending requests are still required before cutover. The previous migration constructor cannot import an existing deferred queue; do not use it for this live source.

The existing testnet server can deploy and verify a separate approval-enabled candidate with `bash ubuntu-deploy-approved.sh --execute`. This workflow uses the reviewed root artifact, a distinct replay-safe journal and the existing server deployer. See [the deployment guide](DEPLOY-APPROVED-REWARDS.md). It leaves the active contract, accounts, pending withdrawals and website configuration untouched.

After the approved contract is deployed and its existing-account transition is reviewed, configure the server's active target and provision a dedicated reporter key locally at `/etc/globaldroptrade/automation.key`, owned by root with mode 0600. Reporter authorization uses the existing contract governance; the key need not be the owner's key. Never share private keys in chat or commit them. Fund the reward budget and the worker's bounded test gas balance.

`bash ubuntu-automation.sh` verifies the target, approval queue and reporter role, creates a forward-only policy once, tests the service and enables a five-minute systemd timer. Reinstallation preserves the start time and journal. Setup fails before timer activation if requirements are absent. Inspect `systemctl status globaldroptrade-automation.timer` and `journalctl -u globaldroptrade-automation`. Status and allocation manifests are private under `/var/lib/globaldroptrade/automation-v1`.

## Build and verification

Vaults use Solidity 0.8.30, Shanghai EVM and optimizer runs 1 to fit EIP-170 while retaining the full plan. BNB Chain supports the Shanghai PUSH0 instruction through [BEP-216 / Kepler](https://www.bnbchain.org/en/blog/bsc-kepler-hardfork-bsc-fast-finality-governance-and-evm-compatibility-of-ethereum-shanghai-upgrade). Both deferred variants have 24,243-byte runtime. Existing testnet mock token and feed runtime are preserved byte-for-byte with their original Paris / 200 build and separate verification input.

Validation commands:

```bash
npm ci
npm run compile
node scripts/sync-contract-artifacts.mjs
node --test --test-concurrency=1 test/*.test.mjs
npm ci --prefix website
npm test --prefix website
npm run build --prefix website
python3 scripts/test-unified-installer.py
python3 scripts/test-api-installer.py
python3 scripts/test-website-installer.py
python3 scripts/test-oracle-installer.py
git diff --check
```

Verified results: 145 contract/API/deployment tests and 49 frontend tests passed; TypeScript and production build passed; four installer checks passed, including upgrade rollback. Read-only public-chain preflight confirmed the active address, owner and missing approval capability. The cloud browser could not reach the local preview, so new visual states were not browser-verified. No live deployment, server installation or public-chain transaction was performed while preparing this release.
