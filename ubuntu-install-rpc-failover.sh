#!/usr/bin/env bash
# Install a separate guarded RPC rotation monitor for the existing testnet worker.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$#" -eq 1 ] && [ "$1" = --execute ] || { echo 'Usage: bash ubuntu-install-rpc-failover.sh --execute'; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo 'ROOT_REQUIRED'; exit 1; }
for tool in python3 systemctl tar date flock; do command -v "$tool" >/dev/null; done
install -d -m 700 /var/lib/globaldroptrade/rpc-failover-v1
exec 9>/var/lib/globaldroptrade/rpc-failover-v1/install.lock
flock -n 9 || { echo 'RPC_FAILOVER_INSTALL_BUSY'; exit 1; }
# Do not interrupt an earlier configuration transition on reinstallation.
case "$(systemctl show globaldroptrade-rpc-failover.service --property=ActiveState --value 2>/dev/null || true)" in
 active|activating|deactivating) echo 'RPC_FAILOVER_INSTALL_BUSY'; exit 1;;
esac
python3 - <<'PY'
import json,os,stat
from pathlib import Path
p=Path('/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/daily-policy.json')
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
with os.fdopen(fd) as f:
 s=os.fstat(f.fileno())
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077:raise SystemExit('PRIVATE_POLICY_REQUIRED')
 d=json.load(f)
if d.get('chainId')!=97 or d.get('periodSeconds')!=3600 or d.get('basis')!='position-anniversary-principal':raise SystemExit('EXISTING_HOURLY_TESTNET_POLICY_REQUIRED')
PY
umask 077
base=/opt/globaldroptrade-rpc-failover
release="$base/releases/$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$release"
# Keep the complete reviewed repair source; never copy dependencies or Git data.
tar --exclude='./.git' --exclude='./node_modules' --exclude='*/node_modules' \
 --exclude='./.runtime' --exclude='*/__pycache__' -cf - . | tar -xf - -C "$release"
cat > /etc/systemd/system/globaldroptrade-rpc-failover.service <<EOF
[Unit]
Description=Verified Global testnet RPC failover
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
UMask=0077
WorkingDirectory=$release
ExecStart=/usr/bin/python3 $release/scripts/zero-rpc-failover.py
TimeoutStartSec=infinity
EOF
cat > /etc/systemd/system/globaldroptrade-rpc-failover.timer <<'EOF'
[Unit]
Description=Check Global testnet RPC failover periodically
[Timer]
OnBootSec=3min
OnUnitInactiveSec=5min
RandomizedDelaySec=30s
Unit=globaldroptrade-rpc-failover.service
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now globaldroptrade-rpc-failover.timer
systemctl start --no-block globaldroptrade-rpc-failover.service
echo 'RPC_FAILOVER_MONITOR_INSTALLED: candidates require complete verification before cutover.'
echo 'RPC_FAILOVER_STATUS: journalctl -u globaldroptrade-rpc-failover.service -n 15 --no-pager'
