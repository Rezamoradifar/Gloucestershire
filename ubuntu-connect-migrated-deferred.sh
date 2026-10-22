#!/usr/bin/env bash
# Connect an independently verified, paused testnet state copy; never sign transactions.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for tool in node npm nginx curl python3 systemctl flock; do command -v "$tool" >/dev/null; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("Node 22.12+ required")'
[[ "${MIGRATED_VAULT_TX:-}" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo 'Set MIGRATED_VAULT_TX to the verified copied deployment transaction'; exit 1; }
envfile=/etc/globaldroptrade/trades.env
unit=/etc/systemd/system/globaldroptrade-api.service
test -s "$envfile" && test -f "$unit"
previous=$(readlink -f /opt/globaldroptrade-api/current)
test -d "$previous"
nginx -t
node --input-type=module - <<'JS'
import fs from 'node:fs';
const dir='/var/lib/globaldroptrade/deferred-cutover';fs.mkdirSync(dir,{recursive:true,mode:0o700});
const s=fs.lstatSync(dir);if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_CUTOVER_DIRECTORY_REQUIRED');
const file=dir+'/run.lock';if(fs.existsSync(file)){const l=fs.lstatSync(file);if(!l.isFile()||l.uid!==0||(l.mode&0o077)!==0)throw Error('PRIVATE_CUTOVER_LOCK_REQUIRED');}
JS
umask 077
exec 9>/var/lib/globaldroptrade/deferred-cutover/run.lock
flock -n 9 || { echo 'Another copied-contract connection is running'; exit 1; }
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
node scripts/connect-migrated-deferred.mjs prepare "$stage"
backup="/var/backups/globaldroptrade/deferred-connection-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
cp -a /etc/nginx "$backup/nginx"
cp -p "$envfile" "$backup/trades.env"
cp -p "$unit" "$backup/api.service"
marker=/var/www/globaldroptrade/migration-data/deferred-connection.json
if [ -f "$marker" ]; then cp -p "$marker" "$backup/deferred-connection.json"; fi
rollback(){
 trap - ERR
 cp -a "$backup/nginx/." /etc/nginx/
 cp -p "$backup/trades.env" "$envfile"
 cp -p "$backup/api.service" "$unit"
 ln -sfn "$previous" /opt/globaldroptrade-api/current
 if [ -f "$backup/deferred-connection.json" ]; then cp -p "$backup/deferred-connection.json" "$marker"; else rm -f -- "$marker"; fi
 systemctl daemon-reload
 systemctl restart globaldroptrade-api || true
 nginx -t && systemctl reload nginx || true
 echo "Copied-contract connection failed; previous API, target and Nginx restored. Backup: $backup"
 exit 1
}
trap rollback ERR
node scripts/connect-migrated-deferred.mjs check "$stage"
install -m 600 "$stage/trades.env" "$envfile"
GLOBAL_SKIP_AUTOMATION=1 bash ubuntu-unified.sh
python3 scripts/install-deferred-console.py
curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/api/config -o "$stage/active.json"
node --input-type=module - "$stage/deferred-connection.json" "$stage/active.json" <<'JS'
import fs from 'node:fs';
const [r,c]=process.argv.slice(2).map(file=>JSON.parse(fs.readFileSync(file)));
if(c.version!==1||c.chainId!==97||c.vaultAddress.toLowerCase()!==r.target.toLowerCase())throw Error('ACTIVE_COPIED_TARGET_MISMATCH');
JS
node scripts/connect-migrated-deferred.mjs publish "$stage"
trap - ERR
echo "MIGRATED_SITE_CONNECTED_OWNER_ACTIVATION_REQUIRED backup=$backup"
echo 'https://globaldroptrade.com/deploy/deferred-migration.html'
echo 'Copied contract remains paused. Owner activation, funded budget and reporter authorization are separate wallet actions.'
