# Hourly testnet network volume processor

This optional worker processes pending V3 network-volume jobs beyond the first
eight ancestors handled by a deposit. It is restricted to the existing **separate
hourly BNB Testnet contract**, verified chain 97, the pinned mock token and the
existing hourly deployment proof. It calls only `processNetworkVolume` in
bounded batches. It does not create reward groups, prepare or claim network
rewards, approve withdrawals, transfer tokens, or pay users. Existing hourly
and 24-hour contracts, accounts, websites and keeper units are not modified.

Use a reviewed, clean checkout and the existing hourly proof and config. The
volume worker requires its own gas-only wallet, distinct from the profit
keeper; this avoids competing nonces. Never reveal, export or paste its private
key. With root access, from the reviewed checkout:

1. `bash scripts/v3-volume-install.sh --init-wallet` creates the separate key
   only if missing and prints its public address. Fund this address with a small
   amount of valueless BNB Testnet gas, not mainnet assets.
2. `bash scripts/v3-volume-install.sh --check` independently verifies the
   contract identity, deployment receipt, mock token, hourly period, signer
   roles and minimum gas. It does not send a transaction or install a timer.
3. `bash scripts/v3-volume-install.sh --install` repeats the checks, runs a
   disposable systemd credential probe and installs a separate two-minute
   timer. Installation requests a first run, but does not establish success.
4. `bash scripts/v3-volume-install.sh --status` shows the timer and journal.
   An empty queue is normal. Confirm an actual `V3_VOLUME_CONFIRMED` event and
   transaction before claiming that a pending volume job was processed.

The worker records an `INTENT` before broadcasting and a transaction hash after
broadcast. If an intent or receipt is unresolved, it leaves `pending.json` in
its isolated systemd state directory and stops. Inspect the chain, signer nonce
and receipt before any manual recovery; do not delete the file or retry blindly.
On-chain cursors prevent a completed ancestor from receiving volume twice, but
that does not make uncertain transaction outcomes safe to ignore.

Only testnet plumbing and test accounting are involved. A successful run does
not establish profitability, cash backing, funded withdrawals, production
readiness or an independent security review.
