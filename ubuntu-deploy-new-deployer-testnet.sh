#!/usr/bin/env bash
# Independent BNB Testnet deployment; it never modifies legacy state or journals.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

usage(){
 echo 'Usage: bash ubuntu-deploy-new-deployer-testnet.sh --setup-key|--check|--execute'
}

[ "$#" -eq 1 ] || { usage; exit 1; }
case "$1" in --setup-key|--check|--execute) mode="$1";; *) usage; exit 1;; esac
[ "$(id -u)" -eq 0 ] || { echo 'ROOT_REQUIRED'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'UNSUPPORTED_CPU'; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for command in node npm flock systemctl stat dirname; do command -v "$command" >/dev/null || { echo "MISSING_$command"; exit 1; }; done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<12))throw Error("NODE_22_12_REQUIRED")'

umask 077
state=/var/lib/globaldroptrade/new-deployer-testnet-v1
keydir=/etc/globaldroptrade/new-deployer-testnet-v1
keyfile="$keydir/deployer.key"
expected=0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d
legacy_services=(
 globaldroptrade-smart-worker.service
 globaldroptrade-rpc-failover.service
 globaldroptrade-position-index.service
 globaldroptrade-zero-daily.service
 globaldroptrade-automation.service
 globaldroptrade-oracles.service
 globaldroptrade-migration.service
 globaldroptrade-fresh-rewards.service
)
legacy_timers=(
 globaldroptrade-smart-worker.timer
 globaldroptrade-rpc-failover.timer
 globaldroptrade-position-index.timer
 globaldroptrade-zero-daily.timer
 globaldroptrade-automation.timer
 globaldroptrade-oracles.timer
)
legacy_locks=(
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

private_directory(){
 node --input-type=module - "$1" <<'JS'
import fs from 'node:fs';
const directory=process.argv[2];
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const info=fs.lstatSync(directory);
if(!info.isDirectory()||info.uid!==0||(info.mode&0o077)!==0)throw Error('NEW_DEPLOYER_PRIVATE_DIRECTORY_REQUIRED');
JS
}

install_runtime_dependencies(){
 npm ci --omit=dev --ignore-scripts --no-audit --no-fund
}

legacy_unit_quiescent(){
 local unit load active state
 for unit in "${legacy_services[@]}"; do
  load=$(systemctl show --property=LoadState --value "$unit") || { echo 'NEW_DEPLOYER_SIGNER_STATUS_REQUIRED'; return 1; }
  case "$load" in loaded|not-found) ;; *) echo 'NEW_DEPLOYER_SIGNER_STATUS_REQUIRED'; return 1;; esac
  active=$(systemctl show --property=ActiveState --value "$unit") || { echo 'NEW_DEPLOYER_SIGNER_STATUS_REQUIRED'; return 1; }
  if [ "$load" = not-found ]; then
   case "$active" in ''|inactive|failed) continue;; *) echo "NEW_DEPLOYER_LEGACY_SIGNER_ACTIVE unit=$unit"; return 1;; esac
  fi
  case "$active" in inactive|failed) ;; *) echo "NEW_DEPLOYER_LEGACY_SIGNER_ACTIVE unit=$unit"; return 1;; esac
 done
 for unit in "${legacy_timers[@]}"; do
  load=$(systemctl show --property=LoadState --value "$unit") || { echo 'NEW_DEPLOYER_SIGNER_STATUS_REQUIRED'; return 1; }
  case "$load" in loaded|not-found) ;; *) echo 'NEW_DEPLOYER_SIGNER_STATUS_REQUIRED'; return 1;; esac
  active=$(systemctl show --property=ActiveState --value "$unit") || { echo 'NEW_DEPLOYER_SIGNER_STATUS_REQUIRED'; return 1; }
  if [ "$load" = not-found ]; then
   case "$active" in ''|inactive|failed) continue;; *) echo "NEW_DEPLOYER_LEGACY_SIGNER_ACTIVE unit=$unit"; return 1;; esac
  fi
  case "$active" in inactive|failed) ;; *) echo "NEW_DEPLOYER_LEGACY_SIGNER_ACTIVE unit=$unit"; return 1;; esac
  state=$(systemctl show --property=UnitFileState --value "$unit") || { echo 'NEW_DEPLOYER_SIGNER_STATUS_REQUIRED'; return 1; }
  case "$state" in disabled|static|indirect|masked) ;; *) echo "NEW_DEPLOYER_LEGACY_TIMER_ENABLED unit=$unit"; return 1;; esac
 done
}

prepare_legacy_lock(){
 node --input-type=module - "$1" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const file=process.argv[2],directory=path.dirname(file);
const parent=fs.lstatSync(directory);
if(!parent.isDirectory()||parent.uid!==0||(parent.mode&0o077)!==0)throw Error('NEW_DEPLOYER_LEGACY_LOCK_DIRECTORY_REQUIRED');
let descriptor;
try{
 try{descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}
 catch(error){
  if(error?.code!=='ENOENT')throw error;
  descriptor=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);
 }
 const info=fs.fstatSync(descriptor);
 if(!info.isFile()||info.uid!==0||(info.mode&0o077)!==0)throw Error('NEW_DEPLOYER_LEGACY_LOCK_REQUIRED');
}finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
JS
}

hold_legacy_locks(){
 local lock parent fd
 for lock in "${legacy_locks[@]}"; do
  parent=$(dirname "$lock")
  if [ ! -e "$parent" ] && [ ! -L "$parent" ]; then continue; fi
  prepare_legacy_lock "$lock" || { echo 'NEW_DEPLOYER_LEGACY_LOCK_REQUIRED'; return 1; }
  exec {fd}<"$lock"
  flock -n "$fd" || { echo "NEW_DEPLOYER_LEGACY_LOCK_BUSY lock=$lock"; return 1; }
 done
}

setup_key(){
 private_directory "$keydir"
 if [ -e "$keyfile" ] || [ -L "$keyfile" ]; then
  echo 'NEW_DEPLOYER_KEY_ALREADY_EXISTS_PRESERVED'
  exit 1
 fi
 printf 'Enter only the BNB Testnet deployer private key (input hidden): ' >&2
 IFS= read -r -s entered_key
 printf '\n' >&2
 if [ -z "$entered_key" ]; then unset entered_key; echo 'NEW_DEPLOYER_KEY_REQUIRED'; exit 1; fi
 if ! printf '%s\n' "$entered_key" | node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
import {Wallet,getAddress} from "ethers";
try{
 const [target,expected]=process.argv.slice(1);
 const value=fs.readFileSync(0,"utf8").trim();
 if(!/^(0x)?[0-9a-fA-F]{64}$/.test(value))throw Error("NEW_DEPLOYER_KEY_INVALID");
 let signer;
 try{signer=getAddress(new Wallet(value.startsWith("0x")?value:"0x"+value).address);}
 catch{throw Error("NEW_DEPLOYER_KEY_INVALID");}
 if(signer!==getAddress(expected))throw Error("NEW_DEPLOYER_KEY_ADDRESS_REQUIRED");
 const directory=path.dirname(target),info=fs.lstatSync(directory);
 if(!info.isDirectory()||info.uid!==0||(info.mode&0o077)!==0)throw Error("NEW_DEPLOYER_PRIVATE_DIRECTORY_REQUIRED");
 if(fs.existsSync(target))throw Error("NEW_DEPLOYER_KEY_ALREADY_EXISTS_PRESERVED");
 let temporary,descriptor,created=false;
 try{
  temporary=path.join(directory,".deployer.key."+process.pid+"."+Date.now());
  descriptor=fs.openSync(temporary,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  created=true;
  fs.writeFileSync(descriptor,(value.startsWith("0x")?value.slice(2):value)+"\n");
  fs.fsyncSync(descriptor);
  fs.closeSync(descriptor);descriptor=undefined;
  fs.linkSync(temporary,target);
 }finally{
  if(descriptor!==undefined)fs.closeSync(descriptor);
  if(created&&temporary){try{fs.unlinkSync(temporary);}catch{}}
 }
 const saved=fs.lstatSync(target);
 if(!saved.isFile()||saved.uid!==0||(saved.mode&0o077)!==0)throw Error("KEY_FILE_MUST_BE_ROOT_ONLY_MODE_600");
}catch(error){
 const code=/^NEW_DEPLOYER_[A-Z0-9_]+$/.test(error?.message||"")?error.message:"NEW_DEPLOYER_KEY_SETUP_FAILED";
 console.error(code);
 process.exitCode=1;
}
' "$keyfile" "$expected"; then
  unset entered_key
  echo 'NEW_DEPLOYER_KEY_SETUP_FAILED'
  exit 1
 fi
 unset entered_key
 echo 'NEW_DEPLOYER_KEY_READY'
}

if [ "$mode" = --setup-key ]; then
 install_runtime_dependencies
 setup_key
 exit 0
fi

private_directory "$state"
private_directory "$keydir"
[ -f "$keyfile" ] && [ ! -L "$keyfile" ] || { echo 'NEW_DEPLOYER_KEY_FILE_REQUIRED'; exit 1; }
[ -f /etc/globaldroptrade/trades.env ] && [ ! -L /etc/globaldroptrade/trades.env ] || { echo 'NEW_DEPLOYER_ENV_REQUIRED'; exit 1; }
if [ -e "$state/run.lock" ] || [ -L "$state/run.lock" ]; then
 node --input-type=module - "$state/run.lock" <<'JS'
import fs from 'node:fs';
const file=process.argv[2],info=fs.lstatSync(file);
if(!info.isFile()||info.uid!==0||(info.mode&0o077)!==0)throw Error('NEW_DEPLOYER_PRIVATE_LOCK_REQUIRED');
JS
fi
exec 9>"$state/run.lock"
flock -n 9 || { echo 'NEW_DEPLOYER_TESTNET_ALREADY_RUNNING'; exit 1; }
legacy_unit_quiescent || exit 1
hold_legacy_locks || exit 1
legacy_unit_quiescent || exit 1

install_runtime_dependencies
if [ "$mode" = --check ]; then
 exec node --env-file=/etc/globaldroptrade/trades.env scripts/deploy-new-deployer-testnet.mjs --check
fi
echo 'Deploying only FastNewDeployerTestnetVault on BNB Testnet 97. Maximum cumulative transaction fee: 0.1 test BNB.'
exec node --env-file=/etc/globaldroptrade/trades.env scripts/deploy-new-deployer-testnet.mjs --execute
