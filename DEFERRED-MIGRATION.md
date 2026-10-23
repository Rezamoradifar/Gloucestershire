# Global testnet account transition

The approval-enabled candidate at `0x1227b77986fb91b6b678716ED7B0eF76fdE1dA8f`
was deployed by transaction
`0x25adfb4da86047c1121b28925a841816d1fc6d1168683fe564bb2cb76a74c17b`.
It is an empty deployment and has no account-import interface. Do not connect the
existing website to that candidate to preserve legacy accounts.

The active legacy source is `0x731Ba0644e8f44BbBd48124F945724ba534431eb`,
BNB Testnet 97. A read-only observation at 2026-10-22T22:46:08Z found
128,765 Test USDT of recorded principal, 1,510 of recorded profit, a pending
20 Test USDT withdrawal, and zero vault cash. These are recorded claims, not
proof of cash backing. The owner is
`0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632`.

## Scope and limitations

This workflow is testnet-only. The new constructor copies user accounts,
positions, reinvestment totals, network groups, consumed and reserved volumes,
pending propagation jobs, used sales and reward IDs, and the full legacy profit
withdrawal history. Pending withdrawals retain their original recipient, amount,
fee and deadline, and require owner approval on the copied queue before payment.
Copied principal positions remain invested until an approved principal payment.
Registration events are emitted so daily allocations discover imported users.

The legacy contract cannot extinguish its claims through this migration. Legacy
withdrawals and some network operations remain callable while paused. The new
treasury starts empty; cash is not transferred. Keep the old treasury unfunded.
This process is unsuitable for migrating real funds. The public verification
report explicitly records `legacyClaimsExtinguished: false`.

The source must be paused, its ownership transition must be empty, and its cash,
fee reserves and reward budget must be zero. A changed source or queue after
the copy stops site cutover for review. There is no automatic reset or second
deployment when a copy already exists. If the full inventory exceeds block gas
or the 49,152-byte initcode limit, stop before signing; this version does not
provide a multi-transaction importer.

Economic settings and the council quorum are copied. Server reporters and pending
configuration proposals are not imported. The new owner is initially the only
reporter. The existing council and two-day configuration delay must authorize the
server operator again. No key, funds or council votes are supplied by the installer.

## 1. Install the tools and current wallet UI

From this pinned checkout on the existing server, run as root:

```bash
bash ubuntu-deferred-migration.sh
```

This installs the prebuilt 0.8.0 frontend, WalletConnect support, day/night theme,
API verification routes and content-addressed owner-console assets. The existing
API vault target, credentials, data and TLS are preserved. Automation is not
enabled. A background service builds a resumable event index using the private
server RPC. It does not load signing keys or send blockchain transactions.

```bash
journalctl -u globaldroptrade-deferred-index.service -n 20 --no-pager
```

Open `https://globaldroptrade.com/deploy/deferred-migration.html` and connect the
owner wallet on BNB Testnet. Review the displayed balances and testnet limits.
Scan the account history, pause the old contract, estimate fees, then sign the
account-copy deployment. The new contract stays paused. No API endpoint signs,
grants roles, approves withdrawals, or changes server configuration.

The public seed is frozen when published. Later inventory scans append source
events in memory without overwriting that seed. Exact reviewed initcode, a
canonical successful creation receipt, complete source registration and used-ID
history, and constructor accounting checks prove the atomic state import. This
proof needs historical logs and headers; it does not require historical storage
tries. At least four canonical confirmations are required for verification.

The wallet journal persists request identity and nonce before requesting a wallet
signature. An uncertain response blocks new requests until its hash is recovered.
Recovery binds sender, chain, nonce, value and calldata, and identifies confirmed
replacements. Existing mined copies are discovered across browsers before another
deployment nonce is used. Reserved network fees are limited to 0.1 tBNB per local
journal. Do not clear the journal or use another deployment installer to retry an
uncertain transaction. Download and retain the public verification report.

## 2. Connect the verified paused copy

Use the **new migration transaction hash**, not the empty candidate transaction:

```bash
MIGRATED_VAULT_TX=0xYOUR_MIGRATION_TRANSACTION bash ubuntu-connect-migrated-deferred.sh
```

The server independently verifies the constructor and full inventory, checks that
the source stayed paused and unchanged, and requires the copied target to remain
paused. It backs up the active API environment, service, Nginx configuration and
connection report, installs the new target, verifies HTTPS `/api/config`, then
publishes the connection marker. Any failure restores the previous configuration.
No blockchain transaction is sent. Keep the original checkout for this command.

Refresh the owner console and sign activation only after it verifies that the
website/API point to the copied contract. Council partners can use the same page
after connection to vote on the server reporter proposal.

## 3. Fund and enable the daily plan

In the console, the owner proposes authorization for the existing server operator
`0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2`. The copied council must meet its
quorum and the original two-day delay. The owner then executes authorization.
Use the dashboard's funding controls to supply the reward budget; this tool does
not choose an amount or mint assets. The operator also needs test BNB for fees.

After activation, authorization and funding, run as root:

```bash
bash ubuntu-enable-migrated-daily.sh
```

This verifies the connected imported contract, role, funded budget and historical
storage availability before enrolling the existing server operator key. It never
reads or copies the owner key. Existing operator keys, policies and transaction
journals are preserved; a mismatched policy stops for review. Keys remain on the
server and must be root-owned mode 600.

Daily credits use the deployed plan's percentage of each account's active
principal at the fixed start of each 24-hour period, including reinvestments.
The first period begins when the server policy is created after these checks;
there is no historical back-credit. Allocations require actual reward funding.
Only owner-approved withdrawal requests are paid. Transaction and batch IDs
prevent repeated credit or payment after a restart.

The daily worker needs an archive-capable RPC for period-start account state.
A pruned RPC stops enrollment with
`ARCHIVE_RPC_REQUIRED_FOR_PERIOD_START_PRINCIPAL`; it is not replaced with
latest-state accounting. The enrollment probe checks storage approximately
24 hours in the past. Future RPC retention and service availability must still
support each due period.

## Verification

`scripts/compile-deferred-migration.mjs` builds migration-only artifacts without
overwriting released contract bytecode. `scripts/sync-deferred-console.mjs` keeps
the shared read-only browser module aligned. The wallet bundle is reproducible
with `node scripts/build-migration-wallet.mjs` after frontend dependencies are
installed. Runtime contracts must remain below EIP-170 size limits.

The migration tests use a local testnet EVM for account and queue preservation,
owner approvals, single payment, cancellation, daily-member indexing, constructor
proof without archived storage, existing-copy discovery, read-only API behavior,
cutover rejection, council delay and archive-RPC enrollment checks. Installer
tests exercise managed paths, credential preservation and rollback. Local tests
do not claim a live owner signature, server installation or completed migration.

## Existing Nginx enabled-file repair

The 2026-10-23 server diagnostic identified a regular active
`sites-enabled/globaldroptrade.com` containing the current theme, an older
canonical available file, and two loaded backup entries ending in
`.bak.1792627288` and `.bak.1792627441`. These backups caused duplicate hostname
warnings, and the regular enabled file prevented the managed installer from
updating the site.

From the pinned repair checkout on that existing server, run as root:

```bash
python3 scripts/repair-global-nginx.py --apply
bash ubuntu-deferred-migration.sh
```

The repair first matches all four configuration hashes against the verified
diagnostic, checks that each configuration belongs exclusively to the Global
domain, and verifies that local HTTPS serves the active release. It snapshots
the four original entries outside Nginx include directories, preserves the
active configuration byte-for-byte as the canonical file, replaces the active
entry with the required symlink, and removes only the two verified backup
entries from the enabled directory. Certificate files, other sites, API settings
and blockchain state are not changed.

Nginx syntax, remaining hostname conflicts, HTTPS content and any previously
healthy API are checked before success is reported. A failed change restores
the original file and symlink types. The script prints a private backup path
and a concrete `--restore` command. If the diagnosed files changed or additional
conflicts remain, it stops instead of selecting another configuration.

`python3 scripts/test-nginx-enabled-repair.py` exercises this repair and rollback
against isolated filesystem and service fixtures. No live Nginx repair is
claimed by these tests.
