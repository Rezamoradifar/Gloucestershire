# V3 TESTNET keeper activation after website installation

The installed V3 website does not automatically install the hourly keeper. `systemctl is-enabled ...timer` returning `No such file or directory`, an inactive timer and an empty service journal do not show successful scheduled accrual. They indicate the expected unit is absent; inspect actual host state before claiming activation.

This change only concerns the off-chain TESTNET gas-only worker and its installer. It changes no Solidity bytecode, deployed address, website, users, fees, principal, Current balances or withdrawal permissions. The worker records daily and compound claims internally by calling permissionless `accrueDaily`. It cannot mint, transfer user tokens, approve withdrawals or pay them.

## Setup on the existing Global VPS

Use a separate checkout or the existing /opt/global-v3-auto at this reviewed commit. The installer restores the existing Node 22.23.3 path after an SSH reconnect.

1. `bash scripts/install-global-v3-keeper-timer.sh --init-wallet`
   - Creates a dedicated TESTNET gas-only wallet only if absent.
   - Preserves an existing key and prints only its public address.
   - The private key remains in /etc/globaldroptrade/v3-keeper-testnet-gas-only.key, root-only mode 0600. Never paste it into chat, source control, or screenshots.
2. Fund that public address with valueless BNB Testnet tBNB (chain 97), not real BNB, Tether or customer deposits. A starting balance such as 0.005 tBNB is only an operational example, not a guaranteed gas budget. The source may be a project testnet wallet under the operator's control. This is not treasury or user-profit funding.
3. `bash scripts/install-global-v3-keeper-timer.sh --check`
   - Sends no transaction and does not activate the timer.
   - Verifies chain 97, pinned V3 runtime, exact MOCK token, and absence of admin/manager/funder/guardian roles on the signer.
   - Requires an unpaused contract and at least 0.001 tBNB as the configured minimum balance. Actual per-transaction gas checks still apply; this minimum does not guarantee every queued account will be processed.
4. `bash scripts/install-global-v3-keeper-timer.sh --install`
   - Repeats the read-only checks and stops before installing if they fail.
   - Copies code and locked runtime dependencies into a separate immutable-release directory readable by the dynamic service user, without widening private key permissions.
   - Uses systemd DynamicUser, LoadCredential and a private state directory. Enables an hourly timer and requests one first service run. This may sign TESTNET accrual transactions for currently eligible accounts; it does not send tokens to user wallets.
   - Existing service files are never silently overwritten; concurrent installs are refused.
5. Check the actual host: `systemctl is-enabled global-v3-compound-keeper-testnet.timer`, `systemctl is-active global-v3-compound-keeper-testnet.timer`, and `journalctl -u global-v3-compound-keeper-testnet.service -n 60 --no-pager -o cat`.

## Interpret output accurately

- `V3_KEEPER_READINESS` / `ready:true`: preflight succeeded, not proof of a transaction.
- `V3_AUTO_COMPOUND_KEEPER_TIMER_INSTALLED`: timer activation succeeded, not proof of any credited account.
- `V3_FIRST_RUN_REQUESTED_NOT_YET_VERIFIED`: service was queued only.
- `V3_AUTO_COMPOUND_RUN_RESULT` with `NO_DUE_POSITIONS` and `sent:0`: no qualified position was due; no credit occurred.
- `SUCCESS` with `sent>0`: the worker checked successful receipts with the required confirmation depth and matched each DailyClaimAccrued event to its user and position. Independently verify the listed testnet transaction hashes and on-chain balances before accepting end-to-end behavior.
- `PARTIAL_REVIEW_REQUIRED`: do not assume every account was processed. Inspect the listed transaction hash and failure; no cursor advance occurs on errors.

Existing rules remain: recent user check-in and at least 24 hours since the position's last accrued period. Missed days are not backfilled. Hourly checks are not guaranteed exact credit times. Unfunded internal claims are not wallet cash or proof of investment revenue. Mainnet and real deposits remain unapproved.

The worker now pins actual transaction gas price, uses bounded receipt polling rather than a background ethers wait listener, and distinguishes an empty schedule from credited accounts. Local/CI tests do not substitute for a successful run of the actual VPS systemd service or public-testnet acceptance.
