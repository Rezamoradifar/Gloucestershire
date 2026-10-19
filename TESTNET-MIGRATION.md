# Global testnet account copy

This is a chain-97-only migration console for the existing immutable legacy vault
`0x4f65014A86Af841bF7a72F49E9AEB4432a72Db8F`. It is NOT a mainnet migration or a
mechanism to extinguish old claims. Legacy principal and profit withdrawals remain
callable while paused. Funding both contracts can enable independent payouts.

Run `bash ubuntu-migration-console.sh` as root on the existing Global server. This
only installs public files under the verified active Nginx web root and saves a
backup. No RPC credentials, keys, API configuration or blockchain state are changed.

Open `/deploy/migrate.html` in the owner's wallet browser on BNB Testnet (97).
Connect, pause the source, scan, estimate, deploy, verify, activate, and download
the JSON report. Review each wallet transaction. No seed phrase is required.
The owner must hold sufficient test BNB for deployment.

The scan requires historical code and complete event logs. RPC failure aborts the
scan; no partial inventory is used. Deployment rejects missing funded accounts,
missing parents, duplicate members, inconsistent positions, active source, pending
ownership transfer, nonzero source cash, fee reserve or funded reward budget.
It imports accounts, positions and lock dates, referral state, reward group stages
and consumption, current-stage reservations, volume jobs, owner capital debt,
retained penalties and supplied settlement/batch replay identifiers.

Zero-balance users and replay identifiers rely on complete RPC logs. Verify the
inventory against operational records. Governance proposals/votes and non-owner
reporter permissions are deliberately not copied and must be reviewed separately.
The new vault starts paused with no cash. Verification compares copied state at
the deployment block; activation and subsequent operations can then change it.
The constructor is subject to block gas and init-code limits: an oversized
migration stops at estimation and needs a separately reviewed batched design.

The website/API continue using the old address until the verified report is used
to prepare the separate configuration cutover. Do not infer successful cutover
from successful console installation. Retain the old contract and historical
event source for audit/history: copied users and positions do not replay the old
registration/deposit events on the new contract.

Local tests cover state preservation, continuation of partially prepared rewards,
replay rejection, inventory failures, source cash/pause gates and the fact that
legacy liabilities remain independently callable after the copy.

## Automatic server signing (testnet only)

Run `bash ubuntu-auto-migrate.sh` as root. It uses the existing Node 22 runtime
and `/etc/globaldroptrade/trades.env`. Existing root-only key files are used as described below; no key is sent to chat
or passed in a command argument. The optional owner key is stored at
`/etc/globaldroptrade/migration-owner.key`. A different wallet cannot perform
owner actions. The combined reserved transaction fee limit is
0.1 test BNB; exceeding it stops execution rather than silently increasing it.

The `globaldroptrade-migration` systemd job scans, pauses, scans again, deploys,
compares copied state, and activates. It sends no token transfers and does not
fund or drain either treasury. Nonempty source cash/budgets stop the process.
Existing pending owner transactions also stop new signing.

Inspect `journalctl -u globaldroptrade-migration -n 40 --no-pager`. The public
result is `/var/lib/globaldroptrade/migration-v1/report.json`. The adjacent
`journal.json` contains signed transactions, not the private key; keep it private.
Transactions are persisted and fsynced before broadcasting, and resume broadcasts
only the identical transaction. Keep the journal and rerun the same script after
a timeout. Never delete the journal to fix a failure. A reverted or externally
replaced transaction requires investigation. Do not simultaneously use the
browser migration console: the browser and server do not share their journals.

Three confirmations are required. This cannot eliminate all chain reorganization
risk. No legacy claim is extinguished. Successful completion does not switch the
website/API: retain the verified report for the subsequent configuration cutover.
Remove the server key after migration if it is no longer needed, keeping the
report and journal. Do not use this tool for a wallet holding real assets.

## Separate deployer and owner

The server now uses `/etc/globaldroptrade/migration-deployer.key`, falling back
to the existing `/root/global-testnet-v071/.testnet-server/deployer.key`. It never
treats a mismatched owner key as a deployer key. The source owner is preserved
by the constructor regardless of the deployment signer. Only the actual owner
can pause the source or activate the destination. The optional owner key remains
`/etc/globaldroptrade/migration-owner.key`; it is used only when its address matches.
No interactive key prompt is needed for existing files.

If an owner action is required and no matching owner key is available, the script
stops with `OWNER_SIGNATURE_REQUIRED`, recording the exact unsigned call in
`/var/lib/globaldroptrade/migration-v1/owner-action.json`. It does not bypass access
control. Resume the same journal after the owner signs the action or a matching
owner key is installed. Before activation, a verified report is already saved.
Existing transactions remain bound to their original signer when resuming.
