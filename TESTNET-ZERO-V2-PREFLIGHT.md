# Global Testnet Zero v2 — archive and balance preflight

The currently connected BNB Testnet vault is
`0x4C0F6141b18971db4b14e45c0bE8CddB09febc14`.
It contains historical user positions. Its on-chain positions **cannot be
deleted or erased by clearing server journals**.

The user requested a fresh start and made a server backup. The next release
must use a new contract address and a separate state/journal namespace. The
preflight introduced here **does not deploy, connect, pause or stop anything**.

## Run preflight on the server

From a clean pinned checkout with Node >=22.12 and npm dependencies installed:

```bash
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/preflight-testnet-zero-v2.mjs --check
```

This exits without signing and prints `ZERO_V2_READONLY_PREFLIGHT_PASS`
followed by on-chain accounting balances in smallest token units. It requires:

- the latest root-owned `/var/backups/globaldroptrade/pre-zero-YYYYMMDDTHHMMSSZ`;
- the preserved deployment report and worker journal matching the old target;
- the current API target still bound to BNB Testnet chain 97 and the old vault;
- canonical old runtime hash and withdrawal queue;
- live chain-97 RPC code and read-only ledger, queue and cash information.

The reported balances and queue are read at `readBlock` and `readBlockHash`.
The check stops if that block changes while the snapshot is read. The values
are a snapshot, not proof that the previous worker has stopped or that claims
have been settled; review the obligations again after quiescing the worker.

A missing/incomplete latest backup is a hard failure. No older backup is
silently chosen instead.

## Staged independent V2 deployment

The separate contract-deployment tool is prepared, but **the existing site
remains connected to the old vault** and this release does not automate an
API/worker cutover.

After completing the read-only archive check, run the no-signer plan:

```bash
node scripts/testnet-zero-v2-deploy.mjs --plan
```

It reviews the active chain-97 vault, backup and settled old worker journal,
rechecks the unchanged contract build and prints whether the previous signer
worker/timer is quiescent. The plan opens no signing key and sends no
transactions.

The deployment code has a distinct, root-only state directory:
`/var/lib/globaldroptrade/testnet-zero-v2`. It binds to the pinned V2
release profile, the old deployment identity and the old worker journal
digest, and stores any signed raw deployment transaction *before* broadcast.
It uses the existing verified FastNewDeployerTestnetVault artifact and
separately checks the exact on-chain genesis state before reporting success.

**Do not run the following live deployment mode until the entire V2
cutover/rollback path is reviewed and the previous users' testnet claims
are accounted for.**

```bash
# Explicit operation, only after quiescing the old signer and disabling its timer:
# node scripts/testnet-zero-v2-deploy.mjs --execute
```

The signer refuses execution while the previous worker is running or its
timer remains enabled. It has a cumulative fee ceiling of 0.1 test BNB and
does not fund rewards, connect the website, or activate automation.

Use the guarded wrapper rather than manually stopping a signer timer:

```bash
bash ubuntu-testnet-zero-v2-deploy.sh --check
# After CI and owner review:
bash ubuntu-testnet-zero-v2-deploy.sh --execute
```

The wrapper rechecks the backup and live state, serializes the V2 deployment,
temporarily stops/disables the old timer, **waits for the old service to exit
without killing it**, runs the V2 deployment with its separate journal, then
restores the original old-timer state, including on normal errors/signals.
If the shell or machine is force-killed, check and restore the old timer
explicitly before assuming it is active.

This operation only deploys an empty contract. The existing website
continues to show the V1 vault after it returns. No V2 funding or
website/worker cutover is implied.

## Cutover safety and explicit remaining work

1. Review open position/principal/credited-profit/queued-withdrawal
   obligations on the old vault. A new empty vault does not make old users'
   assets, approved requests or claims disappear.
2. Use the distinct V2 deployment and journal, then separately implement
   and verify a V2-specific API/site cutover and V2 activity/worker policy.
   Never rerun the V1 deployment command or delete its journal to force a
   different address.
3. Before any signer use, quiesce the previous signer worker, disable its
   timer, ensure no pending operator transaction or ambiguous lock, and capture
   a final consistent archive.
4. Deploy a fresh contract on BNB Testnet chain 97 only, verify the constructor,
   exact runtime, zero accounts, zero positions, zero withdrawal queue, and
   zero ledgers at its canonical genesis block.
5. Stage the API/site transition with explicit target pinning and rollback.
   Activate a separate worker bound to the new vault only after reward funding
   and operator permission are verified.
6. Require public testnet E2E evidence for registration, deposit, activity,
   personal/referral profit, reinvestment, owner-approved payout and no replay.

The old on-chain vault and its liabilities remain inspectable after cutover.
Do not use mainnet funds, erase old state or treat a backup alone as financial
settlement evidence.
