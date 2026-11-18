# Global V3 single investment account

This profile is a separate BNB Smart Chain Testnet release (chain 97). Each
wallet has one investment position. Every deposit and reinvestment adds to
its principal, with a separate first accrual time and 90-day principal lock.
The keeper records eligible accrual after an on-chain check-in. The deposit
routes, tiers, compounding, withdrawal fees and payout approvals use the
existing V3 rules.

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

For an approved testnet deployment, use `--deploy-testnet` with the same
profile flag. If the network drops after submission, inspect the new profile's
pending journal and reconcile it with `--recover-existing`. The install
entry point requires the new deployment proof before staging the site.

Run `bash scripts/start-v3-unified-release.sh <reviewed-sha> --single-capital`
to publish `/single-capital-test/` against that proof. The separate
`global-v3-single-capital-keeper-testnet.timer` needs its own gas-only wallet
with at least 0.001 tBNB. The installer prints the public address if gas is
missing and keeps the candidate route read-only until the verified timer is
active. The successful wallet-enabled publication marker includes the new
route URL. Confirm the first eligible keeper transaction and test withdrawal
receipt separately.
