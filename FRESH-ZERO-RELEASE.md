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

## Connect the fresh deployment to the site

After deployment, run from this release checkout on the existing server:

```bash
bash ubuntu-connect-zero-start.sh
```

The connection command reads the transaction hash from the private fresh-zero
deployment report. It independently verifies the exact canonical creation input,
chain 97, expected deployer and owner, deterministic approval queue, current
constructor settings and automatic-group capability. It does not accept an old
vault address, import data, read an old vault or sign a transaction.

The connection proof is explicitly `canonical-creation-and-current-state`.
Verified constructor initialization proves that this implementation begins with
empty user storage. Current state is verified separately. Historical storage
queries are not required, and legitimate accounts created on the fresh contract
before connection are preserved.

Existing RPC, marketplace credentials, community tickets and announcements, keys,
old policies and transaction journals remain intact. The command checks the
staged configuration again before writing. It preserves multiline secrets by
appending the verified contract/chain/start-block/port assignments and disabling
the cancelled legacy migration API.

The previously diagnosed Global Nginx entries are normalized with the pinned
repair helper before taking the connection snapshot. Unknown Nginx layouts are
rejected. The installer snapshots the current API release, environment, managed
Nginx entries and connection marker; stops the previous automation/oracle timers
and workers; installs the compatible prebuilt frontend and API; then checks HTTPS
health, the API contract address and the exact served frontend index hash.
`FRESH_ZERO_SITE_CONNECTED` is printed only after these checks and an independent
final target check. The filtered result is saved to
`/var/lib/globaldroptrade/fresh-zero-v1/connection-public.json`.

On failure, the previous configuration and API release are restored. Previous
workers resume only after the restored site and API are healthy; a failed recovery
reports `RECOVERY_REQUIRED` and quiesces workers for review. Connection does not
activate a daily worker or new oracle maintenance policy. Fresh reporter
authorization and reward funding remain required for daily credits. Reload the
site after connection: already open tabs retain the contract configuration they
loaded before the change.

The frontend recognizes automatic Group 1 and removes manual group-building
actions for this contract, while retaining the legacy interface when connected
to a legacy contract. Account snapshots, pending receipts and trade-feed records
are checked against their contract and chain identity.

Connection validation passed locally: 63 frontend tests, 6 chain/configuration
connection tests, 12 API tests and 13 mock-host installation/recovery scenarios.
The production build passed, and the unpacked frontend package matches the built
files and embedded installer byte for byte. These are preparation checks; no
live server cutover is claimed until the server command prints its verified
connection result.

The API installer makes its new immutable runtime release readable by the
unprivileged `globaldroptrade-api` service, even when connection was launched with
`umask 077` or source files have private modes. This normalization is limited to
the newly copied runtime code and dependencies. The environment file, community
data, operator keys, connection reports and backups retain private permissions.
If an earlier attempt reported `API health check failed` and restored the previous
site, rerun connection from the corrected pinned release using the existing fresh
deployment report. No second contract deployment is needed for this repair.

## Enable the existing-server-key worker

After deployment and connection, run from this release checkout:

```bash
bash ubuntu-enable-zero-daily.sh
```

This command installs `globaldroptrade-zero-daily.timer` and its serialized
oneshot service. It uses the existing server operator key for
`0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2`; it does not load the owner's key or
open a wallet approval window. Blockchain transactions still require signatures,
which the server supplies automatically. This does not bypass the contract's
existing reporter governance, withdrawal approvals or spending rules.

The current contract initially authorizes only the owner as a reporter. If the
server operator has not already received reporter authority through the existing
two partner votes, two-day delay and configuration execution, daily scheduling
remains waiting. The installer does not propose, vote, execute governance or
silently deploy another contract. It also requires usable reward cash, operator
gas and historical state for the fresh target. The status page displays these
blockers; a running timer alone is not reported as active daily credits.

Once ready, the worker creates a new policy beginning at a verified confirmed
checkpoint. The first period ends 24 hours after that boundary. It processes only
the fresh target's registered accounts, uses active principal and plan rates at
each period's start, includes completed reinvestment, and retains a target-bound
epoch journal. It never imports old accounts or back-credits old periods. A later
funding shortfall preserves the existing policy and unpaid epoch. Contract batch
identifiers and the journal prevent duplicate credits. Persisted activation,
transaction and network-volume checkpoints are checked for chain reorganizations
before reuse; conflicting history stops processing for review.

The service checks every five minutes. It also finishes bounded deep network
volume jobs, maintains the pinned testnet mock feeds when authorized, and pays
withdrawals that the current owner has already approved. It never approves a
withdrawal itself. Approved payments are processed independently of daily reporter
or reward-funding readiness. All its transaction types share a single signed
transaction journal and a cumulative maximum fee reservation of 0.1 test BNB.
Exhausting that budget stops new spending; it does not reset the journal.

Private state is stored in
`/var/lib/globaldroptrade/fresh-zero-automation-v1/`; the operator key is copied
with private permissions to `/etc/globaldroptrade/fresh-zero-automation.key`.
Existing keys, policies and financial journals are preserved. Installation stops
previous signing workers before switching releases. It snapshots worker state,
the prior release, units and two managed status-page entries, and restores them
on installation failure. A failed recovery leaves recorded workers stopped and
reports `recoveryVerified=0`. Financial transactions already confirmed on-chain
are never rolled back by the installer.

Successful installation prints `ZERO_START_AUTOMATION_MONITOR_INSTALLED`, followed
by either `DAILY_PLAN_AUTOMATION_ACTIVE` or `DAILY_PLAN_WAITING` with blockers. The
read-only page is `https://globaldroptrade.com/deploy/zero-start-activation.html`.
It has no wallet connection or transaction actions, marks stale reports, and
distinguishes scheduled automation from actual credited transaction evidence.
Local tests validate these states and installation recovery; they do not prove
that the user's VPS has run this release.

## Initial reporter permission in the SafePal browser

For the connected fresh deployment
`0x23C32Bb326DB63f89532f80e757B8463c75655b8`, install the small permission page
from the pinned release on the existing server:

```bash
bash ubuntu-zero-permission.sh
```

Open `https://globaldroptrade.com/deploy/zero-start-permission.html` inside
SafePal's DApp browser. Select **Select BNB Testnet** (chain 97), connect the
existing owner wallet, and select **Review owner proposal**. After reviewing the target and
fee, **Confirm in wallet** opens the wallet for the exact `queueConfiguration`
call. This starts the existing
48-hour delay. Two distinct configured partner wallets must each review and
confirm **Review partner vote**. After the delay and votes, the owner can
select **Review owner execution** and confirm it. Each step is a separate wallet
transaction; connecting, refreshing and installing do not send transactions.

This is the existing reporter role, covering sales reporting, customer status and
daily credit batches. It does not grant withdrawal approval. Every permission
transaction sends zero native value and has a maximum reviewed fee of 0.01 test
BNB. The page accepts only the pinned fresh target and operator, verifies live
chain identity and governance state again before submitting, and retains pending
transaction intent so a refresh does not resend a request automatically. Missing
or ambiguous wallet responses remain blocked for reconciliation.

The static installer verifies the existing fresh connection, copies only the
permission page and its local dependencies with public read permissions, and
checks the served HTTPS assets. It preserves the current API, status console,
workers, keys, environment and financial journals. Publishing failure restores
only the previous permission-page entry point. It does not deploy a contract or
grant permission from the server.

The existing daily worker observes completed permission changes automatically.
Reward funding through `fundRewards` and verified historical state remain
necessary before a new daily policy starts; this permission-only page does not
fund rewards. The first daily credit follows a complete 24-hour policy period.

## Separate fast testnet release

The existing contract cannot skip its initial reporter governance delay. This
separate release uses `FastTestnetVault`, which authorizes the pinned server
reporter during construction. It creates a new contract and withdrawal queue
on BNB Testnet 97 with zero accounts. It imports no previous accounts or pending
withdrawals. Previous contracts, deployment records and private financial journals
remain available independently.

The constructor accepts only chain 97, the existing deployer
`0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2` and owner
`0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632`. Both are initial reporters. Other
configuration changes retain the owner proposal, two partner votes and 48-hour
delay. Withdrawal approval remains owner-only. Plan rates, groups, reinvestment,
fees and the 86,400-second daily period are inherited unchanged.
`FAST_TESTNET_VERSION=1` identifies this separate test release.

From the pinned checkout on the existing VPS, run as root:

```bash
bash ubuntu-fast-testnet.sh --execute
```

This runs deployment, connection and installation with explicit `--fast-testnet`
flags. Use the combined command so the shared server signer is quiesced before
deployment. It stops timers before services and refuses to deploy while a prior
worker has unresolved signed transactions. Reconcile such transactions with the
corresponding prior worker against its original target. Nonstandard legacy daily
state overrides require review before setup. The fast deployment journal has a
cumulative fee limit of 0.1 test BNB. Its separate automation journal has another
cumulative 0.1 test BNB limit shared by oracle maintenance, test reward seeding,
daily batches and approved payments. Transactions send no native BNB value.
Test gas must be available in the server wallet; no owner key is requested.

The fast service explicitly includes `--seed-test-rewards`. It verifies the exact
pinned Test USDT runtime and metadata, mints only the operator's initial shortfall,
approves the new vault for exactly 10 Test USDT when necessary, and calls
`fundRewards` for those 10 tokens. The saved plan and signed transactions share
the automation journal. This is one seed per new target: retries resume it, and
spending the reward budget never triggers a refill. It uses only the reviewed
public test faucet token. It does not fund native BNB rewards. Saved pending
seed transactions can resume without the creation flag; completing a saved seed
plan uses the explicit flag installed in the fast service.

Fast deployment state is `/var/lib/globaldroptrade/fresh-fast-testnet-v1/`;
automation state is `/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/`.
Connection locks and backups use a separate namespace. The environment adds
`TRADES_ZERO_START_PROFILE=global-fresh-fast-test-v1`. The service/timer names,
installation base, existing server key and public status URL remain shared, so
setup switches the installed worker to the selected target. An explicit ordinary
release selection uses its original artifact and journals. Ambient environment
variables cannot select the fast profile.

The fast contract may start a policy before it is 24 hours old when all requested
historical reads succeed. The initial archive status remains `provisional`, with
`fullyVerified=false` and `provisionalAccepted=true`. Missing historical reads
still block, and daily credits require actual period-start snapshots. The
ordinary release still waits for verified 24-hour retention. First credits follow
a full daily period after the new confirmed policy boundary; the five-minute
timer is only the checking interval.

`FAST_TESTNET_SETUP_COMPLETE` follows the worker's
`DAILY_PLAN_AUTOMATION_ACTIVE` or `DAILY_PLAN_WAITING` result. Completion alone
does not claim readiness passed. The read-only page at
`https://globaldroptrade.com/deploy/zero-start-activation.html` pins the fast
artifact and markers and displays test status. The old SafePal permission page
remains pinned to the previous contract and is not used for this initial role.

On failure each stage retains its verified recovery. The combined setup resumes
prior workers only when the exact previous environment, API unit/release, daily
units/release, served frontend and API configuration are restored and health is
verified, with no pending new signed transaction. Otherwise workers stay stopped
and setup prints `FAST_TESTNET_SETUP_INCOMPLETE previousWorkersRestored=0`.
A completed connection followed by failed automation installation leaves the
new connection for the same command to resume. Confirmed transactions are never
rolled back. Retry the same pinned command and preserve journals; completed
deployment is reused instead of creating another contract.

Compiler settings are solc 0.8.30, optimizer runs 1, via IR, Shanghai EVM. Saved
standard input independently reproduces ABI, creation code and runtime. Creation
hash is `0x008e37042763d39b139ead6cd867ef48a221a2eec1c8e8702a844fa5f269b11e`;
runtime is 24,192 bytes and initcode is 30,261 bytes. Existing contract sources
and artifacts are preserved. Local checks cover actual Ganache contract,
deployment, connection, fixed funding, historical readiness and daily-credit
behavior, status validation, and isolated host installation/recovery. They do
not prove deployment on the user's VPS or native SafePal behavior.

## Oracle recovery and hourly testing

### Investment and profit repair

When the existing provider cannot read an owed period's start state, the explicit
archive repair can switch the same connected fast-testnet configuration to the
fixed PublicNode endpoint after verifying it on this server:

```bash
bash ubuntu-zero-archive-rpc.sh --check
bash ubuntu-zero-archive-rpc.sh --execute
```

If the public candidate reports unavailable historical state on the affected
server, select a BNB Smart Chain Testnet (chain 97) archive endpoint explicitly.
Enter its full HTTPS URL at the hidden terminal prompt, then run the same proof
and repair with the private file:

```bash
python3 scripts/save-zero-archive-rpc.py
bash ubuntu-zero-archive-rpc.sh --execute --candidate-file /etc/globaldroptrade/archive-rpc-url
```

The input helper requires an interactive terminal and root. It validates the
single HTTPS URL and writes it atomically with mode 0600, preserving a private
copy of a replaced input. It never echoes the URL or places its credentials in
shell history. Do not put a URL in command arguments or post an API key in chat.
The endpoint must actually prove the original unpaid snapshot; a provider's
archive label or a successful current-state query is insufficient. The same
command with `--check` performs verification without applying the connection.

Without `--candidate-file`, the existing fixed public candidate remains the only
choice. No local file is selected implicitly. With the flag, a root-owned regular
0600 UTF-8 file is required. A URL fingerprint and the hash of its exact file
bytes bind precheck, staging and application; a changed file blocks the switch.
Stage reports include only this fingerprint metadata, never the candidate URL.
The URL appears only in private input/environment/backup files. The private
candidate still passes every chain, creation, runtime, journal, canonical-history,
funding and original-period proof before the worker can start. No provider is
silently substituted and no new funding grant or deployment is performed.

The candidate is first checked before any existing service is stopped. An
`ARCHIVE_RPC_FULL_READINESS_REQUIRED` failure now reports only safe readiness
blockers, archive probe results, funding readiness and operator gas status.
At most three complete checks retry temporary archive/transport availability;
an identity, funding, pending-state or canonical-history failure remains blocking.
No incomplete archive result is accepted and no owed period is discarded.

Settlement and registration event windows now use the same-provider complete log
reader. It divides a rejected window only after a recognized block-range or
result-size limit, then requires every non-overlapping subrange to succeed. It
retains the exact contract, event filter and inclusive block range, verifies
canonical hashes, and rejects malformed or conflicting logs. Authentication,
missing history and timeout errors do not become empty results. Confirmed 429s
have a bounded same-request retry; read parallelism and total requests per window
are bounded. Successful span limits are reused for that provider instance. A
member-index cursor advances only after its entire logical window succeeds.

Execution also stages immutable copies of the installed API and daily-worker
code, adding the complete reader and replacing only its reviewed callers. The
installed callers must match the pinned baseline or the new verified source;
unrelated source edits require review before services stop. Other installed
files and dependencies are preserved. The old release pointers and environment
can be restored before a worker may run. Once a worker may have run, updated
code, the selected RPC and all financial journals are retained together. Updating
the checkout alone does not update the running service code.

This preserves the configured logical page sizes and the existing bounded
indexing progress. Providers with very small log ranges require more requests,
so historical member indexing may span several worker runs. Previously saved
complete windows are retained; no unpaid period is skipped. A persistent failure
reports only sanitized operation, requested range, RPC/HTTP codes and a fixed
reason category, never provider messages or a private URL.

The reader also recognizes a bounded structured JSON-RPC error carried inside an
HTTP error response. Some HTTP transports reject a 400 response before exposing
its RPC code, so inspecting only the top-level exception misses a legitimate
range-limit rejection. Only a valid error envelope with a numeric code and a
recognized range/result-limit message can enable subdivision. A generic HTTP
400, malformed body, authentication error or missing historical state remains a
failure. Response bodies and private endpoint details are never retained in
diagnostics. Transport tests use the actual ethers HTTP client, including 400
responses, in addition to direct-provider fixtures.

The structured RPC code `-32600` is also eligible for subdivision when its own
bounded message explicitly identifies a block-range or result-size limit.
The code alone means invalid request and never permits subdivision. Generic
invalid requests, missing history, authentication and quota failures retain their
blocking or bounded-retry behavior. No historical principal or member-index
verification is omitted to accommodate a provider's error-code convention.

If historical account principal does not equal both asset ledger totals, the
planner still stops with `INCOMPLETE_DAILY_MEMBER_INDEX`. Its safe diagnostic
shows the same owed snapshot, cache counts and exact per-asset principal sums.
A canonical cache-ending block does not prove that an earlier RPC supplied every
registration event.

For this exact failure during `--execute`, the archive launcher can rebuild only
the derived member registry using the selected candidate. It scans from this
verified contract's creation through the same unpaid snapshot into a separate
private `member-index-rebuild.json`. Complete pages are saved durably; bindings
include original input hashes, policy, epoch, candidate and canonical snapshot.
Each pass is bounded by 100 logical pages and a 240-second start-page budget.
The launcher allows at most four passes per command. `--check` never rebuilds.
If `ZERO_MEMBER_INDEX_REBUILD_IN_PROGRESS` is reported, repeat the same pinned
command to resume complete pages. Changed bound inputs stop resumption.

The original journal remains untouched until the full reconstructed plan proves
both principal totals and the full original-period readiness again. Current-epoch
credit evidence or used personal/referral batch IDs blocks replacement. Only
`daily.registry` can change; epoch, activation, previous credits, transactions,
raw signed data, grants, fees and all other journal fields remain identical.
The original bytes are backed up privately before atomic replacement. The
wrapper independently checks that only the registry changed and repeats normal
preflight before any service cutover. Rebuilding never opens a signer or credits
profit, and cannot discard an unpaid period to escape unavailable history.

A failed probe also reports the exact allowlisted read operation, sanitized
error/RPC codes, HTTP status and a fixed reason category inferred from the
provider error. A timeout or malformed response can otherwise look like missing
history; the generic archive blocker alone does not establish pruning. Provider
messages, URLs, request payloads and credentials are never copied into this
diagnostic. Use `--check` to obtain the per-operation result on the affected
server without stopping services, changing its environment or opening a signer.
Passing a probe elsewhere does not prove that the server's provider route works.

API startup is checked with bounded HTTP availability polling. An unchanged
environment does not cause an unnecessary API restart during failure recovery.
Successful explicit execution enables a managed timer left disabled by an older
failed attempt, only after the new connection and API target pass verification.

Preflight proves the same confirmed chain anchor, exact creation and current
target identity, canonical completed journal, saved activation and unchanged
period. It requires the actual owed-period archive state and historical
registration logs. The repair changes only `TRADES_RPC_URL`, preserves all other
configuration, refuses unresolved transactions, and takes private backups under
the existing connection and worker locks. The API must remain healthy on the
same target before the worker restarts. Failure before worker startup can restore
the unchanged previous configuration; once a worker may have run, the candidate
configuration and financial journals are retained for explicit recovery.

This switches the primary provider; it does not introduce a financial-read
fallback or substitute current balances for old snapshots. Account balances,
policy dates, epochs and transaction fee reservations are never reset. A verified
connection alone is not proof of an on-chain profit credit.

After a verified cutover, the launcher may run the same installed service up to
three additional times only while that same unpaid epoch is still indexing.
It stops on a credit, another wait reason, an error, a changed policy or pending
transaction. This uses the existing run lock and cumulative fee cap; it does not
skip an epoch or start an independent signer.

The investment form validates the current registered referrer, deposit minimum,
asset precision, pause state and cumulative VIP/KYC requirement before requesting
a token approval. It rechecks the target, wallet and current requirements after
approval and simulates the final transaction. An existing account keeps its
permanent on-chain referrer. These checks explain a rejected request; they do not
relax the contract's registration, minimum or VIP rules.

The administrator page lets a connected authorized reporter load a
registered customer's current activity/KYC status, review the before/after
values, and explicitly confirm `setCustomerStatus` in their wallet. The UI checks
the current role, customer, network, contract and reviewed status again before
signing. The initial owner is a reporter; a later owner still needs the on-chain
reporter role for this action. Opening the page never activates an account or attests KYC. Complete
the actual verification process before marking KYC verified. Status changes
affect eligibility at subsequent period-start snapshots.

Daily and hourly personal profit now also produce separate funded upline batches.
The calculation uses the same deployed source-tier referral percentages and
recipient eligibility as sales profit, at the same period-start snapshot as the
personal earnings. Each source's personal profit generates commissions once;
commission earnings do not recursively generate more commissions. Active status
and VIP/KYC conditions remain required. Existing personal batch identifiers stay
unchanged, with separate idempotent commission identifiers and a combined remaining
budget check before the first new credit. Previously completed policy epochs are
not reset or automatically replayed.

An incomplete member index is waiting, rather than active. Read failures expose a
safe execution phase and numeric RPC code without provider URLs, raw messages or
signed data. The worker preserves the saved policy, epoch, pending transactions
and fee reservations. Historical reads still use the configured primary RPC.

From the pinned checkout, install the updated frontend, then use the explicit
profit recovery mode to upgrade the full worker, including interrupted financial
transactions in its existing journal:

```bash
bash ubuntu-website.sh
bash ubuntu-zero-oracle.sh --execute --hourly-test --profit-recovery
node scripts/diagnose-zero-profit.mjs --fast-testnet
```

The recovery launcher retains its non-selected journal checks and signer locks.
The diagnostic is read-only: it never opens a signer or saves its cloned member
index. It probes one registration page and can simulate pending period batches
without broadcasting them. An RPC history/capability failure must be resolved on
the configured provider; installing the code alone is not evidence of a paid
period. Initial indexing can require multiple runs, and overdue epochs are
processed in bounded subsequent runs without changing their snapshot or IDs.

For a fresh vault that is already connected, these commands inspect or repair
the currently selected release without deploying another contract:

```bash
bash ubuntu-zero-oracle.sh --check
bash ubuntu-zero-oracle.sh --execute --hourly-test
```

The private API configuration selects the connected standard or fast release;
the repair then independently proves its exact creation transaction, current
runtime/settings and saved connection marker. Hourly testing is accepted only
for the fast BNB Testnet profile. The ordinary release keeps 86,400-second
periods. An oracle repair without an explicit interval change preserves an
already installed hourly test mode.

If the configured RPC cannot return the saved historical creation transaction or
receipt, the CLI may retrieve only that missing proof from the fixed official
BNB Testnet public RPC. Any available primary proof must already be valid;
conflicting, malformed or failed primary records remain blocking. The fallback
must prove chain 97, the exact saved creation input and its receipt/header pair.
The configured primary RPC still verifies the canonical deployment block,
confirmations and all current state, and remains the only signing/broadcast
provider. The saved deployment report is required; this does not bypass a missing
report or substitute a different deployment.

Oracle-only execution uses the existing server key, automation run lock, private
journal and cumulative 0.1 test BNB fee reservation. It accepts only the two
reviewed mock feeds and preserves their price values while renewing timestamps
and rounds. It reconciles its saved oracle update before sending another;
pending non-oracle transactions require the corresponding normal worker to
reconcile them first. It never seeds rewards, credits profit, pays withdrawals
or changes a policy. Chain, canonical block, target, environment, runtime and
nonce checks remain in place. Mainnet and unrelated legacy oracle CLIs are not
used.

The repair stops the current timer before its service, refuses other active
signers and unresolved non-selected journals, then refreshes under the current
worker's lock. It installs the updated persistent worker after verification.
The worker resolves its command path before checking direct execution so the
installed `current` directory symlink runs the CLI instead of silently exiting.
Validation invokes the actual installed symlink entrypoint as well as importing
its modules. Installation alone does not prove that readiness or credits passed.
Failure recovery resumes prior workers only after exact unchanged configuration,
units/releases and healthy API checks with no unresolved journal. Confirmed
transactions and financial journals are preserved for retry.

Normal worker execution now maintains verified price feeds before optional new
test-token seeding, daily historical readiness, policy loading or approved
withdrawal scanning. A retryable daily read or seed-inspection failure after
successful maintenance is reported as waiting; it cannot claim active credits.
Identity, pending transaction, reorganization, fee and other financial safety
failures remain blocking. Read-only status exposes the separate oracle result.

With explicit `--hourly-test`, a verified fast vault uses 3,600-second test
periods. Each test period applies the full deployed daily plan percentage to its
period-start active principal, including completed reinvestment. This accelerates
test allocations by 24 times; it does not change the on-chain plan percentages
or enable this interval on mainnet. Hourly batch identifiers have a separate
domain; existing 24-hour batch identifiers remain unchanged. Actual period-start
historical reads, funded reward cash, server authority and canonical checkpoints
remain required. Re-running a completed interval cannot credit it twice.
Explicit hourly readiness requires one-hour retention and each actual unpaid
period-start snapshot; ordinary readiness retains its 24-hour requirement.

A new hourly policy begins at a fresh confirmed checkpoint. An unused 24-hour
policy can transition only with no prior daily credits, pending transaction or
fully due unpaid period. Its original policy, activation and daily state are
archived before replacement, with a persisted recovery intent. Existing account
balances, contract addresses, transaction fee reservations and journals are not
reset. A policy with prior credits requires review instead of silently changing
its timeline or replaying old periods at hourly frequency.

The reward budget is held by the connected vault. On the verified fast deployment
`0x04E26FcaA198d21cEf6d04e1e54f9C5f6399e522`, its test reward token is
`0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89` with 18 decimals. Approve the vault
for the intended test-token amount and call `fundRewards(token, amount)`. A plain
token transfer does not increment the reward ledger. For a BNB budget, call
`fundRewards(address(0), amount)` with the same native value. This is BNB Testnet
97. Funding belongs to the vault, rather than the withdrawal queue or operator.

For the separately authorized addition of exactly 1,000,000 Test USDT on this
verified fast target, run the combined repair from the pinned checkout:

```bash
bash ubuntu-zero-oracle.sh --execute --hourly-test --fund-test-million
```

This is a test-token reward grant, not real USD, mainnet USDT, an investment or a
new deployment. The grant verifies the pinned token runtime, metadata, chain,
vault, owner and operator. It saves its fixed plan before minting only the
operator's initial shortfall, approving exactly 1,000,000 tokens when necessary,
and calling `fundRewards` for exactly that amount. The grant is separate from the
existing 10-token setup seed, so the resulting total reward balance may include
that seed or other funding and may decrease as rewards are credited.

The grant uses the existing private automation journal, run lock, nonce checks,
zero native transaction value and cumulative 0.1 test BNB automation fee cap.
Canonical transaction and exact `Funded` event verification prove the grant;
before/after reward-ledger balances also record any other changes in the same
block. Retries reuse saved transactions and never grant again after completion,
even if the budget has since been spent. Preserve the journal. The flag is
one-shot and never appears in the persistent service command. Interrupted grant
transactions resume before a new oracle nonce is used; mixed or unknown pending
transaction scopes block before sending. Ordinary repair without this explicit
flag never creates a million-token grant. The ordinary release and read-only
mode reject it.
