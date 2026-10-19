# Fresh rewards vault on BNB Testnet

Run `bash ubuntu-fresh-rewards.sh` on the existing server. This is a new empty
DeferredRewardsVault, not TestnetMigratedRewardsVault. No users, balances,
positions or network volume are copied. No transaction is sent to the old vault.
Only token, oracle, seven partner and operations settings are read for the new
constructor. Economic settings start at the compiled new contract defaults.

Chain is pinned to 97, owner to 0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632,
and deployer to 0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2. Existing test deployer
key files are reused, and no owner key is read. The new contract starts active.
The deployer has no owner privileges. Unfunded rewards accrue to profit, and
profit withdrawals use the separate 72-hour queue.

The private, resumable transaction journal is
`/var/lib/globaldroptrade/fresh-rewards-v1/journal.json`; do not delete it on
failure. Repeated execution reuses the same signed deployment transaction.
The fee ceiling is 0.1 test BNB. Three confirmations and deployment-block
checks are required. Inspect `journalctl -u globaldroptrade-fresh-rewards`.
Share only `deployment-public.json` from the same directory for site cutover.
The installer does not switch the website/API, remove legacy data or move funds.
If the old vault was paused manually, this command leaves it paused.
