#!/usr/bin/env bash
# Connect the independently verified fresh testnet deployment without signing transactions.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$#" -eq 0 ] || { echo 'This command reads the fresh deployment report; no address argument is required.'; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU'; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for tool in node npm nginx curl python3 systemctl flock tar sha256sum cmp; do command -v "$tool" >/dev/null; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("Node 22.12+ required")'
envfile=/etc/globaldroptrade/trades.env
unit=/etc/systemd/system/globaldroptrade-api.service
report=/var/lib/globaldroptrade/fresh-zero-v1/connection-public.json
test -s "$envfile" && test -f "$unit"
test -s /var/lib/globaldroptrade/fresh-zero-v1/deployment-public.json || { echo 'FRESH_ZERO_DEPLOYMENT_REPORT_REQUIRED: run ubuntu-deploy-zero-start.sh --execute first.'; exit 1; }
previous=$(readlink -f /opt/globaldroptrade-api/current)
test -d "$previous"
for other in globaldroptrade-migration.service globaldroptrade-fresh-rewards.service; do
 if systemctl is-active --quiet "$other"; then echo "Another deployment is running: $other"; exit 1; fi
done
umask 077
directory=/var/lib/globaldroptrade/fresh-zero-connection
node --input-type=module - "$directory" <<'JS'
import fs from 'node:fs';
const directory=process.argv[2];fs.mkdirSync(directory,{recursive:true,mode:0o700});
const s=fs.lstatSync(directory);if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_CONNECTION_DIRECTORY_REQUIRED');
const lock=directory+'/run.lock';if(fs.existsSync(lock)){const l=fs.lstatSync(lock);if(!l.isFile()||l.uid!==0||(l.mode&0o077)!==0)throw Error('PRIVATE_CONNECTION_LOCK_REQUIRED');}
JS
exec 9>"$directory/run.lock"
flock -n 9 || { echo 'Another fresh connection is running'; exit 1; }
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
bash scripts/unpack-website.sh "$stage"
tar -xzf "$stage/website-release.tar.gz" -C "$stage"
node scripts/connect-zero-start.mjs prepare "$stage"
# Normalize only the already diagnosed Global entries before taking the cutover snapshot.
python3 scripts/repair-global-nginx.py --apply
backup="/var/backups/globaldroptrade/fresh-zero-connection-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
cp -p "$envfile" "$backup/trades.env"
cp -p "$unit" "$backup/api.service"
printf '%s\n' "$previous" > "$backup/api-release"
curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$backup/served-before.html"
if [ -e "$report" ] || [ -L "$report" ]; then
 [ -f "$report" ] && [ ! -L "$report" ] || { echo 'PRIVATE_CONNECTION_REPORT_REQUIRED'; exit 1; }
 cp -p "$report" "$backup/connection-public.json"
fi
python3 - "$backup" <<'PY'
import json,os,shutil,stat,sys
from pathlib import Path
backup=Path(sys.argv[1]);nginx=Path('/etc/nginx');records={}
for name in ['sites-available/globaldroptrade.com','sites-enabled/globaldroptrade.com','snippets/globaldroptrade-api.conf']:
 p=nginx/name;target=backup/'nginx'/name
 if not p.exists() and not p.is_symlink():records[name]='absent';continue
 s=p.lstat()
 if s.st_uid!=0 or not (stat.S_ISREG(s.st_mode) or stat.S_ISLNK(s.st_mode)) or (stat.S_ISREG(s.st_mode) and s.st_mode&0o022):raise SystemExit('UNSAFE_GLOBAL_NGINX_ENTRY')
 target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 shutil.copy2(p,target,follow_symlinks=False);records[name]='present'
(backup/'nginx-files.json').write_text(json.dumps(records))
PY
workers=(globaldroptrade-automation.timer globaldroptrade-oracles.timer globaldroptrade-zero-daily.timer globaldroptrade-automation.service globaldroptrade-oracles.service globaldroptrade-zero-daily.service globaldroptrade-deferred-index.service)
: > "$backup/worker-state"
for worker in "${workers[@]}"; do
 load=$(systemctl show --property=LoadState --value "$worker" 2>/dev/null || true)
 [ "$load" = loaded ] || continue
 enabled=$(systemctl is-enabled "$worker" 2>/dev/null || true)
 active=$(systemctl show --property=ActiveState --value "$worker" 2>/dev/null || true)
 case "$active" in active|activating|inactive|failed) ;; *) echo 'WORKER_STATE_NOT_STABLE'; exit 1;; esac
 printf '%s|%s|%s\n' "$worker" "$enabled" "$active" >> "$backup/worker-state"
done
rollback(){
 trap - ERR INT TERM
 set +e
 restore_failed=0
 # A failed stop or restore must never restart a financial worker against uncertain settings.
 while IFS='|' read -r worker enabled active; do
  case "$worker" in *.timer) systemctl stop "$worker" || restore_failed=1;; esac
 done < "$backup/worker-state"
 while IFS='|' read -r worker enabled active; do systemctl stop "$worker" || restore_failed=1; done < "$backup/worker-state"
 cp -p "$backup/trades.env" "$envfile" || restore_failed=1
 cp -p "$backup/api.service" "$unit" || restore_failed=1
 ln -sfn "$previous" /opt/globaldroptrade-api/current || restore_failed=1
 python3 - "$backup" <<'PY'
import json,os,shutil,sys,tempfile
from pathlib import Path
backup=Path(sys.argv[1]);nginx=Path('/etc/nginx');records=json.loads((backup/'nginx-files.json').read_text())
with tempfile.TemporaryDirectory(prefix='.global-zero-restore-',dir=nginx) as stage:
 for i,(name,state) in enumerate(records.items()):
  destination=nginx/name
  if state=='absent':destination.unlink(missing_ok=True);continue
  temporary=Path(stage)/str(i);shutil.copy2(backup/'nginx'/name,temporary,follow_symlinks=False);os.replace(temporary,destination)
PY
 [ "$?" -eq 0 ] || restore_failed=1
 if [ -f "$backup/connection-public.json" ]; then cp -p "$backup/connection-public.json" "$report" || restore_failed=1; else rm -f -- "$report" || restore_failed=1; fi
 systemctl daemon-reload || restore_failed=1
 systemctl restart globaldroptrade-api || restore_failed=1
 if ! nginx -t || ! systemctl reload nginx; then restore_failed=1; fi
 cmp -s "$backup/trades.env" "$envfile" || restore_failed=1
 cmp -s "$backup/api.service" "$unit" || restore_failed=1
 [ "$(readlink -f /opt/globaldroptrade-api/current)" = "$previous" ] || restore_failed=1
 recovered=0
 for attempt in {1..10}; do
  if curl -fsS --noproxy '*' --max-time 5 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$stage/restored.html" && cmp -s "$backup/served-before.html" "$stage/restored.html" && curl -fsS --noproxy '*' --max-time 5 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/api/health -o "$stage/restored-health.json" && node --input-type=module - "$stage/restored-health.json" <<'JS'
import fs from 'node:fs';const h=JSON.parse(fs.readFileSync(process.argv[2]));if(h.status!=='ok'||h.configured!==true)throw Error('RESTORED_API_NOT_HEALTHY');
JS
  then recovered=1; break; fi
  sleep 1
 done
 [ "$recovered" -eq 1 ] || restore_failed=1
 if [ "$restore_failed" -eq 0 ]; then
  # Restore services before their timers, after the previous target is healthy again.
  while IFS='|' read -r worker enabled active; do
   case "$worker" in *.timer) continue;; esac
   case "$active" in active|activating) systemctl start "$worker" || restore_failed=1;; esac
  done < "$backup/worker-state"
  if [ "$restore_failed" -eq 0 ]; then
   while IFS='|' read -r worker enabled active; do
    case "$worker" in *.timer) ;; *) continue;; esac
    case "$enabled" in enabled) systemctl enable "$worker" || restore_failed=1;; enabled-runtime) systemctl enable --runtime "$worker" || restore_failed=1;; esac
    case "$active" in active|activating) systemctl start "$worker" || restore_failed=1;; esac
   done < "$backup/worker-state"
  fi
 fi
 if [ "$restore_failed" -eq 0 ]; then echo "FRESH_CONNECTION_FAILED_PREVIOUS_SITE_RESTORED backup=$backup";
 else
  while IFS='|' read -r worker enabled active; do
   case "$worker" in *.timer) systemctl stop "$worker";; esac
  done < "$backup/worker-state"
  while IFS='|' read -r worker enabled active; do systemctl stop "$worker"; done < "$backup/worker-state"
  echo "FRESH_CONNECTION_FAILED_RECOVERY_REQUIRED backup=$backup"
 fi
 exit 1
}
trap rollback ERR INT TERM
node scripts/connect-zero-start.mjs check "$stage"
# Timers are stopped first so a service cannot restart while its target is changing.
while IFS='|' read -r worker enabled active; do
 case "$worker" in *.timer)
  systemctl stop "$worker"
  case "$enabled" in enabled|enabled-runtime) systemctl disable "$worker";; esac
 ;; esac
done < "$backup/worker-state"
while IFS='|' read -r worker enabled active; do
 systemctl stop "$worker"
 state=$(systemctl show --property=ActiveState --value "$worker")
 case "$state" in inactive|failed) ;; *) echo 'OLD_WORKER_STILL_RUNNING'; false;; esac
done < "$backup/worker-state"
node scripts/connect-zero-start.mjs check "$stage"
install -m 600 "$stage/trades.env" "$envfile"
unset GLOBAL_SITE_IP GLOBAL_SITE_PORT
# The verified file, rather than a stale exported shell value, supplies API preflight settings.
unset TRADES_CHAIN_ID TRADES_VAULT_ADDRESS TRADES_RPC_URL TRADES_START_BLOCK TRADES_PORT TRADES_CONFIRMATIONS TRADES_LOOKBACK_BLOCKS TRADES_LOG_PAGE_SIZE
GLOBAL_SKIP_AUTOMATION=1 bash ubuntu-unified.sh
curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/api/config -o "$stage/active.json"
curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$stage/served.html"
curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/api/health -o "$stage/health.json"
node --input-type=module - "$stage" <<'JS'
import fs from 'node:fs';import{createHash}from'node:crypto';
const d=process.argv[2],read=name=>JSON.parse(fs.readFileSync(d+'/'+name));
const report=read('zero-start-connection.json'),active=read('active.json'),health=read('health.json');
if(active.version!==1||active.chainId!==97||active.vaultAddress.toLowerCase()!==report.target.toLowerCase()||health.status!=='ok'||health.configured!==true)throw Error('HTTPS_FRESH_TARGET_MISMATCH');
const sha=name=>createHash('sha256').update(fs.readFileSync(d+'/'+name)).digest('hex');
const expected=sha('globaldroptrade-package/site/index.html'),served=sha('served.html');
if(expected!==served)throw Error('HTTPS_FRONTEND_RELEASE_MISMATCH');
fs.writeFileSync(d+'/frontend-check.json',JSON.stringify({version:1,chainId:97,vaultAddress:report.target,indexSha256:served,servedIndexSha256:served,expectedIndexSha256:expected,verified:true}),{mode:0o600,flag:'wx'});
JS
node scripts/connect-zero-start.mjs publish "$stage"
trap - ERR INT TERM
echo "FRESH_ZERO_SITE_CONNECTED chain=97 backup=$backup"
echo "REPORT=$report"
echo 'DAILY_AUTOMATION_ACTIVE=false: new reporter authorization, policy and reward funding are required.'
echo 'Reload https://globaldroptrade.com/ to load the new contract connection.'
