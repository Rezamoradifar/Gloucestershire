#!/usr/bin/env bash
# Publish a fixed testnet wallet permission page; no transaction is signed here.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] && [ "$#" -eq 0 ] || { echo 'Run as root without arguments'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for command in node npm python3 curl flock; do command -v "$command" >/dev/null; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("Node 22.12+ required")'
umask 077
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
backup="/var/backups/globaldroptrade/zero-permission-$(date -u +%Y%m%dT%H%M%S)-$$"
python3 - "$backup" <<'PY'
import importlib.util,os,stat,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('permission_installer','scripts/install-zero-start-permission.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
parent=module.shared._directories(Path('/'),Path('var/backups/globaldroptrade'),create=True,mode=0o700)
module.shared._backup_directory(Path(sys.argv[1]),create=True)
lock=parent/'zero-permission.lock'
if lock.exists() or lock.is_symlink():
 info=lock.lstat()
 if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077:raise SystemExit('PRIVATE_PERMISSION_LOCK_REQUIRED')
PY
exec 9>/var/backups/globaldroptrade/zero-permission.lock
flock -n 9 || { echo 'Another permission console installation is running'; exit 1; }
unset GLOBAL_DAILY_POLICY GLOBAL_AUTOMATION_STATE
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/zero-start-readiness.mjs status
rollback(){
 trap - ERR INT TERM
 set +e
 restored=1
 if [ -f "$backup/manifest.json" ]; then python3 scripts/install-zero-start-permission.py --restore "$backup" || restored=0; fi
 echo "ZERO_START_PERMISSION_INSTALL_FAILED recoveryVerified=$restored backup=$backup"
 exit 1
}
trap rollback ERR INT TERM
python3 scripts/install-zero-start-permission.py --backup-dir "$backup"
folder=$(python3 - "$backup/installed.json" <<'PY'
import json,re,sys
value=json.load(open(sys.argv[1]))
if value.get('version')!=1 or not re.fullmatch('zero-permission-[0-9a-f]{20}',value.get('folder','')):raise SystemExit('PERMISSION_INSTALL_RECORD_INVALID')
print(value['folder'])
PY
)
base=https://globaldroptrade.com/deploy
curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 "$base/zero-start-permission.html" -o "$stage/redirect.html"
for asset in zero-start-permission.html zero-start-permission.js zero-start-permission-core.js ethers.js style.css; do
 curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 "$base/$folder/$asset" -o "$stage/$asset"
done
python3 - "$backup/installed.json" "$stage" <<'PY'
import hashlib,json,sys
from pathlib import Path
record=json.load(open(sys.argv[1]));stage=Path(sys.argv[2])
assets=('zero-start-permission.html','zero-start-permission.js','zero-start-permission-core.js','ethers.js','style.css')
if set(record['assets'])!=set(assets):raise SystemExit('PERMISSION_INSTALL_RECORD_INVALID')
expected={'redirect.html':record['redirectSha256'],**record['assets']}
for name,digest in expected.items():
 if hashlib.sha256((stage/name).read_bytes()).hexdigest()!=digest:raise SystemExit('HTTPS_PERMISSION_ASSET_MISMATCH')
PY
trap - ERR INT TERM
echo "ZERO_START_PERMISSION_PAGE_READY backup=$backup"
echo 'https://globaldroptrade.com/deploy/zero-start-permission.html'
echo 'Open this page in the owner wallet browser. Every governance transaction requires explicit wallet confirmation.'
