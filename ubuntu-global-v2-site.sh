#!/usr/bin/env bash
# Static Global V2-only frontend replacement. NEVER changes API, signer, journal or vault.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")"
[ "$(id -u)" -eq 0 ] || { echo "V2_SITE_ROOT_REQUIRED"; exit 1; }
[ "$#" -eq 1 ] || { echo "Usage: bash ubuntu-global-v2-site.sh --check|--install"; exit 1; }
case "$1" in --check|--install) mode="$1";; *) echo "V2_SITE_INVALID_MODE"; exit 1;; esac

expected_sha=$(printenv GLOBAL_V2_EXPECTED_SHA || true)
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "V2_SITE_PINNED_SHA_REQUIRED"; exit 1; }
actual_sha=$(git rev-parse HEAD)
[ "$expected_sha" = "$actual_sha" ] || { echo "V2_SITE_RELEASE_SHA_MISMATCH"; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo "V2_SITE_ARCH_UNSUPPORTED"; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for program in node npm nginx curl python3 git cmp flock realpath install find stat; do
 command -v "$program" >/dev/null || { echo "V2_SITE_TOOL_MISSING_$program"; exit 1; }
done
node -e 'if(Number(process.versions.node.split(".")[0])<22)throw Error("NODE_22_REQUIRED")'
nginx -t

# Frontend regression tests also import the repository's root test dependencies.
# Install dependencies only inside the isolated checkout, never in the running API.
single_capital_primary=0
if [[ ${GLOBAL_V3_MAIN_PREPARED_BUILD:-} == single-capital-testnet || ${GLOBAL_V3_MAIN_PREPARED_BUILD:-} == referral-profit-testnet || ${GLOBAL_V3_MAIN_PREPARED_BUILD:-} == manual-reinvest-testnet || ${GLOBAL_V3_MAIN_PREPARED_BUILD:-} == upline-rates-testnet || ${GLOBAL_V3_MAIN_PREPARED_BUILD:-} == account-reinvest-testnet || ${GLOBAL_V3_MAIN_PREPARED_BUILD:-} == portfolio-testnet ]]; then
 single_capital_primary=1
 primary_profile="--${GLOBAL_V3_MAIN_PREPARED_BUILD%-testnet}"
 node scripts/publish-v3-single-capital-primary.mjs --check-build "$actual_sha" \
  "${GLOBAL_V3_PRIMARY_PROOF_SHA256:-}" "${GLOBAL_V3_PRIMARY_RPC:-}" "$primary_profile"
elif [ "${GLOBAL_V3_MAIN_REUSE_TESTED_DEPS:-}" = 1 ]; then
 python3 scripts/prepare-v3-primary-dependencies.py validate --target "$PWD"
else
 npm ci --ignore-scripts --no-audit --no-fund
 npm ci --prefix website --ignore-scripts --no-audit --no-fund
fi
# Bound Vitest worker processes on the VPS; CI can continue using its own
# parallelism. Avoid dozens of Ganache workers exhausting a small host.
if [ "$single_capital_primary" = 0 ]; then
env -u VITE_V3_HOURLY_TEST -u VITE_V3_PRIMARY_DASHBOARD -u VITE_V3_LANDING_AT_ROOT \
 -u VITE_V3_CONTRACT_ADDRESS -u VITE_V3_RUNTIME_HASH -u VITE_V3_DEPLOYMENT_TX \
 npm test --prefix website -- --maxWorkers=2
npm run build --prefix website
fi
[ -s website/dist/index.html ] || { echo "V2_SITE_BUILD_MISSING"; exit 1; }
grep -RilF '0xA98D8d3709f5D3730BAD5d76C334731784e7CF07' website/dist/assets --include='*.js' >/dev/null || {
 echo "V2_SITE_ADDRESS_NOT_IN_BUNDLE"; exit 1;
}
if grep -RilE '0x4c0f6141b18971db4b14e45c0be8cddb09febc14|/api/trades\?limit|/api/config' website/dist/assets --include='*.js' >/dev/null; then
 echo "V2_SITE_OLD_CONTRACT_REFERENCE_DETECTED"; exit 1;
fi
if [ "${VITE_V3_PRIMARY_DASHBOARD:-}" = verified-testnet ]; then
 [ "${VITE_V3_PRIMARY_DASHBOARD:-}" = verified-testnet ] || { echo "V3_SITE_PRIMARY_FLAG_MISSING"; exit 1; }
 if find website/dist/assets -maxdepth 1 -type f -name 'V2Dashboard-*.js' -print -quit | grep -q . ||
    grep -RilE 'Open existing V2 dashboard|V2 ON-CHAIN TRANSPARENCY|Global V2 testnet terms' website/dist/assets --include='*.js' >/dev/null; then
  echo "V3_SITE_RETIRED_FRONTEND_DETECTED"; exit 1;
 fi
fi
if [ "${VITE_V3_HOURLY_TEST:-}" = isolated-1h ]; then
 [ "${VITE_V3_LANDING_AT_ROOT:-}" = true ] || { echo V3_HOURLY_MAIN_LANDING_REQUIRED; exit 1; }
 bundle_profile=()
 if [ "$single_capital_primary" = 1 ]; then
  [[ ${VITE_V3_UNIFIED_MODE:-} == "$GLOBAL_V3_MAIN_PREPARED_BUILD" && ${VITE_V3_UNIFIED_PRIMARY:-} == "$GLOBAL_V3_MAIN_PREPARED_BUILD" ]] ||
   { echo GLOBAL_PRIMARY_PROFILE_MISMATCH; exit 1; }
  bundle_profile=("$primary_profile")
 else
  [ "${VITE_V3_CONTRACT_ADDRESS,,}" = 0x4f2777861cc5bdd0d6aed86014ce1370bf823884 ] || { echo V3_HOURLY_MAIN_CONTRACT_MISMATCH; exit 1; }
 fi
 wallet_flags=()
 if [ "$single_capital_primary" = 1 ]; then wallet_flags=(--allow-disabled); fi
 wallet_built=$(node scripts/read-v3-wallet-config.mjs website/dist "${wallet_flags[@]}")
 [ "$wallet_built" = "${V3_EXPECTED_WALLET_CONFIG:-not-provided}" ] || { echo V3_HOURLY_MAIN_WALLET_CONFIG_MISMATCH; exit 1; }
 mapfile -t hourly_assets < <(python3 scripts/check-v3-hourly-primary-bundle.py \
  --dist website/dist --address "$VITE_V3_CONTRACT_ADDRESS" \
  --runtime-hash "$VITE_V3_RUNTIME_HASH" --deployment-tx "$VITE_V3_DEPLOYMENT_TX" "${bundle_profile[@]}")
 [ "${#hourly_assets[@]}" -eq 2 ] || { echo V3_HOURLY_MAIN_ASSET_CHECK_FAILED; exit 1; }
fi
echo "V2_SITE_BUILD_AND_TEST_PASS"

stage=$(mktemp -d /opt/global-v2-site-stage.XXXXXX)
chmod 700 "$stage"
trap 'rm -rf -- "$stage"' EXIT
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/ -o "$stage/served-before.html"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/api/config -o "$stage/api-before.json"
nginx -T > "$stage/nginx.conf" 2>/dev/null
site_root=$(python3 scripts/verify-nginx-served-root.py --nginx-config "$stage/nginx.conf" --served "$stage/served-before.html")
[ -n "$site_root" ] && [ -d "$site_root" ] && [ ! -L "$site_root" ] || { echo "V2_SITE_ROOT_INVALID"; exit 1; }
[ "$(stat -c %u "$site_root")" -eq 0 ] || { echo "V2_SITE_ROOT_OWNERSHIP_INVALID"; exit 1; }
if [ "${VITE_V3_HOURLY_TEST:-}" = isolated-1h ]; then
 [ -d "$site_root/hourly-test" ] && [ ! -L "$site_root/hourly-test" ] && \
  [ -f "$site_root/hourly-test/index.html" ] && [ ! -L "$site_root/hourly-test/index.html" ] || { echo V3_HOURLY_EXISTING_SITE_REQUIRED; exit 1; }
 curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
  https://globaldroptrade.com/hourly-test/ -o "$stage/hourly-before.html"
 cmp -s "$site_root/hourly-test/index.html" "$stage/hourly-before.html" || { echo V3_HOURLY_EXISTING_SITE_NOT_VERIFIED; exit 1; }
 python3 scripts/check-v3-publish-paths.py --site-root "$site_root" --dist website/dist
fi
echo "V2_SITE_VERIFIED_ROOT=$site_root"
if [ "$mode" = --check ]; then
 echo "V2_SITE_PREFLIGHT_PASS"
 echo "No live site, API, timer, signer or journal was modified."
 exit 0
fi

lockdir=/var/lib/globaldroptrade/v2-site-install
install -d -m 700 "$lockdir"
exec 9>"$lockdir/installer.lock"
flock -n 9 || { echo "V2_SITE_INSTALL_LOCKED"; exit 1; }
if [ "${VITE_V3_HOURLY_TEST:-}" = isolated-1h ]; then
 hourly_state=/var/lib/globaldroptrade/v3-hourly-testnet
 [ -d "$hourly_state" ] && [ ! -L "$hourly_state" ] && \
  [ "$(stat -c %u "$hourly_state")" = 0 ] && [ ! -L "$hourly_state/site-install.lock" ] || { echo V3_HOURLY_STATE_UNSAFE; exit 1; }
 exec 8>"$hourly_state/site-install.lock"
 flock -n 8 || { echo V3_HOURLY_SITE_INSTALL_LOCKED; exit 1; }
 if [ "$single_capital_primary" = 1 ]; then
  node scripts/publish-v3-single-capital-primary.mjs --check-build "$actual_sha" \
   "$GLOBAL_V3_PRIMARY_PROOF_SHA256" "$GLOBAL_V3_PRIMARY_RPC" "$primary_profile"
 else
 site_vars_again=$(node scripts/verify-v3-hourly-testnet.mjs --emit-site-env)
 grep -Fx "export VITE_V3_CONTRACT_ADDRESS=$VITE_V3_CONTRACT_ADDRESS" <<< "$site_vars_again" >/dev/null && \
 grep -Fx "export VITE_V3_RUNTIME_HASH=$VITE_V3_RUNTIME_HASH" <<< "$site_vars_again" >/dev/null && \
 grep -Fx "export VITE_V3_DEPLOYMENT_TX=$VITE_V3_DEPLOYMENT_TX" <<< "$site_vars_again" >/dev/null || { echo V3_HOURLY_PROOF_CHANGED; exit 1; }
 fi
 curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
  https://globaldroptrade.com/ -o "$stage/served-current.html"
 cmp -s "$stage/served-before.html" "$stage/served-current.html" || { echo V3_HOURLY_MAIN_SITE_CHANGED_RETRY; exit 1; }
 nginx -T > "$stage/nginx-current.conf" 2>/dev/null
 site_root_current=$(python3 scripts/verify-nginx-served-root.py --nginx-config "$stage/nginx-current.conf" --served "$stage/served-current.html")
 [ "$site_root_current" = "$site_root" ] || { echo V3_HOURLY_MAIN_ROOT_CHANGED_RETRY; exit 1; }
 curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
  https://globaldroptrade.com/hourly-test/ -o "$stage/hourly-current.html"
 cmp -s "$stage/hourly-before.html" "$stage/hourly-current.html" || { echo V3_HOURLY_EXISTING_SITE_CHANGED_RETRY; exit 1; }
 cmp -s "$site_root/hourly-test/index.html" "$stage/hourly-current.html" || { echo V3_HOURLY_EXISTING_SITE_CHANGED_RETRY; exit 1; }
 python3 scripts/check-v3-publish-paths.py --site-root "$site_root" --dist website/dist
fi

# A separate routed V3 must not replace the dashboard while the prior V3
# holds members, obligations, requests or test tokens. Recheck after the
# lengthy build and immediately before touching served files.
if [ "${GLOBAL_V3_RELEASE_PROFILE:-}" = routed-testnet ]; then
 node scripts/verify-prior-v3-testnet-empty.mjs --check
fi

backup="/var/backups/globaldroptrade/v2-site-$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 700 "$backup" "$backup/files"
cp -p "$stage/served-before.html" "$backup/index-before.html"
cp -p "$stage/api-before.json" "$backup/api-before.json"
printf '%s\n' "$site_root" > "$backup/site-root.txt"
printf '%s\n' "$actual_sha" > "$backup/sha.txt"
touch "$backup/modified.lst" "$backup/created.lst"

changed=0
rollback(){
 local result=0 rel
 while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  cp -p -- "$backup/files/$rel" "$site_root/$rel" || result=1
 done < "$backup/modified.lst"
 while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  rm -f -- "$site_root/$rel" || result=1
 done < "$backup/created.lst"
 if [ "$result" -eq 0 ]; then
  echo "V2_SITE_ROLLBACK_OK backup=$backup"
 else
  echo "V2_SITE_ROLLBACK_REVIEW_REQUIRED backup=$backup" >&2
 fi
 return "$result"
}
cleanup(){
 local status=$?
 trap - EXIT
 if [ "$changed" -eq 1 ]; then rollback || status=1; fi
 rm -rf -- "$stage"
 exit "$status"
}
trap - EXIT
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

copy_one(){
 local source="$1" relative target folder
 relative=$(realpath --relative-to=website/dist -- "$source")
 [ -n "$relative" ] && [[ "$relative" != ../* ]] || { echo "V2_SITE_UNSAFE_PATH"; return 1; }
 target="$site_root/$relative"
 folder=$(dirname "$relative")
 if [ -e "$target" ] || [ -L "$target" ]; then
  [ -f "$target" ] && [ ! -L "$target" ] || { echo "V2_SITE_UNSAFE_EXISTING_FILE"; return 1; }
  install -d -m 700 -- "$backup/files/$folder"
  cp -p -- "$target" "$backup/files/$relative"
  printf '%s\n' "$relative" >> "$backup/modified.lst"
 else
  printf '%s\n' "$relative" >> "$backup/created.lst"
 fi
 [ -d "$site_root/$folder" ] || install -d -m 755 -- "$site_root/$folder"
 install -m 644 -- "$source" "$target"
}
changed=1
while IFS= read -r -d '' file; do
 [ "$file" = website/dist/index.html ] || copy_one "$file"
done < <(find website/dist -type f -print0)
copy_one website/dist/index.html

curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 'https://globaldroptrade.com/?v2-site-verify=1' -o "$stage/served-after.html"
cmp -s website/dist/index.html "$stage/served-after.html" || { echo "V2_SITE_INDEX_NOT_SERVED"; exit 1; }
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/api/config -o "$stage/api-after.json"
cmp -s "$stage/api-before.json" "$stage/api-after.json" || { echo "V2_SITE_BACKEND_CHANGED"; exit 1; }
if [ "${VITE_V3_HOURLY_TEST:-}" = isolated-1h ]; then
 for asset in "${hourly_assets[@]}"; do
  curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
   "https://globaldroptrade.com/$asset" -o "$stage/asset-after"
  cmp -s "website/dist/$asset" "$stage/asset-after" || { echo V3_HOURLY_MAIN_ASSET_NOT_SERVED; exit 1; }
 done
 if [ "$single_capital_primary" = 1 ]; then
  python3 scripts/check-v3-unified-route.py website/dist "$stage" --primary
 fi
 curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
  https://globaldroptrade.com/hourly-test/ -o "$stage/hourly-after.html"
 cmp -s "$stage/hourly-before.html" "$stage/hourly-after.html" || { echo V3_HOURLY_EXISTING_SITE_CHANGED; exit 1; }
fi

changed=0
# Once the new HTML, every current hashed JS/CSS asset and the unchanged API
# have been verified, remove only obsolete hashed web assets from this served
# directory. Other release directories, backups and accounting data are not
# within this operation. On failure the current site remains installed and the
# wrapper does not report the full release as complete.
if [ "${GLOBAL_V3_RELEASE_PROFILE:-}" = routed-testnet ]; then
 python3 scripts/prune-retired-v3-site-assets.py --site-root "$site_root" --dist website/dist --apply
fi
trap - EXIT INT TERM
rm -rf -- "$stage"
echo "V2_SITE_ONLY_INSTALLED"
echo "RELEASE_SHA=$actual_sha"
echo "BACKUP_PATH=$backup"
echo "Old vault, backend, user balances and financial journals were not deleted."
