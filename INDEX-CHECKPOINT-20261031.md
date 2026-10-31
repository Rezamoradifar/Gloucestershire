# Preserve member-index checkpoints during unavailable RPC reads

The live worker for the new testnet target reported
`DAILY_MEMBER_INDEX_INCOMPLETE` during repeated bounded planning runs. That
status covers both registration and position-event indexing. It does not by
itself establish a stalled scan or a missing payment.

The indexer saves each completed verified page and uses a fixed canonical target.
Compare `daily.registry.through` and `daily.positionIndex.through` against
`daily.positionScanTarget.number` before selecting any live repair. Do not clear
the journal, change the deployment block or advance a cursor past unverified logs.

Code inspection found a separate robustness defect: an absent checkpoint header
was treated like a confirmed different canonical hash, clearing the registration
index. The fix now requires a well-formed header for the exact checkpoint number
before deciding whether a reorganization occurred. Missing or malformed headers
produce a bounded `HISTORICAL_BLOCK_UNAVAILABLE` / `BAD_DATA` read failure and
preserve all saved progress. A genuine canonical hash mismatch still triggers
the existing rescan. Equivalent hash casing does not create a false mismatch.

This change does not alter the contract, policy, reward rates, period timing,
transaction identities or completed payment cursors. It does not skip scans or
prove that the screenshot's live wait was caused by this defect. No deployment
or live worker change is asserted by this source-only patch.

Targeted tests cover missing/malformed headers, RPC exceptions, unchanged signed
journals and payment cursors, confirmed reorganizations, completed-index reuse,
and the existing worker's pending-transaction retry gate. The daily, hourly
position and worker regression suites exercise funded credits and replay guards.
