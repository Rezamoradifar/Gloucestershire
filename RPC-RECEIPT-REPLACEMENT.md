# Explicit testnet RPC replacement

Use the pinned release's `bash ubuntu-zero-archive-rpc.sh --execute
--receipt-rpc-replacement` to replace an unusable receipt provider with the
existing default candidate `https://bsc-testnet-rpc.publicnode.com`.

The selected candidate must independently prove the exact canonical creation
transaction, reviewed initcode, owner, queue, runtime, connected identity,
current state, reward funding, historical account state, journal blocks and
log-query capability. The original provider must still agree on chain ID and a
canonical anchor header. Existing configuration and private inputs are bound
through the preflight, stage and commit checks. The source fingerprint guards,
locks, backups and rollback checks of the archive RPC installer remain in force.

This explicit configuration replacement obtains creation proof from the new
selected provider. It does not alter the creation verifier's rejection of a
malformed receipt. Ordinary RPC-repair mode continues to validate the original
provider's creation receipt. A malformed candidate or disagreeing anchor still
blocks installation. Position schedules use their activation timestamp for the
archive capability probe; their settlement count is not treated as a shared
global period number.

The installer preserves financial journals, hourly positions, paid cursors,
reward grant records, accounts and contract address. Its preflight and stage are
read-only. Following successful configuration installation, the existing worker
may resume already-authorized due profit and approved withdrawal transactions.
No reward top-up or contract deployment is part of this repair.

Local verification: receipt replacement refuses a malformed new provider and
conflicting old-provider headers; ordinary mode still refuses a malformed old
receipt. The independent read-only candidate proof leaves journals and policy
bytes untouched. PublicNode returned the expected successful creation receipt
and the historical owner at block 139469501 during preparation. Live full
readiness is verified again on the user's server before any cutover; public
provider availability is not guaranteed.
