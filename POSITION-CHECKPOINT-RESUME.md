# Resume hourly allocations without chasing the chain head

The prior planner released its fully verified scan target immediately before
returning a payable hour. Its next pass selected a newer chain head and required
another registration and position scan before paying the next overdue hour.
Slow RPC reads could therefore postpone already-due allocations repeatedly.

The planner now retains the canonical target while draining every position hour
due at that target's timestamp. Each pass still rechecks target and index hashes,
position counts and principal ledgers, and uses historical period-start values
for rates and referral eligibility. It refreshes the head only after the saved
range has no remaining due hours. The existing two-hour-per-worker-pass cap and
deterministic batch IDs are unchanged.

Registration and position scan checkpoints are committed every 100 verified
blocks instead of 500. Log requests remain at most 10 blocks. A cooperative
boundary check yields before starting another page when less than 30 seconds
of the existing 90-second planning read budget remains. A failed in-flight page
never advances its checkpoint. Other daily modes retain their existing page
size and continuation defaults. Safe log-operation diagnostics now survive into
the worker's waiting report; provider URLs and messages are not published.

Install using this release's `bash ubuntu-position-hourly.sh --execute`. Existing
installer locks, backups, target checks, funding checks and failure recovery
remain in force. Existing financial journals, indexes and paid cursors are not
reset. No contract deployment, reward grant or RPC credential change is made.
The resumed worker may send previously authorized due allocations only after
its existing checks pass.

Local checks cover moving-head backlog drainage, independent reinvestment and
referral calculations, duplicate prevention, failed-page recovery, cooperative
yielding, daily-mode regression and sanitized worker failures. The installer
fixture verifies worker imports, locks and rollback. Live receipt and historical
RPC availability are still required; this does not claim to fix a failing
provider's creation receipts or missing archive state.
