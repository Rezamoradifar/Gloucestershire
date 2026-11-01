# Fifteen-minute test cycles on the existing vault

Explicit chain-97 test-only timing change. No deployment, reset, funding grant, rate change or mainnet activation. Use the reviewed `ubuntu-split-hourly-worker.sh --execute --quarter-test` installer. It also installs or updates the separate indexer and indexed payment runtime, waits for existing services, preserves all private state and runs the policy cutover under the existing financial lock.

The current percentage is applied once per complete **900-second test period**, with the same tier and referral rules. This is accelerated testing, not a prorated hourly reward. For a qualifying 100 TestUSDT position at 0.5%, one complete new test period allocates 0.5 TestUSDT, subject to funding and actual worker execution. Mainnet policies still require 86400 seconds.

A confirmed canonical block defines activation. The immutable private intent `/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/quarter-policy-transition-v1.json` records the old policy, new policy and target identity before replacing the policy file. Retrying the same transition reuses its activation instead of choosing a new one. Pending signed/financial transactions block the change; they are never deleted. No signing key is read by the transition tool.

The new policy uses `periodSeconds: 900`, `positionScheduleVersion: 2`, explicit quarter-hour fast-test markers and a canonical `quarterCutover`. Existing `positionPaid`, `positionClosed`, transaction journals, reward batch IDs and allocated balances remain intact. Completed old hours ending at or before activation retain their original hourly batch IDs and are processed as overdue old hours. Old partial hours are not fabricated as completed hours. New quarters start at the later of position opening and activation, with no retroactive quarter allocations. Reinvestments keep their own opening time.

Quarter cursors are stored separately in `positionQuarterPaid` and `positionQuarterClosed`; quarter batch IDs include the activation block hash. Canonical snapshot checks, owner-approved withdrawals, principal reconciliation and cash coverage remain required. Overdue old hours are processed in chronological order before later quarter periods. Thus a backlog, RPC failure, exhausted cumulative fee budget or missing cash can delay visible payment beyond 15 minutes; changing the period does not repair those blockers.

Look for `QUARTER_TEST_POLICY_INSTALLED` with `periodSeconds:900` and then `SPLIT_HOURLY_WORKER_INSTALLED`. These messages prove configuration/installation, not a mined profit credit. Verify real successful receipts, account changes and separate quarter progress:

```bash
python3 - <<'PY'
import json
from pathlib import Path
b=Path('/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1')
p=json.loads((b/'daily-policy.json').read_text())
d=json.loads((b/'journal.json').read_text()).get('daily',{})
print('PERIOD_SECONDS:',p.get('periodSeconds'))
print('LEGACY_PAID_HOURS:',sum(d.get('positionPaid',{}).values()))
print('PAID_QUARTERS:',sum(d.get('positionQuarterPaid',{}).values()))
PY
```

An unchanged legacy `PAID_HOURS` count does not imply new quarter payments stopped: new periods increment `PAID_QUARTERS`. The updated read-only wallet diagnostic exposes both kinds of completed and overdue periods. RPC replacement retains one-hour historical retention checks for safety and binds readiness to the actual selected test period.

Source and tests are prepared locally. Actual VPS activation and two consecutive public-testnet payment receipts still require server evidence. The ordinary production contract and its 24-hour policy remain unchanged.
