#!/usr/bin/env bash
# Publish only a separately verified hourly test dashboard in a new subfolder.
# Do not redeploy, replace the existing dashboard, alter nginx, delete files,
# sign transactions, transfer tokens or touch any account data.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")/.."
[[ "$(id -u)" -eq 0 ]] || { echo V3_HOURLY_SITE_ROOT_REQUIRED; exit 1; }
[[ $# -eq 1 && ( "$1" == --check || "$1" == --install ) ]] ||
 { echo V3_HOURLY_SITE_INVALID_MODE; exit 1; }
mode=$1
case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo V3_HOURLY_UNSUPPORTED_ARCH; exit 1 ;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x "$runtime/node" ]] && export PATH="$runtime:$PATH"
for command in node npm nginx curl python3 git flock cmp install; do
 command -v "$command" >/dev/null || { echo "V3_HOURLY_SITE_MISSING_$command"; exit 1; }
done
[[ -d .git ]] || { echo V3_HOURLY_SITE_CHECKOUT_REQUIRED; exit 1; }
sha="$(git rev-parse HEAD)"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo V3_HOURLY_SITE_SHA_INVALID; exit 1; }
nginx -t
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix website --ignore-scripts --no-audit --no-fund
# This verifier emits fixed variable names and independently validated hex only.
site_vars="$(node scripts/verify-v3-hourly-testnet.mjs --emit-site-env)"
[[ "$site_vars" == *'export VITE_V3_HOURLY_TEST=isolated-1h'* ]] ||
 { echo V3_HOURLY_SITE_VARIABLES_INVALID; exit 1; }
env -u VITE_V3_HOURLY_TEST -u VITE_V3_PRIMARY_DASHBOARD \
 -u VITE_V3_CONTRACT_ADDRESS -u VITE_V3_RUNTIME_HASH -u VITE_V3_DEPLOYMENT_TX \
 npm test --prefix website -- --maxWorkers=2
eval "$site_vars"
npm run build --prefix website
[[ -s website/dist/index.html ]] || { echo V3_HOURLY_SITE_BUILD_MISSING; exit 1; }
grep -RilF 'SEPARATE ONE-HOUR TEST CONTRACT' website/dist/assets --include='*.js' >/dev/null ||
 { echo V3_HOURLY_SITE_DISCLOSURE_MISSING; exit 1; }
stage="$(mktemp -d /tmp/global-v3-hourly-site.XXXXXX)"
created=0
cleanup(){
 result=$?
 trap - EXIT
 if [[ "$created" == 1 ]]; then rm -rf -- "$target"; fi
 rm -rf -- "$stage"
 exit "$result"
}
trap cleanup EXIT
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/ -o "$stage/before.html"
nginx -T > "$stage/nginx.conf" 2>/dev/null
site_root="$(python3 scripts/verify-nginx-served-root.py --nginx-config "$stage/nginx.conf" --served "$stage/before.html")"
[[ -n "$site_root" && -d "$site_root" && ! -L "$site_root" && "$(stat -c %u "$site_root")" == 0 ]] ||
 { echo V3_HOURLY_SITE_ROOT_INVALID; exit 1; }
target="$site_root/hourly-test"
[[ ! -e "$target" && ! -L "$target" ]] || { echo V3_HOURLY_SITE_TARGET_ALREADY_EXISTS; exit 1; }
if [[ "$mode" == --check ]]; then
 echo V3_HOURLY_SITE_PREFLIGHT_PASS
 echo V3_HOURLY_SITE_INSTALLED=NO
 exit 0
fi
install -d -m 0700 /var/lib/globaldroptrade/v3-hourly-testnet
exec 9>/var/lib/globaldroptrade/v3-hourly-testnet/site-install.lock
flock -n 9 || { echo V3_HOURLY_SITE_INSTALL_LOCKED; exit 1; }
# Repeat contract and site-root checks immediately before modifying served files.
node scripts/verify-v3-hourly-testnet.mjs --check
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/ -o "$stage/current.html"
cmp -s "$stage/before.html" "$stage/current.html" || { echo V3_HOURLY_SITE_CHANGED_RETRY; exit 1; }
[[ ! -e "$target" && ! -L "$target" ]] || { echo V3_HOURLY_SITE_TARGET_ALREADY_EXISTS; exit 1; }
mkdir "$target"
created=1
cp -R website/dist/. "$target/"
chmod -R u=rwX,go=rX "$target"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/hourly-test/ -o "$stage/hourly.html"
cmp -s website/dist/index.html "$stage/hourly.html" || { echo V3_HOURLY_SITE_NOT_SERVED; exit 1; }
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/ -o "$stage/after.html"
cmp -s "$stage/before.html" "$stage/after.html" || { echo V3_HOURLY_EXISTING_SITE_CHANGED; exit 1; }
created=0
echo "V3_HOURLY_TESTNET_SITE_INSTALLED=https://globaldroptrade.com/hourly-test/"
echo "V3_HOURLY_SITE_RELEASE_SHA=$sha"
echo V3_EXISTING_24H_SITE_AND_ACCOUNTS_PRESERVED
echo V3_HOURLY_KEEPER_REQUIRES_SEPARATE_GAS_ONLY_SETUP
