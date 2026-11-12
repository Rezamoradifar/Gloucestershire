#!/usr/bin/env bash
# Deploy a new empty BNB Testnet V2 vault, preserving the active V1 site and timer.
# No state deletion, no website cutover and no mainnet transactions.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

usage() { echo 'Usage: bash ubuntu-testnet-zero-v2-deploy.sh --check|--execute'; }
[ "$#" -eq 1 ] || { usage; exit 1; }
case "$1" in --check|--execute) mode="$1";; *) usage; exit 1;; esac
[ "$(id -u)" -eq 0 ] || { echo 'ZERO_V2_ROOT_REQUIRED'; exit 1; }

case "$(uname -m)" in
 x86_64) arch=x64;;
 aarch64|arm64) arch=arm64;;
 *) echo 'ZERO_V2_UNSUPPORTED_CPU'; exit 1;;
esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for tool in git node npm python3 systemctl flock install; do
 command -v "$tool" >/dev/null || { echo "ZERO_V2_TOOL_MISSING_$tool"; exit 1; }
done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22||(major===22&&minor<12))throw Error("NODE_22_12_REQUIRED")'

npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/preflight-testnet-zero-v2.mjs --check
node scripts/testnet-zero-v2-deploy.mjs --plan
if [ "$mode" = --check ]; then
 echo 'ZERO_V2_WRAPPER_CHECK_PASS'
 echo 'No signing key opened or blockchain transaction sent.'
 exit 0
fi

# Only explicit --execute reaches this section.
# The active V1 timer is temporarily disabled, but in-flight service work is
# allowed to finish naturally. Failure does not force-stop an in-flight signer.
state=/var/lib/globaldroptrade/testnet-zero-v2
if [ ! -e "$state" ] && [ ! -L "$state" ]; then install -d -m 700 "$state"; fi
node --input-type=module - "$state" <<'JS'
import fs from 'node:fs';
const dir=process.argv[2],meta=fs.lstatSync(dir);
if(!meta.isDirectory()||meta.uid!==0||(meta.mode&0o077)!==0)throw Error('ZERO_V2_PRIVATE_DIRECTORY_REQUIRED');
JS
node --input-type=module - "$state/setup.lock" <<'JS'
import fs from 'node:fs';
const file=process.argv[2];let fd;
try{
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}
 catch(error){
  if(error.code!=='ENOENT')throw error;
  fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);
 }
 const stat=fs.fstatSync(fd);
 if(!stat.isFile()||stat.uid!==0||(stat.mode&0o077)!==0||stat.nlink!==1)throw Error('ZERO_V2_SETUP_LOCK_REQUIRED');
}finally{if(fd!==undefined)fs.closeSync(fd);}
JS
exec 9<"$state/setup.lock"
flock -n 9 || { echo 'ZERO_V2_ALREADY_RUNNING'; exit 1; }

timer=globaldroptrade-new-deployer-daily.timer
service=globaldroptrade-new-deployer-daily.service
load=$(systemctl show --property=LoadState --value "$timer")
[ "$load" = loaded ] || { echo 'ZERO_V2_EXISTING_TIMER_REQUIRED'; exit 1; }
original_active=$(systemctl show --property=ActiveState --value "$timer")
original_enabled=$(systemctl show --property=UnitFileState --value "$timer")
case "$original_active" in active|inactive|failed) ;; *) echo 'ZERO_V2_TIMER_STATE_REVIEW_REQUIRED'; exit 1;; esac
case "$original_enabled" in enabled|disabled|static) ;; *) echo 'ZERO_V2_TIMER_ENABLE_STATE_REVIEW_REQUIRED'; exit 1;; esac

timer_changed=0
restore_timer() {
 local result=0
 if [ "$timer_changed" -eq 0 ]; then return 0; fi
 if [ "$original_enabled" = enabled ]; then
  systemctl enable "$timer" || result=1
 fi
 if [ "$original_active" = active ]; then
  systemctl start "$timer" || result=1
 fi
 if [ "$result" -ne 0 ]; then
  echo 'ZERO_V2_OLD_TIMER_RESTORE_FAILED_MANUAL_REVIEW_REQUIRED' >&2
  return 1
 fi
 timer_changed=0
 echo 'ZERO_V2_PREVIOUS_TIMER_STATE_RESTORED'
}
cleanup() {
 local status=$?
 trap - EXIT
 restore_timer || status=1
 exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

timer_changed=1
systemctl stop "$timer"
if [ "$original_enabled" = enabled ]; then systemctl disable "$timer"; fi
for attempt in {1..180}; do
 current=$(systemctl show --property=ActiveState --value "$service")
 case "$current" in
  inactive|failed) break;;
  active|activating|deactivating|reloading) ;;
  *) echo 'ZERO_V2_OLD_SERVICE_STATE_UNKNOWN'; exit 1;;
 esac
 if [ "$attempt" -eq 180 ]; then echo 'ZERO_V2_OLD_SERVICE_BUSY'; exit 1; fi
 sleep 1
done

# Independent V2 journal and old-worker lock are enforced again by the Node gate.
node scripts/testnet-zero-v2-deploy.mjs --execute
echo 'ZERO_V2_DEPLOYMENT_FINISHED_V1_SITE_UNCHANGED'
echo 'V1 timer will be restored to its original enabled/active state.'
