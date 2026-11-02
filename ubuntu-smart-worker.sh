#!/usr/bin/env bash
# Install scheduling only. Existing services keep all signing and financial checks.
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[[ $EUID = 0 && $# = 1 && $1 = --execute ]] || { echo 'ROOT_EXPLICIT_EXECUTE_REQUIRED';exit 1; }
state=/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1
base=/opt/globaldroptrade-zero-daily
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
node_bin="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin/node"
[[ -x $node_bin && -L $base/current ]] || { echo 'EXISTING_MANAGED_WORKER_REQUIRED';exit 1; }
export PATH="$(dirname "$node_bin"):$PATH"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
# Refuse to schedule an older or different payment/index implementation.
for file in position-profit.mjs index-zero-positions.mjs zero-start-automation.mjs; do
 cmp -s "scripts/$file" "$base/current/scripts/$file" || { echo "CURRENT_WORKER_UPDATE_REQUIRED file=$file";exit 1; }
done
for unit in globaldroptrade-zero-daily.service globaldroptrade-position-index.service; do
 [[ $(systemctl show "$unit" -p LoadState --value) = loaded ]] || { echo 'VERIFIED_SERVICES_REQUIRED';exit 1; }
done
"$node_bin" --input-type=module <<'JS'
import fs from 'node:fs';
import {validateDailyPolicy} from './scripts/daily-profit.mjs';
import {isPositionPolicy} from './scripts/position-profit.mjs';
const p=validateDailyPolicy(JSON.parse(fs.readFileSync('/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/daily-policy.json')));
if(p.chainId!==97||!isPositionPolicy(p))throw Error('EXISTING_TESTNET_POSITION_POLICY_REQUIRED');
JS
install -d -m 700 /var/lib/globaldroptrade/smart-worker-v1
exec 8>/var/lib/globaldroptrade/smart-worker-v1/install.lock
flock -n 8 || { echo 'SMART_INSTALL_BUSY';exit 75; }
case "$(systemctl show globaldroptrade-smart-worker.service -p ActiveState --value)" in
 active|activating|deactivating|reloading) echo 'SMART_SERVICE_RUNNING';exit 75;;
esac
release="/opt/globaldroptrade-smart-worker/releases/$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 755 "$release"
install -m 644 scripts/smart-worker.py "$release/smart-worker.py"
python3 -m py_compile "$release/smart-worker.py"
backup="/var/backups/globaldroptrade/smart-worker-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
for timer in globaldroptrade-position-index.timer globaldroptrade-zero-daily.timer globaldroptrade-smart-worker.timer; do
 systemctl is-enabled "$timer" > "$backup/$timer.enabled" 2>/dev/null || true
 systemctl is-active "$timer" > "$backup/$timer.active" 2>/dev/null || true
done
for name in globaldroptrade-smart-worker.service globaldroptrade-smart-worker.timer; do
 if [[ -f /etc/systemd/system/$name ]]; then cp -p "/etc/systemd/system/$name" "$backup/$name";fi
done
recover(){
 trap - ERR
 case "$(systemctl show globaldroptrade-smart-worker.service -p ActiveState --value)" in
  active|activating|deactivating|reloading) echo "SMART_INSTALL_REVIEW_REQUIRED backup=$backup";exit 1;;
 esac
 for name in globaldroptrade-smart-worker.service globaldroptrade-smart-worker.timer; do
  if [[ -f $backup/$name ]]; then cp -p "$backup/$name" "/etc/systemd/system/$name";else rm -f "/etc/systemd/system/$name";fi
 done
 systemctl daemon-reload || true
 for timer in globaldroptrade-position-index.timer globaldroptrade-zero-daily.timer globaldroptrade-smart-worker.timer; do
  if grep -qx enabled "$backup/$timer.enabled";then systemctl enable "$timer" || true;fi
  if grep -qx active "$backup/$timer.active";then systemctl start "$timer" || true;fi
 done
 echo "SMART_INSTALL_FAILED previousSchedulingRestored=true backup=$backup"
 exit 1
}
trap recover ERR
# Stop scheduling, never terminate an in-flight financial service.
systemctl disable --now globaldroptrade-position-index.timer globaldroptrade-zero-daily.timer
cat > /etc/systemd/system/globaldroptrade-smart-worker.service <<UNIT
[Unit]
Description=Global testnet ordered indexing and payment coordinator
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
UMask=0077
ExecStart=/usr/bin/python3 $release/smart-worker.py
TimeoutStartSec=infinity
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/globaldroptrade/smart-worker-v1
InaccessiblePaths=-/etc/globaldroptrade/fresh-zero-automation.key -/etc/globaldroptrade/migration-deployer.key
UNIT
cat > /etc/systemd/system/globaldroptrade-smart-worker.timer <<'UNIT'
[Unit]
Description=Continue ordered testnet indexing and payments
[Timer]
OnBootSec=20s
OnUnitInactiveSec=20s
AccuracySec=2s
Unit=globaldroptrade-smart-worker.service
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now globaldroptrade-smart-worker.timer
systemctl start --no-block globaldroptrade-smart-worker.service
trap - ERR
echo "SMART_WORKER_INSTALLED backup=$backup"
echo 'Existing signatures, journals, policies, owner approval and RPC verification preserved.'
