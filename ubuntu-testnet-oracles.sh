#!/usr/bin/env bash
# Maintain existing mock price timestamps on the pinned testnet vault.
set +x
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
for tool in systemctl flock install; do command -v "$tool" >/dev/null; done
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[ -x "$runtime/node" ] || { echo 'Existing Node runtime missing'; exit 1; }
export PATH="$runtime:$PATH"
envfile=/etc/globaldroptrade/trades.env
test -s "$envfile"
umask 077
state=/var/lib/globaldroptrade/oracle-maintenance-v1
install -d -m 700 "$state"
exec 9>"$state/setup.lock"
flock -n 9 || { echo 'Oracle maintenance setup is already running'; exit 1; }
release="/opt/globaldroptrade-oracles/releases/$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$release/scripts" "$release/artifacts"
install -m 600 package.json package-lock.json "$release/"
for file in maintain-testnet-oracles.mjs refresh-testnet-oracles.mjs migration-signers.mjs migration-journal.mjs; do
 install -m 600 "scripts/$file" "$release/scripts/$file"
done
install -m 600 artifacts/MockFeed.json "$release/artifacts/"
npm ci --prefix "$release" --omit=dev --ignore-scripts --no-audit --no-fund
node --env-file="$envfile" "$release/scripts/maintain-testnet-oracles.mjs" --check

service=globaldroptrade-oracles.service
timer=globaldroptrade-oracles.timer
backup="$state/install-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
was_enabled=0
systemctl is-enabled --quiet "$timer" 2>/dev/null && was_enabled=1
for unit in "$service" "$timer"; do
 if [ -f "/etc/systemd/system/$unit" ]; then cp -p "/etc/systemd/system/$unit" "$backup/$unit"; fi
done
rollback(){
 trap - ERR
 systemctl disable --now "$timer" 2>/dev/null || true
 systemctl stop "$service" 2>/dev/null || true
 for unit in "$service" "$timer"; do
  if [ -f "$backup/$unit" ]; then cp -p "$backup/$unit" "/etc/systemd/system/$unit"; else rm -f "/etc/systemd/system/$unit"; fi
 done
 systemctl daemon-reload
 if [ "$was_enabled" -eq 1 ]; then systemctl enable --now "$timer"; fi
 echo "Oracle service installation failed; previous units restored. Journal preserved: $state"
 exit 1
}
trap rollback ERR
systemctl stop "$timer" 2>/dev/null || true
systemctl stop "$service" 2>/dev/null || true
cat > "/etc/systemd/system/$service" <<UNIT
[Unit]
Description=GlobalDropTrade testnet mock oracle maintenance
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=root
UMask=0077
WorkingDirectory=$release
ExecStart=/usr/bin/flock -n $state/run.lock $runtime/node --env-file=$envfile $release/scripts/maintain-testnet-oracles.mjs
TimeoutStartSec=240
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$state
RestrictSUIDSGID=true
UNIT
cat > "/etc/systemd/system/$timer" <<UNIT
[Unit]
Description=Check GlobalDropTrade testnet mock prices every five minutes

[Timer]
OnBootSec=30s
OnCalendar=*:0/5
Persistent=true
RandomizedDelaySec=10s
Unit=$service

[Install]
WantedBy=timers.target
UNIT
chmod 644 "/etc/systemd/system/$service" "/etc/systemd/system/$timer"
systemctl daemon-reload
systemctl enable --now "$timer"
# A transient RPC failure must leave scheduled retries enabled and the signed journal intact.
trap - ERR
if ! systemctl start "$service"; then
 echo 'ORACLE_MAINTENANCE_INSTALLED_RETRY_PENDING — timer enabled; initial quote verification did not finish.'
 journalctl -u "$service" -n 15 --no-pager
 exit 1
fi
systemctl is-active --quiet "$timer"
echo 'GLOBAL_TESTNET_ORACLE_MAINTENANCE_READY'
echo 'Both quotes verified. Checks every 5 minutes; refresh only after half the allowed age.'
echo 'Only mock timestamps/rounds change; prices, vault rules and accounts are preserved.'
echo 'Cumulative maintenance fee ceiling: 0.1 test BNB. Keep the journal; this is testnet only.'
echo "Status: journalctl -u $service -n 20 --no-pager"
