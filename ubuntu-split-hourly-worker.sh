#!/usr/bin/env bash
# Existing chain-97 journal only. No deployment, reset, faucet or owner key.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
quarter=false
if [[ $# = 2 && $1 = --execute && $2 = --quarter-test ]]; then quarter=true; shift;set -- --execute;fi
[[ $# = 1 && $1 = --execute && $EUID = 0 ]] || { echo 'ROOT_EXPLICIT_EXECUTE_REQUIRED';exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x "$runtime/node" ]] || { echo 'MANAGED_NODE_REQUIRED';exit 1; }
export PATH="$runtime:$PATH"
state=/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1
base=/opt/globaldroptrade-zero-daily
[[ -d "$state" && -L "$base/current" ]] || { echo 'EXISTING_HOURLY_WORKER_REQUIRED';exit 1; }
[[ $(df -Pk /opt | awk 'NR==2 {print ($4>=524288)?1:0}') = 1 ]] || { echo 'SPLIT_REQUIRES_512_MIB_FREE';exit 1; }
install -d -m 700 /var/lib/globaldroptrade/worker-sync-v1
exec 8>/var/lib/globaldroptrade/worker-sync-v1/run.lock
flock -n 8 || { echo 'WORKER_SYNC_BUSY';exit 75; }
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
# Immutable creation proof first; this check never opens a signer.
node scripts/zero-start-automation.mjs --oracles-only --check --fast-testnet
node --input-type=module <<'JS'
import fs from 'node:fs';import {validateDailyPolicy} from './scripts/daily-profit.mjs';import {isPositionPolicy} from './scripts/position-profit.mjs';
const p=validateDailyPolicy(JSON.parse(fs.readFileSync('/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/daily-policy.json')));
if(p.chainId!==97||!isPositionPolicy(p)||![3600,900].includes(p.periodSeconds))throw Error('EXISTING_POSITION_HOURLY_POLICY_REQUIRED');
JS
phase=QUIESCING
worker_before=$(systemctl is-active globaldroptrade-zero-daily.timer 2>/dev/null || true)
rpc_before=$(systemctl is-active globaldroptrade-rpc-failover.timer 2>/dev/null || true)
index_before=$(systemctl is-active globaldroptrade-position-index.timer 2>/dev/null || true)
smart_before=$(systemctl is-active globaldroptrade-smart-worker.timer 2>/dev/null || true)
smart_enabled=$(systemctl is-enabled globaldroptrade-smart-worker.timer 2>/dev/null || true)
failed(){
 local code=$?
 if [[ $code != 0 ]]; then
  echo "SPLIT_INSTALL_FAILED phase=$phase exit=$code"
  if [[ $phase = QUIESCING ]]; then
   [[ $worker_before != active ]] || systemctl start globaldroptrade-zero-daily.timer || true
   [[ $rpc_before != active ]] || systemctl start globaldroptrade-rpc-failover.timer || true
   [[ $index_before != active ]] || systemctl start globaldroptrade-position-index.timer || true
   [[ $smart_before != active ]] || systemctl start globaldroptrade-smart-worker.timer || true
  else echo "SPLIT_REVIEW_REQUIRED backup=${backup:-unavailable}; financial journals were never restored or deleted";fi
 fi
}
trap failed EXIT
wait_idle(){
 local unit=$1 active attempt
 for ((attempt=0;attempt<120;attempt++)); do
  active=$(systemctl show "$unit" --property=ActiveState --value 2>/dev/null || true)
  case "$active" in inactive|failed|'') return;; active|activating|deactivating|reloading) ;; *) echo 'SPLIT_UNKNOWN_UNIT_STATE';return 1;;esac
  ((attempt%6!=0)) || echo "SPLIT_WAITING_FOR_RUNNING_UNIT unit=$unit"
  sleep 5
 done
 echo 'SPLIT_WORKER_BUSY_RETRY';return 75
}
if [[ $(systemctl show globaldroptrade-smart-worker.timer --property=LoadState --value) = loaded ]]; then
 systemctl stop globaldroptrade-smart-worker.timer
 wait_idle globaldroptrade-smart-worker.service
fi
if [[ $(systemctl show globaldroptrade-rpc-failover.timer --property=LoadState --value) = loaded ]]; then
 systemctl stop globaldroptrade-rpc-failover.timer
fi
wait_idle globaldroptrade-rpc-failover.service
systemctl stop globaldroptrade-zero-daily.timer
systemctl stop globaldroptrade-position-index.timer 2>/dev/null || true
wait_idle globaldroptrade-zero-daily.service
wait_idle globaldroptrade-position-index.service
# Preserve the stable financial lock inode and avoid racing a manual worker.
exec 9>"$state/run.lock"
flock -w 30 -E 75 9 || { echo 'SPLIT_JOURNAL_BUSY';exit 75; }
old=$(readlink -f "$base/current")
case "$old" in "$base"/releases/*) ;; *) echo 'MANAGED_RELEASE_REQUIRED';exit 1;;esac
stamp="$(date -u +%Y%m%dT%H%M%S)-$$"
backup="/var/lib/globaldroptrade/split-index-installs/$stamp"
install -d -m 700 "$backup"
printf '%s\n' "$old" > "$backup/previous-release"
cp -p "$state/journal.json" "$backup/journal-before.json"
[[ ! -f /etc/systemd/system/globaldroptrade-zero-daily.service.d/split-index.conf ]] || cp -p /etc/systemd/system/globaldroptrade-zero-daily.service.d/split-index.conf "$backup/previous-dropin"
for name in globaldroptrade-position-index.service globaldroptrade-position-index.timer; do
 [[ ! -f /etc/systemd/system/$name ]] || cp -p "/etc/systemd/system/$name" "$backup/$name"
done
release="$base/releases/split-index-$stamp"
cp -a "$old" "$release"
for name in daily-profit.mjs position-profit.mjs zero-start-automation.mjs zero-start-readiness.mjs complete-rpc-logs.mjs index-zero-positions.mjs; do
 install -m 644 "scripts/$name" "$release/scripts/$name"
 "$runtime/node" --check "$release/scripts/$name"
done
phase=FILES_CHANGED
if $quarter; then node scripts/install-quarter-policy.mjs --execute --locked-fd 9;fi
install -d -m 755 /etc/systemd/system/globaldroptrade-zero-daily.service.d
cat > /etc/systemd/system/globaldroptrade-zero-daily.service.d/split-index.conf <<UNIT
[Service]
ExecStart=
ExecStart=/usr/bin/flock -w 90 -E 75 $state/run.lock $runtime/node $base/current/scripts/zero-start-automation.mjs --execute --fast-testnet --hourly-test --indexed-payments
TimeoutStartSec=infinity
UNIT
cat > /etc/systemd/system/globaldroptrade-position-index.service <<UNIT
[Unit]
Description=Global testnet signer-free deposit and reinvestment index
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
UMask=0077
WorkingDirectory=$base/current
ExecStart=$runtime/node $base/current/scripts/index-zero-positions.mjs --execute --fast-testnet
TimeoutStartSec=infinity
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$state
InaccessiblePaths=-/etc/globaldroptrade/fresh-zero-automation.key -/etc/globaldroptrade/migration-deployer.key
UNIT
cat > /etc/systemd/system/globaldroptrade-position-index.timer <<'UNIT'
[Unit]
Description=Continue testnet indexing independently of payment cycles
[Timer]
OnBootSec=20s
OnUnitInactiveSec=20s
AccuracySec=2s
Unit=globaldroptrade-position-index.service
[Install]
WantedBy=timers.target
UNIT
# The financial worker's main timer already exists; shorten only its polling interval.
install -d -m 755 /etc/systemd/system/globaldroptrade-zero-daily.timer.d
[[ ! -f /etc/systemd/system/globaldroptrade-zero-daily.timer.d/split-index.conf ]] || cp -p /etc/systemd/system/globaldroptrade-zero-daily.timer.d/split-index.conf "$backup/previous-timer-dropin"
cat > /etc/systemd/system/globaldroptrade-zero-daily.timer.d/split-index.conf <<'UNIT'
[Timer]
OnBootSec=
OnUnitActiveSec=
OnUnitInactiveSec=
OnCalendar=
OnBootSec=30s
OnUnitInactiveSec=30s
AccuracySec=2s
UNIT
ln -s "$release" "$base/current.split-next"
mv -Tf "$base/current.split-next" "$base/current"
systemctl daemon-reload
flock -u 9
exec 9>&-
# Ship this same source for any future verified RPC switch, preserving the drop-in.
bash ubuntu-install-rpc-failover.sh --execute
if [[ $smart_before = active || $smart_enabled = enabled ]]; then
 systemctl disable --now globaldroptrade-position-index.timer globaldroptrade-zero-daily.timer
 systemctl enable --now globaldroptrade-smart-worker.timer
 systemctl start --no-block globaldroptrade-smart-worker.service
else
 systemctl enable --now globaldroptrade-position-index.timer globaldroptrade-zero-daily.timer
 systemctl start --no-block globaldroptrade-position-index.service
 systemctl start --no-block globaldroptrade-zero-daily.service
fi
phase=COMPLETE
echo "SPLIT_HOURLY_WORKER_INSTALLED backup=$backup"
echo 'Contract, policy, signed transactions and paid-hour cursors preserved. Inspect canonical live receipts; installation is not proof of a payout.'
