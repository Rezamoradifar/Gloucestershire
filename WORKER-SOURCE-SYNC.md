# Align the installed hourly worker and RPC repair source

The live acceptance report showed all three payment worker source comparisons
false despite successful historical credit receipts. The installed payment
worker therefore differs from the reviewed source. A source comparison alone
does not identify why those files differ or prove every difference is a bug.
The failover monitor also keeps a complete source checkout and may install its
own source during a future verified RPC replacement. Both must be aligned.

Run this pinned release's `ubuntu-sync-hourly-worker.sh --execute --wallet
0xPUBLIC_ADDRESS` through a systemd transient service. The updater:

1. Serializes itself with a private update lock and pauses timer triggers.
2. Waits up to fifteen minutes per service for an existing RPC transition and
   payment worker to finish. It never stops either running service.
3. Installs the hourly worker through its existing guarded installer.
4. Compares the installed financial modules and complete-log reader byte for
   byte against this source, then installs the failover monitor from the same
   source and verifies its corresponding files.
5. Runs the read-only wallet/payment diagnostic and reports successful source
   alignment separately from actual receipt and backlog verification.

The contract, accounts, policy economics, financial journal and paid cursors are
preserved. There is no reset, redeployment or reward top-up. Existing authorized
worker payments can resume through the normal installer after its checks pass.
Its own backups and rollback guards remain in force. If waiting times out before
installation begins, originally active timers are restored. If installation or
source verification fails, an older failover source is left paused rather than
allowed to overwrite the reviewed worker. Such a failure requires inspection of
the updater and underlying install output; it is not reported as success.

Fake-host tests cover busy-service waiting, timer restoration, source mismatch,
failed worker installation, successful two-source alignment and a failed
read-only audit without undoing installed code. These do not claim live VPS
installation or regular payments. Live success requires matching sources and
verified overdue/new-period receipts from the user's server.
