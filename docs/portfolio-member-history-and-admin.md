# Portfolio history and administration

Open `/#dashboard/history` for the connected member’s confirmed activity. On the V7 and V8 portfolio sites, the browser reads the site's own API for both the transaction ledger and the withdrawal ledger. A search can use a transaction hash, activity type or UTC date range. The response identifies the wallet, vault and confirmed block. Search progress covers the selected blocks; a server error leaves the result incomplete until retried.

## Server integration

`GET /api/v3/member-history` reads confirmed events. `GET /api/v3/member-withdrawals` reads withdrawal requests, their settlement status and the allocations for combined withdrawals. Both require a `wallet` and a `vault` query parameter. The API uses the verified chain-97 vault identities exported by the installer from the portfolio deployment proofs. An isolated V8 vault has its own history.

The main-domain release command uses `--portfolio --primary-with-commerce`. Before switching the website, the installer reads a historical event page and the first withdrawal page at the same confirmed block through the site's HTTPS origin. It verifies the responses against the installed portfolio proof. A failed history check leaves the previous website in place and reports `GLOBAL_PANEL_HISTORY_API_NOT_READY`. The Global VPS can use its existing protected archive RPC for historical reads.

## Manager and funder access

Open `/#dashboard/admin` or choose **Funding & settlement** in the dashboard menu and connect the authorized wallet. Newest requests load first. Search by the request number displayed to the member, or browse older requests. Review the beneficiary, personal profit, referral commission, network rewards, unlocked principal, deductions and net payout before choosing a settlement action. The available actions depend on the verified wallet role and request status.

Managers can also look up a registered member by full wallet address to review or revoke the member's VIP flag. The wallet review identifies the member and the change; the app verifies the resulting on-chain status before reporting success.
