# Existing-account withdrawal and runtime recovery

## Source and scope

This change builds on `c77c29757421b10f3c1ff0ad44bd43ada03817f2`, the
current unified-reinvestment release in PR #112. It preserves the hourly
dashboard, verified wallet transaction flow, account history, network features,
and deployment verification from that release.

PR #113 is based on the older daily prototype. Its dashboard and activation
scripts must not replace this newer hourly/unified release merely because an
old prototype timer is missing.

## One withdrawal form

The customer enters a withdrawal type and amount. The dashboard selects a
verified eligible source automatically. It reads every ordinary position and,
when the unified reinvestment book is present, a bounded complete set of its
additions at the same verified block. A partial book scan must not be presented
as the account's maximum withdrawal.

The displayed account balance and supported single request have different
meanings. A balance is the sum of recorded claims. The maximum request must
respect the deployed contract's source boundaries, profit cap, principal locks,
reservations, pending request and cooldown. The current wallet adapter submits
at most eight book additions in one request and scans at most 256 additions.
These are dashboard limits, not the contract's larger 64-addition page bound.
A request that would require
combining ordinary positions is refused before a wallet signature. It is not
silently split into several transactions or deferred requests.

The wallet sender rechecks the selected source, current account and chain
identity, simulates the transaction, and verifies its confirmed receipt. This
change does not introduce a server signer for user withdrawals.

## Immutable account boundary

Neither the original daily/hourly vault nor the existing unified-reinvestment
vault can merge historical deposit positions. The latter combines repeated
reinvestments only; ordinary deposits remain separate contract entries.

This release provides one account withdrawal interface, not an on-chain
migration. It does not copy historical balances into a new contract, reset
opening times, shorten locks, or duplicate claims. A future vault with one
physical position for both deposits and reinvestments would need separate
release identity and a migration mechanism that prevents double claims.

## Diagnose the correct worker

The following names refer to different deployments:

| Profile | Timer |
| --- | --- |
| Original prototype | `global-v3-compound-keeper-testnet.timer` |
| Routed daily | `global-v3-routed-compound-keeper-testnet.timer` |
| Hourly | `global-v3-hourly-compound-keeper-testnet.timer` |
| Unified reinvestment | `global-v3-unified-keeper-testnet.timer` |

An absent original prototype timer says nothing about the other three. Public
chain data also cannot establish whether a VPS timer is installed or running.

On the Global VPS, from the reviewed source, run:

```bash
bash scripts/resume-v3-unified-wallet-site.sh --diagnose
```

This command reads the known services, bounded journals, allowlisted public
deployment metadata, and the last resume outcome. It does not create a state
directory, load a signer key, start a service, install a website or submit a
transaction. It labels local proof records as local observations, not fresh
public-chain verification. Sensitive log lines and credential-bearing URLs
are redacted.

Failure reports retain up to 80 lines of context so a long Node stack does not
hide the initiating error behind `Node.js v22.23.3` and `UNIFIED_RESUME_EXIT=1`.
The exit code alone is not a diagnosis.

## Resume an existing unified deployment

After identifying the intended existing unified deployment, the resume entry
point without arguments installs its pinned payload. It requires both:

- `/var/lib/globaldroptrade/v3-unified-testnet/deployment-proof.json`
- `/etc/globaldroptrade/v3-unified-keeper-testnet-gas-only.key`

The resume path refuses missing files. It does not create another deployment
as a fallback. It verifies the existing deployment, checks the dedicated worker,
and publishes the isolated `/unified-test/` route with the existing rollback
checks. The main domain and hourly accounts retain their existing deployment.

Success requires the actual worker installation, served-site verification and
the final `UNIFIED_TESTNET_WALLET_DASHBOARD_AVAILABLE` marker. Starting the
systemd job or passing repository tests is not installation success. An
insufficient dedicated gas balance returns code 42 and leaves the route
read-only; the actual address and required chain-97 test gas must be checked
from the operator report.

The existing `update-v3-hourly-wallet-site.sh` and
`install-v3-hourly-primary-site.sh` are distinct frontend-only update paths.
Select one only after verifying that the intended current account is on that
hourly deployment. They do not activate the hourly keeper.

## Verification and remaining host evidence

Behavioral tests exercise automatic source selection, financial limits and
complete scan requirements. Runtime-diagnosis tests check that the report does
not mutate host state, rejects symlinked proof files, excludes non-public proof
fields, redacts sensitive logs and retains the initiating failure. Existing
resume and apply sequencing tests remain required in CI.

No Global VPS command was executed while preparing this change. Actual timer
state, current served release, dedicated worker gas and a confirmed accrual
remain host/public-chain acceptance evidence. A worker may legitimately have
no eligible due claims; that outcome must not be described as recorded profit.
