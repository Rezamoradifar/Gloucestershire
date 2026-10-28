#!/usr/bin/env bash
# Install serialized existing-server-key automation; missing permissions remain explicit.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
profile_args=()
worker_args=''
state=/var/lib/globaldroptrade/fresh-zero-automation-v1
fast=0
hourly=0
oracle_recovery=0
usage(){ echo 'Usage: bash ubuntu-enable-zero-daily.sh [--fast-testnet [--hourly-test]] [--oracle-recovery]'; exit 1; }
for argument in "$@"; do
 case "$argument" in
  --fast-testnet) [ "$fast" -eq 0 ] || usage; fast=1;;
  --hourly-test) [ "$hourly" -eq 0 ] || usage; hourly=1;;
  --oracle-recovery) [ "$oracle_recovery" -eq 0 ] || usage; oracle_recovery=1;;
  *) usage;;
 esac
done
[ "$hourly" -eq 0 ] || [ "$fast" -eq 1 ] || usage
if [ "$fast" -eq 1 ]; then
 profile_args=(--fast-testnet)
 worker_args=' --fast-testnet --seed-test-rewards'
 state=/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1
fi
if [ "$hourly" -eq 1 ]; then worker_args+=' --hourly-test'; fi
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for command in node npm systemctl flock python3 curl nginx; do command -v "$command" >/dev/null; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("Node 22.12+ required")'
umask 077
public=/var/www/globaldroptrade/automation-data
node --input-type=module - "$state" "$public" <<'JS'
import fs from 'node:fs';
for(const[directory,mode]of[[process.argv[2],0o700],[process.argv[3],0o755]]){
 fs.mkdirSync(directory,{recursive:true,mode});const s=fs.lstatSync(directory);
 if(!s.isDirectory()||s.uid!==0||(s.mode&0o022)!==0||(mode===0o700&&(s.mode&0o077)!==0))throw Error('SAFE_AUTOMATION_DIRECTORY_REQUIRED');
 if(mode===0o755)fs.chmodSync(directory,0o755);
}
for(const name of ['setup.lock','run.lock']){const lock=process.argv[2]+'/'+name;let s;try{s=fs.lstatSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;}if(s&&(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0))throw Error('PRIVATE_AUTOMATION_LOCK_REQUIRED');}
const status=process.argv[3]+'/activation.json';let s;try{s=fs.lstatSync(status);}catch(e){if(e.code!=='ENOENT')throw e;}if(s&&(!s.isFile()||s.uid!==0||(s.mode&0o022)!==0))throw Error('SAFE_PUBLIC_STATUS_FILE_REQUIRED');
JS
exec 9>"$state/setup.lock"
flock -n 9 || { echo 'Another automation installation is running'; exit 1; }
unset GLOBAL_DAILY_POLICY GLOBAL_AUTOMATION_STATE
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
# Recovery can install the verified oracle worker while daily history is unavailable.
if [ "$oracle_recovery" -eq 1 ]; then
 node scripts/zero-start-automation.mjs --oracles-only --check "${profile_args[@]}"
 node --input-type=module - "$stage/activation.json" <<'JS'
import fs from 'node:fs';
const value={version:1,kind:'fresh-zero-automation-error',chainId:97,ready:false,dailyAutomationActive:false,automationStatus:'not-inspected',blockers:['DAILY_READINESS_NOT_YET_INSPECTED'],checkedAt:new Date().toISOString()};
fs.writeFileSync(process.argv[2],JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
JS
else
 # Ordinary readiness failure blocks installation; missing authority/funding is a WAIT.
 node scripts/zero-start-readiness.mjs status "$stage" "${profile_args[@]}"
fi
node --input-type=module - <<'JS'
import fs from 'node:fs';import{Wallet}from'ethers';import{readPrivateKey}from'./scripts/migration-signers.mjs';import{zeroStartRelease}from'./scripts/deploy-zero-start.mjs';
const file='/etc/globaldroptrade/fresh-zero-automation.key';
const key=readPrivateKey(file)||readPrivateKey('/etc/globaldroptrade/migration-deployer.key')||readPrivateKey('/root/global-testnet-v071/.testnet-server/deployer.key');
if(!key||new Wallet(key).address!==zeroStartRelease.deployer)throw Error('EXISTING_SERVER_OPERATOR_KEY_REQUIRED');
if(!fs.existsSync(file))fs.writeFileSync(file,key+'\n',{mode:0o600,flag:'wx'});
JS
base=/opt/globaldroptrade-zero-daily
release="$base/releases/$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 755 "$release/scripts" "$release/server" "$release/artifacts" "$release/config"
for file in zero-start-automation.mjs zero-start-readiness.mjs zero-start-volume.mjs daily-profit.mjs position-profit.mjs complete-rpc-logs.mjs zero-start-hourly-test.mjs maintain-testnet-oracles.mjs refresh-testnet-oracles.mjs migration-journal.mjs migration-signers.mjs connect-zero-start.mjs deploy-zero-start.mjs zero-start-profile.mjs; do cp "scripts/$file" "$release/scripts/"; done
cp server/trades-api.mjs server/community.mjs server/marketplace.mjs "$release/server/"
cp artifacts/AutomaticGroupVault.json artifacts/MockFeed.json "$release/artifacts/"
cp config/fresh-zero-testnet.json "$release/config/"
if [ "${#profile_args[@]}" -ne 0 ]; then
 cp scripts/fund-fast-test-rewards.mjs scripts/fund-million-test-rewards.mjs "$release/scripts/"
 cp artifacts/FastTestnetVault.json artifacts/MockToken.json "$release/artifacts/"
 cp config/fresh-fast-testnet.json "$release/config/"
fi
cp package.json package-lock.json "$release/"
(cd "$release" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
node_bin=$(command -v node)
case "$node_bin" in /root/*) echo 'System-readable Node is required'; exit 1;; esac
backup="$state/install-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
previous=''
if [ -L "$base/current" ]; then
 previous=$(readlink -f "$base/current")
 [ -d "$previous" ] && [[ "$previous" = "$base/releases/"* ]] || { echo 'MANAGED_AUTOMATION_RELEASE_REQUIRED'; exit 1; }
elif [ -e "$base/current" ]; then echo 'MANAGED_AUTOMATION_SYMLINK_REQUIRED'; exit 1; fi
service=globaldroptrade-zero-daily.service
timer=globaldroptrade-zero-daily.timer
workers=(globaldroptrade-automation.timer globaldroptrade-oracles.timer globaldroptrade-automation.service globaldroptrade-oracles.service "$timer" "$service")
: > "$backup/workers"
for worker in "${workers[@]}"; do
 load=$(systemctl show --property=LoadState --value "$worker" 2>/dev/null || true)
 [ "$load" = loaded ] || continue
 enabled=$(systemctl is-enabled "$worker" 2>/dev/null || true)
 active=$(systemctl show --property=ActiveState --value "$worker" 2>/dev/null || true)
 case "$active" in active|activating|inactive|failed) ;; *) echo 'WORKER_STATE_NOT_STABLE'; exit 1;; esac
 printf '%s|%s|%s\n' "$worker" "$enabled" "$active" >> "$backup/workers"
done
for worker in "$service" "$timer"; do
 file="/etc/systemd/system/$worker"
 if [ -e "$file" ] || [ -L "$file" ]; then [ -f "$file" ] && [ ! -L "$file" ] || exit 1; cp -p "$file" "$backup/$worker"; fi
done
if [ -f "$public/activation.json" ] && [ ! -L "$public/activation.json" ]; then cp -p "$public/activation.json" "$backup/activation.json"; fi
rollback(){
 trap - ERR INT TERM
 set +e
 restored=1
 for worker in "$timer" "$service"; do
  load=$(systemctl show --property=LoadState --value "$worker" 2>/dev/null)
  if [ "$load" = loaded ]; then systemctl stop "$worker" || restored=0;case "$worker" in *.timer)systemctl disable "$worker" || restored=0;;esac;fi
 done
 for worker in "$service" "$timer"; do
  file="/etc/systemd/system/$worker"
  if [ -f "$backup/$worker" ]; then cp -p "$backup/$worker" "$file" || restored=0; else rm -f -- "$file" || restored=0; fi
 done
 if [ -n "$previous" ]; then ln -sfn "$previous" "$base/current" || restored=0; else rm -f -- "$base/current" || restored=0; fi
 if [ -f "$backup/activation.json" ]; then cp -p "$backup/activation.json" "$public/activation.json" || restored=0; else rm -f -- "$public/activation.json" || restored=0; fi
 if [ -f "$backup/status-console/manifest.json" ]; then python3 scripts/install-zero-start-status.py --restore "$backup/status-console" || restored=0; fi
 systemctl daemon-reload || restored=0
 if [ "$restored" -eq 1 ]; then
  while IFS='|' read -r worker enabled active; do
   case "$enabled" in enabled) systemctl enable "$worker" || restored=0;; enabled-runtime) systemctl enable --runtime "$worker" || restored=0;; esac
   case "$active" in active|activating) systemctl start "$worker" || restored=0;; esac
  done < "$backup/workers"
 fi
 if [ "$restored" -ne 1 ]; then
  while IFS='|' read -r worker enabled active; do
   case "$worker" in *.timer)systemctl disable --now "$worker";;esac
   systemctl stop "$worker"
  done < "$backup/workers"
 fi
 echo "ZERO_START_AUTOMATION_INSTALL_FAILED recoveryVerified=$restored backup=$backup"
 exit 1
}
trap rollback ERR INT TERM
while IFS='|' read -r worker enabled active; do
 case "$worker" in *.timer) systemctl stop "$worker";case "$enabled" in enabled|enabled-runtime)systemctl disable "$worker";;esac;;esac
done < "$backup/workers"
while IFS='|' read -r worker enabled active; do
 systemctl stop "$worker"
 activity=$(systemctl show --property=ActiveState --value "$worker")
 case "$activity" in inactive|failed) ;; *) echo 'ANOTHER_SIGNING_WORKER_IS_RUNNING'; false;; esac
done < "$backup/workers"
ln -sfn "$release" "$base/current"
install -m 644 "$stage/activation.json" "$public/activation.json"
python3 scripts/install-zero-start-status.py --backup-dir "$backup/status-console"
cat > "/etc/systemd/system/$service" <<UNIT
[Unit]
Description=Global fresh testnet daily plan and approved withdrawals
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
WorkingDirectory=$base/current
ExecStart=/usr/bin/flock -n $state/run.lock $node_bin $base/current/scripts/zero-start-automation.mjs --execute$worker_args
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$state $public
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077
TimeoutStartSec=10min
UNIT
cat > "/etc/systemd/system/$timer" <<UNIT
[Unit]
Description=Check Global fresh daily readiness and payments every five minutes
[Timer]
OnBootSec=30s
OnUnitActiveSec=5min
AccuracySec=15s
Unit=$service
[Install]
WantedBy=timers.target
UNIT
chmod 644 "/etc/systemd/system/$service" "/etc/systemd/system/$timer"
systemctl daemon-reload
systemctl enable --now "$timer"
systemctl start "$service"
systemctl is-active --quiet "$timer"
curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/deploy/zero-start-activation.json -o "$stage/served-status.json"
node --input-type=module - "$public/activation.json" "$stage/served-status.json" <<'JS'
import fs from 'node:fs';const[a,b]=process.argv.slice(2).map(f=>JSON.parse(fs.readFileSync(f)));if(JSON.stringify(a)!==JSON.stringify(b)||a.version!==1||a.chainId!==97)throw Error('HTTPS_AUTOMATION_STATUS_MISMATCH');
JS
trap - ERR INT TERM
echo "ZERO_START_AUTOMATION_MONITOR_INSTALLED backup=$backup"
node --input-type=module - "$public/activation.json" <<'JS'
import fs from 'node:fs';const r=JSON.parse(fs.readFileSync(process.argv[2]));console.log(r.dailyAutomationActive?'DAILY_PLAN_AUTOMATION_ACTIVE':'DAILY_PLAN_WAITING '+[...(r.blockers||[]),...(r.automation?.errors||[])].join(','));
JS
echo 'https://globaldroptrade.com/deploy/zero-start-activation.html'
echo 'No interactive wallet confirmation was requested. Daily credits begin only after actual on-chain permission, funding and archive checks pass.'
