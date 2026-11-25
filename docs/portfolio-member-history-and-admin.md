# Portfolio history and administration

Open `/#dashboard/history` for the connected member’s confirmed activity. On the V7 and V8 portfolio sites, the browser reads the site's own API for both the transaction ledger and the withdrawal ledger. A search can use a transaction hash, activity type or UTC date range. The response identifies the wallet, vault and confirmed block. Search progress covers the selected blocks; a server error leaves the result incomplete until retried.

## Server integration

`GET /api/v3/member-history` reads confirmed events. `GET /api/v3/member-withdrawals` reads withdrawal requests, their settlement status and the allocations for combined withdrawals. Both require a `wallet` and a `vault` query parameter. The API uses the verified chain-97 vault identities exported by the installer from the portfolio deployment proofs. An isolated V8 vault has its own history.

The main-domain release command uses `--portfolio --primary-with-commerce`. Before switching the website, the installer reads a historical event page and the first withdrawal page at the same confirmed block through the site's HTTPS origin. It verifies the responses against the installed portfolio proof. A failed history check leaves the previous website in place and reports `GLOBAL_PANEL_HISTORY_API_NOT_READY`. The Global VPS can use its existing protected archive RPC for historical reads.

## Manager and funder access

Open `/#dashboard/admin` or choose **Admin panel** in the dashboard menu and connect the authorized wallet. Open **Withdrawals & funding**. Newest requests load first. Search by the request number displayed to the member, or browse older requests. Review the beneficiary, personal profit, referral commission, network rewards, unlocked principal, deductions and net payout before choosing a settlement action. The available actions depend on the verified wallet role and request status.

The **Members** section lists registered wallets. Select a member or search by full wallet address to review the plan, principal, external deposits, reinvestments, rewards and withdrawal count. Managers can review VIP verification. A manager with the guardian role can also review suspension or reactivation. Each change requires wallet confirmation and a verified receipt.

## Support and announcements

Members can use **Support tickets** in the dashboard menu or open `/#dashboard/tickets`. Sign the wallet message to open a private thread, follow replies, close a resolved ticket or reopen it. Managers use **Admin panel → Support inbox** to search conversations by subject, wallet or ticket ID and filter by status.

Published notices are available at `/#dashboard/announcements` with or without a connected wallet. Managers use **Admin panel → Announcements** to publish, edit, unpublish or republish a notice. Unpublished notices remain in the manager archive.

The API keeps threads and notices in the service state directory under `v3/<vault>/community.json`. Each portfolio has its own records and wallet sessions. The server checks the confirmed and latest manager role before opening the private inbox or moderating announcements. The primary installer checks the public notice feed and the signed-access requirement for the private inbox before switching the site.
