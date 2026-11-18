#!/usr/bin/env bash
# Install one isolated static TESTNET preview; never deploy a contract or touch the legacy routes.
set +x
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname -s) == vps-luna-2585 ]] || { echo UNIFIED_SITE_WRONG_SERVER; exit 1; }
profile=()
route_name=unified-test
expected_proof=/var/lib/globaldroptrade/v3-unified-testnet/deployment-proof.json
if [[ ${1:-} == --single-capital ]]; then
  shift
  profile=(--single-capital)
  route_name=single-capital-test
  expected_proof=/var/lib/globaldroptrade/v3-single-capital-testnet/deployment-proof.json
fi
route="https://globaldroptrade.com/$route_name/"
mode=${1:-}
sha=${2:-}
[[ $sha =~ ^[a-f0-9]{40}$ ]] || { echo UNIFIED_SITE_ARGUMENTS_INVALID; exit 1; }
case "$mode" in
 --install-status)
  [[ $# == 2 && $route_name == unified-test ]] || { echo UNIFIED_SITE_ARGUMENTS_INVALID; exit 1; }
  ;;
 --install|--install-prepared)
  if [[ $# == 6 && ($mode != --install-prepared || $6 != --enable-testnet-wallets) ]]; then echo UNIFIED_SITE_ARGUMENTS_INVALID; exit 1; fi
  [[ ($# == 5 || $# == 6) && $3 == "$expected_proof" && $4 =~ ^[a-f0-9]{64}$ ]] || { echo UNIFIED_SITE_ARGUMENTS_INVALID; exit 1; }
  proof=$3 digest=$4 rpc=$5
  [[ $rpc == https://bsc-testnet-dataseed.bnbchain.org || $rpc == https://bsc-testnet-rpc.publicnode.com ]] || { echo UNIFIED_SITE_RPC_INVALID; exit 1; }
  case $(uname -m) in x86_64) arch=x64;; aarch64) arch=arm64;; *) echo UNIFIED_SITE_ARCH_INVALID; exit 1;; esac
  runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
  [[ -x $runtime/node && -x $runtime/npm ]] && export PATH="$runtime:$PATH"
  for tool in node npm; do command -v "$tool" >/dev/null || { echo "UNIFIED_SITE_MISSING_$tool"; exit 1; }; done
  if [[ $mode == --install ]]; then
  avail_inodes=$(df -Pi /opt | awk 'NR==2 {print $4}')
  avail_kib=$(df -Pk /opt | awk 'NR==2 {print $4}')
  [[ $avail_inodes =~ ^[0-9]+$ && $avail_kib =~ ^[0-9]+$ && $avail_inodes -ge 120000 && $avail_kib -ge 2097152 ]] || { echo UNIFIED_SITE_NEEDS_FREE_INODES_OR_SPACE; exit 1; }
  fi
  ;;
 *) echo UNIFIED_SITE_ARGUMENTS_INVALID; exit 1;;
esac
for tool in git nginx curl python3 flock cp mktemp; do command -v "$tool" >/dev/null || { echo "UNIFIED_SITE_MISSING_$tool"; exit 1; }; done
[[ -d .git && ! -L .git && $(git rev-parse HEAD) == "$sha" ]] || { echo UNIFIED_SITE_CHECKOUT_INVALID; exit 1; }
git diff --quiet HEAD -- || { echo UNIFIED_SITE_CHECKOUT_MODIFIED; exit 1; }
lock_dir=/run/globaldroptrade-unified-site
[[ -d /run && ! -L /run && $(stat -c %u /run) == 0 && $((8#$(stat -c %a /run) & 0022)) -eq 0 ]] || { echo UNIFIED_SITE_LOCK_DIRECTORY_INVALID; exit 1; }
mkdir -m 0700 "$lock_dir" 2>/dev/null || true
[[ -d $lock_dir && ! -L $lock_dir && $(stat -c %u "$lock_dir") == 0 && $((8#$(stat -c %a "$lock_dir") & 0077)) -eq 0 && ! -L $lock_dir/site.lock ]] || { echo UNIFIED_SITE_LOCK_DIRECTORY_INVALID; exit 1; }
exec 9>"$lock_dir/site.lock"
flock -n 9 || { echo UNIFIED_SITE_INSTALL_BUSY; exit 1; }
nginx -t
work=$(mktemp -d /opt/global-v3-unified-site.XXXXXXXX)
site_root='' stage='' target='' installed=0 target_inode='' previous_id=none
status_html="$work/status.html"
publisher="$work/publish.py"
cleanup(){
 result=$?
 trap - EXIT
 if [[ $installed == 1 ]]; then
  # Only the exact newly installed directory may be removed during rollback.
  if [[ -d $target && ! -L $target && $(stat -c '%d:%i' "$target") == "$target_inode" ]]; then
   if python3 "$publisher" rollback "$stage" "$target" "$status_html" "$previous_id" "${profile[@]}"; then
    echo UNIFIED_SITE_ROUTE_ROLLED_BACK >&2
   else echo UNIFIED_SITE_ROLLBACK_REQUIRES_REVIEW >&2; stage=''; fi
  else echo UNIFIED_SITE_ROLLBACK_REQUIRES_REVIEW >&2; stage=''; fi
 fi
 [[ -z $stage ]] || rm -rf -- "$stage"
 rm -rf -- "$work"
 exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
git show "$sha:website/static/unified-test-status.html" > "$status_html"
git show "$sha:scripts/publish-v3-unified-route.py" > "$publisher"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$work/main-before.html"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/hourly-test/ -o "$work/hourly-before.html"
nginx -T > "$work/nginx.conf" 2>/dev/null
site_root=$(python3 scripts/verify-nginx-served-root.py --nginx-config "$work/nginx.conf" --served "$work/main-before.html")
[[ -d $site_root && ! -L $site_root && $(stat -c %u "$site_root") == 0 ]] || { echo UNIFIED_SITE_ROOT_INVALID; exit 1; }
hourly="$site_root/hourly-test"
[[ -d $hourly && ! -L $hourly && -f $hourly/index.html && ! -L $hourly/index.html && -d $hourly/assets && ! -L $hourly/assets ]] || { echo UNIFIED_SITE_HOURLY_INVALID; exit 1; }
cmp -s "$hourly/index.html" "$work/hourly-before.html" || { echo UNIFIED_SITE_HOURLY_MISMATCH; exit 1; }
if [[ $route_name == single-capital-test ]]; then
 curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/unified-test/ -o "$work/legacy-unified-before.html"
fi
target="$site_root/$route_name"
if [[ -e $target || -L $target ]]; then
 python3 "$publisher" owned "$site_root/.$route_name-stage.check" "$target" "$status_html" none "${profile[@]}"
 previous_id=$(stat -c '%d:%i' "$target")
 if [[ $mode == --install-status ]]; then
  cmp -s "$target/index.html" "$status_html" || { echo UNIFIED_SITE_FULL_PREVIEW_ALREADY_INSTALLED; exit 1; }
  curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/unified-test/ -o "$work/status-current.html"
  cmp -s "$status_html" "$work/status-current.html" || { echo UNIFIED_SITE_ROUTE_NOT_SERVED; exit 1; }
  echo 'UNIFIED_SITE_STATUS_AVAILABLE=https://globaldroptrade.com/unified-test/'
  exit 0
 fi
fi
if [[ $mode == --install-status ]]; then
 dist="$work/dist"
 mkdir "$dist"
 cp -- "$status_html" "$dist/index.html"
else
wallet=$(node --input-type=module - "$hourly" <<'JS'
import fs from 'node:fs';import path from 'node:path';
const ids=new Set(),dir=path.join(process.argv[2],'assets');
for(const name of fs.readdirSync(dir)){
 if(!name.endsWith('.js'))continue;
 const file=path.join(dir,name),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)||stat.size>15000000)continue;
 const source=fs.readFileSync(file,'utf8');
 for(const use of source.matchAll(/\.init\(\{projectId:([A-Za-z_$][A-Za-z0-9_$]*)/g)){
  const variable=use[1].replace(/[$]/g,'\\$&');
  const values=[...source.matchAll(new RegExp('(?:^|[,;\\s])'+variable+'="([a-f0-9]{32}|)"\\.trim\\(\\)','gi'))];
  if(values.length>1)throw Error('UNIFIED_SITE_WALLET_CONFIG_AMBIGUOUS');
  if(values.length===1)ids.add(values[0][1].toLowerCase()||'disabled');
 }
}
if(ids.size>1)throw Error('UNIFIED_SITE_WALLET_CONFIG_AMBIGUOUS');
// The injected-wallet reader also works when the hourly build has no WalletConnect project.
process.stdout.write([...ids][0] || 'disabled');
JS
)
if [[ $mode == --install-prepared ]]; then
 python3 scripts/verify-v3-prepared-checkout.py
else
# A fresh local clone prevents untracked checkout files from entering the build.
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c core.hooksPath=/dev/null clone -q --no-hardlinks --no-checkout -- "$(pwd -P)" "$work/release"
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -C "$work/release" -c core.hooksPath=/dev/null checkout -q --detach "$sha"
cd "$work/release"
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix website --ignore-scripts --no-audit --no-fund
fi
build_args=("$proof" "$digest" "$sha" "$rpc" "$wallet")
if [[ ${6:-} == --enable-testnet-wallets ]]; then build_args+=("--enable-testnet-wallets"); fi
node scripts/build-v3-unified-site.mjs "${build_args[@]}" "${profile[@]}"
[[ -s website/dist/index.html && -d website/dist/assets && ! -L website/dist/assets ]] || { echo UNIFIED_SITE_BUILD_INCOMPLETE; exit 1; }
dist="$PWD/website/dist"
fi
# Recheck both existing pages immediately before adding the isolated route.
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$work/main-current.html"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/hourly-test/ -o "$work/hourly-current.html"
cmp -s "$work/main-before.html" "$work/main-current.html" && cmp -s "$work/hourly-before.html" "$work/hourly-current.html" || { echo UNIFIED_SITE_LEGACY_CHANGED; exit 1; }
nginx -T > "$work/nginx-current.conf" 2>/dev/null
current_root=$(python3 scripts/verify-nginx-served-root.py --nginx-config "$work/nginx-current.conf" --served "$work/main-current.html")
[[ $current_root == "$site_root" ]] || { echo UNIFIED_SITE_ROOT_CHANGED; exit 1; }
python3 - "$dist" <<'PYCODE'
import os,stat,sys
for root,dirs,files in os.walk(sys.argv[1],followlinks=False):
 for name in dirs+files:
  st=os.lstat(os.path.join(root,name))
  if not (stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode)):
   raise SystemExit('UNIFIED_SITE_BUILD_UNSAFE_FILE')
PYCODE
stage=$(mktemp -d "$site_root/.$route_name-stage.XXXXXXXX")
cp -a "$dist/." "$stage/"
chmod -R u=rwX,go=rX "$stage"
if [[ $mode != --install-status ]]; then python3 "$publisher" mark "$stage" "$target" "$status_html" none "${profile[@]}"; fi
target_inode=$(stat -c '%d:%i' "$stage")
# Keep the previous status page at stage until the new preview passes all HTTP checks.
installed=1
python3 "$publisher" install "$stage" "$target" "$status_html" "$previous_id" "${profile[@]}"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 "$route" -o "$work/unified-after.html"
cmp -s "$dist/index.html" "$work/unified-after.html" || { echo UNIFIED_SITE_ROUTE_NOT_SERVED; exit 1; }
if [[ $mode != --install-status ]]; then
 python3 scripts/check-v3-unified-route.py "$dist" "$work" "${profile[@]}"
fi
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$work/main-after.html"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/hourly-test/ -o "$work/hourly-after.html"
cmp -s "$work/main-before.html" "$work/main-after.html" && cmp -s "$work/hourly-before.html" "$work/hourly-after.html" || { echo UNIFIED_SITE_LEGACY_CHANGED; exit 1; }
if [[ $route_name == single-capital-test ]]; then
 curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/unified-test/ -o "$work/legacy-unified-after.html"
 cmp -s "$work/legacy-unified-before.html" "$work/legacy-unified-after.html" || { echo UNIFIED_SITE_LEGACY_CHANGED; exit 1; }
fi
installed=0
if [[ $mode == --install-status ]]; then
 echo 'UNIFIED_SITE_STATUS_AVAILABLE=https://globaldroptrade.com/unified-test/'
else
 echo "UNIFIED_SITE_INSTALLED=$route"
fi
echo "UNIFIED_SITE_SOURCE_SHA=$sha"
echo 'UNIFIED_SITE_ONLY_NO_MIGRATION_NO_KEEPER_NO_CHAIN_TRANSACTION'
