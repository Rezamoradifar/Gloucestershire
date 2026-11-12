#!/usr/bin/env bash
# Deploy the updated history UI and API, preserving the active vault and worker.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'ACCOUNT_HISTORY_ROOT_REQUIRED'; exit 1; }
[ "$#" -eq 1 ] || { echo 'Usage: bash ubuntu-account-history-install.sh --check|--install'; exit 1; }
case "$1" in --check|--install) mode="$1";; *) echo 'ACCOUNT_HISTORY_MODE_REQUIRED'; exit 1;; esac
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'UNSUPPORTED_CPU'; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for tool in node npm git realpath curl cmp find install cp nginx systemctl readlink flock; do
 command -v "$tool" >/dev/null || { echo "ACCOUNT_HISTORY_TOOL_REQUIRED_$tool"; exit 1; }
done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<12))throw Error("NODE_22_12_REQUIRED")'

envfile=/etc/globaldroptrade/trades.env
unit=/etc/systemd/system/globaldroptrade-api.service
[ -f "$envfile" ] && [ ! -L "$envfile" ] || { echo 'ACCOUNT_HISTORY_ENV_REQUIRED'; exit 1; }
[ -f "$unit" ] && [ ! -L "$unit" ] || { echo 'ACCOUNT_HISTORY_API_UNIT_REQUIRED'; exit 1; }
previous_api=$(readlink -f /opt/globaldroptrade-api/current)
[ -d "$previous_api" ] || { echo 'ACCOUNT_HISTORY_CURRENT_API_REQUIRED'; exit 1; }
# Refuse to overwrite an unfamiliar live API release with older source code.
live_api_sha=$(git hash-object "$previous_api/server/trades-api.mjs")
case "$live_api_sha" in
 13e11f9251a2434cfb8039276ce4cfc2c0aa8152|65e8fba4d20409564f7707d98808efa7aac56772|991727bce4b7ba9b5efa056e3173567b15eead91) ;;
 *) echo 'ACCOUNT_HISTORY_LIVE_API_VERSION_REVIEW_REQUIRED'; exit 1 ;;
esac
nginx -t

node --env-file="$envfile" --input-type=module - <<'JS'
import {readConfig} from './server/trades-api.mjs';
const c=readConfig();
if(c.chainId!==97||c.address?.toLowerCase()!=='0x4c0f6141b18971db4b14e45c0be8cddb09febc14'||
   c.port!==3115||!c.rpcUrl)throw Error('ACCOUNT_HISTORY_ACTIVE_TESTNET_TARGET_REQUIRED');
console.log('ACCOUNT_HISTORY_ACTIVE_CHAIN_97_VAULT_PINNED');
JS

# Build current source: the old bundled website release does not include this change.
npm ci --prefix website --ignore-scripts --no-audit --no-fund
npm run build --prefix website
[ -s website/dist/index.html ] || { echo 'ACCOUNT_HISTORY_BUILD_MISSING'; exit 1; }

stage=$(mktemp -d /opt/global-history-stage.XXXXXX)
chmod 700 "$stage"
trap 'rm -rf -- "$stage"' EXIT
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/ -o "$stage/served-before.html"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/api/config -o "$stage/config-before.json"
node --env-file="$envfile" --input-type=module - "$stage/config-before.json" <<'JS'
import fs from 'node:fs';
import {readConfig} from './server/trades-api.mjs';
const current=readConfig(),publicConfig=JSON.parse(fs.readFileSync(process.argv[2]));
if(publicConfig.version!==1||publicConfig.chainId!==current.chainId||
   publicConfig.vaultAddress?.toLowerCase()!==current.address.toLowerCase())
 throw Error('ACCOUNT_HISTORY_API_TARGET_MISMATCH');
JS

# Find the real served static root via exact byte comparison, not assumptions.
site_root=''
for index in /var/www/globaldroptrade/index.html /var/www/globaldroptrade/site/index.html \
 /var/www/globaldroptrade.com/index.html /var/www/html/index.html; do
 if [ -f "$index" ] && [ ! -L "$index" ] && cmp -s "$index" "$stage/served-before.html"; then
  [ -z "$site_root" ] || { echo 'ACCOUNT_HISTORY_AMBIGUOUS_SITE_ROOT'; exit 1; }
  site_root=$(dirname -- "$index")
 fi
done
[ -n "$site_root" ] || { echo 'ACCOUNT_HISTORY_SITE_ROOT_NOT_VERIFIED'; exit 1; }
[ ! -L "$site_root" ] && [ "$(stat -c %u "$site_root")" -eq 0 ] ||
 { echo 'ACCOUNT_HISTORY_SITE_ROOT_UNSAFE'; exit 1; }

echo 'ACCOUNT_HISTORY_BUILD_AND_SITE_PREFLIGHT_PASS'
if [ "$mode" = --check ]; then
 echo 'ACCOUNT_HISTORY_CHECK_PASS'
 echo 'No site, API, timer, private key, or financial journal was modified.'
 exit 0
fi

lockdir=/var/lib/globaldroptrade/account-history-install
install -d -m 700 "$lockdir"
exec 9>"$lockdir/installer.lock"
flock -n 9 || { echo 'ACCOUNT_HISTORY_INSTALL_ALREADY_RUNNING'; exit 1; }

backup="/var/backups/globaldroptrade/account-history-$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 700 "$backup" "$backup/previous-site"
cp -p "$envfile" "$backup/trades.env"
cp -p "$unit" "$backup/api.service"
printf '%s\n' "$previous_api" > "$backup/previous-api.txt"
printf '%s\n' "$site_root" > "$backup/site-root.txt"
cp -p "$stage/config-before.json" "$backup/config-before.json"
: > "$backup/overwritten.bin"

changed=0
restore(){
 local result=0 relative
 while IFS= read -r -d '' relative; do
  cp -p "$backup/previous-site/$relative" "$site_root/$relative" || result=1
 done < "$backup/overwritten.bin"
 cp -p "$backup/api.service" "$unit" || result=1
 ln -sfn "$previous_api" /opt/globaldroptrade-api/current || result=1
 if ! cmp -s "$envfile" "$backup/trades.env"; then
  cp -p "$backup/trades.env" "$envfile" || result=1
 fi
 systemctl daemon-reload || result=1
 systemctl restart globaldroptrade-api || result=1
 nginx -t && systemctl reload nginx || result=1
 if [ "$result" -eq 0 ]; then
  echo "ACCOUNT_HISTORY_PREVIOUS_RELEASE_RESTORED backup=$backup"
 else
  echo "ACCOUNT_HISTORY_ROLLBACK_REVIEW_REQUIRED backup=$backup" >&2
 fi
 return "$result"
}
cleanup(){
 local status=$?
 trap - EXIT
 if [ "$changed" -eq 1 ]; then restore || status=1; fi
 rm -rf -- "$stage"
 exit "$status"
}
trap - EXIT
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# The existing installer stages a new API release with the new route.
changed=1
bash ubuntu-api.sh
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/api/config -o "$stage/config-after.json"
cmp -s "$stage/config-before.json" "$stage/config-after.json" ||
 { echo 'ACCOUNT_HISTORY_CONTRACT_TARGET_CHANGED'; exit 1; }

# Verify live historical RPC coverage before making a new UI visible.
curl -fsS --noproxy '*' --max-time 90 --resolve globaldroptrade.com:443:127.0.0.1 \
 'https://globaldroptrade.com/api/account-history?wallet=0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632&limit=1' \
 -o "$stage/history-smoke.json"
node --input-type=module - "$stage/history-smoke.json" <<'JS'
import fs from 'node:fs';
const result=JSON.parse(fs.readFileSync(process.argv[2]));
if(result.version!==1||result.chainId!==97||
 result.vaultAddress?.toLowerCase()!=='0x4c0f6141b18971db4b14e45c0be8cddb09febc14'||
 !Array.isArray(result.items)||result.items.length>1)
 throw Error('ACCOUNT_HISTORY_API_SMOKE_INVALID');
console.log('ACCOUNT_HISTORY_API_READ_ONLY_PASS');
JS

# Copy new hashed assets first, index.html last. Leave automation-data intact.
copy_one(){
 local source=$1 relative target
 relative=$(realpath --relative-to=website/dist "$source")
 target="$site_root/$relative"
 if [ -e "$target" ] || [ -L "$target" ]; then
  [ -f "$target" ] && [ ! -L "$target" ] || { echo 'ACCOUNT_HISTORY_UNSAFE_SITE_ENTRY'; return 1; }
  install -d -m 755 "$backup/previous-site/$(dirname "$relative")"
  cp -p "$target" "$backup/previous-site/$relative"
  printf '%s\0' "$relative" >> "$backup/overwritten.bin"
 fi
 install -d -m 755 "$(dirname "$target")"
 install -m 644 "$source" "$target"
}
while IFS= read -r -d '' file; do
 [ "$file" = website/dist/index.html ] || copy_one "$file"
done < <(find website/dist -type f -print0)
copy_one website/dist/index.html

curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/ -o "$stage/served-after.html"
cmp -s website/dist/index.html "$stage/served-after.html" ||
 { echo 'ACCOUNT_HISTORY_FRONTEND_NOT_SERVED'; exit 1; }
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/api/health -o "$stage/health-after.json"
node --input-type=module - "$stage/health-after.json" <<'JS'
import fs from 'node:fs';
const state=JSON.parse(fs.readFileSync(process.argv[2]));
if(state.status!=='ok'||state.configured!==true)throw Error('ACCOUNT_HISTORY_API_UNHEALTHY');
JS

changed=0
trap - EXIT INT TERM HUP
rm -rf -- "$stage"
echo 'ACCOUNT_HISTORY_SITE_AND_API_INSTALLED'
echo "BACKUP_PATH=$backup"
echo 'Contract, testnet reward timer and financial journal were not reset.'
