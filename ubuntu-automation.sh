#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
node --env-file=/etc/globaldroptrade/trades.env scripts/setup-automation.mjs
base=/opt/globaldroptrade-automation
release="$base/releases/$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 755 "$release/scripts"
cp scripts/daily-profit.mjs scripts/migration-journal.mjs scripts/migration-signers.mjs "$release/scripts/"
cp package.json package-lock.json "$release/"
(cd "$release" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
install -d -m 700 /var/lib/globaldroptrade/automation-v1
node_bin=$(command -v node)
case "$node_bin" in /root/*) echo 'System-readable Node is required'; exit 1;; esac
previous=$(readlink -f "$base/current" || true)
ln -sfn "$release" "$base/current"
cat > /etc/systemd/system/globaldroptrade-automation.service <<EOF
[Unit]
Description=Global daily plan credits and administrator-approved withdrawal payments
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
WorkingDirectory=$base/current
EnvironmentFile=/etc/globaldroptrade/trades.env
ExecStart=$node_bin $base/current/scripts/daily-profit.mjs --execute
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/globaldroptrade/automation-v1
UMask=0077
TimeoutStartSec=10min
EOF
cat > /etc/systemd/system/globaldroptrade-automation.timer <<'EOF'
[Unit]
Description=Check daily plan and approved withdrawals every five minutes
[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
AccuracySec=15s
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
if ! systemctl start globaldroptrade-automation.service; then
 if [ -n "$previous" ]; then ln -sfn "$previous" "$base/current"; fi
 echo 'Automation check failed; timer was not enabled. Inspect journalctl -u globaldroptrade-automation.'
 exit 1
fi
systemctl enable --now globaldroptrade-automation.timer
systemctl is-active --quiet globaldroptrade-automation.timer
echo 'GLOBAL_AUTOMATION_TIMER_ACTIVE'
