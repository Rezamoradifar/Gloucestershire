# Small log windows for position-hour test allocations

The server diagnostic accepted 1-block and 10-block deposit-log reads, while a
500-block read returned an opaque SERVER_ERROR. The position planner now sets
an explicit 10-block maximum for registration, deposit and reinvestment log
requests. Other complete-log callers retain their existing defaults.

The complete-log reader covers every requested block, validates each response
against its own subrange and immutable filter, checks canonical block hashes,
and rejects malformed or conflicting results. It does not turn an RPC error
into an empty successful response. Four concurrent reads and existing request,
planning-time and saved-page limits remain in force.

Install using the pinned release's `bash ubuntu-position-hourly.sh --execute`.
The existing installer backs up the worker and status files and preserves the
contract, environment, policy, journals, indexes, payment cursors and funding.
It can resume previously authorized due credits after all existing checks pass.
There is no contract deployment, account reset or reward grant in this repair.

Verification: 24 complete-log tests and 9 position-hour tests passed locally,
including an opaque-error provider which refuses requests wider than 10 blocks,
full 500-block coverage, independent deposit and reinvestment hours, exact
referral amounts and prevention of duplicate allocations. Live server indexing
and confirmed credit receipts remain required. This change does not repair
unreliable creation receipts, missing historical state or other RPC failures.
