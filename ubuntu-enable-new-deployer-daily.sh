#!/usr/bin/env bash
# Install the isolated BNB Testnet timer and the target-bound 24-hour activity gate.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$#" -eq 1 ] && [ "$1" = --execute ] || { echo 'Usage: bash ubuntu-enable-new-deployer-daily.sh --execute'; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo 'ROOT_REQUIRED'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'UNSUPPORTED_CPU'; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for command in node npm git systemctl flock curl install cmp mktemp cp; do command -v "$command" >/dev/null || { echo "MISSING_$command"; exit 1; }; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("NODE_22_12_REQUIRED")'
umask 077

state=/var/lib/globaldroptrade/new-deployer-testnet-automation-v1
policy=/etc/globaldroptrade/new-deployer-testnet-v1/daily-activity-policy.json
envfile=/etc/globaldroptrade/trades.env
public=/var/www/globaldroptrade/automation-data
base=/opt/globaldroptrade-new-deployer-daily
unit_dir=/etc/systemd/system
timer=globaldroptrade-new-deployer-daily.timer
service=globaldroptrade-new-deployer-daily.service
owner=0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632
legacy_services=(globaldroptrade-smart-worker.service globaldroptrade-rpc-failover.service globaldroptrade-position-index.service globaldroptrade-zero-daily.service globaldroptrade-automation.service globaldroptrade-oracles.service globaldroptrade-migration.service globaldroptrade-fresh-rewards.service)
legacy_timers=(globaldroptrade-smart-worker.timer globaldroptrade-rpc-failover.timer globaldroptrade-position-index.timer globaldroptrade-zero-daily.timer globaldroptrade-automation.timer globaldroptrade-oracles.timer)
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
 /var/lib/globaldroptrade/new-deployer-testnet-connection/run.lock
)

unit_info(){
 local unit=$1 load active
 load=$(systemctl show --property=LoadState --value "$unit" 2>/dev/null) || { echo 'NEW_DEPLOYER_SYSTEMD_INSPECTION_REQUIRED' >&2; return 1; }
 active=$(systemctl show --property=ActiveState --value "$unit" 2>/dev/null) || { echo 'NEW_DEPLOYER_SYSTEMD_INSPECTION_REQUIRED' >&2; return 1; }
 case "$load:$active" in loaded:inactive|loaded:failed|not-found:|not-found:inactive|not-found:failed) ;; *) echo "NEW_DEPLOYER_SIGNER_OR_TIMER_ACTIVE unit=$unit" >&2; return 1;; esac
 if [[ "$unit" = *.timer ]] && [ "$load" = loaded ]; then
  local enabled
  enabled=$(systemctl show --property=UnitFileState --value "$unit" 2>/dev/null) || { echo 'NEW_DEPLOYER_SYSTEMD_INSPECTION_REQUIRED' >&2; return 1; }
  case "$enabled" in disabled|static|indirect|masked) ;; *) echo "NEW_DEPLOYER_TIMER_ENABLED unit=$unit" >&2; return 1;; esac
 fi
}

node --input-type=module - "$state" "$public" <<'JS'
import fs from 'node:fs';
for(const [directory,mode] of [[process.argv[2],0o700],[process.argv[3],0o755]]){
 fs.mkdirSync(directory,{recursive:true,mode});const s=fs.lstatSync(directory);
 if(!s.isDirectory()||s.uid!==0||(s.mode&0o022)!==0||(mode===0o700&&(s.mode&0o077)!==0))throw Error('NEW_DEPLOYER_SAFE_DIRECTORY_REQUIRED');
}
JS
node --input-type=module - "$state/setup.lock" <<'JS'
import fs from 'node:fs';
const file=process.argv[2];let fd;
try{try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}catch(e){if(e.code!=='ENOENT')throw e;fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);}const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error('NEW_DEPLOYER_SETUP_LOCK_REQUIRED');}finally{if(fd!==undefined)fs.closeSync(fd);}
JS
exec 9<"$state/setup.lock"
flock -n 9 || { echo 'NEW_DEPLOYER_SETUP_LOCKED'; exit 1; }
for unit in "${legacy_services[@]}" "${legacy_timers[@]}" "$service" "$timer"; do unit_info "$unit"; done
for lock in "${legacy_locks[@]}"; do
 parent=$(dirname -- "$lock")
 if [ ! -e "$parent" ] && [ ! -L "$parent" ]; then continue; fi
 node --input-type=module - "$lock" <<'JS'
import fs from 'node:fs';import path from 'node:path';
const file=process.argv[2],s=fs.lstatSync(path.dirname(file));
if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('NEW_DEPLOYER_LEGACY_LOCK_DIRECTORY_REQUIRED');
let fd;try{try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}catch(e){if(e.code!=='ENOENT')throw e;fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);}const p=fs.fstatSync(fd);if(!p.isFile()||p.uid!==0||(p.mode&0o077)!==0)throw Error('NEW_DEPLOYER_LEGACY_LOCK_REQUIRED');}finally{if(fd!==undefined)fs.closeSync(fd);}
JS
 exec {lock_fd}<"$lock"
 flock -n "$lock_fd" || { echo "NEW_DEPLOYER_LEGACY_LOCK_BUSY lock=$lock"; exit 1; }
done
for unit in "${legacy_services[@]}" "${legacy_timers[@]}" "$service" "$timer"; do unit_info "$unit"; done
for unit in "$service" "$timer"; do
 load=$(systemctl show --property=LoadState --value "$unit" 2>/dev/null) || { echo 'NEW_DEPLOYER_SYSTEMD_INSPECTION_REQUIRED'; exit 1; }
 [ "$load" = not-found ] || { echo "NEW_DEPLOYER_EXISTING_UNIT_REVIEW_REQUIRED unit=$unit"; exit 1; }
 [ ! -e "$unit_dir/$unit" ] && [ ! -L "$unit_dir/$unit" ] || { echo "NEW_DEPLOYER_EXISTING_UNIT_REVIEW_REQUIRED unit=$unit"; exit 1; }
done

npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node --input-type=module - <<'JS'
import {Wallet} from 'ethers';import {readPrivateKey} from './scripts/migration-signers.mjs';
try{
 const key=readPrivateKey('/etc/globaldroptrade/new-deployer-testnet-v1/deployer.key');
 if(!key||new Wallet(key).address!=='0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d')throw Error();
}catch{console.error('NEW_DEPLOYER_SERVER_OPERATOR_KEY_REQUIRED');process.exitCode=1;}
JS
stage=$(mktemp -d)
chmod 700 "$stage"
worker_lock_owned=0
cleanup(){
 if [ "$worker_lock_owned" -eq 1 ]; then
  node --input-type=module - "$state/run.lock" "$$" cleanup <<'JS' || echo 'NEW_DEPLOYER_INSTALL_LOCK_CLEANUP_REQUIRED' >&2
import fs from 'node:fs';
const [file,pid]=process.argv.slice(2);let fd;
try{
 fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 const s=fs.fstatSync(fd),p=fs.lstatSync(file);
 if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0||s.nlink!==1||p.dev!==s.dev||p.ino!==s.ino||fs.readFileSync(fd,'utf8')!==pid)throw Error('NEW_DEPLOYER_INSTALL_LOCK_CHANGED');
 fs.unlinkSync(file);
}finally{if(fd!==undefined)fs.closeSync(fd);}
JS
 fi
 rm -rf -- "$stage"
}
trap cleanup EXIT
node scripts/new-deployer-testnet-automation.mjs --check
# The worker's PID lock is the common serialization point for both scheduled
# and manually started workers. Never remove a prior or uncertain lock.
node --input-type=module - "$state/run.lock" "$$" acquire <<'JS'
import fs from 'node:fs';
const [file,pid]=process.argv.slice(2);
if(!/^[1-9][0-9]*$/.test(pid))throw Error('NEW_DEPLOYER_INSTALL_PID_REQUIRED');
let fd;
try{fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,pid);fs.fsyncSync(fd);}
catch(error){if(error.code==='EEXIST')throw Error('NEW_DEPLOYER_WORKER_LOCK_REVIEW_REQUIRED');throw error;}
finally{if(fd!==undefined)fs.closeSync(fd);}
JS
worker_lock_owned=1
node scripts/prepare-new-deployer-activity.mjs "$stage"
node scripts/create-new-deployer-waiting-status.mjs "$stage/activity-preflight.json"

revision=$(git rev-parse --verify HEAD)
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'NEW_DEPLOYER_SOURCE_REVISION_REQUIRED'; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo 'NEW_DEPLOYER_SOURCE_DIRTY'; exit 1; }
release="$base/releases/$revision-$$"
if [ -e "$release" ] || [ -L "$release" ]; then echo 'NEW_DEPLOYER_RELEASE_ALREADY_EXISTS_REVIEW_REQUIRED'; exit 1; fi
install -d -m 755 "$release/scripts" "$release/server" "$release/artifacts" "$release/config"
cp scripts/*.mjs "$release/scripts/"
cp server/*.mjs "$release/server/"
cp artifacts/*.json "$release/artifacts/"
# The shared automation imports the default profile even for the replacement
# signer. Keep its public configuration in the staged module closure.
cp config/fresh-zero-testnet.json config/fresh-fast-testnet.json config/new-deployer-testnet.json "$release/config/"
cp package.json package-lock.json "$release/"
(cd "$release" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund && node --input-type=module -e "await import('./scripts/new-deployer-testnet-automation.mjs'); await import('./server/daily-activity.mjs')")
node_bin=$(command -v node)
case "$node_bin" in /root/*|*' '*) echo 'NEW_DEPLOYER_SYSTEM_NODE_REQUIRED'; exit 1;; esac

backup="$state/install-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
cp -p "$stage/trades.original" "$backup/trades.env"
cp -p "$stage/activity-preflight.json" "$backup/activity-preflight.json"
cmp -s "$stage/trades.original" "$envfile" || { echo 'NEW_DEPLOYER_ENV_CHANGED'; exit 1; }

# An existing policy is never rewritten; a new one is committed once and retained on failure.
node --input-type=module - "$policy" "$stage/activity-policy.json" <<'JS'
import fs from 'node:fs';
const [target,source]=process.argv.slice(2),desired=fs.readFileSync(source);
try{
 const fd=fs.openSync(target,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,desired);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const dir=fs.openSync(target.substring(0,target.lastIndexOf('/')),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}catch(e){
 if(e.code!=='EEXIST')throw e;
 const fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0||JSON.stringify(JSON.parse(fs.readFileSync(fd,'utf8')))!==JSON.stringify(JSON.parse(desired)))throw Error('NEW_DEPLOYER_ACTIVITY_POLICY_CHANGED');}finally{fs.closeSync(fd);}
}
JS

env_changed=0
created_service=0
created_timer=0
rollback(){
 trap - ERR INT TERM
 set +e
 safe=1
 if [ "$created_timer" -eq 1 ]; then
  systemctl stop "$timer" || safe=0
  systemctl disable "$timer" || safe=0
  timer_state=$(systemctl show --property=ActiveState --value "$timer" 2>/dev/null) || safe=0
  case "$timer_state" in ''|inactive|failed) ;; *) safe=0;; esac
 fi
 worker_state=$(systemctl show --property=ActiveState --value "$service" 2>/dev/null) || safe=0
 case "$worker_state" in ''|inactive|failed) ;; *) safe=0;; esac
 if [ "$safe" -eq 1 ] && [ "$env_changed" -eq 1 ]; then
  if cmp -s "$stage/trades.staged" "$envfile"; then
   node scripts/replace-new-deployer-env.mjs "$stage/trades.staged" "$stage/trades.original" && systemctl restart globaldroptrade-api || safe=0
  else safe=0; fi
 fi
 if [ "$safe" -eq 1 ]; then
  if [ "$created_timer" -eq 1 ]; then cmp -s "$stage/$timer" "$unit_dir/$timer" && rm -f -- "$unit_dir/$timer" || safe=0; fi
  if [ "$created_service" -eq 1 ]; then cmp -s "$stage/$service" "$unit_dir/$service" && rm -f -- "$unit_dir/$service" || safe=0; fi
  systemctl daemon-reload || safe=0
 fi
 echo "NEW_DEPLOYER_DAILY_INSTALL_FAILED recoveryVerified=$safe backup=$backup"
 echo 'Activity policy and any new history were preserved; no legacy journal was removed.'
 [ "$safe" -eq 1 ] || echo 'NEW_DEPLOYER_DAILY_MANUAL_RECOVERY_REQUIRED'
 exit 1
}
trap rollback ERR INT TERM
if ! cmp -s "$stage/trades.staged" "$envfile"; then
 node scripts/replace-new-deployer-env.mjs "$stage/trades.original" "$stage/trades.staged"
 env_changed=1
 systemctl restart globaldroptrade-api
fi
systemctl is-active --quiet globaldroptrade-api
curl -fsS --noproxy '*' --retry 5 --retry-delay 1 --retry-connrefused --retry-max-time 25 --max-time 5 --resolve globaldroptrade.com:443:127.0.0.1 "https://globaldroptrade.com/api/daily-activity/status?wallet=$owner" -o "$stage/activity-response.json"
node --input-type=module - "$stage/activity-response.json" "$stage/activity-preflight.json" <<'JS'
import fs from 'node:fs';
const [response,expected]=process.argv.slice(2).map(file=>JSON.parse(fs.readFileSync(file)));
if(response.version!==1||response.chainId!==97||response.vaultAddress!==expected.target||response.origin!=='https://globaldroptrade.com'||response.windowSeconds!==86400||response.requirementEnabled!==true||response.activationTimestamp!==expected.activationTimestamp)throw Error('NEW_DEPLOYER_ACTIVITY_API_MISMATCH');
JS
cat > "$stage/$service" <<UNIT
[Unit]
Description=Global replacement-deployer testnet rewards and approved withdrawals
After=network-online.target globaldroptrade-api.service
Wants=network-online.target
[Service]
Type=oneshot
User=root
WorkingDirectory=$release
ExecStart=$node_bin $release/scripts/new-deployer-testnet-automation.mjs --execute
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$state $public
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077
TimeoutStartSec=10min
UNIT
cat > "$stage/$timer" <<UNIT
[Unit]
Description=Run replacement-deployer testnet automation every five minutes
[Timer]
OnActiveSec=1min
OnUnitActiveSec=5min
AccuracySec=15s
Unit=$service
[Install]
WantedBy=timers.target
UNIT
install -m 644 "$stage/$service" "$unit_dir/$service"
created_service=1
install -m 644 "$stage/$timer" "$unit_dir/$timer"
created_timer=1
systemctl daemon-reload
systemctl enable "$timer"
systemctl start "$timer"
systemctl is-active --quiet "$timer"
trap - ERR INT TERM
echo "NEW_DEPLOYER_DAILY_TIMER_ACTIVE backup=$backup"
echo 'The timer does not seed test rewards. Empty funding, insufficient cash, or unavailable activity history keeps daily credits waiting.'
echo 'Actual payout requires a verified reward balance, an approved withdrawal, sufficient liquidity, and a confirmed receipt.'
