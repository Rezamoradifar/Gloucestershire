# Global Drop Trade — owner-verified User Directory (13 November 2026)

## Implemented in this pull request
- New owner-only **Admin → User directory & account audit** inside the existing dashboard, without changing the contracts, balances, paid epochs, user check-in records, or the financial worker.
- Uses **distinct read-only owner audit sign-in**, separate from support sign-in. The owner signs a scoped, expiring wallet message with the configured chain and vault bound. The backend checks that this wallet is still the current on-chain owner on **every directory request**. Sessions are volatile (memory only, 10 minutes). Reporter permissions do not grant owner-directory access.
- Lists canonical `Registered` events in bounded 1,024-block pages from the server's verified RPC. The interface scans up to four pages per manual click; it shows the verified scan range, does not pretend unloaded blocks contain zero members, and marks the list complete only when it reaches the **configured deployment block**.
- Allows searching **any wallet** independently of directory scan progress. Each confirmed contract snapshot includes: registration, actual referrer, reporter-active flag, VIP KYC boolean, tier, direct registered and active counts, qualified directs, recorded USD capital and sales, daily target rate (not promised earnings), BNB and USDT principal/profit/external deposits/reinvestments/caps/cooldowns, investment position details, and supported withdrawal queue requests. Status and wallet transfer receipts are kept distinct.
- Uses existing daily check-in API and verified RPC history for optional on-demand evidence. Daily check-in proof is **not** the on-chain reporter-active flag. Only recent history windows appear until an operator explicitly scans older windows.
- Prefills the existing **Customer activity & KYC** review form when an owner chooses a user. No state or KYC value is changed automatically; the existing reporter authorization, simulation, wallet confirmation and post-tx verification remain mandatory.
- Includes responsive tables and CSV export of **loaded** verified registration events only.

## Explicit limits
- No durable historical database or instant all-user index has been installed; full population requires scanning the configured historic registration range, or a separately reviewed indexed database. The directory's counts and exports explicitly state the range.
- This source does not store legal names, email addresses, identity-document scans, off-platform personal data, or private signing keys. KYC is only the public on-chain flag.
- A `ProfitCredited` event is a contract credit and does not prove a cash transfer. Historical **personal versus referral** profit attribution still requires verified batch-ID matching and a complete transaction index; no new payouts are invented.
- This is **BNB Testnet** (chain 97) on the current VPS. Live mainnet needs separate audit and migration decisions. No retroactive activity or referral rewards are granted.
- If archival RPC is unavailable, unsupported requests fail with explicit errors; the panel does not show partial silently inferred totals.

## Deployment prerequisites
1. All GitHub CI checks must pass for the exact immutable PR head SHA.
2. Verify current live API source against the exact allowlisted previous server blob `8473f8fb072a1edd468682b0d3cc5cd592ebf21f`; unknown source fails closed.
3. Execute the existing `ubuntu-event-history-rpc-install.sh --check` on the pinned repository checkout; do not bypass any guard.
4. Use the guarded install only after review. The installer requires unauthenticated `GET /api/admin-users/head` to return HTTP 401 before swapping assets.
5. Verify after deployment: owner login succeeds, support token and non-owner wallet fail, listing returns canonical confirmed events with range metadata, selected user's balances match contract, withdrawal queue is not confused with bank payment, account change invalidates the session, and historical/financial worker remains unchanged.
6. If post-deployment checks fail, use the immutable installer backup to roll back site and API only. Never restore an older financial journal over newer user activity.
