#!/usr/bin/env bash
# Atomically connect the independently verified replacement-deployer testnet vault.
# It does not invoke a V1 reset/deploy script and deliberately leaves financial workers stopped.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

[ "${1:-}" = --execute ] && [ "$#" -eq 1 ] || { echo 'Usage: bash ubuntu-connect-new-deployer-testnet.sh --execute'; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU'; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for tool in node npm nginx curl python3 systemctl flock tar sha256sum cmp install; do command -v "$tool" >/dev/null; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("Node 22.12+ required")'

data_root=/var/lib/globaldroptrade
state_dir="$data_root/new-deployer-testnet-v1"
connection_dir="$data_root/new-deployer-testnet-connection"
legacy_session="$data_root/fresh-fast-reset-20261107/session.json"
envfile=/etc/globaldroptrade/trades.env
unit=/etc/systemd/system/globaldroptrade-api.service
api_root=/opt/globaldroptrade-api
backup_root=/var/backups/globaldroptrade
nginx_root=/etc/nginx
report="$state_dir/connection-public.json"
deployment="$state_dir/deployment-public.json"
new_worker_state="$data_root/new-deployer-testnet-automation-v1"
new_worker_setup_lock="$new_worker_state/setup.lock"
new_worker_run_lock="$new_worker_state/run.lock"
new_worker_service=globaldroptrade-new-deployer-daily.service
new_worker_timer=globaldroptrade-new-deployer-daily.timer
new_worker_units=("$new_worker_service" "$new_worker_timer")
systemd_unit_dir=/etc/systemd/system

unit_info(){
 local unit=$1 load active
 load=$(systemctl show --property=LoadState --value "$unit" 2>/dev/null) || { echo 'NEW_DEPLOYER_SYSTEMD_INSPECTION_REQUIRED' >&2; return 1; }
 active=$(systemctl show --property=ActiveState --value "$unit" 2>/dev/null) || { echo 'NEW_DEPLOYER_SYSTEMD_INSPECTION_REQUIRED' >&2; return 1; }
 case "$load" in
  loaded) case "$active" in active|activating|deactivating|reloading|inactive|failed) ;; *) echo 'NEW_DEPLOYER_SYSTEMD_STATE_UNSAFE' >&2; return 1;; esac;;
  not-found) case "$active" in ''|inactive|failed) ;; *) echo 'NEW_DEPLOYER_UNMANAGED_WORKER_ACTIVE' >&2; return 1;; esac;;
  *) echo 'NEW_DEPLOYER_SYSTEMD_STATE_UNSAFE' >&2; return 1;;
 esac
 printf '%s|%s\n' "$load" "$active"
}

unit_file_state(){
 local unit=$1 state
 state=$(systemctl show --property=UnitFileState --value "$unit" 2>/dev/null) || { echo 'NEW_DEPLOYER_SYSTEMD_INSPECTION_REQUIRED' >&2; return 1; }
 case "$state" in enabled|enabled-runtime|disabled|static|indirect|masked|masked-runtime) ;; *) echo 'NEW_DEPLOYER_SYSTEMD_STATE_UNSAFE' >&2; return 1;; esac
 printf '%s\n' "$state"
}

# A connection re-run must never replace the API target while the independent
# replacement-deployer worker is scheduled or executing. The worker lock below
# protects manual execution; these checks cover units created by its installer.
assert_new_worker_quiescent(){
 local worker info load active enabled
 for worker in "${new_worker_units[@]}"; do
  info=$(unit_info "$worker") || return 1
  IFS='|' read -r load active <<< "$info"
  if [ "$load" = not-found ]; then
   [ ! -e "$systemd_unit_dir/$worker" ] && [ ! -L "$systemd_unit_dir/$worker" ] || { echo "NEW_DEPLOYER_NEW_WORKER_UNIT_REVIEW_REQUIRED unit=$worker" >&2; return 1; }
   continue
  fi
  case "$active" in inactive|failed) ;; *) echo "NEW_DEPLOYER_NEW_WORKER_ACTIVE unit=$worker" >&2; return 1;; esac
  enabled=$(unit_file_state "$worker") || return 1
  case "$enabled" in enabled|enabled-runtime) echo "NEW_DEPLOYER_NEW_WORKER_ENABLED unit=$worker" >&2; return 1;; esac
 done
}

prepare_new_worker_setup_lock(){
 node --input-type=module - "$data_root" "$new_worker_state" "$new_worker_setup_lock" <<'JS'
import fs from 'node:fs';
const [root,directory,setup]=process.argv.slice(2);
const privateDirectory=target=>{
 const stat=fs.lstatSync(target);
 if(!stat.isDirectory()||stat.uid!==0||(stat.mode&0o077)!==0)throw Error('NEW_DEPLOYER_NEW_WORKER_DIRECTORY_REQUIRED');
};
const trustedRoot=target=>{
 const stat=fs.lstatSync(target);
 if(!stat.isDirectory()||stat.uid!==0||(stat.mode&0o022)!==0)throw Error('NEW_DEPLOYER_NEW_WORKER_DIRECTORY_REQUIRED');
};
trustedRoot(root);
try{fs.mkdirSync(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
privateDirectory(directory);
let descriptor;
try{
 try{descriptor=fs.openSync(setup,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}
 catch(error){
  if(error.code!=='ENOENT')throw error;
  descriptor=fs.openSync(setup,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);
 }
 const stat=fs.fstatSync(descriptor);
 if(!stat.isFile()||stat.uid!==0||(stat.mode&0o077)!==0||stat.nlink!==1)throw Error('NEW_DEPLOYER_NEW_WORKER_SETUP_LOCK_REQUIRED');
}finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
JS
}

acquire_new_worker_run_lock(){
 node --input-type=module - "$new_worker_state" "$new_worker_run_lock" "$$" <<'JS'
import fs from 'node:fs';
const [directory,run,pidText]=process.argv.slice(2);
const directoryStat=fs.lstatSync(directory);
if(!directoryStat.isDirectory()||directoryStat.uid!==0||(directoryStat.mode&0o077)!==0)throw Error('NEW_DEPLOYER_NEW_WORKER_DIRECTORY_REQUIRED');
if(fs.existsSync(run)){
 let fd;
 try{
  fd=fs.openSync(run,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const stat=fs.fstatSync(fd),raw=fs.readFileSync(fd,'utf8').trim();
  if(!stat.isFile()||stat.uid!==0||(stat.mode&0o077)!==0||stat.nlink!==1||!(/^[1-9][0-9]*$/).test(raw))throw Error('NEW_DEPLOYER_NEW_WORKER_LOCK_INVALID');
  try{process.kill(Number(raw),0);}catch(error){if(error.code==='ESRCH')throw Error('NEW_DEPLOYER_NEW_WORKER_LOCK_STALE_REVIEW_REQUIRED');throw error;}
  throw Error('NEW_DEPLOYER_NEW_WORKER_LOCK_ACTIVE');
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
if(!(/^[1-9][0-9]*$/).test(pidText))throw Error('NEW_DEPLOYER_NEW_WORKER_LOCK_INVALID');
let descriptor;
try{
 descriptor=fs.openSync(run,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
 fs.writeFileSync(descriptor,pidText);fs.fsyncSync(descriptor);
 const stat=fs.fstatSync(descriptor);
 if(!stat.isFile()||stat.uid!==0||(stat.mode&0o077)!==0||stat.nlink!==1)throw Error('NEW_DEPLOYER_NEW_WORKER_LOCK_INVALID');
}finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
JS
}

release_new_worker_lock(){
 node --input-type=module - "$new_worker_run_lock" "$$" <<'JS'
import fs from 'node:fs';
const [file,pid]=process.argv.slice(2);let descriptor;
try{
 descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 const stat=fs.fstatSync(descriptor),entry=fs.readFileSync(descriptor,'utf8');
 if(!stat.isFile()||stat.uid!==0||(stat.mode&0o077)!==0||stat.nlink!==1||entry!==pid)throw Error('NEW_DEPLOYER_NEW_WORKER_LOCK_CHANGED');
 fs.unlinkSync(file);
}finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
JS
}

test -s "$envfile" && test -f "$unit" && test -s "$deployment" && test -s "$legacy_session"
previous=$(readlink -f "$api_root/current")
test -d "$previous"

umask 077
node --input-type=module - "$connection_dir" "$state_dir" "$legacy_session" <<'JS'
import fs from 'node:fs';
const [directory,state,archive]=process.argv.slice(2);
for(const [target,create] of [[directory,true],[state,false]]){
 if(create)fs.mkdirSync(target,{recursive:true,mode:0o700});
 const stat=fs.lstatSync(target);if(!stat.isDirectory()||stat.uid!==0||(stat.mode&0o077)!==0)throw Error('NEW_DEPLOYER_PRIVATE_DIRECTORY_REQUIRED');
}
for(const target of [archive,state+'/deployment-public.json']){
 const stat=fs.lstatSync(target);if(!stat.isFile()||stat.uid!==0||(stat.mode&0o077)!==0)throw Error('NEW_DEPLOYER_PRIVATE_FILE_REQUIRED');
}
JS
exec 9>"$connection_dir/run.lock"
flock -n 9 || { echo 'Another replacement-deployer connection is running'; exit 1; }
stage=
new_worker_lock_owned=0
cleanup(){
 local status=$?
 trap - EXIT
 if [ "$new_worker_lock_owned" -eq 1 ]; then
  if ! release_new_worker_lock; then echo 'NEW_DEPLOYER_NEW_WORKER_LOCK_CLEANUP_REQUIRED' >&2; status=1; fi
 fi
 if [ -n "${stage:-}" ] && [ -d "$stage" ]; then rm -rf -- "$stage" || status=1; fi
 exit "$status"
}
trap cleanup EXIT
assert_new_worker_quiescent
prepare_new_worker_setup_lock
exec 8<"$new_worker_setup_lock"
flock -n 8 || { echo 'NEW_DEPLOYER_NEW_WORKER_SETUP_LOCKED'; exit 1; }
assert_new_worker_quiescent
acquire_new_worker_run_lock
new_worker_lock_owned=1
assert_new_worker_quiescent
legacy_locks=(
 "$data_root/fresh-fast-reset-20261107/run.lock"
 "$data_root/fast-testnet-setup-v1/setup.lock"
 "$data_root/zero-oracle-repair-v1/setup.lock"
 "$data_root/fresh-fast-testnet-connection/run.lock"
 "$data_root/worker-sync-v1/run.lock"
 "$data_root/smart-worker-v1/run.lock"
 "$data_root/rpc-failover-v1/install.lock"
 "$data_root/fresh-fast-testnet-v1/setup.lock"
 "$data_root/fresh-fast-testnet-v1/run.lock"
 "$data_root/fresh-fast-testnet-automation-v1/setup.lock"
 "$data_root/fresh-fast-testnet-automation-v1/run.lock"
)
available_legacy_locks=$(node --input-type=module - "${legacy_locks[@]}" <<'JS'
import fs from 'node:fs';
for(const lock of process.argv.slice(2)){
 let parent;try{parent=fs.lstatSync(lock.substring(0,lock.lastIndexOf('/')));}catch(error){if(error.code==='ENOENT')continue;throw error;}
 if(!parent.isDirectory()||parent.uid!==0||(parent.mode&0o077)!==0)throw Error('NEW_DEPLOYER_LEGACY_LOCK_PATH_REQUIRED');
 if(fs.existsSync(lock)){
  const stat=fs.lstatSync(lock);
  if(!stat.isFile()||stat.uid!==0||(stat.mode&0o077)!==0)throw Error('NEW_DEPLOYER_LEGACY_LOCK_REQUIRED');
 }
 console.log(lock);
}
JS
)
mapfile -t available_legacy_locks <<< "$available_legacy_locks"
for lock in "${available_legacy_locks[@]}"; do
 [ ! -L "$lock" ] || { echo 'NEW_DEPLOYER_LEGACY_LOCK_REQUIRED'; exit 1; }
 exec {lock_fd}>>"$lock"
 flock -n "$lock_fd" || { echo 'NEW_DEPLOYER_LEGACY_WORKER_LOCKED'; exit 1; }
done

stage=$(mktemp -d)
chmod 700 "$stage"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
bash scripts/unpack-website.sh "$stage"
tar -xzf "$stage/website-release.tar.gz" -C "$stage"
node scripts/connect-new-deployer-testnet.mjs prepare "$stage"
node scripts/preflight-new-deployer-testnet.mjs "$stage"

backup="$backup_root/new-deployer-testnet-connection-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
cp -p "$envfile" "$backup/trades.env"
cp -p "$unit" "$backup/api.service"
printf '%s\n' "$previous" > "$backup/api-release"
cp -p "$legacy_session" "$backup/legacy-session.json"
conf="$nginx_root/sites-available/globaldroptrade.com"
link="$nginx_root/sites-enabled/globaldroptrade.com"
snippet="$nginx_root/snippets/globaldroptrade-api.conf"
for name in conf link snippet; do
 value=${!name}
 if [ -e "$value" ] || [ -L "$value" ]; then
  case "$name" in conf|snippet) [ -f "$value" ] && [ ! -L "$value" ] || { echo 'UNSAFE_NGINX_ENTRY'; exit 1; }; cp -p "$value" "$backup/$name";; link) [ -L "$value" ] || { echo 'UNSAFE_NGINX_ENTRY'; exit 1; }; readlink "$value" > "$backup/link-target";; esac
 else touch "$backup/$name.absent"; fi
done
# The reset intentionally left the old API unavailable, so an unavailable old page is not a
# connection blocker. The rollback still restores every mutable configuration surface.
if curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$backup/served-before.html"; then touch "$backup/served-before.available"; else echo 'PREVIOUS_SITE_UNAVAILABLE_CONTINUING_WITH_CONFIG_BACKUP'; fi

timers=(globaldroptrade-smart-worker.timer globaldroptrade-rpc-failover.timer globaldroptrade-position-index.timer globaldroptrade-zero-daily.timer globaldroptrade-automation.timer globaldroptrade-oracles.timer)
signer_services=(globaldroptrade-smart-worker.service globaldroptrade-rpc-failover.service globaldroptrade-position-index.service globaldroptrade-zero-daily.service globaldroptrade-automation.service globaldroptrade-oracles.service globaldroptrade-migration.service globaldroptrade-fresh-rewards.service)
workers=("${timers[@]}" "${signer_services[@]}")
: > "$backup/worker-state"
for worker in "${workers[@]}"; do
 info=$(unit_info "$worker") || exit 1
 IFS='|' read -r load active <<< "$info"
 [ "$load" = loaded ] || continue
 enabled=$(unit_file_state "$worker")
 printf '%s|%s|%s\n' "$worker" "$enabled" "$active" >> "$backup/worker-state"
done

rollback(){
 trap - ERR INT TERM
 set +e
 # A signing service may still be winding down after a failure. Timers are safe to stop;
 # services are never force-stopped here because that could interrupt a signed transaction.
 for timer in "${timers[@]}"; do
  systemctl stop "$timer" || true
 done
 cp -p "$backup/trades.env" "$envfile" || true
 cp -p "$backup/api.service" "$unit" || true
 ln -sfn "$previous" "$api_root/current" || true
 if [ -f "$backup/conf" ]; then cp -p "$backup/conf" "$conf"; else rm -f "$conf"; fi
 if [ -f "$backup/snippet" ]; then install -d -m 755 "$nginx_root/snippets"; cp -p "$backup/snippet" "$snippet"; else rm -f "$snippet"; fi
 if [ -f "$backup/link-target" ]; then ln -sfn "$(cat "$backup/link-target")" "$link"; else rm -f "$link"; fi
 systemctl daemon-reload || true
 systemctl restart globaldroptrade-api || true
 nginx -t && systemctl reload nginx || true
 restored=1
 cmp -s "$backup/trades.env" "$envfile" || restored=0
 cmp -s "$backup/api.service" "$unit" || restored=0
 [ "$(readlink -f "$api_root/current" 2>/dev/null || true)" = "$previous" ] || restored=0
 cmp -s "$backup/legacy-session.json" "$legacy_session" || restored=0
 if ! nginx -t || ! systemctl reload nginx; then restored=0; fi
 if [ -f "$backup/served-before.available" ]; then
  if ! curl -fsS --noproxy '*' --max-time 8 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$stage/restored.html" || ! cmp -s "$backup/served-before.html" "$stage/restored.html" || ! curl -fsS --noproxy '*' --max-time 8 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/api/health -o "$stage/restored-health.json"; then restored=0; fi
 fi
 if [ "$restored" -eq 1 ] && [ -f "$backup/served-before.available" ]; then echo "NEW_DEPLOYER_CONNECTION_FAILED_PREVIOUS_SITE_RESTORED backup=$backup"; else echo "NEW_DEPLOYER_CONNECTION_FAILED_RECOVERY_REQUIRED backup=$backup"; fi
 echo 'Legacy timers remain stopped; signer services were not force-stopped.'
 exit 1
}
trap rollback ERR INT TERM

node scripts/connect-new-deployer-testnet.mjs check "$stage"
for timer in "${timers[@]}"; do
 info=$(unit_info "$timer") || exit 1
 IFS='|' read -r load active <<< "$info"
 [ "$load" = loaded ] || continue
 systemctl stop "$timer"
 enabled=$(unit_file_state "$timer")
 case "$enabled" in enabled|enabled-runtime) systemctl disable "$timer";; esac
 info=$(unit_info "$timer") || exit 1
 IFS='|' read -r load active <<< "$info"
 case "$active" in inactive|failed) ;; *) echo 'NEW_DEPLOYER_TIMER_STILL_RUNNING'; false;; esac
done
signers_idle=0
signer_wait_seconds=180
[[ "$signer_wait_seconds" =~ ^[0-9]+$ ]] && [ "$signer_wait_seconds" -le 180 ] || { echo 'NEW_DEPLOYER_SIGNER_WAIT_INVALID'; false; }
for ((attempt=0;attempt<=signer_wait_seconds;attempt++)); do
 busy=()
 for worker in "${signer_services[@]}"; do
  info=$(unit_info "$worker") || exit 1
  IFS='|' read -r load active <<< "$info"
  [ "$load" = loaded ] || continue
  case "$active" in inactive|failed) ;; active|activating|deactivating|reloading) busy+=("$worker");; *) echo 'NEW_DEPLOYER_SIGNER_STATE_UNSAFE'; false;; esac
 done
 if [ "${#busy[@]}" -eq 0 ]; then signers_idle=1; break; fi
 if [ "$attempt" -eq "$signer_wait_seconds" ]; then break; fi
 if [ "$((attempt % 30))" -eq 0 ]; then echo 'NEW_DEPLOYER_WAITING_FOR_SIGNER_WORKER'; fi
 sleep 1
done
[ "$signers_idle" -eq 1 ] || { echo 'NEW_DEPLOYER_SIGNER_WORKER_BUSY_RETRY_SAME_COMMAND'; false; }
node --input-type=module - <<'JS'
import {inspectLegacyJournals} from './scripts/deploy-new-deployer-testnet.mjs';
const result=inspectLegacyJournals();if(!/^[0-9a-f]{64}$/.test(result.digest))throw Error('NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED');
console.log('NEW_DEPLOYER_LEGACY_JOURNALS_SETTLED');
JS
node scripts/connect-new-deployer-testnet.mjs check "$stage"
assert_new_worker_quiescent
install -m 600 "$stage/trades.env" "$envfile"
unset GLOBAL_SITE_IP GLOBAL_SITE_PORT TRADES_CHAIN_ID TRADES_VAULT_ADDRESS TRADES_RPC_URL TRADES_START_BLOCK TRADES_PORT TRADES_CONFIRMATIONS TRADES_LOOKBACK_BLOCKS TRADES_LOG_PAGE_SIZE TRADES_ZERO_START_PROFILE GLOBAL_AUTOMATION_PUBLIC_STATUS
bash ubuntu-api.sh
bash "$stage/globaldroptrade-package/install.sh"
curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/api/config -o "$stage/active.json"
curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/api/health -o "$stage/health.json"
curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$stage/served.html"
node --input-type=module - "$stage" <<'JS'
import fs from 'node:fs';import {createHash} from 'node:crypto';
const directory=process.argv[2],read=name=>JSON.parse(fs.readFileSync(directory+'/'+name));
const expected=read('new-deployer-testnet-connection.json'),active=read('active.json'),health=read('health.json');
if(active.version!==1||active.chainId!==97||active.vaultAddress.toLowerCase()!==expected.target.toLowerCase()||health.status!=='ok'||health.configured!==true)throw Error('NEW_DEPLOYER_HTTPS_TARGET_MISMATCH');
const digest=name=>createHash('sha256').update(fs.readFileSync(directory+'/'+name)).digest('hex');
const expectedIndex=digest('globaldroptrade-package/site/index.html'),servedIndex=digest('served.html');
if(expectedIndex!==servedIndex)throw Error('NEW_DEPLOYER_HTTPS_FRONTEND_MISMATCH');
fs.writeFileSync(directory+'/frontend-check.json',JSON.stringify({version:1,chainId:97,vaultAddress:expected.target,indexSha256:servedIndex,servedIndexSha256:servedIndex,expectedIndexSha256:expectedIndex,verified:true})+'\n',{mode:0o600,flag:'wx'});
JS
node scripts/connect-new-deployer-testnet.mjs publish "$stage"
cmp -s "$backup/legacy-session.json" "$legacy_session"
trap - ERR INT TERM
echo "NEW_DEPLOYER_SITE_CONNECTED chain=97 backup=$backup"
echo "REPORT=$report"
echo 'AUTOMATION_ACTIVE=false: install and verify the isolated replacement-deployer worker separately.'
echo 'Reload https://globaldroptrade.com/ to load the new testnet contract.'
