# Hourly payment acceptance checks

The testnet position policy remains one complete hour per deposit or reinvestment.
No economic rates, contract addresses, financial journals or grant amounts are
changed by the checks in this release.

Local financial tests exercise personal rates and tier boundaries, independent
reinvestment hours, exact source-tier referral percentages, funding rejection,
immutable historical snapshots, ten-block log queries, smaller saved pages,
moving-head backlog drainage, cooperative yielding and duplicate prevention.
Additional recovery cases reload serialized journal state after a completed
payment and after only its personal batch confirms. The latter resumes the
referral batch exactly once without paying the source again.

The read-only diagnostic now uses the activation timestamp for position-policy
archive probes instead of multiplying a settlement counter by the hourly
period. It can inspect a supplied public wallet, its on-chain position count,
current rate, principal and profit, and compare known indexed opening times
against saved paid-hour cursors. Unindexed positions are explicitly unknown;
current profit balances never imply that every historical period was paid.

Up to three recent completed daily journal transactions are independently read
from the chain. Their chain, hash, sender, destination, native value, successful
receipt, canonical block, confirmations, batch identifier and exact credited
recipient/asset/amount events must agree. Pending entries are excluded. No
private signing key is opened and no transaction is sent. Provider URLs and
raw messages do not appear in diagnostic errors.

Run on the VPS using the pinned source:

    bash ubuntu-check-hourly-payments.sh --wallet 0xPUBLIC_ADDRESS

This installs only checkout-local production dependencies, prints service/timer
status, compares installed worker sources with the reviewed release, reads saved
index/payment progress and runs the diagnostic under the existing worker lock.
It never stops a running worker, resets state, deploys a contract or grants
funding. A busy worker produces HOURLY_CHECK_WORKER_BUSY; a failed RPC or receipt
check remains a failed check. A completed diagnostic is not mainnet approval.

Live acceptance still requires multiple distinct hourly intervals with verified
personal and referral receipts, expected reinvestment credits, and observed
service execution after SSH logout and a planned reboot. RPC failover must
actually select a fully verified archive provider. None of these live outcomes
may be inferred from local test success or from an enabled timer alone.
