# Guarded automatic testnet RPC configuration failover

Install this release using `bash ubuntu-install-rpc-failover.sh --execute`.
The monitor is a separate systemd oneshot service and enabled timer. It survives
SSH logout and reboot, and checks again five minutes after its previous run,
with up to 30 seconds of scheduling jitter. It skips active payment workers,
healthy reports, ordinary index backlogs and funding-only blockers.

On a reported RPC read blocker or a failed worker exit, it checks these public
BNB Testnet candidates in order:

1. https://bsc-testnet-dataseed.bnbchain.org
2. https://bsc-testnet.bnbchain.org
3. https://data-seed-prebsc-1-s1.bnbchain.org:8545

After a successful selection it starts from the following candidate on the next
outage. These public addresses are not asserted to provide complete archive
history. An endpoint is eligible only when the existing archive-replacement
installer's full read-only check succeeds, including exact creation proof,
canonical blocks, required historical state, funding, logs and journal checks.
The apply phase repeats the proofs and uses existing locks, backups, source
fingerprints and rollback safeguards before configuration cutover.

No direct edit of financial journals, paid cursors, contract or reward funding
is performed. The existing repair installer may restart the already-authorized
payment worker after a verified cutover. A failed apply stops further automatic
rotations and requires review; another candidate is never tried after a
potentially partial configuration or financial transition.

When no candidate passes, the monitor prints RPC_FAILOVER_NO_VERIFIED_CANDIDATE
and preserves the current configuration. This is a genuine remaining archive
provider blocker, not a successful payment recovery. Diagnostic output and
status are private under /var/lib/globaldroptrade/rpc-failover-v1. Provider
responses and subprocess output are never copied into public status.

Local decision tests cover failed candidate rejection, fallback ordering,
selection of the third endpoint, no apply without a successful proof, stopping
after apply failure, healthy/indexing-worker skips and SSH-independent systemd
configuration. Shell syntax and Python compilation are checked. Installation
and live provider eligibility must still be verified on the user's VPS.
