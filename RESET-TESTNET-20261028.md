# Fresh testnet replacement

This command replaces only the connected BNB Testnet 97 generation at
`0x04E26FcaA198d21cEf6d04e1e54f9C5f6399e522`. It preserves all old financial
state under `/var/lib/globaldroptrade/fresh-fast-reset-20261028/previous-state`.
Old on-chain accounts, claims and cash remain at the old address; they are not
migrated or erased. Wallet Test USDT balances and support data are not reset.

Run the pinned checkout's `bash ubuntu-reset-fast-testnet.sh --execute` as root.
The command stops the timer, waits for the existing worker to finish naturally,
and refuses other active signers or pending journal entries. It archives state
while holding the original lock inodes. A persistent one-time session resumes
interrupted deployment and connection steps without clearing new signed state.
A completed session never creates another deployment on rerun.

Deployment uses the existing reviewed FastTestnetVault artifact, owner,
operator, feeds, token and economic rules. The existing deployment journal limits
cumulative reserved fees to 0.1 test BNB and the separate new automation journal
to 0.1 test BNB. Only the ordinary one-time 10 Test USDT reward seed is used;
there is no million-token refill or automatic refill. Funding may need a
separately authorized top-up for larger tests. No private key is printed.

The existing connector verifies the new deployment and installs the website.
The oracle installer refreshes test quotes, creates the hourly policy and starts
the worker. RESET_COMPLETE confirms completion of those installation steps,
not a profit payment. Inspect the status page and actual receipts after users
register and deposit. New deposits and completed reinvestments first earn in the
next period-start snapshot, with allocation after that full period ends. The
hourly test rate is the full daily rate per hour, not the daily rate divided by 24.
Historical RPC, reward funding and administrator withdrawal approval remain
required; a new deployment does not repair an unreliable RPC provider.

If interrupted, retry the exact same pinned command. Never delete either the
archive or the new journals. If a pending signed transaction is present, resume
its existing release first. No automatic rollback of financial state is attempted
after a possible broadcast. The session's private trades.env backup and existing
connection/oracle installer backups support deliberate recovery; never restore
old journals into the new generation.

Validation: offline reset tests cover partial archive resumption, lock inode
preservation, pending signature rejection, mainnet rejection, changed file
rejection, preservation of new deployment state across retries and completed
session idempotency. Existing 27 daily, hourly and referral tests were rerun
successfully locally. No public-chain transaction or VPS reset was executed
while preparing this release.
