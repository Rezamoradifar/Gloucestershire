# Independent hourly test positions

This optional change applies only to the freshly connected BNB Testnet 97 vault
`0xfA53C3337825cDE4f760a6Fa45A87D8A7B353f75`. It does not deploy a contract,
reset accounts, transfer principal, refill rewards or change plan rates.

Each external deposit and reinvestment starts its own one-hour interval at its
confirmed creation-block timestamp. Its principal and plan/referral rates are
read at the start of each interval. A full interval must pass before a credit is
due. Reinvestment creates a separate position; it does not retroactively increase
the parent's already-started interval. The worker checks every five minutes and
handles at most eight due position intervals in one run. Confirmation delay, RPC
availability, backlog and funding can delay recording after the eligibility time;
this is not an exact wall-clock payment guarantee.

Only personal earnings generate referral commissions. Recipient activation,
VIP KYC and seller-tier rates are taken from the same interval-start snapshot.
Deterministic batch IDs bind chain, vault, member, position, interval and asset.
A partially completed personal/referral plan resumes the same batches without
replaying completed credits. A position cursor advances only after all its
batches are confirmed. Registration counts, position counts and aggregate
principal must reconcile before any credit. Log pages and block hashes remain
mandatory. Historical RPC support is still required.

Run `bash ubuntu-position-hourly.sh --execute` from the pinned release. It stops
only the timer, waits on the worker's existing run lock, archives the previous
policy in a dedicated transition file and installs a complete worker release plus
matching status console. The financial journal is never replaced or reset.
Previously paid daily batches, pending signatures or earlier incompatible hourly
transitions block the change before the policy is written; do not bypass that
check. A failed install can be retried from the same pinned release. Inspect the
actual worker status and receipts before calling the site active.

The ordinary 24-hour policy and mainnet deployment paths are unchanged. This
anniversary implementation explicitly rejects mainnet and 24-hour selection;
production anniversary support requires its own reviewed activation path.
