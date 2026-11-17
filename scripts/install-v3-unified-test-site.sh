#!/usr/bin/env bash
# Install one isolated static TESTNET preview; never deploy a contract or touch the legacy routes.
set +x
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname -s) == vps-luna-2585 ]] || { echo UNIFIED_SITE_WRONG_SERVER; exit 1; }
[[ $# == 5 && $1 == --install && $2 =~ ^[a-f0-9]{40}$ && $3 == /var/lib/globaldroptrade/v3-unified-testnet/deployment-proof.json && $4 =~ ^[a-f0-9]{64}$ ]] || { echo UNIFIED_SITE_ARGUMENTS_INVALID; exit 1; }
sha=$2 proof=$3 digest=$4 rpc=$5
[[ $rpc == https://bsc-testnet-dataseed.bnbchain.org || $rpc == https://bsc-testnet-rpc.publicnode.com ]] || { echo UNIFIED_SITE_RPC_INVALID; exit 1; }
case $(uname -m) in x86_64) arch=x64;; aarch64) arch=arm64;; *) echo UNIFIED_SITE_ARCH_INVALID; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x $runtime/node && -x $runtime/npm ]] && export PATH="$runtime:$PATH"
for tool in git node npm nginx curl python3 flock df cp mktemp; do command -v "$tool" >/dev/null || { echo "UNIFIED_SITE_MISSING_$tool"; exit 1; }; done
[[ -d .git && ! -L .git && $(git rev-parse HEAD) == "$sha" ]] || { echo UNIFIED_SITE_CHECKOUT_INVALID; exit 1; }
git diff --quiet HEAD -- || { echo UNIFIED_SITE_CHECKOUT_MODIFIED; exit 1; }
# Never remove files automatically to make room: 120k free inodes covers the known installs with a reserve.
avail_inodes=$(df -Pi /opt | awk 'NR==2 {print $4}')
avail_kib=$(df -Pk /opt | awk 'NR==2 {print $4}')
[[ $avail_inodes =~ ^[0-9]+$ && $avail_kib =~ ^[0-9]+$ && $avail_inodes -ge 120000 && $avail_kib -ge 2097152 ]] || { echo UNIFIED_SITE_NEEDS_FREE_INODES_OR_SPACE; exit 1; }
lock_dir=/run/globaldroptrade-unified-site
[[ -d /run && ! -L /run && $(stat -c %u /run) == 0 && $((8#$(stat -c %a /run) & 0022)) -eq 0 ]] || { echo UNIFIED_SITE_LOCK_DIRECTORY_INVALID; exit 1; }
mkdir -m 0700 "$lock_dir" 2>/dev/null || true
[[ -d $lock_dir && ! -L $lock_dir && $(stat -c %u "$lock_dir") == 0 && $((8#$(stat -c %a "$lock_dir") & 0077)) -eq 0 && ! -L $lock_dir/site.lock ]] || { echo UNIFIED_SITE_LOCK_DIRECTORY_INVALID; exit 1; }
exec 9>"$lock_dir/site.lock"
flock -n 9 || { echo UNIFIED_SITE_INSTALL_BUSY; exit 1; }
nginx -t
work=$(mktemp -d /opt/global-v3-unified-site.XXXXXXXX)
site_root='' stage='' target='' installed=0 target_inode=''
cleanup(){
 result=$?
 trap - EXIT
 if [[ $installed == 1 ]]; then
  # Only the exact newly installed directory may be removed during rollback.
  if [[ -d $target && ! -L $target && $(stat -c '%d:%i' "$target") == "$target_inode" ]]; then
   rm -rf -- "$target"
   echo UNIFIED_SITE_NEW_ROUTE_ROLLED_BACK >&2
  else echo UNIFIED_SITE_ROLLBACK_REQUIRES_REVIEW >&2; fi
 fi
 [[ -z $stage ]] || rm -rf -- "$stage"
 rm -rf -- "$work"
 exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$work/main-before.html"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/hourly-test/ -o "$work/hourly-before.html"
nginx -T > "$work/nginx.conf" 2>/dev/null
site_root=$(python3 scripts/verify-nginx-served-root.py --nginx-config "$work/nginx.conf" --served "$work/main-before.html")
[[ -d $site_root && ! -L $site_root && $(stat -c %u "$site_root") == 0 ]] || { echo UNIFIED_SITE_ROOT_INVALID; exit 1; }
hourly="$site_root/hourly-test"
[[ -d $hourly && ! -L $hourly && -f $hourly/index.html && ! -L $hourly/index.html && -d $hourly/assets && ! -L $hourly/assets ]] || { echo UNIFIED_SITE_HOURLY_INVALID; exit 1; }
cmp -s "$hourly/index.html" "$work/hourly-before.html" || { echo UNIFIED_SITE_HOURLY_MISMATCH; exit 1; }
target="$site_root/unified-test"
[[ ! -e $target && ! -L $target ]] || { echo UNIFIED_SITE_ROUTE_ALREADY_EXISTS; exit 1; }
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
if(ids.size!==1)throw Error('UNIFIED_SITE_WALLET_CONFIG_NOT_FOUND');
process.stdout.write([...ids][0]);
JS
)
# A fresh local clone prevents untracked checkout files from entering the build.
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c core.hooksPath=/dev/null clone -q --no-hardlinks --no-checkout -- "$(pwd -P)" "$work/release"
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -C "$work/release" -c core.hooksPath=/dev/null checkout -q --detach "$sha"
cd "$work/release"
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix website --ignore-scripts --no-audit --no-fund
node scripts/build-v3-unified-site.mjs "$proof" "$digest" "$sha" "$rpc" "$wallet"
[[ -s website/dist/index.html && -d website/dist/assets && ! -L website/dist/assets ]] || { echo UNIFIED_SITE_BUILD_INCOMPLETE; exit 1; }
entry=$(python3 - website/dist/index.html <<'PY'
import re,sys
text=open(sys.argv[1],encoding='utf-8').read()
m=re.search(r'<script\b[^>]*\btype="module"[^>]*\bsrc="(\.?/assets/[A-Za-z0-9._-]+\.js)"',text)
if not m: raise SystemExit('UNIFIED_SITE_ENTRY_INVALID')
print(m.group(1).lstrip('./'))
PY
)
[[ -f website/dist/$entry && ! -L website/dist/$entry ]] || { echo UNIFIED_SITE_ENTRY_MISSING; exit 1; }
# Recheck both existing pages immediately before adding the isolated route.
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$work/main-current.html"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/hourly-test/ -o "$work/hourly-current.html"
cmp -s "$work/main-before.html" "$work/main-current.html" && cmp -s "$work/hourly-before.html" "$work/hourly-current.html" || { echo UNIFIED_SITE_LEGACY_CHANGED; exit 1; }
nginx -T > "$work/nginx-current.conf" 2>/dev/null
current_root=$(python3 scripts/verify-nginx-served-root.py --nginx-config "$work/nginx-current.conf" --served "$work/main-current.html")
[[ $current_root == "$site_root" ]] || { echo UNIFIED_SITE_ROOT_CHANGED; exit 1; }
python3 - website/dist <<'PYCODE'
import os,stat,sys
for root,dirs,files in os.walk(sys.argv[1],followlinks=False):
 for name in dirs+files:
  st=os.lstat(os.path.join(root,name))
  if not (stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode)):
   raise SystemExit('UNIFIED_SITE_BUILD_UNSAFE_FILE')
PYCODE
stage=$(mktemp -d "$site_root/.unified-test-stage.XXXXXXXX")
cp -a website/dist/. "$stage/"
chmod -R u=rwX,go=rX "$stage"
target_inode=$(stat -c '%d:%i' "$stage")
# Rename without replacement: never overwrite an existing route.
# Record rollback eligibility before the atomic rename; inode matching protects an existing target.
installed=1
python3 - "$stage" "$target" <<'PY'
import ctypes,os,sys
libc=ctypes.CDLL(None,use_errno=True)
fn=getattr(libc,'renameat2',None)
if fn is None: raise SystemExit('UNIFIED_SITE_RENAME_UNAVAILABLE')
fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
fn.restype=ctypes.c_int
if fn(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),1):
 e=ctypes.get_errno();raise OSError(e,os.strerror(e))
PY
stage=''
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/unified-test/ -o "$work/unified-after.html"
cmp -s website/dist/index.html "$work/unified-after.html" || { echo UNIFIED_SITE_ROUTE_NOT_SERVED; exit 1; }
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 "https://globaldroptrade.com/unified-test/$entry" -o "$work/entry-after.js"
cmp -s "website/dist/$entry" "$work/entry-after.js" || { echo UNIFIED_SITE_ASSET_NOT_SERVED; exit 1; }
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$work/main-after.html"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/hourly-test/ -o "$work/hourly-after.html"
cmp -s "$work/main-before.html" "$work/main-after.html" && cmp -s "$work/hourly-before.html" "$work/hourly-after.html" || { echo UNIFIED_SITE_LEGACY_CHANGED; exit 1; }
installed=0
echo "UNIFIED_SITE_INSTALLED=https://globaldroptrade.com/unified-test/"
echo "UNIFIED_SITE_SOURCE_SHA=$sha"
echo 'UNIFIED_SITE_ONLY_NO_MIGRATION_NO_KEEPER_NO_CHAIN_TRANSACTION'
