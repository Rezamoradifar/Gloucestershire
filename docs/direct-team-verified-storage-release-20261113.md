# Direct team roster from the contract — chain-97 safe update

## What changed
- Read the registered direct referrals from the vault's canonical `networkBranchCount(address)` / `networkBranch(address,index)` storage, not from repeated 96-block `Registered` log scans on mobile devices.
- A new read-only `GET /api/team/branches?parent=0x...&offset=0&limit=12` endpoint uses server-side verified RPC candidates and a 3+-confirmation snapshot.
- It validates each returned child using the vault's `users(child)` record: `registered == true`, immutable `referrer == parent`. It fails closed for an inconsistent edge.
- Frontend paginates at the **same pinned canonical block hash**, shows the actual total registered direct members even before all pages are loaded, and expands up to 3 nested levels. It links to the real address in the explorer; it does **not** invent registration block timestamps or transactions.
- Team summary separately displays **registered direct members** and **reporter-verified active direct members**. Five registered directs with zero active directs can be a valid state; neither account activity nor earnings are forged to reconcile counts.
- The previous event-history and reward RPC routes remain untouched. Private signing keys, policies, pending withdrawals, reward journals and contracts are unchanged.
- The guarded installer now allowlists only the exact already-reviewed previous Team API source blob `c488903ba7ff6222e6e683f2a13221986bb3cac8` and verifies the new Team branch RPC endpoint after installing the API but before switching frontend assets. Other unknown API versions still fail closed.

## Release controls
1. Require all GitHub Actions checks to succeed **for the exact reviewed commit**.
2. On VPS confirm the running API source `git hash-object /opt/globaldroptrade-api/current/server/trades-api.mjs` equals the expected reviewed hash; never bypass an unknown version mismatch.
3. Run `bash ubuntu-event-history-rpc-install.sh --check` from the pinned checkout. If successful, run `--install` in a transient systemd unit and inspect the completion journal.
4. Verify `/api/team/branches` for a real previously registered wallet returns the expected direct count; verify paging at the same block, nested levels, and registered vs reporter-active statuses, **without changing statuses manually**.
5. Verify `/api/event-history/window`, `/api/health`, the first-deposit referral preflight, and wallet connection.
6. Failures require the installer-provided backup/rollback review. Do not restore a stale financial journal or reset paid epochs.

## Still not completed
- Daily reward indexing needs the independently reviewed PR #49's signer-free timer; install and verify it separately. A successful indexer is not evidence of a paid or funded reward.
- A durable financial event-history database, full contract/RPC reconciliation, and withdrawal receipt backfill remain under issue #52. The existing history endpoint returns verified RPC events, not a complete historical database.
- Reporter activity eligibility and actual profit payments require evidence, liquidity, and independent tests; a registered referral is not automatically an active or credited referral.
