# Global Drop Trade — independent testnet index catch-up

**Scope:** BNB Testnet chain 97, exact replacement-deployer vault `0x4C0F6141b18971db4b14e45c0bE8CddB09febc14` only. This release **does not** change the site's API, financial worker, contract, policies, historical credits or withdrawal approvals. It is **not** approval to begin mainnet payouts.

## Why

A five-minute financial worker can report `DAILY_MEMBER_INDEX_INCOMPLETE` forever while its member/position cursors remain behind a fixed confirmed target. The codebase includes an optimistic, signer-free indexer (`scripts/auto-index-new-deployer.mjs`), but the production snapshot did not show an independent timer for this module. Installing this timer separates history catch-up from payment scheduling.

Every run reads verified chain-97 logs and can commit **only** `registry`, `positionIndex`, and `positionScanTarget` in the existing journal through the shared worker PID lock and strict compare-and-swap; financial cursors, credits and transaction records are preserved. The systemd unit masks the new deployer's key file and prevents writes outside the existing index journal directory. It refuses changed chain identity, unconfirmed or reorged checkpoints, pending financial transactions, or stale source changes. RPC outages or insufficient history remain hard blockers.

## How to install after code review and green CI

Use a *new, clean* git checkout of the reviewed commit, with verified origin `https://github.com/Rezamoradifar/Gloucestershire.git`. The root-only guard requires the exact commit SHA explicitly:

```bash
export INDEX_EXPECTED_SHA="<approved 40-character commit SHA>"
export PATH="/opt/globaldroptrade-node/node-v22.23.3-linux-x64/bin:$PATH" # adapt to arm64
bash ubuntu-enable-new-deployer-index-worker.sh --check
bash ubuntu-enable-new-deployer-index-worker.sh --install
```

**Important:** replace the placeholder with the exact approved commit hash from the reviewed PR. Never populate this variable automatically from an unreviewed checkout. The installer stages a fresh immutable git archive in `/opt/globaldroptrade-readonly-index/releases/<sha>`, installs only production Node dependencies with lifecycle scripts disabled, runs the read-only live preflight and installs the dedicated `globaldroptrade-readonly-index.{service,timer}`. It does **not** reset or copy the existing financial journal, alter the API, or restart the payment timer. Re-running the same commit is idempotent; different existing units fail closed.

## Verify

```bash
systemctl is-active globaldroptrade-readonly-index.timer
systemctl status globaldroptrade-readonly-index.service --no-pager -l
journalctl -u globaldroptrade-readonly-index.service -n 60 --no-pager -o cat
```

Expected worker log: `INDEX_AUTO_RESULT` with `status: "committed"` on a confirmed progressive pass, or `no_progress`, `busy`, or `changed` without modifying financial records. Check the journal's member/position `through` fields on two separate passes; progress must move **toward the unchanged target**, not jump over missing logs. If either cursor stops moving, investigate `INDEX_AUTO_STOPPED` and RPC history support; never mark paid epochs by hand.

After both cursors reach their verified target, independently test the due-epoch planner, activity qualification, funding availability, referral shares, and owner-approved withdrawals. Confirm actual on-chain `ProfitCredited` events and no duplicate batch IDs before claiming payouts succeed.

## Disable the independent timer

```bash
systemctl disable --now globaldroptrade-readonly-index.timer
```

Disabling the timer stops future index passes; it **does not roll back or rewrite the journal**. Never restore an older journal while the payment worker may have advanced credits or transfers.