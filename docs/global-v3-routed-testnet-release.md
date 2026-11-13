# Separate routed V3 TESTNET release

The previous V3 test contract was already deployed with different deposit
routing. It cannot be changed in place. This release preserves that contract,
its operator proof, the existing V2 installation and all old data. It uses a
new, fixed proof path and a separate keeper configuration for the corrected
10% / 10% / 80% mock-token contract.

The new release is TESTNET only, not for real USDT or valuable assets. Mock
token balances and accrued claims do not prove cash backing or earned revenue.

## Preconditions and no-duplicate behavior

- The old V3 proof must be root-private and must match the confirmed BNB
  Testnet receipt, runtime hash, token, fee receiver and manager.
- A same-block read of the old V3 must show zero registered members, zero
  withdrawal requests, zero principal/profit liabilities, zero escrow and zero
  mock-token balance and zero native BNB. If any are nonzero, stop and reconcile before switching.
- The check runs during preflight, before deployment, before site verification,
  and again just before the site's served files are changed. The old contract
  remains on chain and can still be interacted with; snapshots do not freeze it.
- A separate root-private proof file prevents a second routed deployment. If an
  intent/receipt needs review, the script stops rather than deleting a marker or
  issuing another transaction.
- The pinned earlier TESTNET deployer is used for the new contract, subject to
  a read-only balance/gas check and an interactive exact confirmation phrase.
- Website installation is detached, backed up and rollback-protected. Success is
  `V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED` in the recorded systemd journal.

The new contract currently supports only the pinned 18-decimal MOCK test token;
native BNB deposits and a real price oracle are not implemented. Independent
security/economic review and public-chain testing remain required.

## Automatic accounting

The release does not silently enable a keeper. After a verified new contract is
installed, use `GLOBAL_V3_RELEASE_PROFILE=routed-testnet bash scripts/install-global-v3-keeper-timer.sh --init-wallet`
to create a separate gas-only testnet keeper if it does not already exist. Fund
its public address with valueless tBNB; then run the same script with `--check`
and `--install`. The routed profile uses its own key, config, service, cursor and
release directory, so it does not overwrite the old V3 keeper. Check-in and a
valid 24-hour period remain required. Recording Internal Current does not send
tokens to a user's external wallet.
