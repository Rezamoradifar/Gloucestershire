# Global history, Team and invitation integrity — staged rollout

This change is proposed on a stacked **draft** PR. It is not installed on the live VPS by merging source, and it does not deploy or upgrade contracts.

## Data provenance and limitations

- **Contract + RPC:** `/api/event-history/window` requests a bounded, canonical BNB Chain RPC page. `/api/team/member` reads `users(address)` at a confirmed block from the configured vault, also over server RPC. The browser must not send historical `eth_getLogs` to a mobile wallet.
- **Private SQLite database:** `/var/lib/globaldroptrade-api/verified-history.sqlite` is a bounded read-through cache of *successfully RPC-verified* windows. Database hits must re-check chain ID, vault code hash, confirmed head and the exact canonical end-block hash against a live RPC. If RPC is unavailable, cached results cannot masquerade as newly verified. If the DB cannot open, the API falls back to direct RPC and logs `HISTORY_DB_UNAVAILABLE_RPC_ONLY`.
- **Not a full historic index:** Cache pages are populated *on demand*, not retroactively populated from genesis. "Loaded" totals do not equal all-time liability totals. An empty scan window is not evidence of zero registrations elsewhere.
- **Referrer:** The vault stores a public wallet address as the immutable referrer; no short arbitrary alias can be silently invented. Reject invalid, duplicate, unregistered or self-referral addresses before first deposit.
- **Financial truth:** Profit, credits, approved queue status, cash coverage and paid transfer receipts remain controlled by the vault and reconciled worker. This change does not recalculate, pay, alter or fund any profits.

## CI and required inspection

1. Confirm all checks succeed for the **exact commit** on PR #50; do not use a CI result from PR #49 or an earlier commit.
2. Review the changed server files and run `npm ci`, `node --test test/history-relay.test.mjs` and `npm test && npm run build` within `website/` in a pinned checkout. Use Node 22.23.3 and verify `node:sqlite` support.
3. Confirm `globaldroptrade-api.service` working directory, ExecStart, service user, read/write permissions for `/var/lib/globaldroptrade-api`, and a rollback plan before swapping production files.
4. Back up the existing API release, Nginx root and frontend release. Deploy server and frontend as **one reviewed, compatible release**. Stop the process rather than overwriting unrelated installed assets or changing payment services.
5. On localhost verify `/api/config` retains chain ID **97** and the exact unchanged vault address, `/api/health` is OK and `nginx -t` succeeds.
6. For a real connected wallet, verify a confirmed finance page, second request served as `database+rpc`, and correct treatment of a DB outage / RPC failure. Verify a genuine direct registration via `kind=team`, contract `users(address)` profile, correct depth and "older records may exist" messaging.
7. Test a valid public `?ref=REGISTERED_WALLET#dashboard` link with a *new* wallet, invalid/duplicate links, self-referral and unregistered referrer. A first deposit must receive the exact reviewed address. Existing registered wallets retain their on-chain inviter.
8. Check responsive Team and History screens on mobile and desktop browsers. Live design visuals were **not** inspected within this change; no screenshot-based fidelity claim is made.
9. Confirm daily, referral and withdrawal flows separately with canonical receipts; this PR is not evidence that previously blocked `DAILY_MEMBER_INDEX_INCOMPLETE` or pending payments are fixed.

## Rollback boundaries

- This PR makes no database or financial journal migrations. The SQLite file is a cache only and can be **quarantined** if corrupted; do not touch `/var/lib/globaldroptrade/new-deployer-testnet-automation-v1/journal.json` or a payout ledger.
- Switch back to the previous *site and API release together* if the new endpoints fail or the client can't validate snapshots.
- Never restore an old financial journal while financial workers may be active. No forced payout, wallet signing, fee changes, mainnet migration or profit creation is part of this feature.
