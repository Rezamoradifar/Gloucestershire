#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run: sudo bash ubuntu-api.sh'; exit 1; }
for tool in node npm systemctl curl install; do command -v "$tool" >/dev/null || { echo "Missing required command: $tool (Node.js 20+ required)"; exit 1; }; done
node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'
api_root=/opt/globaldroptrade-api
release="$api_root/releases/$(date -u +%Y%m%dT%H%M%S)-$$"
envfile=/etc/globaldroptrade/trades.env
unit=/etc/systemd/system/globaldroptrade-api.service
backup_dir=$(mktemp -d)
trap 'rm -rf -- "$backup_dir"' EXIT
install -d -m 755 "$release/server" /etc/globaldroptrade
cp server/trades-api.mjs "$release/server/"
cp package.json package-lock.json "$release/"
(cd "$release" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
if [ ! -f "$envfile" ]; then install -m 600 server/trades.env.example "$envfile"; fi
chmod 600 "$envfile"
id globaldroptrade-api >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin globaldroptrade-api
node_bin=$(command -v node)
case "$node_bin" in /root/*) echo 'Install Node in a system-readable path (for example /usr/bin/node); the service cannot read /root.'; exit 1;; esac
# Validate dotenv through Node itself; never execute it as shell code or print credentials.
node --env-file="$envfile" --input-type=module -e "import {readConfig} from '$release/server/trades-api.mjs'; const c=readConfig(); if(c.port!==3115)throw Error('The bundled Nginx proxy requires port 3115');"
previous=$(readlink -f "$api_root/current" 2>/dev/null || true)
existed=0
if [ -f "$unit" ]; then cp -p "$unit" "$backup_dir/original.service"; existed=1; fi
cat > "$backup_dir/new.service" <<EOF
[Unit]
Description=Global Drop Trade read-only settlement API
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=globaldroptrade-api
Group=globaldroptrade-api
WorkingDirectory=$api_root/current
EnvironmentFile=$envfile
ExecStart=$node_bin $api_root/current/server/trades-api.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
install -m 644 "$backup_dir/new.service" "$unit"
ln -sfn "$release" "$api_root/current"
rollback() {
 if [ -n "$previous" ]; then ln -sfn "$previous" "$api_root/current"; fi
 if [ "$existed" -eq 1 ]; then cp -p "$backup_dir/original.service" "$unit"; else systemctl stop globaldroptrade-api || true; rm -f "$unit"; fi
 systemctl daemon-reload
 if [ "$existed" -eq 1 ]; then systemctl restart globaldroptrade-api || true; fi
}
if ! systemctl daemon-reload || ! systemctl enable globaldroptrade-api || ! systemctl restart globaldroptrade-api; then rollback; echo 'API startup failed; previous service restored.'; exit 1; fi
ready=0
for attempt in 1 2 3 4 5; do
 if curl -fsS --max-time 3 http://127.0.0.1:3115/api/health >/dev/null; then ready=1; break; fi
 sleep 1
done
if [ "$ready" -ne 1 ]; then rollback; echo 'API health check failed; previous service restored.'; exit 1; fi
echo 'Settlement API installed. Configure /etc/globaldroptrade/trades.env with the verified RPC, chain and contract; restart globaldroptrade-api after editing.'
echo 'No wallet or transaction signing is used. An unconfigured feed displays no trades.'
