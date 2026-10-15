# Approved fresh testnet vault

Owner: `0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632`.
Previous vault: `0x7f19354B765920B9b17003d0840EEaA133883DcA`.
Chain: BNB Testnet 97 only. No mainnet deployment is included. Future deployment configuration examples (including the unsigned mainnet example) use the explicitly approved owner; no existing contract ownership is changed.

The script deploys one model-2 vault using the previous vault's USDT, mock feeds, maximum oracle age, seven partners and operations wallet. The new owner is also the initial sales reporter. It verifies constructor provenance, owner/model/assets/partners and unchanged governed settings before exporting a public report. Existing settings that differ from constructor defaults stop the connection rather than being silently replaced.

This is a fresh vault, not a migration. New contract accounts start empty. Old principal/profit/referrals remain in the previous contract. The frontend provides an explicit Previous contract accounts switch with the previous address fixed at build time; URL input cannot select arbitrary contracts. New deposits through this legacy view are disabled, while old position/withdrawal actions remain available subject to the old contract's rules and liquidity.

The existing server test deployer key is read locally from `/root/global-testnet-v071/.testnet-server/deployer.key`; it is never printed, exported or committed. A journal containing the signed creation transaction is written privately before broadcast, so a rerun reuses the same transaction instead of deploying again. The public report is `/root/global-testnet-v071/.testnet-server/owner-v2-5bc282-20261015/deployment-public.json` and contains no raw transaction or private key.

Deployment gas is capped at 0.028 tBNB and 3 gwei. Necessary refreshes of the two existing mock feeds are capped at 0.001 tBNB each. The test deployer must have at least 0.03 tBNB for a new attempt. These are test assets, not dollar costs. Mock prices still expire after the configured maximum age and require the existing refresh process.

The connection installer builds before signing, reuses the previous frontend dependencies, verifies the new report, rebuilds with the new address, updates the support API owner target and publishes with the old-vault switch. API environment backups are private. Installation failure restores the previous API target; deployment journals/reports are preserved. This cannot reverse a mined deployment.

Validation: local EVM deployment with independent new owner, preserved old balances/assets, reporter/model checks, resume without duplicate deployment, journal mismatch/wrong-chain rejection and private/public report checks; frontend tests for the fixed-address legacy switch; existing frontend regression suite and production build. No live deployment has been executed by the assistant. Run `bash ubuntu-deploy-owner-v2.sh` on the authorized existing server.
