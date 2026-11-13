# Global full-site V2 cutover: isolation and safety gates

## Target
Restore the full production-capable legacy frontend and admin experience from this branch, while using **only** the independently deployed V2 contract, fresh indexes and fresh application state. Do not reuse an old vault, old worker journal, old simulated balances, or old API cache.

## Explicit non-goals
- **Do not** delete blockchain history: old contract positions and claims remain immutable.
- **Do not** delete backups, old settlement evidence, queued claims or payment records. Preserve a sealed archive outside the new runtime, with access restricted to the operator.
- **Do not** treat a pending deployment report, empty site directory, or HTTP 200 as proof of a safe live contract.
- **Do not** grant test credits or seed test rewards on production. Test-only balances must be identified and separated.

## Baseline facts observed November 13, 2026
The existing `/api/config` replied with chain 97 and the **old** vault `0x4C0F6141b18971db4b14e45c0bE8CddB09febc14`. Nginx and API reported active. `/var/lib/globaldroptrade/v2-prototype/deployment.json` recorded `status: pending`, chain 97, a transaction hash and a predicted contract address. This is *not* proof of a mined V2 deployment. The `trades.env` file had multiple assignments for `TRADES_VAULT_ADDRESS`; replacing only one line is unsafe.

## Cutover sequence, all gates mandatory
1. **Archive, do not migrate:** take verified snapshots of the old API configuration, frontend release and worker metadata; separately inventory unpaid user balances and withdrawal liabilities. Never display the old balances as V2 balances. Never touch on-chain state.
2. **Verify V2 on chain:** run `python3 scripts/v2-one-shot-check.py --check` in the pinned checkout. If it reports pending/failed or missing bytecode, STOP. Next verify deployed bytecode hash, constructor parameters, ABI, admin privileges and expected ownership against the *new* source artifact. The one-shot check intentionally does not certify those properties.
3. **Validate new state isolation:** new contract must start with expected empty registries/positions/withdrawal queue; fresh index namespace must be empty; no historical user activity or stale cached API response should be imported.
4. **Restore legacy experience:** compile the existing `website/` React application, preserving all customer/admin, deposits, positions, history, referrals, wallet connection, notices, reinvestment, queue and reporting screens. Connect it to a **new** API/worker target; do not reuse the old service's mutable state.
5. **Feature parity tests:** check registration, wallet/network detection, on-chain deposit receipt, personal and referral credit, reinvestment, withdrawal request/owner approval/payment, rejection and repeat-transaction protection, main account balances, mobile UX, API/source consistency and restart recovery. Do not claim 'real' payouts from a simulated receipt or mere accounting credits.
6. **Liquidity and security:** verify reserve funding, settlement economics, owner privileges, principal liabilities, withdrawal solvency, and independent contract/security review before any mainnet money.
7. **Atomic release:** publish the new frontend/API only after all gates pass; use a unique release directory, cache-busted assets, no-store dynamic API responses, strict V2 chain/address allowlist and a reversible Nginx/config swap. Do not clear old archival data to make a failing gate pass.
8. **Acceptance:** public `/api/config` matches exactly the new V2 chain/address; wallet transaction signer targets the same address; verified end-to-end test receipts match that contract; old vault does not appear in current site/API/worker configuration. If any gate fails, keep the current site unchanged.

## Current status
**BLOCKED.** The observed V2 deployment report says pending and no verified on-chain receipt/runtime hash has been supplied. Neither V2 financial integration nor complete site acceptance has been established. No destructive reset or main-site switch is authorized by this document.

## Operator quick check
From the pinned `codex/global-full-site-v2-isolated-20261113` checkout, use:
```bash
python3 scripts/v2-one-shot-check.py --check
```
This is read-only and exits nonzero while a release gate remains unresolved. Never supply private keys or `trades.env` contents in chat.
