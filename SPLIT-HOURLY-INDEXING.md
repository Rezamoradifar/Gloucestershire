# Separate hourly history indexing and catch-up payments

Implementation for the existing chain-97 FastTestnetVault and position-anniversary policy. No contract deployment, reset, account migration, reward top-up, owner approval or percentage change is part of this release. Public-network installation and recurring payouts have not been verified by local tests.

## Changes

- `globaldroptrade-position-index.service` scans registrations, deposits and reinvestments independently of payment invocations. It never loads a private key or sends a transaction. Its systemd sandbox also masks the operator/deployer key files.
- The indexer keeps a fixed confirmed target until every page is scanned, then selects a newer confirmed target. Completed pages are saved atomically. A later failed page cannot publish partial events or rewind a paid-hour cursor.
- The payment planner uses the smaller fully scanned registration/position checkpoint. It verifies both stored canonical hashes, reconciles position counts and asset principal at that exact block, and calculates only hours complete by that checkpoint. Newer incomplete pages do not block older verified earned hours. `Deposited`/`Reinvested` log scans are absent from this planner mode; existing bounded creation/settlement capability probes remain required by CLI readiness.
- Payments remain oldest-hour first. The batch domain and `usedRewardBatch` checks are unchanged. Saved transactions, paid-hour cursors and deterministic IDs remain in the existing journal. A restarted worker resumes its saved signed transaction before new work.
- An indexed payment run processes at most eight position-hours and stops starting another plan after a soft two-minute catch-up budget. A signed financial transaction is never canceled by that planning budget. Gas limits and the existing cumulative test-BNB budget remain unchanged.
- The index timer polls 20 seconds after completion; the payment timer polls 30 seconds after completion. They are separate services but share the existing financial lock to serialize journal writes. The financial service waits up to 90 seconds for the indexer's short read-only run instead of skipping every busy instant. Closing SSH does not stop either systemd service.
- Existing cash-coverage, referral eligibility, historical rate, owner capital authority and owner-approved withdrawal checks are retained. A positive recorded reward ledger alone does not guarantee available cash.
- The existing RPC failover monitor receives the same reviewed source. It still requires chain, creation, runtime, log/history and canonical checks before changing endpoints. This release does not assert that a public endpoint is healthy or a private subscription is configured.

## Install on the existing VPS

Run the reviewed `ubuntu-split-hourly-worker.sh --execute` under a systemd transient oneshot with an infinite startup timeout. It requires the existing managed Node 22.23.3 runtime, existing hourly policy, root access and at least 512 MiB free disk space.

The installer performs a signer-free target check before stopping timers. It waits for existing RPC, indexing and financial services to finish; it never kills an in-flight financial service. It stages public modules into a new managed release, preserves private journals and policy, installs drop-ins and restarts the two timers with the aligned RPC monitor source. It does not use `ubuntu-reset-fast-testnet-20261031.sh` or the old hardcoded-address policy transition.

Backups under `/var/lib/globaldroptrade/split-index-installs/` contain the previous release pointer, prior drop-ins and a private journal snapshot. **Never restore that journal snapshot after a worker may have run**: it is evidence, not a financial rollback command. If installation fails while waiting for old services, prior active timers resume. A failure after changing source or unit files leaves a review-required message and backup path; do not blindly restart an old failover source.

RPC repair releases include the signer-free indexer module, and the systemd drop-in keeps payment mode indexed after a reviewed service reinstall. An unrelated older installer that predates this flag/module must not overwrite the running release.

## Verify live behavior

```bash
systemctl show globaldroptrade-position-index.timer globaldroptrade-zero-daily.timer -p ActiveState -p SubState
journalctl -u globaldroptrade-position-index.service -u globaldroptrade-zero-daily.service -n 40 --no-pager
python3 - <<'PY'
import json
from pathlib import Path
b=Path('/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1')
d=json.loads((b/'journal.json').read_text()).get('daily',{})
print(json.dumps({'target':d.get('positionScanTarget',{}).get('number'),'membersThrough':d.get('registry',{}).get('through'),'positionsThrough':d.get('positionIndex',{}).get('through'),'paidPositionHours':sum(d.get('positionPaid',{}).values())},indent=2))
PY
```

`POSITION_INDEXER_PROGRESS` proves scan movement, not a payment. Require canonical successful credit receipts plus account changes, and increasing paid-position hours for due positions. Verify two consecutive public-testnet cycles, the reinvestment increment, eligible referrals and owner-approved withdrawal payment before mainnet preparation. A private RPC with incorrect receipts, unavailable historical state, funding shortfall or exhausted fee budget still blocks safely and requires diagnosis; this separation cannot manufacture missing chain data.
