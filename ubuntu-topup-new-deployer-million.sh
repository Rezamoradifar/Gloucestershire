#!/usr/bin/env bash
# One target-bound BNB Testnet reward top-up. No production token or account is used.
set +x
set -Eeuo pipefail
[ "$#" -eq 1 ] && [ "$1" = --execute ] || { echo 'Usage: bash ubuntu-topup-new-deployer-million.sh --execute'; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo 'ROOT_REQUIRED'; exit 1; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'UNSUPPORTED_CPU'; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for command in node npm systemctl flock; do command -v "$command" >/dev/null; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("NODE_22_12_REQUIRED")'
umask 077

legacy_services=(globaldroptrade-smart-worker.service globaldroptrade-rpc-failover.service globaldroptrade-position-index.service globaldroptrade-zero-daily.service globaldroptrade-automation.service globaldroptrade-oracles.service globaldroptrade-migration.service globaldroptrade-fresh-rewards.service)
legacy_timers=(globaldroptrade-smart-worker.timer globaldroptrade-rpc-failover.timer globaldroptrade-position-index.timer globaldroptrade-zero-daily.timer globaldroptrade-automation.timer globaldroptrade-oracles.timer)
quiescent(){
 local unit load active enabled
 for unit in "${legacy_services[@]}" "${legacy_timers[@]}"; do
  load=$(systemctl show --property=LoadState --value "$unit" 2>/dev/null) || { echo 'TOPUP_SYSTEMD_INSPECTION_REQUIRED'; return 1; }
  active=$(systemctl show --property=ActiveState --value "$unit" 2>/dev/null) || { echo 'TOPUP_SYSTEMD_INSPECTION_REQUIRED'; return 1; }
  case "$load:$active" in loaded:inactive|loaded:failed|not-found:|not-found:inactive|not-found:failed) ;; *) echo "TOPUP_LEGACY_UNIT_ACTIVE unit=$unit"; return 1;; esac
  if [[ "$unit" = *.timer ]] && [ "$load" = loaded ]; then
   enabled=$(systemctl show --property=UnitFileState --value "$unit" 2>/dev/null) || return 1
   case "$enabled" in disabled|static|indirect|masked) ;; *) echo "TOPUP_LEGACY_TIMER_ENABLED unit=$unit"; return 1;; esac
  fi
 done
}

locks=(
 /var/lib/globaldroptrade/new-deployer-testnet-v1/run.lock
 /var/lib/globaldroptrade/new-deployer-testnet-connection/run.lock
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
quiescent
for lock in "${locks[@]}"; do
 parent=$(dirname -- "$lock")
 if [ ! -e "$parent" ] && [ ! -L "$parent" ]; then continue; fi
 node --input-type=module - "$lock" <<'JS'
import fs from 'node:fs';import path from 'node:path';
const file=process.argv[2],s=fs.lstatSync(path.dirname(file));
if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('TOPUP_LOCK_DIRECTORY_REQUIRED');
let fd;try{try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}catch(e){if(e.code!=='ENOENT')throw e;fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);}const p=fs.fstatSync(fd);if(!p.isFile()||p.uid!==0||(p.mode&0o077)!==0||p.nlink!==1)throw Error('TOPUP_LOCK_REQUIRED');}finally{if(fd!==undefined)fs.closeSync(fd);}
JS
 exec {lock_fd}<"$lock"
 flock -n "$lock_fd" || { echo "TOPUP_LOCK_BUSY lock=$lock"; exit 1; }
done
quiescent
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
exec node scripts/topup-new-deployer-million.mjs --execute
