#!/usr/bin/env bash
# Publish the verified hourly TESTNET dashboard on the main domain, keeping
# the landing page. This never deploys or changes a blockchain contract.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")/.."
[[ $# == 1 && ( $1 == --check || $1 == --install ) ]] || { echo V3_PRIMARY_INVALID_MODE; exit 1; }
mode=$1
[[ $(id -u) == 0 && $(hostname -s) == vps-luna-2585 ]] || { echo V3_PRIMARY_WRONG_SERVER; exit 1; }
[[ -d .git && ! -L .git ]] || { echo V3_PRIMARY_CHECKOUT_REQUIRED; exit 1; }
sha=$(git rev-parse HEAD)
[[ $sha =~ ^[a-f0-9]{40}$ && ${GLOBAL_V2_EXPECTED_SHA:-} == "$sha" ]] || { echo V3_PRIMARY_RELEASE_SHA_MISMATCH; exit 1; }
git diff --quiet HEAD -- || { echo V3_PRIMARY_CHECKOUT_MODIFIED; exit 1; }
case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo V3_PRIMARY_UNSUPPORTED_ARCH; exit 1 ;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x "$runtime/node" ]] && export PATH="$runtime:$PATH"
for tool in node npm nginx curl python3 git flock cmp stat; do
 command -v "$tool" >/dev/null || { echo "V3_PRIMARY_TOOL_MISSING_$tool"; exit 1; }
done
python3 scripts/prepare-v3-primary-dependencies.py prepare --target "$PWD"
export GLOBAL_V3_MAIN_REUSE_TESTED_DEPS=1
node scripts/verify-v3-hourly-testnet.mjs --check
site_vars=$(node scripts/verify-v3-hourly-testnet.mjs --emit-site-env)
# Parse only fixed names and simple values from the verified release script.
declare -A seen=()
while IFS= read -r line; do
 [[ $line =~ ^export\ (VITE_V3_CONTRACT_ADDRESS|VITE_V3_RUNTIME_HASH|VITE_V3_DEPLOYMENT_TX|VITE_V3_PRIMARY_DASHBOARD|VITE_V3_HOURLY_TEST)=([a-zA-Z0-9_-]+)$ ]] || { echo V3_PRIMARY_BAD_RELEASE_VARIABLE; exit 1; }
 name=${BASH_REMATCH[1]}; value=${BASH_REMATCH[2]}
 [[ -z ${seen[$name]+x} ]] || { echo V3_PRIMARY_DUPLICATE_RELEASE_VARIABLE; exit 1; }
 seen[$name]=1
 printf -v "$name" '%s' "$value"
 export "$name"
done <<< "$site_vars"
[[ ${#seen[@]} == 5 && ${VITE_V3_CONTRACT_ADDRESS,,} == 0x4f2777861cc5bdd0d6aed86014ce1370bf823884 && \
 ${VITE_V3_RUNTIME_HASH} =~ ^0x[0-9a-f]{64}$ && ${VITE_V3_DEPLOYMENT_TX} =~ ^0x[0-9a-f]{64}$ && \
 ${VITE_V3_PRIMARY_DASHBOARD} == verified-testnet && ${VITE_V3_HOURLY_TEST} == isolated-1h ]] || { echo V3_PRIMARY_CONTRACT_NOT_VERIFIED; exit 1; }

# Preserve the WalletConnect configuration of the already deployed hourly app.
work=$(mktemp -d /tmp/global-v3-primary.XXXXXX)
trap 'rm -rf -- "$work"' EXIT
nginx -t
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/ -o "$work/main.html"
nginx -T > "$work/nginx.conf" 2>/dev/null
site_root=$(python3 scripts/verify-nginx-served-root.py --nginx-config "$work/nginx.conf" --served "$work/main.html")
hourly="$site_root/hourly-test"
[[ -d $hourly && ! -L $hourly && -d $hourly/assets && ! -L $hourly/assets && -f $hourly/index.html && ! -L $hourly/index.html && $(stat -c %u "$hourly") == 0 && $(stat -c %u "$hourly/assets") == 0 ]] || { echo V3_PRIMARY_HOURLY_SITE_MISSING; exit 1; }
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/hourly-test/ -o "$work/hourly.html"
cmp -s "$hourly/index.html" "$work/hourly.html" || { echo V3_PRIMARY_HOURLY_SITE_UNVERIFIED; exit 1; }
wallet_config=$(node scripts/read-v3-wallet-config.mjs "$hourly")
[[ $wallet_config == disabled || $wallet_config =~ ^[a-f0-9]{32}$ ]] || { echo V3_PRIMARY_WALLET_ID_INVALID; exit 1; }
if [[ $wallet_config == disabled ]]; then export VITE_WALLETCONNECT_PROJECT_ID=''; else export VITE_WALLETCONNECT_PROJECT_ID=$wallet_config; fi
export V3_EXPECTED_WALLET_CONFIG=$wallet_config
export VITE_V3_LANDING_AT_ROOT=true
unset GLOBAL_V3_RELEASE_PROFILE
bash ubuntu-global-v2-site.sh "$mode"
if [[ $mode == --check ]]; then
 echo V3_HOURLY_PRIMARY_PREFLIGHT_PASS
else
 echo 'V3_HOURLY_PRIMARY_SITE_INSTALLED=https://globaldroptrade.com/'
 echo "V3_HOURLY_PRIMARY_RELEASE_SHA=$sha"
 echo V3_HOURLY_PRIMARY_CHAIN=97
 echo "V3_HOURLY_PRIMARY_CONTRACT=$VITE_V3_CONTRACT_ADDRESS"
 echo V3_HOURLY_PRIMARY_NO_CHAIN_WRITES_OR_DATA_MIGRATION
fi
