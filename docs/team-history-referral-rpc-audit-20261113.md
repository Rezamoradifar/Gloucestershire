# Global Drop Trade — history, Team, referral audit (13 November 2026)

## Applied, proposed source changes
- Team registrations (levels 1–3) no longer use `eth_getLogs` on a mobile wallet. `/api/team/registrations` accepts a parent and at most 96 blocks per request, checks BNB chain ID and contract, reads `Registered` event logs on verified server RPC candidates, and verifies canonical block hashes before returning them.
- Expanded member details now use `/api/team/member`, reading the contract's `users(address)` at a confirmed checkpoint. No signer, wallet approval or private RPC URL reaches the browser.
- A bounded, incremental client maintains a pinned chain snapshot and labels discovered counts as partial. It rejects malformed/unconfirmed API responses, supports loading older pages, and keeps the contract's reporter-verified active-direct count separate from raw registrations.
- The network sidebar is labeled **Team & referrals**.
- The permanent referral identifier stays the inviter's **public wallet address**, via `?ref=0x...#dashboard`. Short alphanumeric aliases are **not** accepted by the current contract and must not be pretended to be on-chain referral codes.

## Existing financial history
- `/api/event-history/window` already uses server-side bounded `eth_getLogs` with RPC candidate failover and canonical block checks, not the mobile wallet.
- It returns on-chain `Deposited`, `ProfitCredited`, `Reinvested`, `Withdrawal` and network-milestone events. Displayed profit is an allocation in the contract, not necessarily a settled payout.
- Older blocks may require an archival BNB Testnet RPC. The UI's coverage label and export are necessarily **partial** until the scan reaches the contract creation block.
- There is **no verified durable event-history database wired into this release**. Do not label RPC results as database-backed, promise historical completeness, or claim that the app's current chain-97 ledger has been reconciled.

## Database integration still required before a complete-history claim
1. Select/verify a durable history store on the VPS. Use a uniqueness key `(chain_id,contract_address,transaction_hash,log_index)`, with block number/hash, topics, decoded event, scan boundaries and index version.
2. Build a signer-free indexer; save only fully verified pages with canonical hashes, resume from persisted checkpoints, and monitor finality/reorg invalidation.
3. Expose a read API that identifies its source and coverage (e.g. `verified_database` vs `verified_rpc`); validate every returned window against the canonical chain before using it in financial calculations.
4. Backfill and reconcile registered members, deposits, profit credits, reinvestments, withdrawals, queue status and per-wallet earnings; never infer a payment from a credit or a queue mark alone.
5. Verify an authenticated wallet E2E check for three referral depths, new invite's first deposit, old and new member histories, mobile wallet without `eth_getLogs`, and withdrawal receipts.
6. Keep chain 97 isolated from mainnet 56 and preserve all prior financial journal entries and batch IDs.

## Deployment boundary
This PR is source-only. CI and code review must pass; the site and API must be deployed **together** with the project's guarded installer and a reversible release. Test on the live VPS before announcing success. This change does not start an index timer, fund rewards, modify contracts, perform payments, or merge any PR automatically.
