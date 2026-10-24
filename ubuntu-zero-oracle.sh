#!/usr/bin/env bash
# Repair current fresh-testnet feeds or install full-worker profit recovery.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
mode=''
hourly=0
fund_million=0
profit_recovery=0
for argument in "$@"; do
 case "$argument" in
  --check|--execute) [ -z "$mode" ] || { echo 'Choose one repair mode'; exit 1; };mode=$argument;;
  --hourly-test) [ "$hourly" -eq 0 ] || { echo 'Duplicate hourly flag'; exit 1; };hourly=1;;
  --fund-test-million) [ "$fund_million" -eq 0 ] || { echo 'Duplicate test funding flag'; exit 1; };fund_million=1;;
  --profit-recovery) [ "$profit_recovery" -eq 0 ] || { echo 'Duplicate profit recovery flag'; exit 1; };profit_recovery=1;;
  *) echo 'Usage: bash ubuntu-zero-oracle.sh --check|--execute [--hourly-test] [--fund-test-million|--profit-recovery]'; exit 1;;
 esac
done
[ -n "$mode" ] || { echo 'Choose --check or --execute'; exit 1; }
if [ "$profit_recovery" -eq 1 ] && { [ "$mode" != --execute ] || [ "$fund_million" -eq 1 ]; }; then echo 'PROFIT_RECOVERY_REQUIRES_EXECUTE_WITHOUT_TEST_TOPUP'; exit 1;fi
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for tool in node systemctl python3 flock curl cmp; do command -v "$tool" >/dev/null; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("Node 22.12+ required")'
envfile=/etc/globaldroptrade/trades.env
profile=$(node --input-type=module - "$envfile" <<'JS'
import fs from 'node:fs';import {parseEnv} from 'node:util';
const fd=fs.openSync(process.argv[2],fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
let e;
try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_API_ENV_REQUIRED');e=parseEnv(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
if(e.TRADES_CHAIN_ID!=='97')throw Error('ACTIVE_TESTNET_REQUIRED');
if(e.GLOBAL_AUTOMATION_STATE&&e.GLOBAL_AUTOMATION_STATE!=='/var/lib/globaldroptrade/automation-v1')throw Error('LEGACY_AUTOMATION_STATE_OVERRIDE_REQUIRES_REVIEW');
if(e.TRADES_ZERO_START_PROFILE==='global-fresh-fast-test-v1')console.log('fast');
else if(!e.TRADES_ZERO_START_PROFILE||e.TRADES_ZERO_START_PROFILE==='global-fresh-zero-v1')console.log('standard');
else throw Error('CONNECTED_FRESH_PROFILE_REQUIRED');
JS
)
profile_args=()
state=/var/lib/globaldroptrade/fresh-zero-automation-v1
other_state=/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1
if [ "$profile" = fast ]; then
 profile_args=(--fast-testnet)
 state=/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1
 other_state=/var/lib/globaldroptrade/fresh-zero-automation-v1
fi
if [ "$hourly" -eq 1 ] && { [ "$profile" != fast ] || [ "$mode" != --execute ]; }; then echo 'EXPLICIT_FAST_HOURLY_EXECUTION_REQUIRED'; exit 1;fi
if [ "$fund_million" -eq 1 ] && { [ "$profile" != fast ] || [ "$mode" != --execute ]; }; then echo 'EXPLICIT_FAST_TEST_TOPUP_EXECUTION_REQUIRED'; exit 1;fi
if [ "$mode" = --check ]; then
 node scripts/zero-start-automation.mjs --oracles-only --check "${profile_args[@]}"
 exit 0
fi
installed_hourly=$(python3 - <<'PY'
import shlex,stat
from pathlib import Path
p=Path('/etc/systemd/system/globaldroptrade-zero-daily.service')
try:s=p.lstat()
except FileNotFoundError:print(0);raise SystemExit(0)
if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:raise SystemExit('MANAGED_ZERO_UNIT_REQUIRED')
found=any('--hourly-test' in shlex.split(line.split('=',1)[1]) for line in p.read_text().splitlines() if line.startswith('ExecStart='))
print(int(found))
PY
)
if [ "$installed_hourly" -eq 1 ]; then hourly=1;fi
if [ "$hourly" -eq 1 ] && [ "$profile" != fast ]; then echo 'FAST_HOURLY_PROFILE_REQUIRED'; exit 1;fi
install_args=("${profile_args[@]}" --oracle-recovery)
if [ "$hourly" -eq 1 ]; then install_args+=(--hourly-test);fi
command -v npm >/dev/null
umask 077
directory=/var/lib/globaldroptrade/zero-oracle-repair-v1
python3 - "$directory" "$state" <<'PY'
import stat,sys
from pathlib import Path
for name in sys.argv[1:]:
 p=Path(name);p.mkdir(parents=True,exist_ok=True,mode=0o700);s=p.lstat()
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077:raise SystemExit('PRIVATE_ORACLE_REPAIR_DIRECTORY_REQUIRED')
 for lock in ['setup.lock','run.lock']:
  f=p/lock
  try:t=f.lstat()
  except FileNotFoundError:continue
  if not stat.S_ISREG(t.st_mode) or t.st_uid!=0 or t.st_mode&0o077:raise SystemExit('PRIVATE_ORACLE_REPAIR_LOCK_REQUIRED')
PY
exec 9>"$directory/setup.lock"
flock -n 9 || { echo 'ZERO_ORACLE_REPAIR_ALREADY_RUNNING'; exit 1; }
for other in globaldroptrade-migration.service globaldroptrade-fresh-rewards.service globaldroptrade-automation.timer globaldroptrade-automation.service globaldroptrade-oracles.timer globaldroptrade-oracles.service; do
 load=$(systemctl show --property=LoadState --value "$other") || { echo 'CANNOT_INSPECT_OTHER_SIGNER'; exit 1; }
 case "$load" in loaded|not-found) ;; *) echo 'CANNOT_INSPECT_OTHER_SIGNER'; exit 1;; esac
 active=$(systemctl show --property=ActiveState --value "$other")
 case "$active" in inactive|failed) ;; *) echo "OTHER_SIGNER_WORKER_ACTIVE $other"; exit 1;; esac
done
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
# This checks current target identity and feed data without opening a signer.
node scripts/zero-start-automation.mjs --oracles-only --check "${profile_args[@]}"
backup="$directory/attempt-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
apiunit=/etc/systemd/system/globaldroptrade-api.service
apicurrent=/opt/globaldroptrade-api/current
dailycurrent=/opt/globaldroptrade-zero-daily/current
python3 - "$apiunit" <<'PY'
import os,stat,sys
s=os.lstat(sys.argv[1])
if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:raise SystemExit('MANAGED_API_UNIT_REQUIRED')
PY
install -m 600 "$envfile" "$backup/trades.env"
install -m 600 "$apiunit" "$backup/api.service"
previous_api=$(readlink -f "$apicurrent")
[ -L "$apicurrent" ] && [ -d "$previous_api" ] || { echo 'MANAGED_API_RELEASE_REQUIRED'; exit 1; }
previous_daily_present=0
previous_daily=''
if [ -e "$dailycurrent" ] || [ -L "$dailycurrent" ]; then
 previous_daily=$(readlink -f "$dailycurrent")
 [ -L "$dailycurrent" ] && [ -d "$previous_daily" ] || { echo 'MANAGED_DAILY_RELEASE_REQUIRED'; exit 1; }
 previous_daily_present=1
fi
https_read(){ curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 "https://globaldroptrade.com/$1" -o "$2"; }
healthy(){
 python3 - "$1" <<'PY'
import json,sys
try:h=json.load(open(sys.argv[1]));assert h.get('status')=='ok' and h.get('configured') is True
except Exception:raise SystemExit('API_HEALTH_NOT_VERIFIED')
PY
}
https_read api/config "$backup/config.json"
https_read api/health "$backup/health.json"
healthy "$backup/health.json"
service=globaldroptrade-zero-daily.service
timer=globaldroptrade-zero-daily.timer
workers=("$timer" "$service")
: > "$backup/workers"
for worker in "${workers[@]}"; do
 load=$(systemctl show --property=LoadState --value "$worker")
 active=$(systemctl show --property=ActiveState --value "$worker")
 case "$load" in not-found) case "$active" in inactive|failed) continue;; *) echo 'UNMANAGED_SIGNER_WORKER_ACTIVE'; exit 1;; esac;; loaded) ;; *) echo 'CANNOT_INSPECT_ZERO_SIGNER'; exit 1;; esac
 enabled=$(systemctl is-enabled "$worker" || true)
 case "$enabled" in enabled|enabled-runtime|disabled|static|indirect|masked) ;; *) echo 'WORKER_ENABLE_STATE_UNKNOWN'; exit 1;; esac
 case "$active" in active|activating|inactive|failed) ;; *) echo 'WORKER_STATE_NOT_STABLE'; exit 1;; esac
 printf '%s|%s|%s\n' "$worker" "$enabled" "$active" >> "$backup/workers"
 file="/etc/systemd/system/$worker"
 if [ -e "$file" ] || [ -L "$file" ]; then
  [ -f "$file" ] && [ ! -L "$file" ] || { echo 'MANAGED_ZERO_UNIT_REQUIRED'; exit 1; }
  install -m 600 "$file" "$backup/$worker"
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
 oracle=j.get('oracle',{})
 if not isinstance(oracle,dict):raise SystemExit('SIGNER_JOURNAL_REVIEW_REQUIRED')
 if j.get('pending') or oracle.get('pending') or any(not isinstance(t,dict) or type(t.get('block')) is not int or t['block']<1 for t in j.get('transactions',{}).values()):raise SystemExit('PENDING_SIGNED_TRANSACTION_REQUIRES_RECONCILIATION')
PY
}
quiesce(){
 local load active enabled failed=0
 load=$(systemctl show --property=LoadState --value "$timer") || { failed=1;load=unknown; }
 active=$(systemctl show --property=ActiveState --value "$timer") || { failed=1;active=unknown; }
 if [ "$load" != not-found ] || { [ "$active" != inactive ] && [ "$active" != failed ]; }; then systemctl stop "$timer" || failed=1;fi
 if [ "$load" = loaded ]; then
  enabled=$(systemctl is-enabled "$timer" || true)
  case "$enabled" in enabled|enabled-runtime) systemctl disable "$timer" || failed=1;; disabled|static|indirect|masked) ;; *) failed=1;; esac
 elif [ "$load" != not-found ]; then failed=1;fi
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
 flock -u 8 2>/dev/null
 exec 8>&-
 restored=0
 quiesce
 safe=$?
 [ "${run_lock_conflict:-0}" -eq 0 ] || safe=1
 journals_complete "$state/journal.json" /var/lib/globaldroptrade/automation-v1/journal.json /var/lib/globaldroptrade/oracle-maintenance-v1/journal.json "$other_state/journal.json" || safe=1
 cmp -s "$backup/trades.env" "$envfile" || safe=1
 cmp -s "$backup/api.service" "$apiunit" || safe=1
 [ -L "$apicurrent" ] && [ "$(readlink -f "$apicurrent")" = "$previous_api" ] || safe=1
 if [ "$previous_daily_present" -eq 1 ]; then
  [ -L "$dailycurrent" ] && [ "$(readlink -f "$dailycurrent" || true)" = "$previous_daily" ] || safe=1
 elif [ -e "$dailycurrent" ] || [ -L "$dailycurrent" ]; then safe=1;fi
 for worker in "${workers[@]}"; do
  file="/etc/systemd/system/$worker"
  if [ -f "$backup/$worker" ]; then cmp -s "$backup/$worker" "$file" || safe=1
  elif [ -e "$file" ] || [ -L "$file" ]; then safe=1;fi
 done
 https_read api/config "$backup/recovered-config.json" && cmp -s "$backup/config.json" "$backup/recovered-config.json" || safe=1
 https_read api/health "$backup/recovered-health.json" && healthy "$backup/recovered-health.json" || safe=1
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
 echo "ZERO_ORACLE_REPAIR_INCOMPLETE previousWorkersRestored=$restored backup=$backup"
 echo 'The current contract and confirmed transactions are preserved. Retry this command with the same journals.'
 exit 1
}
trap failed ERR INT TERM
quiesce
journals_complete /var/lib/globaldroptrade/automation-v1/journal.json /var/lib/globaldroptrade/oracle-maintenance-v1/journal.json "$other_state/journal.json"
exec 8>"$state/run.lock"
run_lock_conflict=0
if ! flock -n 8; then run_lock_conflict=1;echo 'ZERO_AUTOMATION_JOURNAL_IN_USE';false;fi
cmp -s "$backup/trades.env" "$envfile"
if [ "$profit_recovery" -eq 1 ]; then
 # The source CLI never signs in this mode. The updated full worker alone
 # validates and resumes selected pending transactions after installation.
 echo 'PROFIT_RECOVERY_INSTALL_ONLY: selected pending transactions belong to the full worker.'
else
order=oracle-first
if [ "$fund_million" -eq 1 ]; then
 # Choose only the recovery order here. Each worker mode validates the exact
 # saved target, signer, transaction payload and fee journal before sending.
 order=$(python3 - "$state/journal.json" <<'PY'
import json,os,re,stat,sys
p=sys.argv[1]
try:fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
except FileNotFoundError:print('oracle-first');raise SystemExit(0)
with os.fdopen(fd) as f:
 s=os.fstat(f.fileno())
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077 or s.st_size>16*1024*1024:raise SystemExit('PRIVATE_SIGNER_JOURNAL_REQUIRED')
 try:j=json.load(f)
 except (ValueError,UnicodeError):raise SystemExit('SIGNER_JOURNAL_REVIEW_REQUIRED')
if not isinstance(j,dict) or not isinstance(j.get('transactions',{}),dict):raise SystemExit('SIGNER_JOURNAL_REVIEW_REQUIRED')
grant={'fast-test-reward-topup-1000000-v1-'+step for step in ['mint','approve','fund']}
groups=set();pending=[]
def categorize(label):
 if isinstance(label,str) and label in grant:return 'grant'
 if isinstance(label,str) and re.fullmatch(r'oracle-refresh-[1-9][0-9]*',label):return 'oracle'
 raise SystemExit('NON_ORACLE_OR_TEST_TOPUP_PENDING_REQUIRES_FULL_WORKER')
for label,entry in j.get('transactions',{}).items():
 if not isinstance(entry,dict):raise SystemExit('SIGNER_JOURNAL_REVIEW_REQUIRED')
 if not entry.get('block'):pending.append(label);groups.add(categorize(label))
oracle=j.get('oracle',{})
if not isinstance(oracle,dict):raise SystemExit('SIGNER_JOURNAL_REVIEW_REQUIRED')
if oracle.get('pending'):
 if not isinstance(oracle['pending'],dict):raise SystemExit('SIGNER_JOURNAL_REVIEW_REQUIRED')
 if categorize(oracle['pending'].get('label'))!='oracle':raise SystemExit('ORACLE_PENDING_SCOPE_MISMATCH')
 groups.add('oracle')
if len(pending)>1 or len(groups)>1:raise SystemExit('MIXED_PENDING_ORACLE_TOPUP_REQUIRES_RECONCILIATION')
print('fund-first' if groups=={'grant'} else 'oracle-first')
PY
 )
 echo 'ONE_TIME_TEST_REWARD_TOPUP amount=1000000 Test_USDT chain=97; no automatic refill.'
fi
if [ "$order" = fund-first ]; then node scripts/zero-start-automation.mjs --execute --fast-testnet --fund-test-million;fi
node scripts/zero-start-automation.mjs --oracles-only --execute "${profile_args[@]}"
if [ "$fund_million" -eq 1 ] && [ "$order" = oracle-first ]; then node scripts/zero-start-automation.mjs --execute --fast-testnet --fund-test-million;fi
fi
flock -u 8
exec 8>&-
cmp -s "$backup/trades.env" "$envfile"
bash ubuntu-enable-zero-daily.sh "${install_args[@]}"
trap - ERR INT TERM
if [ "$profit_recovery" -eq 1 ]; then
 echo 'ZERO_PROFIT_RECOVERY_COMPLETE: full worker installed; inspect reported readiness and profit state.'
else
 echo 'ZERO_ORACLE_REPAIR_COMPLETE: current testnet quotes verified; repaired maintenance worker installed.'
fi
echo 'Contract address, accounts and economic rules were preserved.'
