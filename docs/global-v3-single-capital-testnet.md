# Global V3 single investment account

This profile is a separate BNB Smart Chain Testnet release (chain 97). Each
wallet has one investment position. Every deposit and reinvestment adds to
its principal, with a separate first accrual time and 90-day principal lock.
The keeper records eligible accrual after an on-chain check-in. The deposit
routes, tiers, compounding, withdrawal fees and payout approvals use the
existing V3 rules.

Account amounts use the display denomination `USDT` consistently in balances,
forms, transaction reviews and history. The network remains explicitly labeled
BNB Testnet. This presentation change does not replace the pinned mock token,
change the chain, convert any balance to real assets or enable a mainnet release.

All account deadlines use the confirmed block's Unix timestamp. The dashboard
shows these times in UTC to the second. Each addition earns its first eligible
hour 3,600 seconds after it is recorded. For example, an addition at 23:40 UTC
is first eligible at 00:40 UTC the following day. The next period starts at
its confirmed accrual. A check-in lasts 24 hours, the withdrawal cooldown lasts
72 hours and each principal lock lasts 90 elapsed days.

The form totals confirmed profit for the whole account and calculates a
separate maximum for one request. The transaction uses the account's verified
additions automatically and honors the request cap, withdrawal cooldown and
any lock or reservation. The site verifies up to 256 additions and submits up
to 16 consecutive additions per request. Approval and test-token funding
remain separate from the request. The previous test contracts and their
balances remain available through their existing dashboards.

From the repository root, run the compile and local acceptance checks:

```bash
node scripts/compile-global-v3-unified-testnet.mjs --single-capital
npm test --prefix website -- --maxWorkers=1 tests/v3-single-capital-local-evm.test.tsx
```

On the Global VPS, use a clean checkout of the reviewed commit for the
separate testnet release. The deployer requires the existing designated
testnet deployer, exact creation code, verified test token, and bounded gas.
Check the estimate with:

```bash
node scripts/deploy-v3-unified-isolated.mjs --check https://bsc-testnet-rpc.publicnode.com --single-capital
```

To deploy and publish the separate testnet account, run
`bash scripts/start-v3-unified-release.sh <reviewed-sha> --single-capital --deploy-testnet`.
The command checks a saved proof first. With a pending deployment it recovers
the original transaction. With neither record it checks the cost and deploys.
Omit `--deploy-testnet` to publish only an existing verified deployment. The separate
`global-v3-single-capital-keeper-testnet.timer` uses its own gas-only wallet.
The installer verifies that operator and starts the timer even when its test
gas is missing. It enables deposits and registration once the deployment,
worker identity and active timer are verified. The dashboard shows the
operator's public address and confirmed tBNB balance. Automatic claim
recording waits for at least 0.001 tBNB in that wallet and resumes on a later
timer tick after funding. The successful wallet-enabled publication marker includes the new
route URL. Confirm the first eligible keeper transaction and test withdrawal
receipt separately.

To promote the verified one-hour account to the main domain, run
`bash scripts/start-v3-unified-release.sh <reviewed-sha> --single-capital --primary`.
This operation requires the existing single-capital deployment proof. It
builds and tests one release, publishes the landing page and dashboard on
the main domain, and publishes that same build at `/single-capital-test/`
and `/hourly-test/`.
The main dashboard is available at `https://globaldroptrade.com/#dashboard`.
The publisher checks the contract, book, network and keeper identities before
updating the served files and checks the actual HTML, JavaScript and CSS over
local HTTPS afterward. The root installer records a backup and restores it
when verification fails. The hourly contract's earlier account records are
archived and verified at `/previous-hourly-test/` before the hourly route is
atomically switched. A failed hourly HTTP check restores its previous files.
Moving its balances into the single-capital
contract requires a separate on-chain migration.

The main account includes the hourly digital countdown and personal and
compound estimates derived from the loaded additions. With a partially
loaded addition list, the dashboard labels that timer and estimate coverage.
Recorded profit changes after a confirmed eligible accrual transaction.

## Referral commission on personal profit

The corrected hourly vault (single-capital version 3) credits uplines only on the
profit earned on each addition's principal. The member keeps their full
personal profit. The member's own compound has a separate balance. Referral
credits and network milestone credits do not generate another commission.

| Earning member's capital in test USDT | Direct | Level 2 | Level 3 | Level 4 |
| --- | ---: | ---: | ---: | ---: |
| 10 through 500 | 8% | 4% | 2% | 0% |
| Over 500 through 2,500 | 10% | 5% | 3% | 0% |
| Over 2,500 through 10,000 | 12% | 6% | 4% | 0% |
| Over 10,000 through 50,000 | 14% | 7% | 5% | 0% |
| VIP, over 50,000 | 16% | 8% | 6% | 4% |

An earning member with 1,000 principal keeps all 7 units of personal profit.
The three eligible uplines receive 0.70, 0.35 and 0.21 units respectively. If
level 2 is inactive its credit is zero and level 3 still receives 0.21.
Recipients must be eligible, and VIP recipients require manager-verified KYC.
Only a VIP earner can generate a fourth-level credit for a VIP recipient.
Team shows the tier schedule and Account supports requests from the recorded
referral balance. The hourly contract checks eligibility at posting. The
separate daily account uses the active terms at cycle maturity.

From a checkout of the reviewed commit on `vps-luna-2585`, publish the corrected
hourly account on BNB Testnet with the existing release entrypoint:

```bash
release_sha=$(git rev-parse HEAD)
bash scripts/start-v3-unified-release.sh "$release_sha" --referral-profit --deploy-testnet
```

The first command sequence verifies or creates the version 3 deployment and
installs its worker and dashboard at `/referral-profit-test/`. The worker
reports its public gas address if it needs test BNB. To serve this verified
account at the main domain after the worker has gas, use the same release:

```bash
bash scripts/start-v3-unified-release.sh "$release_sha" --referral-profit --primary
```

Existing accounts and withdrawal requests stay on their original vaults.
The prior hourly dashboard remains at `/single-capital-test/` and the daily
account remains at `/daily-capital-test/`.

## Manual reinvestment and automatic milestone groups (version 4)

The hourly account at `/manual-reinvest-test/` earns personal profit only on
principal. At 0.7% per eligible test cycle, 1,000 earns 7. Leaving that claim
in the account earns another 7 in the following cycle. Reinvesting the 7 by
signing a transaction raises principal in the same position to 1,007. Once
both additions have matured, the next eligible cycle earns 7.049. Each new
addition starts its own accrual clock and 90-day lock.

The referral tier table still applies to the member's earnings on principal.
A gross withdrawal of 100 in personal, referral or milestone earnings has a
fee of 2 and pays 98 once approved and funded. A principal withdrawal after
unlocking retains its separate 30% deduction.

A direct branch's first recorded volume creates the first milestone group.
Later branches join the current group automatically. The first 500-unit
stage accepts at most 300 from one branch. Another 200 of unused volume
qualifies the active member to record the 35-unit reward. Recording and
withdrawing a reward are separate actions. Each of the 14 stages consumes
fresh eligible volume. After stage 14 the next new branch opens a new group.
Repeated deposits or reinvestments in an assigned branch retain its membership.

On `vps-luna-2585`, run the pinned release in this order:

```bash
release_sha=$(git rev-parse HEAD)
bash scripts/start-v3-unified-release.sh "$release_sha" --manual-reinvest --deploy-testnet &&
bash scripts/start-v3-unified-release.sh "$release_sha" --manual-reinvest --primary
```

If the worker reports insufficient test gas, use the keeper address printed
for this release and repeat the same commands once it is funded. The installer
reuses its verified testnet deployment. Previous referral-profit accounts,
requests and balances remain accessible at `/referral-profit-test/`.
