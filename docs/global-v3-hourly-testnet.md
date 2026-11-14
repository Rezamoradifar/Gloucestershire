# Isolated one-hour BNB Testnet profile

The currently deployed V3 contract has an immutable 24-hour accrual period.
Running its keeper more often does not change that period. This profile deploys
a separate chain-97-only contract whose accrual period is 3,600 seconds, so one
eligible hourly test cycle applies one unchanged daily rate. The token must be
the fixed mock test token. The original deployment, 24-hour site, balances,
addresses, 10/10/80 routing and keeper are not modified. Current positions are
not copied: testers create new test positions in this separate contract.

The one-hour build is generated from the existing reviewed V3 source using
strict, unique substitutions. All other economic terms remain unchanged,
including the 24-real-hour check-in window, principal lock and withdrawal
cooldown. It is an accelerated accrual test, not a faithful real-time test of
those longer timers. Registration and check-in remain signed wallet actions.
Recorded claims and compound basis are not wallet cash or proof of business
profit. Real test-token withdrawal requires separate approval and funding.

## Activation

1. From the reviewed checkout, run `bash scripts/setup-v3-hourly-testnet.sh --prepare`
   in an interactive root terminal. It uses the previously pinned testnet-only
   deployer, checks its test BNB, asks for the exact deployment phrase and
   verifies the chain-97 deployment and receipt. An existing deployment intent
   is never overwritten or retried blindly.
2. The setup creates or preserves a **separate** gas-only testnet keeper wallet
   and prints its public address. Fund that wallet with test BNB; do not reveal
   its private key. The script starts a detached website install. Successful
   installation requires `V3_HOURLY_TESTNET_SITE_INSTALLED` in its journal;
   a started unit alone is not success.
3. Run `bash scripts/setup-v3-hourly-testnet.sh --start-keeper`. The isolated
   timer scans every two minutes; the contract itself allows one accrual per
   position only after a full hour. Each actual accrual resets that position's
   next hour. Check `--status` for the timer, result and real transaction hashes.
4. Open `/hourly-test/`, connect the desired BNB Testnet wallet, register or
   create a new mock-token test position and sign check-in. After two confirmed
   eligible cycles verify both `cumulativeDaily` and `cumulativeCompound`.
   The display's moving estimate is not an on-chain credit or payment.

The frontend verifies the hourly contract's deployment, runtime identity and
on-chain period before displaying account data or authorizing actions. The
separate website subfolder must not already exist and installation refuses a
conflict or unverified web root. A failed HTTP check removes only the newly
created hourly subfolder and preserves the existing site. Browser cache cleanup
is disabled on the isolated page so it cannot clear the current site's data.

Neither a local test nor a deployed hourly profile establishes production
readiness, a verified revenue source, funded withdrawals or a security audit.
