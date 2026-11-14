#!/usr/bin/env bash
# Install only the read-only commerce API into a known existing API release.
# Does not change the website, account data, signer, chain, unit or environment.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")/.."
[[ "$(id -u)" -eq 0 ]] || { echo COMMERCE_API_ROOT_REQUIRED; exit 1; }
[[ $# -eq 1 && ( "$1" == --check || "$1" == --install ) ]] || { echo 'Usage: --check|--install'; exit 1; }
[[ "${GLOBAL_COMMERCE_EXPECTED_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || { echo COMMERCE_PINNED_SHA_REQUIRED; exit 1; }
[[ "$(git rev-parse HEAD)" == "$GLOBAL_COMMERCE_EXPECTED_SHA" ]] || { echo COMMERCE_SHA_MISMATCH; exit 1; }
case "$(uname -m)" in x86_64) commerce_arch=x64;; aarch64|arm64) commerce_arch=arm64;; *) echo COMMERCE_UNSUPPORTED_ARCH; exit 1;; esac
commerce_runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$commerce_arch/bin"
[[ ! -x "$commerce_runtime/node" ]] || export PATH="$commerce_runtime:$PATH"
for commerce_tool in node git curl systemctl flock stat readlink realpath install cp cmp grep; do
 command -v "$commerce_tool" >/dev/null || { echo "COMMERCE_MISSING_$commerce_tool"; exit 1; }
done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("COMMERCE_NODE_22_12_REQUIRED")'
commerce_root=/opt/globaldroptrade-api
commerce_current="$commerce_root/current"
commerce_releases="$commerce_root/releases"
commerce_env=/etc/globaldroptrade/trades.env
commerce_unit=/etc/systemd/system/globaldroptrade-api.service
[[ -L "$commerce_current" && -d "$commerce_releases" && ! -L "$commerce_releases" ]] || { echo COMMERCE_EXISTING_API_REQUIRED; exit 1; }
[[ -f "$commerce_env" && ! -L "$commerce_env" && "$(stat -c %u "$commerce_env")" == 0 ]] || { echo COMMERCE_ENV_REQUIRED; exit 1; }
commerce_env_mode=$(stat -c %a "$commerce_env")
[[ "$commerce_env_mode" =~ ^[0-7]{3,4}$ && "$((8#$commerce_env_mode & 0077))" -eq 0 ]] || { echo COMMERCE_ENV_PERMISSIONS_UNSAFE; exit 1; }
[[ -f "$commerce_unit" && ! -L "$commerce_unit" ]] || { echo COMMERCE_API_UNIT_REQUIRED; exit 1; }
grep -Eq '^WorkingDirectory=/opt/globaldroptrade-api/current$' "$commerce_unit" || { echo COMMERCE_API_UNIT_REVIEW_REQUIRED; exit 1; }
grep -Eq '^ExecStart=[^[:space:]]+[[:space:]]+/opt/globaldroptrade-api/current/server/trades-api\.mjs$' "$commerce_unit" || { echo COMMERCE_API_UNIT_REVIEW_REQUIRED; exit 1; }
systemctl is-active --quiet globaldroptrade-api || { echo COMMERCE_API_NOT_ACTIVE; exit 1; }
commerce_previous="$(readlink -f "$commerce_current")"
case "$commerce_previous" in "$commerce_releases"/*) ;; *) echo COMMERCE_API_RELEASE_PATH_UNSAFE; exit 1;; esac
[[ -d "$commerce_previous" && -f "$commerce_previous/server/trades-api.mjs" && ! -L "$commerce_previous/server/trades-api.mjs" ]] || { echo COMMERCE_API_RELEASE_INVALID; exit 1; }
[[ -d "$commerce_previous/server" && ! -L "$commerce_previous/server" &&
 "$(stat -c %u "$commerce_releases")" == 0 && "$(stat -c %u "$commerce_previous")" == 0 &&
 "$(stat -c %u "$commerce_previous/server")" == 0 &&
 "$(stat -c %u "$commerce_previous/server/trades-api.mjs")" == 0 ]] || { echo COMMERCE_API_OWNERSHIP_UNSAFE; exit 1; }
for commerce_path in "$commerce_releases" "$commerce_previous" "$commerce_previous/server" "$commerce_previous/server/trades-api.mjs"; do
 commerce_mode=$(stat -c %a "$commerce_path")
 [[ "$commerce_mode" =~ ^[0-7]{3,4}$ && "$((8#$commerce_mode & 0022))" -eq 0 ]] || { echo COMMERCE_API_PERMISSIONS_UNSAFE; exit 1; }
done
[[ -d "$commerce_previous/node_modules" && ! -L "$commerce_previous/node_modules" ]] || { echo COMMERCE_API_DEPENDENCIES_MISSING; exit 1; }
[[ "$(git hash-object "$commerce_previous/server/trades-api.mjs")" == 5cae7c3c414386fecb82a0226b43237c3445001d ]] || { echo COMMERCE_LIVE_API_VERSION_REVIEW_REQUIRED; exit 1; }
[[ ! -e "$commerce_previous/server/commerce-ebay.mjs" && ! -L "$commerce_previous/server/commerce-ebay.mjs" ]] || { echo COMMERCE_EXISTING_MODULE_REVIEW_REQUIRED; exit 1; }
# A release-directory switch must not redirect a relative customer-data path.
node --env-file="$commerce_env" --input-type=module - <<'JS'
import path from 'node:path';
for(const key of ['COMMUNITY_DATA_FILE','V2_COMMUNITY_DATA_FILE','DAILY_ACTIVITY_FILE','GLOBAL_AUTOMATION_PUBLIC_STATUS']){
 if(process.env[key]&&!path.isAbsolute(process.env[key])){
  console.error('COMMERCE_RELATIVE_DATA_PATH_REVIEW_REQUIRED='+key);process.exitCode=1;
 }
}
JS
node --check server/trades-api.mjs
node --check server/commerce-ebay.mjs
node --test test/commerce-ebay.test.mjs
commerce_stage=$(mktemp -d /opt/global-commerce-check.XXXXXX)
trap 'rm -rf -- "$commerce_stage"' EXIT
cp -p -- "$commerce_env" "$commerce_stage/env-before"
curl -fsS --noproxy '*' --max-time 10 http://127.0.0.1:3115/api/health -o "$commerce_stage/health-before.json"
curl -fsS --noproxy '*' --max-time 10 http://127.0.0.1:3115/api/config -o "$commerce_stage/config-before.json"
echo COMMERCE_API_PREFLIGHT_PASS
if [[ "$1" == --check ]]; then echo COMMERCE_API_NOT_INSTALLED; exit 0; fi

install -d -m 700 /var/lib/globaldroptrade/commerce-api-install
exec 9>/var/lib/globaldroptrade/commerce-api-install/installer.lock
flock -n 9 || { echo COMMERCE_API_INSTALL_LOCKED; exit 1; }
[[ "$(readlink -f "$commerce_current")" == "$commerce_previous" &&
 "$(git hash-object "$commerce_previous/server/trades-api.mjs")" == 5cae7c3c414386fecb82a0226b43237c3445001d ]] || { echo COMMERCE_API_CHANGED_DURING_PREFLIGHT; exit 1; }
commerce_release=$(mktemp -d "$commerce_releases/commerce.XXXXXX")
cp -a -- "$commerce_previous/." "$commerce_release/"
chmod 755 "$commerce_release"
install -m 644 server/trades-api.mjs "$commerce_release/server/trades-api.mjs"
install -m 644 server/commerce-ebay.mjs "$commerce_release/server/commerce-ebay.mjs"
[[ -d "$commerce_release/node_modules" ]] || { echo COMMERCE_API_DEPENDENCIES_MISSING; exit 1; }
node --env-file="$commerce_env" --input-type=module - "$commerce_release/server/trades-api.mjs" <<'JS'
import {pathToFileURL} from 'node:url';
const api=await import(pathToFileURL(process.argv[2]).href);
if(typeof api.createApiServer!=='function'||api.readConfig().port!==3115)throw Error('COMMERCE_STAGED_API_INVALID');
JS
commerce_link="$commerce_root/.commerce-link-$$"
commerce_changed=0
rollback(){
 if [[ "$commerce_changed" == 1 ]]; then
  if [[ "$(readlink -f "$commerce_current")" != "$commerce_release" ]]; then
   echo COMMERCE_API_CONCURRENT_CHANGE_REVIEW_REQUIRED >&2; return 1
  fi
  ln -s -- "$commerce_previous" "$commerce_link"
  mv -Tf -- "$commerce_link" "$commerce_current"
  systemctl restart globaldroptrade-api || { echo COMMERCE_API_ROLLBACK_REVIEW_REQUIRED >&2; return 1; }
  echo COMMERCE_PREVIOUS_API_RESTORED
 fi
}
cleanup(){
 local result=$?
 trap - EXIT
 if [[ "$result" -ne 0 ]]; then rollback || result=1; fi
 rm -f -- "$commerce_link"
 rm -rf -- "$commerce_stage"
 exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ln -s -- "$commerce_release" "$commerce_link"
mv -Tf -- "$commerce_link" "$commerce_current"
commerce_changed=1
systemctl restart globaldroptrade-api
commerce_ready=0
for commerce_try in 1 2 3 4 5; do
 if systemctl is-active --quiet globaldroptrade-api &&
  curl -fsS --noproxy '*' --max-time 10 http://127.0.0.1:3115/api/health -o "$commerce_stage/health-after.json"; then commerce_ready=1; break; fi
 sleep 1
done
[[ "$commerce_ready" == 1 ]] || { echo COMMERCE_API_HEALTH_FAILED; exit 1; }
curl -fsS --noproxy '*' --max-time 10 http://127.0.0.1:3115/api/config -o "$commerce_stage/config-after.json"
cmp -s "$commerce_stage/config-before.json" "$commerce_stage/config-after.json" || { echo COMMERCE_API_CONFIG_CHANGED; exit 1; }
cmp -s "$commerce_env" "$commerce_stage/env-before" || { echo COMMERCE_API_ENV_CHANGED_EXTERNALLY; exit 1; }
curl -fsS --noproxy '*' --max-time 20 'http://127.0.0.1:3115/api/marketplace?q=headphones' -o "$commerce_stage/catalog.json"
node --input-type=module - "$commerce_stage/catalog.json" <<'JS'
import fs from 'node:fs';
const v=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!Array.isArray(v.providers)||v.providers.length!==2)throw Error('COMMERCE_CATALOG_RESPONSE_INVALID');
JS
curl -fsS --noproxy '*' --max-time 20 http://127.0.0.1:3115/api/commerce/status -o "$commerce_stage/commerce.json"
node --input-type=module - "$commerce_stage/commerce.json" <<'JS'
import fs from 'node:fs';
const v=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(v.version!==1||v.source!=='ebay'||!['live','not_configured','unavailable','rate_limited','incomplete'].includes(v.status)||
 v.commercialProfit!==null||v.profitStatus!=='unverified_costs_and_fees')throw Error('COMMERCE_API_STATUS_INVALID');
console.log('COMMERCE_SELLER_STATUS='+v.status);
JS
commerce_changed=0
echo "COMMERCE_API_ONLY_INSTALLED=$GLOBAL_COMMERCE_EXPECTED_SHA"
echo 'COMMERCE_REQUIRES_SELLER_AUTHORIZATION_AND_COST_RECONCILIATION'
