#!/usr/bin/env bash
# Refresh the existing reviewed BNB Testnet mocks without changing their answers.
set +x
set -Eeuo pipefail
[ "$#" -eq 1 ] && [ "$1" = --execute ] || { echo 'Usage: bash ubuntu-refresh-new-deployer-oracles.sh --execute'; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo ROOT_REQUIRED; exit 1; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo UNSUPPORTED_CPU; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for command in node npm systemctl flock; do command -v "$command" >/dev/null; done
umask 077
state=/var/lib/globaldroptrade/new-deployer-testnet-v1
node --input-type=module - "$state" <<'JS'
import fs from 'node:fs';const s=fs.lstatSync(process.argv[2]);
if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('ORACLE_PRIVATE_DIRECTORY_REQUIRED');
JS
locks=(
 "$state/run.lock"
 /var/lib/globaldroptrade/fresh-fast-reset-20261107/run.lock
 /var/lib/globaldroptrade/fast-testnet-setup-v1/setup.lock
 /var/lib/globaldroptrade/fresh-fast-testnet-v1/run.lock
 /var/lib/globaldroptrade/fresh-fast-testnet-v1/setup.lock
 /var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/run.lock
 /var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/setup.lock
 /var/lib/globaldroptrade/fresh-fast-testnet-connection/run.lock
 /var/lib/globaldroptrade/automation-v1/run.lock
 /var/lib/globaldroptrade/automation-v1/setup.lock
 /var/lib/globaldroptrade/oracle-maintenance-v1/run.lock
 /var/lib/globaldroptrade/oracle-maintenance-v1/setup.lock
 /var/lib/globaldroptrade/zero-oracle-repair-v1/setup.lock
 /var/lib/globaldroptrade/worker-sync-v1/run.lock
 /var/lib/globaldroptrade/smart-worker-v1/run.lock
 /var/lib/globaldroptrade/rpc-failover-v1/install.lock
 /var/lib/globaldroptrade/fresh-zero-automation-v1/run.lock
 /var/lib/globaldroptrade/fresh-zero-automation-v1/setup.lock
)
units=(globaldroptrade-smart-worker globaldroptrade-rpc-failover globaldroptrade-position-index globaldroptrade-zero-daily globaldroptrade-automation globaldroptrade-oracles globaldroptrade-migration globaldroptrade-fresh-rewards globaldroptrade-new-deployer-daily)
quiescent(){
 for base in "${units[@]}"; do
  for suffix in service timer; do
   unit="$base.$suffix"
   load=$(systemctl show --property=LoadState --value "$unit") || { echo ORACLE_SYSTEMD_REQUIRED; return 1; }
   active=$(systemctl show --property=ActiveState --value "$unit") || { echo ORACLE_SYSTEMD_REQUIRED; return 1; }
   case "$load:$active" in loaded:inactive|loaded:failed|not-found:|not-found:inactive|not-found:failed) ;; *) echo "ORACLE_UNIT_ACTIVE=$unit"; return 1;; esac
   if [ "$suffix" = timer ] && [ "$load" = loaded ]; then
    enabled=$(systemctl show --property=UnitFileState --value "$unit") || return 1
    case "$enabled" in disabled|static|indirect|masked) ;; *) echo "ORACLE_TIMER_ENABLED=$unit"; return 1;; esac
   fi
  done
 done
}
quiescent
for lock in "${locks[@]}"; do
 parent=$(dirname -- "$lock")
 if [ ! -e "$parent" ] && [ ! -L "$parent" ]; then continue; fi
 node --input-type=module - "$lock" <<'JS'
import fs from 'node:fs';import path from 'node:path';
const file=process.argv[2],s=fs.lstatSync(path.dirname(file));
if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('ORACLE_LOCK_DIRECTORY_REQUIRED');
let fd;try{try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}catch(e){if(e.code!=='ENOENT')throw e;fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);}const p=fs.fstatSync(fd);if(!p.isFile()||p.uid!==0||(p.mode&0o077)!==0)throw Error('ORACLE_LOCK_REQUIRED');}finally{if(fd!==undefined)fs.closeSync(fd);}
JS
 exec {fd}<"$lock"
 flock -n "$fd" || { echo "ORACLE_LOCK_BUSY=$lock"; exit 1; }
done
quiescent
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
exec node scripts/refresh-new-deployer-testnet-oracles.mjs --execute
