# Routed V3 testnet digital dashboard and keeper

This release updates the verified V3 website and the optional gas-only keeper.
It does not redeploy or modify the contract, transfer deposits, or change the
original two 10% shares and the 80% operations destination.

The dashboard shows recorded internal claims from a verified chain snapshot.
When the page is visible it refreshes the snapshot every 20 seconds, avoiding
overlapping automatic reads. The daily timer advances every second. Its live
progress number is a conditional visual estimate between accruals; it is not a
claim, wallet payment, guaranteed business profit, or an on-chain transaction.

The keeper has an isolated routed profile, state directory, testnet-only
gas key, proof and service names. On each run, the proof must match the fixed
config, confirmed creation receipt and runtime code, and the testnet contract
must return both original fee addresses and operations address with a 10% fee
for each. It may only record eligible 24-hour claims through the permissionless
testnet method; it cannot approve or pay withdrawals. Its bounded scan pages
over positions, retaining a page until all selected due transactions have been
processed. Empty scans are explicitly reported as `NO_DUE_POSITIONS`.

## Release and activation order

1. Use the verified-site-only release path and confirm the detached journal
   contains `V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED`. Do not redeploy V3.
2. With `GLOBAL_V3_RELEASE_PROFILE=routed-testnet`, run the keeper installer
   with `--init-wallet`. It creates a separate key only when missing, preserves
   an existing one, and prints only the public testnet address.
3. Add a small amount of valueless BNB Testnet gas to that public address.
   Never post or copy the private key. This is not withdrawal funding.
4. Run `--check`. It requires the site's completed install marker, a private
   matching proof, verified chain 97 identity, the original payment map, an
   unpaused contract, no privileged keeper roles, and at least 0.001 tBNB.
5. Run `--install` only after readiness. It installs an isolated hourly timer
   and requests an initial run; review the journal for the actual outcome.

`V3_FIRST_RUN_REQUESTED_NOT_YET_VERIFIED` only means a run was queued.
`NO_DUE_POSITIONS` means no claim was credited. A `SUCCESS` with transaction
hashes means the keeper found matching confirmed testnet accrual events; verify
the event and internal account values before treating the cycle as accepted.
No unattended accrual is proven until the VPS timer and actual run are checked.

These changes and all associated test tokens remain on BNB Testnet. Public
testnet acceptance, gas funding and independent security and economic review
are still needed before any real-asset launch.
