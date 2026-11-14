#!/usr/bin/env bash
# Replace only the existing hourly BNB Testnet static frontend. No chain writes.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")/.."
[[ $(id -u) == 0 ]] || { echo V3_HOURLY_UPDATE_ROOT_REQUIRED; exit 1; }
[[ $# == 1 && ( $1 == --check || $1 == --install ) ]] || { echo V3_HOURLY_UPDATE_INVALID_MODE; exit 1; }
mode=$1
case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo V3_HOURLY_UPDATE_UNSUPPORTED_ARCH; exit 1 ;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x "$runtime/node" ]] && export PATH="$runtime:$PATH"
for tool in node npm nginx curl python3 git flock cmp install mktemp cp chmod stat mv; do
 command -v "$tool" >/dev/null || { echo "V3_HOURLY_UPDATE_MISSING_$tool"; exit 1; }
done
[[ -d .git && ! -L .git ]] || { echo V3_HOURLY_UPDATE_CHECKOUT_REQUIRED; exit 1; }
sha=$(git rev-parse HEAD)
[[ $sha =~ ^[a-f0-9]{40}$ ]] || { echo V3_HOURLY_UPDATE_SHA_INVALID; exit 1; }
git diff --quiet HEAD -- || { echo V3_HOURLY_UPDATE_CHECKOUT_MODIFIED; exit 1; }
nginx -t
work=$(mktemp -d /tmp/global-v3-hourly-wallet-update.XXXXXX)
swap_dir=''
swapped=0
exchange(){
 python3 - "$1" "$2" <<'PY'
import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
fn = getattr(libc, 'renameat2', None)
if fn is None:
    raise SystemExit('V3_HOURLY_UPDATE_ATOMIC_EXCHANGE_UNAVAILABLE')
fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
fn.restype = ctypes.c_int
if fn(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 2):
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error))
PY
}
cleanup(){
 result=$?
 trap - EXIT
 if [[ $swapped == 1 ]]; then
  if exchange "$target" "$swap_dir"; then
   echo V3_HOURLY_UPDATE_ROLLED_BACK >&2
   swapped=0
  else
   echo "V3_HOURLY_UPDATE_ROLLBACK_FAILED_BACKUP=$swap_dir" >&2
   swap_dir=''
  fi
 fi
 [[ -z $swap_dir ]] || rm -rf -- "$swap_dir"
 rm -rf -- "$work"
 exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/ -o "$work/main-before.html"
nginx -T > "$work/nginx.conf" 2>/dev/null
site_root=$(python3 scripts/verify-nginx-served-root.py --nginx-config "$work/nginx.conf" --served "$work/main-before.html")
[[ -n $site_root && -d $site_root && ! -L $site_root && $(stat -c %u "$site_root") == 0 ]] || { echo V3_HOURLY_UPDATE_ROOT_INVALID; exit 1; }
target="$site_root/hourly-test"
[[ -d $target && ! -L $target && $(stat -c %u "$target") == 0 && -f $target/index.html && ! -L $target/index.html ]] || { echo V3_HOURLY_UPDATE_TARGET_INVALID; exit 1; }
[[ -d $target/assets && ! -L $target/assets && $(stat -c %u "$target/assets") == 0 ]] || { echo V3_HOURLY_UPDATE_ASSETS_INVALID; exit 1; }
target_mode=$(stat -c %a "$target")
[[ $target_mode =~ ^[0-7]{3,4}$ && $((8#$target_mode & 0022)) -eq 0 ]] || { echo V3_HOURLY_UPDATE_TARGET_PERMISSIONS_UNSAFE; exit 1; }
assets_mode=$(stat -c %a "$target/assets")
[[ $assets_mode =~ ^[0-7]{3,4}$ && $((8#$assets_mode & 0022)) -eq 0 ]] || { echo V3_HOURLY_UPDATE_ASSETS_PERMISSIONS_UNSAFE; exit 1; }
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/hourly-test/ -o "$work/hourly-before.html"
cmp -s "$target/index.html" "$work/hourly-before.html" || { echo V3_HOURLY_UPDATE_EXISTING_SITE_NOT_VERIFIED; exit 1; }
# Preserve the existing public WalletConnect project identifier, including a
# deliberately disabled empty value. Refuse ambiguous or unrecognized bundles.
wallet_config(){
 node --input-type=module - "$1" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const assets=path.join(process.argv[2],'assets'), ids=new Set();
for(const name of fs.readdirSync(assets)){
 if(!name.endsWith('.js'))continue;
 const file=path.join(assets,name), stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.size>15_000_000)continue;
 const source=fs.readFileSync(file,'utf8');
 for(const use of source.matchAll(/\.init\(\{projectId:([A-Za-z_$][A-Za-z0-9_$]*)/g)){
  const variable=use[1].replace(/[$]/g,'\\$&');
  const values=[...source.matchAll(new RegExp('(?:^|[,;\\s])'+variable+'="([a-f0-9]{32}|)"\\.trim\\(\\)','gi'))];
  // Other bundled SDK modules may use dynamic projectId values. Only the
  // application's compiled literal identifies its configured project ID.
  if(values.length===0)continue;
  if(values.length!==1)throw Error('V3_HOURLY_UPDATE_WALLET_ID_UNVERIFIED');
  ids.add(values[0][1].toLowerCase()||'disabled');
 }
}
if(ids.size!==1)throw Error('V3_HOURLY_UPDATE_WALLET_ID_UNVERIFIED');
process.stdout.write([...ids][0]);
JS
}
existing_wallet_config=$(wallet_config "$target") || { echo V3_HOURLY_UPDATE_WALLET_ID_UNVERIFIED; exit 1; }
[[ $existing_wallet_config == disabled || $existing_wallet_config =~ ^[a-f0-9]{32}$ ]] || { echo V3_HOURLY_UPDATE_WALLET_ID_INVALID; exit 1; }
if [[ $existing_wallet_config == disabled ]]; then VITE_WALLETCONNECT_PROJECT_ID=''; else VITE_WALLETCONNECT_PROJECT_ID=$existing_wallet_config; fi
export VITE_WALLETCONNECT_PROJECT_ID
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix website --ignore-scripts --no-audit --no-fund
site_vars=$(node scripts/verify-v3-hourly-testnet.mjs --emit-site-env)
[[ $site_vars == *'export VITE_V3_HOURLY_TEST=isolated-1h'* ]] || { echo V3_HOURLY_UPDATE_VARIABLES_INVALID; exit 1; }
env -u VITE_V3_HOURLY_TEST -u VITE_V3_PRIMARY_DASHBOARD -u VITE_V3_LANDING_AT_ROOT \
 -u VITE_V3_CONTRACT_ADDRESS -u VITE_V3_RUNTIME_HASH -u VITE_V3_DEPLOYMENT_TX \
 npm test --prefix website -- --maxWorkers=2
eval "$site_vars"
unset VITE_V3_LANDING_AT_ROOT
npm run build --prefix website
[[ -s website/dist/index.html ]] || { echo V3_HOURLY_UPDATE_BUILD_MISSING; exit 1; }
grep -RilF 'ONE-HOUR BNB TESTNET CONTRACT' website/dist/assets --include='*.js' >/dev/null || { echo V3_HOURLY_UPDATE_DISCLOSURE_MISSING; exit 1; }
[[ $(wallet_config website/dist) == "$existing_wallet_config" ]] || { echo V3_HOURLY_UPDATE_WALLET_ID_NOT_PRESERVED; exit 1; }
entry=$(python3 - website/dist/index.html <<'PY'
import re, sys
html = open(sys.argv[1], encoding='utf-8').read()
match = re.search(r'<script\b[^>]*\btype="module"[^>]*\bsrc="(\.?/assets/[A-Za-z0-9._-]+\.js)"', html)
if not match:
    raise SystemExit('V3_HOURLY_UPDATE_ENTRY_MISSING')
print(match.group(1).lstrip('./'))
PY
)
[[ -f website/dist/$entry && ! -L website/dist/$entry ]] || { echo V3_HOURLY_UPDATE_ENTRY_INVALID; exit 1; }
if [[ $mode == --check ]]; then
 echo V3_HOURLY_UPDATE_PREFLIGHT_PASS
 echo V3_HOURLY_UPDATE_INSTALLED=NO
 exit 0
fi
install -d -m 0700 /var/lib/globaldroptrade/v3-hourly-testnet
exec 9>/var/lib/globaldroptrade/v3-hourly-testnet/site-install.lock
flock -n 9 || { echo V3_HOURLY_UPDATE_LOCKED; exit 1; }
node scripts/verify-v3-hourly-testnet.mjs --check
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/ -o "$work/main-current.html"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/hourly-test/ -o "$work/hourly-current.html"
cmp -s "$work/main-before.html" "$work/main-current.html" && cmp -s "$work/hourly-before.html" "$work/hourly-current.html" && cmp -s "$target/index.html" "$work/hourly-current.html" || { echo V3_HOURLY_UPDATE_SITE_CHANGED_RETRY; exit 1; }
swap_dir=$(mktemp -d "$site_root/.hourly-wallet-update.XXXXXXXX")
cp -a website/dist/. "$swap_dir/"
# Keep old hashed static assets available to browser tabs opened before the
# switch. Reject unsafe files or a same-name collision with different content.
python3 - "$target/assets" "$swap_dir/assets" <<'PY'
import filecmp, os, re, shutil, stat, sys
source, destination = sys.argv[1:]
for name in os.listdir(source):
    old, new = os.path.join(source, name), os.path.join(destination, name)
    st = os.lstat(old)
    if (not re.fullmatch(r'[A-Za-z0-9._-]+', name) or
        not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022):
        raise SystemExit('V3_HOURLY_UPDATE_UNSAFE_OLD_ASSET')
    if os.path.lexists(new):
        if not os.path.isfile(new) or os.path.islink(new) or not filecmp.cmp(old, new, shallow=False):
            raise SystemExit('V3_HOURLY_UPDATE_ASSET_COLLISION')
    else:
        shutil.copy2(old, new, follow_symlinks=False)
PY
chmod -R u=rwX,go=rX "$swap_dir"
# Linux renameat2 exchange makes the directory switch atomic, including rollback.
exchange "$target" "$swap_dir"
swapped=1
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/hourly-test/ -o "$work/hourly-after.html"
cmp -s website/dist/index.html "$work/hourly-after.html" || { echo V3_HOURLY_UPDATE_NOT_SERVED; exit 1; }
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 "https://globaldroptrade.com/hourly-test/$entry" -o "$work/entry-after.js"
cmp -s "website/dist/$entry" "$work/entry-after.js" || { echo V3_HOURLY_UPDATE_ASSET_NOT_SERVED; exit 1; }
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/ -o "$work/main-after.html"
cmp -s "$work/main-before.html" "$work/main-after.html" || { echo V3_HOURLY_UPDATE_MAIN_SITE_CHANGED; exit 1; }
backup=$swap_dir
swapped=0
swap_dir=''
chmod 0700 "$backup"
echo 'V3_HOURLY_WALLET_SITE_UPDATED=https://globaldroptrade.com/hourly-test/'
echo "V3_HOURLY_UPDATE_RELEASE_SHA=$sha"
echo "V3_HOURLY_UPDATE_PREVIOUS_SITE_BACKUP=$backup"
echo V3_HOURLY_UPDATE_24H_SITE_CONTRACTS_KEEPERS_AND_ACCOUNTS_UNCHANGED
