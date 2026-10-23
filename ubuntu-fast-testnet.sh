#!/usr/bin/env bash
# Deploy, connect and start the separate zero-account fast testnet release.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$#" -eq 1 ] && [ "$1" = --execute ] || { echo 'Usage: bash ubuntu-fast-testnet.sh --execute'; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for tool in node npm systemctl flock python3 curl cmp; do command -v "$tool" >/dev/null; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("Node 22.12+ required")'
umask 077
directory=/var/lib/globaldroptrade/fast-testnet-setup-v1
envfile=/etc/globaldroptrade/trades.env
apiunit=/etc/systemd/system/globaldroptrade-api.service
apicurrent=/opt/globaldroptrade-api/current
dailycurrent=/opt/globaldroptrade-zero-daily/current
python3 - "$directory" "$envfile" "$apiunit" <<'PY'
import os,stat,sys
from pathlib import Path
p=Path(sys.argv[1]);p.mkdir(parents=True,exist_ok=True,mode=0o700)
for f,private,directory in [(p,True,True),(p/'setup.lock',True,False),(Path(sys.argv[2]),True,False),(Path(sys.argv[3]),False,False)]:
 try:s=f.lstat()
 except FileNotFoundError:
  if f.name=='setup.lock':continue
  raise SystemExit('FAST_SETUP_REQUIRED_FILE_MISSING')
 if s.st_uid!=0 or not (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)) or s.st_mode&(0o077 if private else 0o022):raise SystemExit('FAST_SETUP_UNSAFE_FILE')
PY
exec 9>"$directory/setup.lock"
flock -n 9 || { echo 'FAST_TESTNET_SETUP_ALREADY_RUNNING'; exit 1; }
node --input-type=module - "$envfile" <<'JS'
import fs from 'node:fs';import {parseEnv} from 'node:util';
const e=parseEnv(fs.readFileSync(process.argv[2],'utf8'));
if(e.GLOBAL_AUTOMATION_STATE&&e.GLOBAL_AUTOMATION_STATE!=='/var/lib/globaldroptrade/automation-v1')throw Error('LEGACY_AUTOMATION_STATE_OVERRIDE_REQUIRES_REVIEW');
JS
for other in globaldroptrade-migration.service globaldroptrade-fresh-rewards.service; do
 load=$(systemctl show --property=LoadState --value "$other") || { echo 'CANNOT_INSPECT_OTHER_DEPLOYMENT'; exit 1; }
 case "$load" in loaded|not-found) ;; *) echo 'CANNOT_INSPECT_OTHER_DEPLOYMENT'; exit 1;; esac
 active=$(systemctl show --property=ActiveState --value "$other")
 case "$active" in inactive|failed) ;; *) echo 'OTHER_DEPLOYMENT_RUNNING'; exit 1;; esac
done
backup="$directory/attempt-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
cp -p "$envfile" "$backup/trades.env"
cp -p "$apiunit" "$backup/api.service"
previous_api=$(readlink -f "$apicurrent")
[ -d "$previous_api" ] || { echo 'EXISTING_API_RELEASE_REQUIRED'; exit 1; }
previous_daily=$(readlink -f "$dailycurrent" || true)
previous_daily_present=0
if [ -e "$dailycurrent" ] || [ -L "$dailycurrent" ]; then
 [ -L "$dailycurrent" ] && [ -d "$previous_daily" ] || { echo 'MANAGED_DAILY_RELEASE_REQUIRED'; exit 1; }
 previous_daily_present=1
fi
https_read(){ curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 "https://globaldroptrade.com/$1" -o "$2"; }
https_read '' "$backup/home.html"
https_read api/config "$backup/config.json"
https_read api/health "$backup/health.json"
python3 - "$backup/health.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h.get('status')=='ok' and h.get('configured') is True,'EXISTING_API_NOT_HEALTHY'
PY
workers=(globaldroptrade-automation.timer globaldroptrade-oracles.timer globaldroptrade-zero-daily.timer globaldroptrade-automation.service globaldroptrade-oracles.service globaldroptrade-zero-daily.service)
: > "$backup/workers"
for worker in "${workers[@]}"; do
 load=$(systemctl show --property=LoadState --value "$worker") || { echo 'CANNOT_INSPECT_SIGNER_WORKER'; exit 1; }
 case "$load" in
  not-found)
   active=$(systemctl show --property=ActiveState --value "$worker")
   case "$active" in inactive|failed) continue;; *) echo 'UNMANAGED_SIGNER_WORKER_ACTIVE'; exit 1;; esac;;
  loaded) ;; *) echo 'CANNOT_INSPECT_SIGNER_WORKER'; exit 1;;
 esac
 enabled=$(systemctl is-enabled "$worker" || true)
 case "$enabled" in enabled|enabled-runtime|disabled|static|indirect|masked) ;; *) echo 'WORKER_ENABLE_STATE_UNKNOWN'; exit 1;; esac
 active=$(systemctl show --property=ActiveState --value "$worker")
 case "$active" in active|activating|inactive|failed) ;; *) echo 'WORKER_STATE_NOT_STABLE'; exit 1;; esac
 printf '%s|%s|%s\n' "$worker" "$enabled" "$active" >> "$backup/workers"
done
for worker in globaldroptrade-zero-daily.service globaldroptrade-zero-daily.timer; do
 file="/etc/systemd/system/$worker"
 if [ -e "$file" ] || [ -L "$file" ]; then
  [ -f "$file" ] && [ ! -L "$file" ] || { echo 'MANAGED_DAILY_UNIT_REQUIRED'; exit 1; }
  cp -p "$file" "$backup/$worker"
 fi
done
journals_complete(){
 python3 - "$@" <<'PY'
import json,os,stat,sys
from pathlib import Path
for name in sys.argv[1:]:
 p=Path(name)
 try:d=p.parent.lstat()
 except FileNotFoundError:continue
 if not stat.S_ISDIR(d.st_mode) or d.st_uid!=0 or d.st_mode&0o077:raise SystemExit('PRIVATE_SIGNER_JOURNAL_REQUIRED')
 try:fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 except FileNotFoundError:continue
 with os.fdopen(fd) as f:
  s=os.fstat(f.fileno())
  if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077 or s.st_size>16*1024*1024:raise SystemExit('PRIVATE_SIGNER_JOURNAL_REQUIRED')
  try:j=json.load(f)
  except (ValueError,UnicodeError):raise SystemExit('SIGNER_JOURNAL_REVIEW_REQUIRED')
 if not isinstance(j,dict) or not isinstance(j.get('transactions',{}),dict):raise SystemExit('SIGNER_JOURNAL_REVIEW_REQUIRED')
 if j.get('pending') or any(not isinstance(t,dict) or not isinstance(t.get('block'),int) or t['block']<1 for t in j.get('transactions',{}).values()):raise SystemExit('PENDING_SIGNED_TRANSACTION_RESUME_PRIOR_WORKER_FIRST')
PY
}
quiesce(){
 local worker load enabled active failed=0
 # Include units created by a failed child, even when absent in the snapshot.
 for worker in "${workers[@]}"; do
  case "$worker" in *.timer) ;; *) continue;; esac
  load=$(systemctl show --property=LoadState --value "$worker") || { failed=1;load=unknown; }
  active=$(systemctl show --property=ActiveState --value "$worker") || { failed=1;active=unknown; }
  if [ "$load" != not-found ] || { [ "$active" != inactive ] && [ "$active" != failed ]; }; then
   systemctl stop "$worker" || failed=1
  fi
  case "$load" in
   loaded)
    enabled=$(systemctl is-enabled "$worker" || true)
    case "$enabled" in enabled|enabled-runtime) systemctl disable "$worker" || failed=1;; disabled|static|indirect|masked) ;; *) failed=1;; esac;;
   not-found) ;; *) failed=1;;
  esac
 done
 # Activity is independent of whether systemd can still load the unit file.
 for worker in "${workers[@]}"; do
  active=$(systemctl show --property=ActiveState --value "$worker") || { failed=1;active=unknown; }
  case "$active" in inactive|failed) continue;; esac
  systemctl stop "$worker" || failed=1
  active=$(systemctl show --property=ActiveState --value "$worker") || failed=1
  case "$active" in inactive|failed) ;; *) failed=1;; esac
 done
 [ "$failed" -eq 0 ]
}
failed(){
 trap - ERR INT TERM
 set +e
 restored=0
 quiesce
 safe=$?
 # A pending new signed transaction must be reconciled with this same release.
 journals_complete /var/lib/globaldroptrade/fresh-fast-testnet-v1/journal.json /var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/journal.json || safe=1
 cmp -s "$backup/trades.env" "$envfile" || safe=1
 cmp -s "$backup/api.service" "$apiunit" || safe=1
 [ "$(readlink -f "$apicurrent")" = "$previous_api" ] || safe=1
 if [ "$previous_daily_present" -eq 1 ]; then
  [ -L "$dailycurrent" ] && [ "$(readlink -f "$dailycurrent" || true)" = "$previous_daily" ] || safe=1
 elif [ -e "$dailycurrent" ] || [ -L "$dailycurrent" ]; then safe=1;fi
 for worker in globaldroptrade-zero-daily.service globaldroptrade-zero-daily.timer; do
  file="/etc/systemd/system/$worker"
  if [ -f "$backup/$worker" ]; then cmp -s "$backup/$worker" "$file" || safe=1
  elif [ -e "$file" ] || [ -L "$file" ]; then safe=1;fi
 done
 https_read '' "$backup/recovered-home.html" && cmp -s "$backup/home.html" "$backup/recovered-home.html" || safe=1
 https_read api/config "$backup/recovered-config.json" && cmp -s "$backup/config.json" "$backup/recovered-config.json" || safe=1
 https_read api/health "$backup/recovered-health.json" || safe=1
 python3 - "$backup/recovered-health.json" <<'PY'
import json,sys
try:h=json.load(open(sys.argv[1]));assert h.get('status')=='ok' and h.get('configured') is True
except Exception:raise SystemExit('PREVIOUS_API_RECOVERY_NOT_VERIFIED')
PY
 [ "$?" -eq 0 ] || safe=1
 if [ "$safe" -eq 0 ]; then
  while IFS='|' read -r worker enabled active; do
   case "$worker" in *.timer) continue;; esac
   case "$active" in active|activating) systemctl start "$worker" || safe=1;; esac
  done < "$backup/workers"
  if [ "$safe" -eq 0 ]; then
   while IFS='|' read -r worker enabled active; do
    case "$worker" in *.timer) ;; *) continue;; esac
    case "$enabled" in enabled) systemctl enable "$worker" || safe=1;; enabled-runtime) systemctl enable --runtime "$worker" || safe=1;; esac
    case "$active" in active|activating) systemctl start "$worker" || safe=1;; esac
   done < "$backup/workers"
  fi
  if [ "$safe" -eq 0 ]; then restored=1;else quiesce;fi
 fi
 echo "FAST_TESTNET_SETUP_INCOMPLETE previousWorkersRestored=$restored backup=$backup"
 echo 'Confirmed transactions are preserved. Retry this same pinned command; do not delete journals.'
 exit 1
}
trap failed ERR INT TERM
quiesce
journals_complete /var/lib/globaldroptrade/automation-v1/journal.json /var/lib/globaldroptrade/oracle-maintenance-v1/journal.json /var/lib/globaldroptrade/fresh-zero-automation-v1/journal.json
echo 'FAST_TESTNET_NEW_ZERO_ACCOUNT_RELEASE chain=97 initialServerReporter=true dailyPeriodSeconds=86400'
echo 'Fee limits: deployment journal 0.1 test BNB; automation journal 0.1 test BNB. One-time reward seed: 10 Test USDT.'
bash ubuntu-deploy-zero-start.sh --execute --fast-testnet
bash ubuntu-connect-zero-start.sh --fast-testnet
bash ubuntu-enable-zero-daily.sh --fast-testnet
trap - ERR INT TERM
echo 'FAST_TESTNET_SETUP_COMPLETE: use the DAILY_PLAN_AUTOMATION_ACTIVE or DAILY_PLAN_WAITING result above.'
