# Ordered testnet automation

The coordinator sequences the existing signer-free index service and payment service. It does not read signing keys, edit financial journals, change rates, approve withdrawals, fund rewards or send blockchain transactions itself. Existing services retain canonical history, funding and receipt checks. Only the chain-97 position policy is supported.

Install the matching split-worker revision first, then run `bash ubuntu-smart-worker.sh --execute`. The installer refuses mismatched current worker sources, disables the two competing legacy polling timers, and enables `globaldroptrade-smart-worker.timer`. It never stops an in-flight financial service. A running prior service makes the coordinator wait until a later cycle. Per-service and financial locks remain in force for manual actions and independently guarded RPC maintenance.

Each cycle starts the index service, waits for completion, then starts the payment service. An index read failure still permits the payment worker to reconcile signed transactions and handle approved withdrawals. The separately installed RPC monitor keeps its full candidate verification; unverified endpoints are never selected by the coordinator. After repair-installer timer drift, the next coordinator cycle stops legacy timers again without terminating services.

Inspect `journalctl -u globaldroptrade-smart-worker.service -n 20 --no-pager -o cat`. Private health is stored at `/var/lib/globaldroptrade/smart-worker-v1/status.json`. Three completed cycles with unchanged outstanding index progress produce `INDEX_PROGRESS_STALLED`. A successful financial process without a fresh status produces `PAYMENT_STATUS_NOT_REFRESHED`. Neither condition triggers journal deletion, signed-transaction replacement or forced financial process termination.

A hash in `newCreditTransactionHashes` is copied only from a refreshed successful worker report. It is evidence for further receipt inspection, not an independent chain verification by the coordinator. A `running` health status is not proof of a new payment or complete catch-up.

This is a single-host scheduler. It does not provision a standby server, send external notifications, guarantee provider uptime or create reward funding. In the event of installer failure, prior scheduling is restored when safe; a running coordinator requires review instead of forceful termination. Backups preserve unit files and prior timer states, not rollback copies of financial journals.
