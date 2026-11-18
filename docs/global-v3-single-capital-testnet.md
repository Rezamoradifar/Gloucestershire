# Global V3 single investment account

This profile is a separate BNB Smart Chain Testnet release (chain 97). Each
wallet has one investment position. Every deposit and reinvestment adds to
its principal, with a separate first accrual time and 90-day principal lock.
The keeper records eligible accrual after an on-chain check-in. The deposit
routes, tiers, compounding, withdrawal fees and payout approvals use the
existing V3 rules.

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
