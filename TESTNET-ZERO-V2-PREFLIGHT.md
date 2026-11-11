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

A missing/incomplete latest backup is a hard failure. No older backup is
silently chosen instead.

## Cutover safety and explicit remaining work

1. Review open position/principal/credited-profit/queued-withdrawal
   obligations on the old vault. A new empty vault does not make old users'
   assets, approved requests or claims disappear.
2. Stage a **distinct V2 deployment**, journal, canonical creation proof,
   activation policy, API/site and worker configuration. Never rerun the
   existing new-deployer V1 deployment command or delete/recreate its journal
   to force an address change.
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
