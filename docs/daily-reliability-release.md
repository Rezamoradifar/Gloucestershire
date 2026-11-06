# Existing-server daily reward reliability release

This release updates the API, website, reward worker and ordered scheduler for
the existing Global BNB testnet installation. It is pinned to chain ID `97` and
vault `0xB5c3C0f8fc30b2FDB8b16d2325127dAe7C8DCD5B`. The installer verifies the
deployed runtime and creation proofs before changing a service. A different
network, contract, financial policy, unmanaged source path or unverified RPC
stops the installation.

The installer does not open a signing key, deploy a contract, reset a journal,
fund an account, change a reward rate or replace an existing balance. After the
health gates pass, it starts the existing authorized worker through the ordered
coordinator. That worker may resume saved transactions and perform its normal
authorized operations. Successful installation is not proof of a credited
reward or a transfer to a user's wallet.

## Preserved financial rules

The existing test profile uses a `900` or `3600` second position anniversary
period. It applies the existing full test daily rate to each accelerated test
period. This release preserves that policy exactly. It does not reinterpret
the test period as a prorated fraction of a day. The separate mainnet daily
policy remains `86400` seconds; this installer cannot install a mainnet release.

The payment fixes persist the exact planned batches and their period context,
recover the same saved signed transaction, and continue unpaid periods in
bounded cycles. A service restart cannot replace a saved nonce or silently
advance an unpaid period. New rewards require the existing reward budget and
cash coverage after prior profit, fee reserves and pending withdrawals.

The existing cumulative `0.1` test BNB transaction fee limit remains in force.
Its reservation is the sum of every saved transaction's `maxFee`, including
confirmed transactions. Adding gas to the operator does not reset this
cumulative reservation. The release does not remove or raise that limit.

## Daily activity transition

New policy activation begins at the first verified confirmed checkpoint plus
`86400` seconds. This gives existing users a full transition window. Previously
owed periods keep their existing eligibility. From activation onward, the
worker applies the signed daily activity requirement to user reward recipients,
including referrals.

The API uses a wallet signature for activity confirmation. The activity route
does not request a token approval or a blockchain payment. Accepted activity is
stored in `/var/lib/globaldroptrade-api/daily-activity.json`, owned by the API
service with mode `0600` in its mode `0700` state directory. The API creates or
validates this file under its own service identity. The installer never
truncates, rewrites or restores accepted activity history.

The policy is `/etc/globaldroptrade/daily-activity-policy.json`, root-owned with
mode `0600`. A reinstall preserves its exact bytes and activation timestamp.
Public activation metadata is copied into the private systemd environment file
so the API does not need permission to read the worker policy. An explicitly
configured worker policy that is missing or invalid stops reward eligibility
processing.

## Required existing installation

Run the installer from a clean, root-owned checkout of the reviewed published
commit. Use the full 40-character commit in `--expected-revision`. Installation
with `--apply` requires this argument; the check mode accepts it and should use
the same value.

| Component | Required managed location or identity |
| --- | --- |
| Worker | `/opt/globaldroptrade-zero-daily/current` symlink into its own `releases` directory |
| API | `/opt/globaldroptrade-api/current` symlink into its own `releases` directory |
| Financial state | `/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1` |
| Financial files | Existing private `journal.json` and `daily-policy.json` |
| Deployment proofs | `/var/lib/globaldroptrade/fresh-fast-testnet-v1` |
| API configuration | `/etc/globaldroptrade/trades.env`, private and root-owned |
| API service identity | `globaldroptrade-api` |
| Nginx | Enabled managed `/etc/nginx/sites-available/globaldroptrade.com` |
| Existing website | One root under `/var/www/globaldroptrade/releases` |
| JavaScript runtime | System-readable Node 22.12 or later, preferring the existing managed Node 22.23.3 installation |

The installer requires at least 1 GiB free under `/opt`, locked npm dependency
files, and the normal `python3`, `npm`, `git`, `nginx`, `curl` and `systemctl`
commands. An unmanaged path is reported as a failure, rather than guessed or
created as a substitute for the live installation.

RPC candidates come from the existing private `TRADES_RPC_URL` and optional
JSON `TRADES_RPC_URLS` array. An additional operator-supplied candidate can be
read from an existing root-owned private file with `--rpc-file`. Up to four
candidates are accepted. Each must prove the same chain, contract, runtime,
fresh checkpoint, event reads and historical state needed for the existing
policy. Only verified candidates are written into the staged environment.
Credential-bearing URLs are excluded from terminal reports. A public endpoint
is never invented as a replacement for the worker's configured RPC.

## Check and install

Replace the value below with the exact published commit from the release
review. Use a separate checkout; do not edit a running release in place.

```bash
GLOBAL_DAILY_RELEASE_REVISION='<published-40-character-commit>'
sudo python3 scripts/install-daily-reliability.py \
  --check --expected-revision "$GLOBAL_DAILY_RELEASE_REVISION"
sudo python3 scripts/install-daily-reliability.py \
  --apply --expected-revision "$GLOBAL_DAILY_RELEASE_REVISION"
```

Omitting both mode flags runs the read-only check. It does not install
dependencies, change files or control services. The check reads private
configuration and the financial journal, verifies public chain state, and
prints a sanitized report. It requires root in order to read the existing
private files without changing their permissions.

### When RPC verification stops the release

`RELIABILITY_VERIFIED_RPC_REQUIRED` means that no configured candidate passed
every required check. It does not identify the underlying failure by itself.
The installer now prints a structured
`global-daily-reliability-preflight-failure` report before the final
`GLOBAL_DAILY_RELEASE_STOPPED` line, including when the initial preflight fails
before a private installation log has been created.

Each attempted candidate is identified by its zero-based index. Its `phase`,
`operation` and fixed `reason` describe the failing check. Recognized RPC and
HTTP status numbers, the relevant block number and the requested historical
timestamp are retained when available. Unknown fields and unrecognized codes
are discarded at both the Node and Python boundaries. The terminal report
excludes endpoint URLs, provider messages, credentials, environment values,
signed transaction bytes and calldata.

| Diagnostic evidence | Interpretation |
| --- | --- |
| `HISTORICAL_STATE_UNAVAILABLE` during a historical account or ledger read | The candidate did not supply the historical state required by the existing policy. |
| `AUTHENTICATION_REQUIRED` with HTTP 401 or 403 | The candidate rejected access. Verify its existing private configuration. |
| `RATE_LIMITED` or `TIMEOUT` | A bounded request failed because of provider limits or availability. |
| `CREATION_PROOF_UNAVAILABLE` | Required deployment transaction or receipt evidence could not be retrieved. |
| `TARGET_IDENTITY_MISMATCH` or `CANONICAL_MISMATCH` | Target identity or chain evidence failed verification; changing a reward policy cannot resolve this. |
| `STALE_CHECKPOINT` | The confirmed checkpoint did not satisfy the clock/freshness requirement. |

Use the same pinned `--check` command above to obtain the diagnostic without
installing anything. A failed initial preflight occurs before `STAGING`, so no
release files or scheduler state have been changed. `--apply` still stops on
the same verification failures. An alternative RPC must be supplied through
the existing private configuration or explicit `--rpc-file` and must pass all
of the same checks; this diagnostic change does not bypass any guard.

### Successful preflight observations

The report includes the reporter permission, pause state, aggregate asset
budgets and cash, pending withdrawal reserves, operator gas balance, saved fee
reservations, remaining fee budget, pending signed transaction count, verified
RPC count and activation timestamp. These are observations at the reported
checkpoint. A positive balance does not establish that the next transaction's
gas estimate fits the remaining budget.

Useful `waitingFor` diagnostics include:

| Diagnostic | Meaning |
| --- | --- |
| `REPORTER_AUTHORIZATION_REQUIRED` | The existing operator lacks the required reporter permission. |
| `CONTRACT_PAUSED` | The verified contract is paused. |
| `REWARD_BUDGET_EMPTY` | Both observed reward budgets are empty. |
| `VAULT_CASH_SHORTFALL` | Observed cash does not cover profit, fee reserves, pending withdrawals and the complete recorded reward budget. |
| `TOTAL_TEST_BNB_FEE_LIMIT_0_1` | Saved maximum fee reservations have exhausted the unchanged cumulative test fee cap. |
| `INSUFFICIENT_TEST_BNB` | The verified operator balance is zero. |

An installation can succeed while a funding or permission condition remains
waiting. Correct code and a running timer cannot satisfy an unfunded balance,
grant an unauthorized role or remove a transaction limit. The worker continues
to enforce its complete transaction and funding checks.

## Release sequence and verification

The installer builds immutable worker, API and website releases before pausing
any scheduler. It installs locked dependencies with lifecycle scripts disabled,
builds the frontend with the verified chain and vault, and preserves unrelated
website assets. Nginx TLS settings are retained. Existing RPC maintenance is
aligned to the same reviewed source so a later repair retains the activity
modules and durable payment helpers.

It pauses scheduling timers and waits for active worker, index, coordinator and
RPC transition services to finish. It never stops a running financial service.
The release then holds the existing financial lock inode and the connection
and setup locks, repeats the preflight, and records private backups of the exact
files and service states it will change.

Before starting the coordinator, local HTTPS checks require all of the
following:

- API liveness and configured status.
- The exact chain and vault from `/api/config`.
- A current `live` contract feed from `/api/trades?limit=1`, not just HTTP 200
  from the liveness route.
- The newly built website index served by the actual nginx root.
- JSON at both `/automation-data/activation.json` and
  `/deploy/zero-start-activation.json`, plus the API status fallback.
- Daily activity status with the exact chain, vault, `86400` second window,
  enabled requirement and preserved or newly staged activation timestamp.
- Unchanged financial journal and policy under the held lock.

Only `globaldroptrade-smart-worker.timer` schedules index and payment work
after the release. The signer-free coordinator orders the index before the
payment worker and waits for each stage. Independent legacy payment, index and
automation timers are disabled. An existing RPC maintenance timer retains its
prior active state.

Inspect the result using:

```bash
systemctl status globaldroptrade-smart-worker.timer --no-pager
journalctl -u globaldroptrade-smart-worker.service \
  -u globaldroptrade-zero-daily.service -n 40 --no-pager
curl --fail-with-body --silent --show-error \
  https://globaldroptrade.com/api/automation/status
```

The status API deliberately returns HTTP 503 when its worker evidence is
unavailable or stale. A waiting, indexing or blocked status may be valid before
the first updated worker cycle. Review the reported phase, blockers, freshness
and confirmed credit transaction hashes. A credited vault profit balance and
an approved withdrawal paid to a wallet are separate events.

## Failure handling and rollback

Private release backups are stored under
`/var/backups/globaldroptrade/daily-reliability`. The mode `0700` directory holds
the exact old code pointers, modified configurations, unit states and a private
installation log. Journal and financial policy copies are forensic snapshots;
they are excluded from the rollback manifest.

A dependency or build failure leaves the running services unchanged. If an
in-flight financial service remains busy, the installer leaves it running and
restores the prior timer state. Failures after switching files but before
scheduler activation automatically restore the old code, API configuration,
nginx configuration and timer states. Source restoration reacquires the same
stable financial locks. Accepted activity records and financial journal bytes
are never restored from backup.

Once scheduler activation may have started a transaction, the installer does
not switch old code underneath it. An activation failure pauses scheduling
timers, keeps the reviewed code and preserved journal, and prints
`RELEASE_INSTALLED_SCHEDULING_REVIEW_REQUIRED` with the backup location. Inspect
the existing saved transaction and the reported service failure, then re-run
the same pinned release after the underlying condition is fixed. Do not delete
the lock, clear fee reservations, reset a paid cursor, replace signed bytes or
copy a financial journal from a backup.

An interrupted or uncertain rollback prints `ROLLBACK_REQUIRES_REVIEW`. Keep
scheduling paused until the current code pointers, unit configuration, policy
and saved pending transaction have been reconciled. The release intentionally
provides no blind financial-state restore operation.

## Focused verification

```bash
python3 scripts/test-daily-reliability-installer.py
node --test test/daily-reliability-config.test.mjs
python3 test/smart-worker.test.py
sudo --preserve-env=PATH python3 scripts/test-api-installer.py
sudo --preserve-env=PATH python3 scripts/test-stage-zero-log-reader.py
sudo --preserve-env=PATH python3 scripts/test-zero-archive-rpc-repair.py
```

The release fixture exercises real staging, file modes, backups, symlink
switches, financial lock preservation and rollback against controlled service
and HTTP boundaries. It covers a pending signed transaction, preserved activity
history, unchanged activation on reinstall, wrong-chain rejection, busy workers,
dependency failure, feed failure, disabled activity, invalid nginx and failure
after scheduler activation. These tests establish installer behavior; they do
not establish that a live server has installed the release or paid a reward.
