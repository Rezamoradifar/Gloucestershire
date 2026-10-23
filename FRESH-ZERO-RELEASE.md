# Global fresh zero-state contract

This release deploys `AutomaticGroupVault` as an independent vault on BNB Testnet
(chain 97). It does not read, pause, import from, or call any previous Global
vault. The existing token, oracle feeds, owner, seven partner destinations and
operations destination are explicit public constructor settings in
`config/fresh-zero-testnet.json`. Reusing these destinations does not import
accounts or balances.

The new vault starts with no registered members, positions, invested principal,
recorded profit, reward groups, branch volume, volume jobs or withdrawal requests.
There is no importer or migration entry point. Previous contracts and their
blockchain history remain independently accessible.

## Included behavior

- Each independent branch joins its user's first reward group when its first
  positive network volume is propagated. New branches join that same group;
  repeated volume does not duplicate membership or reset a stage. Separate
  manual group creation and branch selection are disabled in this version.
- Fourteen sequential reward stages retain the existing branch caps and consumed
  volume rules. Expected-stage checks reject stale claims. Earned network rewards
  can be recorded and reinvested even when the vault has insufficient cash.
- Reinvestment consumes recorded profit once, creates new principal and network
  volume, raises the cumulative withdrawal-cap basis and starts a new principal
  lock. It does not repeat the external deposit split or charge a profit
  withdrawal fee.
- Registration, deposits, plan qualification, daily credit batches and
  reinvestment do not require approval of each user action. Both profit and
  principal withdrawals require the current owner's approval of the recorded
  request. Payment always uses the recorded recipient and amount.
- Principal remains invested until an approved principal request is paid.
  Unfunded requests remain outstanding. Users can cancel after the existing
  72-hour deadline; payment and cancellation cannot be replayed.
- Existing sales referral accounting, plan percentages, rank qualification,
  80/10/10 external deposit destinations, fees, locks, governance and security
  checks are preserved, including the existing reporter-set VIP eligibility flag.

| Plan | Base daily target | Qualified daily target |
| --- | ---: | ---: |
| Level 1 | 0.5% | 1.0% |
| Level 2 | 0.7% | 1.2% |
| Level 3 | 0.9% | 1.5% |
| Level 4 | 1.1% | 1.8% |
| VIP | 1.3% | 2.0% |

The funded daily worker (`scripts/daily-profit.mjs`) credits one batch per period,
using active principal and the plan rate at the period's start, including completed
reinvestment. A contract cannot wake itself on a clock. Deployment alone does not
start that worker or fund rewards. The initial reporter is the owner; authorizing
a separate server reporter retains the existing two partner votes and two-day
configuration delay. A fresh activation needs a new target-specific daily policy
and journal, with no back-credit from any previous vault.

Network volume propagates eight ancestors during the originating transaction.
Deeper ancestry uses the existing permissionless, cursor-based
`processNetworkVolume(job, steps)` calls, at most 64 steps per call. Automatic group
assignment happens as each ancestor is processed.

## Source and local checks

`contracts/fresh/` is a separate source snapshot of the approval-enabled release,
with the automatic-group hook added. This keeps previously released source,
artifacts and deployment verification pins intact. Compile this snapshot with
Solidity 0.8.30, optimizer runs 1, via IR, Shanghai:

```bash
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm run test:fresh
```

The compiler writes the ABI and bytecode to `artifacts/AutomaticGroupVault.json`,
the browser artifact to `deployment-console/AutomaticGroupVault.json`, and full
compiler verification input to `artifacts/fresh-start-standard-input.json`.
It rejects runtime bytecode above the EIP-170 limit. The deployment helper binds
the artifact hash, constructor settings, chain, owner and deployer to a new
journal, verifies the exact creation transaction, and checks the empty initial
state and owner-approval queue at the canonical deployment block.

The reviewed artifact has 24,181 runtime bytes and 30,071 creation bytes. Its
creation-bytecode hash is
`0x64f24990045d9ef3d268e97657ed6e6af013cb73fc8ec39b9a862929c069e8cf`.
Independent compilation of the saved full standard input reproduced the ABI,
creation bytecode and runtime exactly. Local checks passed: 11 fresh-contract
tests, 5 deployment/journal tests, and 9 existing approved-deployment/daily-worker
regression tests. Shell/Node syntax and diff checks also passed. These checks do
not constitute a public-chain deployment or a server installation.

## Deploy on the existing Ubuntu server

Use the pinned GitHub revision supplied with this release, then run from that
checkout:

```bash
bash ubuntu-deploy-zero-start.sh --execute
```

The installer uses the existing chain-97 RPC in
`/etc/globaldroptrade/trades.env` and the existing server deployer key. It does not
require the configured active vault address to point to an old contract. No
private key belongs in a command or chat message. The existing deployer is
`0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2`; the owner remains
`0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632`.

The new journal and public report live under
`/var/lib/globaldroptrade/fresh-zero-v1/`. The cumulative maximum transaction fee
is 0.1 test BNB. If interrupted, rerun the same pinned command: the saved signed
transaction is resumed, rather than choosing a second deployment nonce. Preserve
the journal. Other deployment journals and environment secrets are untouched.
The RPC must support a one-block registration-log query; this capability is
checked before signing, and unavailable proof stops deployment before spending.

Successful output includes `NEW_CONTRACT`, `WITHDRAWAL_QUEUE`, `TX_HASH` and
`REPORT`. The report records that accounts were not imported and that the website
connection and daily automation have not been activated by this command. It does
not switch the website, API or an existing automation service. Those operations
must verify this new deployment and start fresh target-specific state; the older
migration and `connect-fresh` installers are not the connection route for this
release. Test mock oracle freshness and reward funding must also be checked before
user operations.
