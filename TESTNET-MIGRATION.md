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
