# Fresh hourly test generation, 2026-10-31

Explicitly authorized replacement of the test vault `0xfA53C3337825cDE4f760a6Fa45A87D8A7B353f75` on chain 97. This release does not deploy to mainnet. No live deployment is asserted by this document.

Run the pinned `ubuntu-reset-fast-testnet-20261031.sh --execute` on the existing Ubuntu host, preferably as a systemd transient oneshot with `TimeoutStartSec=infinity` and `UMask=0077`. It uses the existing private signer and configuration without printing secrets. It requires at least 512 MiB free disk space. No owner private key is requested.

The replacement keeps the reviewed FastTestnetVault artifact and economic rules, with the funded automation fixes in this repository. A new deployment address, queue, empty customer state and fresh private journals are created. Personal profit, voluntary reinvestment and source-tier referral rules do not change. Profit withdrawals still require owner approval; the owner retains full capital deployment authority.

Sequence:

1. Verify the actual RPC reports chain 97 before retiring any active files. This basic preflight does not establish receipt or archive correctness.
2. Stop the RPC failover timer, wait for any running transition, then stop the daily timer and wait for its worker. Never kill a financial service. Refuse active legacy signer workers.
3. Hold the setup, connection, source-sync and stable journal locks. Refuse pending signed or financial transactions in either old generation journal.
4. Verify that both the connected environment and recorded old generation identify the expected old vault. Preserve the private environment, all old live state files and their hashes under `/var/lib/globaldroptrade/fresh-fast-reset-20261031`. Preserve original lock inodes and installer recovery folders. Old accounts and withdrawal history are not migrated to the new vault.
5. Deploy a new empty vault and verify the exact constructor, settings, queue, canonical creation and empty initial state. Save a new journal before broadcast. Interrupted deployment resumes the same saved bytes rather than deploying again.
6. Connect the site and API to the verified new address. Refresh test feeds and provide the previously requested one-time 1,000,000 TestUSDT reward top-up for this new generation. These are test tokens, not real USDT.
7. Explicitly select the new verified address for position-anniversary hourly policy. Reject a mismatched deployment/runtime and refuse to change timing after previous or pending credits. Install the reviewed funded worker and matching failover source.
8. Report `RESET_COMPLETE`, the actual new address and hourly mode only after these stages succeed. Completion does not prove consecutive live payouts or full RPC retention; inspect actual credit receipts and funding.

The script retires old state from the active generation, but does not destroy the private archive, operator keys, old on-chain contracts, test token wallet balances or immutable transactions. New contract state starts empty. Old contract balances still exist at the old address. Do not accept new test deposits during replacement; wait for the new site address and final completion output.

A new deployment cannot repair an RPC that returns conflicting receipt data. Creation verification remains mandatory. If a receipt, archive, funding or service check fails, retain the error and rerun this same release after resolving the blocker. Never delete a pending new journal or alter a receipt to force completion. Session state prevents re-archiving or redeploying a successfully completed generation. The former 2026-10-28 reset entrypoint remains unchanged for its own historical recovery.

Local checks cover the pinned artifact and empty deployment, owner authority, approval queue, hourly profit/reinvestment/referrals, funded worker recovery, explicit new-address selection, archive interruption, preservation of signed bytes, mainnet rejection, stable lock inodes, backup folder preservation and orderly RPC-worker quiescence. Public-network deployment and payments require the VPS execution output.
