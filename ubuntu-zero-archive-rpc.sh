#!/usr/bin/env bash
# Replace only the reviewed fast-testnet RPC after proving the existing history.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "$#:${1:-}" in 1:--check|1:--execute) mode=$1;; *) echo 'Usage: bash ubuntu-zero-archive-rpc.sh --check|--execute'; exit 1;; esac
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH";fi
for tool in node npm systemctl python3 flock curl cmp;do command -v "$tool" >/dev/null;done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("Node 22.12+ required")'
umask 077
envfile=/etc/globaldroptrade/trades.env
state=/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1
deployment=/var/lib/globaldroptrade/fresh-fast-testnet-v1
directory=/var/lib/globaldroptrade/zero-oracle-repair-v1
connection=/var/lib/globaldroptrade/fresh-fast-testnet-connection
apiunit=/etc/systemd/system/globaldroptrade-api.service
apicurrent=/opt/globaldroptrade-api/current
dailycurrent=/opt/globaldroptrade-zero-daily/current
service=globaldroptrade-zero-daily.service
timer=globaldroptrade-zero-daily.timer
node --input-type=module - "$envfile" <<'JS'
import fs from 'node:fs';import {parseEnv} from 'node:util';
try{
 const fd=fs.openSync(process.argv[2],fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let original;
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error();original=fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
 const e=parseEnv(original);
 if(e.TRADES_CHAIN_ID!=='97'||e.TRADES_ZERO_START_PROFILE!=='global-fresh-fast-test-v1'||e.GLOBAL_MIGRATION_ENABLED!=='false'||(e.GLOBAL_AUTOMATION_STATE&&e.GLOBAL_AUTOMATION_STATE!=='/var/lib/globaldroptrade/automation-v1'))throw Error();
}catch{console.error('CONNECTED_FAST_TESTNET_PROFILE_REQUIRED');process.exitCode=1;}
JS
python3 - "$connection" "$directory" "$state" <<'PY'
import stat,sys
from pathlib import Path
for name in sys.argv[1:]:
 p=Path(name);p.mkdir(parents=True,exist_ok=True,mode=0o700);s=p.lstat()
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077:raise SystemExit('PRIVATE_ARCHIVE_REPAIR_DIRECTORY_REQUIRED')
 for lock in ['setup.lock','run.lock']:
  f=p/lock
  try:t=f.lstat()
  except FileNotFoundError:continue
  if not stat.S_ISREG(t.st_mode) or t.st_uid!=0 or t.st_mode&0o077:raise SystemExit('PRIVATE_ARCHIVE_REPAIR_LOCK_REQUIRED')
PY
# A connection cutover, oracle repair or installer cannot overlap this change.
exec 9>"$connection/run.lock";flock -n 9 || { echo 'ZERO_CONNECTION_ALREADY_RUNNING';exit 1; }
exec 8>"$directory/setup.lock";flock -n 8 || { echo 'ZERO_ORACLE_REPAIR_ALREADY_RUNNING';exit 1; }
exec 7>"$state/setup.lock";flock -n 7 || { echo 'ZERO_AUTOMATION_SETUP_ALREADY_RUNNING';exit 1; }
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
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
 if not isinstance(j,dict) or not isinstance(j.get('transactions',{}),dict) or not isinstance(j.get('oracle',{}),dict):raise SystemExit('SIGNER_JOURNAL_REVIEW_REQUIRED')
 if j.get('pending') or j.get('oracle',{}).get('pending') or any(not isinstance(t,dict) or type(t.get('block')) is not int or t['block']<1 for t in j.get('transactions',{}).values()):raise SystemExit('PENDING_SIGNED_TRANSACTION_REQUIRES_RECONCILIATION')
PY
}
journals=("$state/journal.json" /var/lib/globaldroptrade/fresh-zero-automation-v1/journal.json /var/lib/globaldroptrade/automation-v1/journal.json /var/lib/globaldroptrade/oracle-maintenance-v1/journal.json)
if [ "$mode" = --check ];then
 exec 6>"$state/run.lock";flock -n 6 || { echo 'ZERO_AUTOMATION_JOURNAL_IN_USE';exit 1; }
 journals_complete "${journals[@]}"
 node scripts/prepare-zero-archive-rpc.mjs --check --fast-testnet
 exit 0
fi
for other in globaldroptrade-migration.service globaldroptrade-fresh-rewards.service globaldroptrade-automation.timer globaldroptrade-automation.service globaldroptrade-oracles.timer globaldroptrade-oracles.service;do
 load=$(systemctl show --property=LoadState --value "$other");active=$(systemctl show --property=ActiveState --value "$other")
 case "$load:$active" in loaded:inactive|loaded:failed|not-found:inactive|not-found:failed) ;; *) echo 'OTHER_SIGNER_WORKER_ACTIVE_OR_UNKNOWN';exit 1;; esac
done
backup="$directory/archive-rpc-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup"
install -m 600 "$envfile" "$backup/trades.env"
python3 - "$apiunit" "/etc/systemd/system/$service" "/etc/systemd/system/$timer" "$state/run.lock" <<'PY'
import os,shlex,stat,sys
from pathlib import Path
for name in sys.argv[1:4]:
 s=os.lstat(name)
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:raise SystemExit('MANAGED_API_AND_ZERO_UNITS_REQUIRED')
lines=[line.split('=',1)[1] for line in Path(sys.argv[2]).read_text().splitlines() if line.startswith('ExecStart=')]
if len(lines)!=1:raise SystemExit('CURRENT_FAST_HOURLY_WORKER_REQUIRED')
a=shlex.split(lines[0])
if any(value not in a for value in [sys.argv[4],'--execute','--fast-testnet','--hourly-test']) or any(value in a for value in ['--fund-test-million','--oracles-only']):raise SystemExit('CURRENT_FAST_HOURLY_WORKER_REQUIRED')
PY
for worker in "$service" "$timer";do install -m 600 "/etc/systemd/system/$worker" "$backup/$worker";done
install -m 600 "$apiunit" "$backup/api.service"
previous_api=$(readlink -f "$apicurrent");previous_daily=$(readlink -f "$dailycurrent")
[ -L "$apicurrent" ] && [ -d "$previous_api" ] && [ -L "$dailycurrent" ] && [ -d "$previous_daily" ] || { echo 'MANAGED_API_AND_ZERO_RELEASES_REQUIRED';exit 1; }
https_read(){ curl -fsS --noproxy '*' --max-time 12 --resolve globaldroptrade.com:443:127.0.0.1 "https://globaldroptrade.com/$1" -o "$2"; }
api_check(){
 python3 - "$1" "$2" "$3" <<'PY'
import json,sys
try:
 c=json.load(open(sys.argv[1]));h=json.load(open(sys.argv[2]));before=json.load(open(sys.argv[3]));assert c==before and c['chainId']==97 and h.get('status')=='ok' and h.get('configured') is True
except Exception:raise SystemExit('API_TARGET_OR_HEALTH_NOT_VERIFIED')
PY
}
https_read api/config "$backup/config.json";https_read api/health "$backup/health.json";api_check "$backup/config.json" "$backup/health.json" "$backup/config.json"
: > "$backup/workers"
for worker in "$timer" "$service";do
 load=$(systemctl show --property=LoadState --value "$worker");active=$(systemctl show --property=ActiveState --value "$worker");enabled=$(systemctl is-enabled "$worker" || true)
 [ "$load" = loaded ] || { echo 'MANAGED_ZERO_WORKER_REQUIRED';exit 1; }
 case "$active" in active|activating|inactive|failed) ;; *) echo 'WORKER_STATE_NOT_STABLE';exit 1;; esac
 case "$enabled" in enabled|enabled-runtime|disabled|static|indirect) ;; *) echo 'WORKER_ENABLE_STATE_UNKNOWN';exit 1;; esac
 printf '%s|%s|%s\n' "$worker" "$enabled" "$active" >> "$backup/workers"
done
quiesce(){
 local worker active enabled failed=0
 systemctl stop "$timer" || failed=1
 enabled=$(systemctl is-enabled "$timer" || true)
 case "$enabled" in enabled|enabled-runtime) systemctl disable "$timer" || failed=1;; disabled|static|indirect) ;; *) failed=1;; esac
 systemctl stop "$service" || failed=1
 for worker in "$timer" "$service";do active=$(systemctl show --property=ActiveState --value "$worker") || failed=1;case "$active" in inactive|failed) ;; *) failed=1;; esac;done
 [ "$failed" -eq 0 ]
}
financial_files=("$state/journal.json" "$state/daily-policy.json" "$deployment/deployment-public.json" "$deployment/connection-public.json" "${journals[@]:1}")
financial_snapshot(){
 python3 - "$1" "$backup/financial-sha256.json" "${financial_files[@]}" <<'PY'
import hashlib,json,os,stat,sys
actual={}
for name in sys.argv[3:]:
 try:fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW)
 except FileNotFoundError:actual[name]=None;continue
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno())
  if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077 or s.st_size>16*1024*1024:raise SystemExit('PRIVATE_FINANCIAL_FILE_REQUIRED')
  actual[name]=hashlib.sha256(f.read()).hexdigest()
if sys.argv[1]=='create':
 fd=os.open(sys.argv[2],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:json.dump(actual,f)
elif actual!=json.load(open(sys.argv[2])):raise SystemExit('FINANCIAL_STATE_CHANGED_DURING_RPC_REPAIR')
PY
}
unchanged_installation(){
 cmp -s "$backup/api.service" "$apiunit" && cmp -s "$backup/$service" "/etc/systemd/system/$service" && cmp -s "$backup/$timer" "/etc/systemd/system/$timer" && [ -L "$apicurrent" ] && [ "$(readlink -f "$apicurrent")" = "$previous_api" ] && [ -L "$dailycurrent" ] && [ "$(readlink -f "$dailycurrent")" = "$previous_daily" ]
}
release_run_lock(){ if [ "$run_locked" -eq 1 ];then flock -u 6;exec 6>&-;run_locked=0;fi; }
start_previous(){
 local worker enabled active failed=0
 while IFS='|' read -r worker enabled active;do case "$worker:$active" in *.service:active|*.service:activating) systemctl start "$worker" || failed=1;; esac;done < "$backup/workers"
 [ "$failed" -eq 0 ] || return 1
 while IFS='|' read -r worker enabled active;do
  case "$worker" in *.timer) ;; *) continue;; esac
  case "$enabled" in enabled) systemctl enable "$worker" || failed=1;; enabled-runtime) systemctl enable --runtime "$worker" || failed=1;; esac
  case "$active" in active|activating) systemctl start "$worker" || failed=1;; esac
 done < "$backup/workers"
 [ "$failed" -eq 0 ]
}
run_locked=0
financial_ready=0
may_have_run=0
failed(){
 trap - ERR INT TERM
 set +e
 restored=0
 quiesce
 safe=$?
 if [ "$may_have_run" -eq 0 ];then
  [ "$run_locked" -eq 1 ] && [ "$financial_ready" -eq 1 ] || safe=1
  if [ "$financial_ready" -eq 1 ];then financial_snapshot verify || safe=1;fi
  unchanged_installation || safe=1
  if ! cmp -s "$backup/trades.env" "$envfile";then
   [ -f "$backup/apply-verified.json" ] || safe=1
   if [ "$safe" -eq 0 ];then
    python3 - "$backup/trades.env" "$envfile" "$backup/apply-verified.json" <<'PY'
import hashlib,json,os,stat,sys
old=open(sys.argv[1],'rb').read();current=open(sys.argv[2],'rb').read();proof=json.load(open(sys.argv[3]))
if hashlib.sha256(old).hexdigest()!=proof['originalEnvSha256'] or hashlib.sha256(current).hexdigest()!=proof['stagedEnvSha256']:raise SystemExit('RPC_ENV_CHANGED_REQUIRES_REVIEW')
p=sys.argv[2]+'.archive-restore-'+str(os.getpid());fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'wb') as f:f.write(old);f.flush();os.fsync(f.fileno())
os.replace(p,sys.argv[2]);parent=os.open(os.path.dirname(sys.argv[2]),os.O_RDONLY)
try:os.fsync(parent)
finally:os.close(parent)
PY
    [ "$?" -eq 0 ] || safe=1
   fi
  fi
  if [ "$safe" -eq 0 ];then
   systemctl restart globaldroptrade-api.service || safe=1
   https_read api/config "$backup/restored-config.json" && https_read api/health "$backup/restored-health.json" && api_check "$backup/restored-config.json" "$backup/restored-health.json" "$backup/config.json" || safe=1
   cmp -s "$backup/trades.env" "$envfile" && financial_snapshot verify && unchanged_installation || safe=1
  fi
  release_run_lock
  if [ "$safe" -eq 0 ];then if start_previous;then restored=1;else quiesce;fi;fi
 else
  # A timer start may already have signed a transaction. Retain the verified
  # candidate environment and every journal; never roll back this provider.
  release_run_lock
 fi
 echo "ZERO_ARCHIVE_RPC_INCOMPLETE previousWorkersRestored=$restored workerMayHaveRun=$may_have_run backup=$backup"
 echo 'Financial journals and confirmed transactions were preserved. Retry the same command.'
 exit 1
}
trap failed ERR INT TERM
quiesce
exec 6>"$state/run.lock"
flock -n 6 || { echo 'ZERO_AUTOMATION_JOURNAL_IN_USE';false; }
run_locked=1
journals_complete "${journals[@]}"
financial_snapshot create;financial_ready=1
cmp -s "$backup/trades.env" "$envfile"
node scripts/prepare-zero-archive-rpc.mjs --stage "$backup/stage" --fast-testnet
financial_snapshot verify;unchanged_installation
node --input-type=module - "$envfile" "$backup/trades.env" "$backup/stage" "$state" "$deployment" "$backup/config.json" "$backup/apply-verified.json" <<'JS'
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {parseEnv} from 'node:util';
const [file,backup,stage,state,deployment,configFile,marker]=process.argv.slice(2),candidate='https://bsc-testnet-rpc.publicnode.com';
const read=file=>{const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0||s.size>16*1024*1024)throw Error('PRIVATE_RPC_STAGE_REQUIRED');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}};
const sha=value=>createHash('sha256').update(value).digest('hex');
const original=read(file),saved=read(backup),next=read(stage+'/trades.env'),report=JSON.parse(read(stage+'/archive-rpc-stage.json')),ready=JSON.parse(read(stage+'/readiness.json'));
const old=parseEnv(original.toString()),after=parseEnv(next.toString()),config=JSON.parse(read(configFile)),c=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json','utf8'));
const expected=old.TRADES_RPC_URL===candidate?original.toString():original.toString()+(original.toString().endsWith('\n')?'':'\n')+'TRADES_RPC_URL="'+candidate+'"\n';
if(!original.equals(saved)||next.toString()!==expected||after.TRADES_RPC_URL!==candidate||old.TRADES_CHAIN_ID!=='97'||old.TRADES_ZERO_START_PROFILE!==c.releaseId||after.TRADES_CHAIN_ID!=='97'||after.TRADES_ZERO_START_PROFILE!==c.releaseId)throw Error('RPC_ONLY_ENV_CHANGE_REQUIRED');
const rest=e=>JSON.stringify(Object.fromEntries(Object.entries(e).filter(([key])=>key!=='TRADES_RPC_URL').sort(([a],[b])=>a.localeCompare(b))));
if(rest(old)!==rest(after)||report.version!==1||report.kind!=='fresh-zero-archive-rpc-stage'||report.chainId!==97||report.releaseId!==c.releaseId||report.candidateRpcUrl!==candidate||report.ready!==true||report.transactionsSent!==0||report.signerOpened!==false||report.originalEnvSha256!==sha(original)||report.stagedEnvSha256!==sha(next)||report.owner!==c.owner||report.operator!==c.deployer||report.artifactHash!==c.artifactHash)throw Error('VERIFIED_ARCHIVE_RPC_STAGE_REQUIRED');
if(config.chainId!==97||typeof config.vaultAddress!=='string'||config.vaultAddress.toLowerCase()!==report.target.toLowerCase()||old.TRADES_VAULT_ADDRESS.toLowerCase()!==report.target.toLowerCase()||ready.ready!==true||ready.chainId!==97||ready.target.toLowerCase()!==report.target.toLowerCase()||ready.archive?.fullyVerified!==true||ready.archive?.requiredRetentionSeconds!==3600||ready.allocationPeriodSeconds!==3600||report.period?.periodSeconds!==3600||!Number.isSafeInteger(report.period?.epoch)||report.period.epoch<0||!Number.isSafeInteger(report.anchor?.block)||report.anchor.block<1)throw Error('CURRENT_HOURLY_ARCHIVE_PROOF_REQUIRED');
for(const [name,directory,key]of[['journal.json',state,'journalSha256'],['daily-policy.json',state,'policySha256'],['deployment-public.json',deployment,'deploymentSha256'],['connection-public.json',deployment,'connectionSha256']])if(sha(read(directory+'/'+name))!==report[key])throw Error('RPC_REPAIR_INPUT_CHANGED');
if(report.readinessSha256!==sha(read(stage+'/readiness.json')))throw Error('RPC_READINESS_STAGE_CHANGED');
const proof=Buffer.from(JSON.stringify({originalEnvSha256:sha(original),stagedEnvSha256:sha(next)})+'\n');let fd=fs.openSync(marker,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,proof);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
const temporary=file+'.archive-rpc-'+process.pid;fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,next);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,file);const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
JS
systemctl restart globaldroptrade-api.service
https_read api/config "$backup/candidate-config.json";https_read api/health "$backup/candidate-health.json";api_check "$backup/candidate-config.json" "$backup/candidate-health.json" "$backup/config.json"
financial_snapshot verify;unchanged_installation
cmp -s "$backup/stage/trades.env" "$envfile"
release_run_lock
# OnBootSec can fire immediately: this flag precedes the first timer attempt.
may_have_run=1
while IFS='|' read -r worker enabled active;do
 [ "$worker" = "$timer" ] || continue
 case "$enabled" in enabled) systemctl enable "$timer";; enabled-runtime) systemctl enable --runtime "$timer";; esac
done < "$backup/workers"
systemctl start "$timer"
systemctl start "$service"
systemctl is-active --quiet "$timer"
https_read api/config "$backup/final-config.json";https_read api/health "$backup/final-health.json";api_check "$backup/final-config.json" "$backup/final-health.json" "$backup/config.json"
cmp -s "$backup/stage/trades.env" "$envfile"
https_read deploy/zero-start-activation.json "$backup/activation.json"
# Advance only the same unfinished member-index pass, never another epoch.
for attempt in 1 2 3;do
 continue_index=$(node --input-type=module - "$backup/activation.json" "$backup/stage/archive-rpc-stage.json" "$state/journal.json" "$state/daily-policy.json" <<'JS'
import fs from 'node:fs';import {createHash} from 'node:crypto';
try{
 const [statusFile,stageFile,journalFile,policyFile]=process.argv.slice(2),v=JSON.parse(fs.readFileSync(statusFile,'utf8')),s=JSON.parse(fs.readFileSync(stageFile,'utf8')),j=JSON.parse(fs.readFileSync(journalFile,'utf8')),policy=fs.readFileSync(policyFile),a=v.automation,p=a?.policy;
 const same=(x,y)=>typeof x==='string'&&typeof y==='string'&&x.toLowerCase()===y.toLowerCase();
 const clean=x=>x===undefined||x===null||(typeof x==='object'&&x.pendingSignedTransaction===false&&x.pendingFinancialTransaction===false);
 const can=v.chainId===97&&v.releaseId===s.releaseId&&same(v.target,s.target)&&v.allocationPeriodSeconds===3600&&v.timerActive===true&&v.ready===true&&a?.readiness?.ready===true&&a?.status==='waiting'&&a.dailyStatus==='indexing'&&a.nextEpoch===s.period.epoch&&j.daily?.epoch===s.period.epoch&&p?.periodSeconds===3600&&Number.isSafeInteger(p.startTimestamp)&&p.startTimestamp+s.period.epoch*p.periodSeconds===s.period.startTimestamp&&same(p.vaultAddress,s.target)&&createHash('sha256').update(policy).digest('hex')===s.policySha256&&Array.isArray(a.errors)&&a.errors.length===0&&Array.isArray(a.blockers)&&a.blockers.length===1&&a.blockers[0]==='DAILY_MEMBER_INDEX_INCOMPLETE'&&Array.isArray(v.blockers)&&v.blockers.length<=1&&v.blockers.every(code=>code==='DAILY_MEMBER_INDEX_INCOMPLETE')&&clean(v.diagnostic)&&clean(a.diagnostic)&&!j.pending&&!j.oracle?.pending&&j.transactions&&Object.values(j.transactions).every(entry=>entry&&Number.isSafeInteger(entry.block)&&entry.block>0);
 console.log(can?'continue':'stop');
}catch{console.log('stop');}
JS
 )
 [ "$continue_index" = continue ] || break
 cmp -s "$backup/stage/trades.env" "$envfile"
 echo 'ZERO_ARCHIVE_MEMBER_INDEX_PROGRESS: continuing the same verified period.'
 systemctl start "$service"
 https_read deploy/zero-start-activation.json "$backup/activation.json"
done
cmp -s "$backup/stage/trades.env" "$envfile"
node --input-type=module - "$backup/activation.json" "$backup/stage/archive-rpc-stage.json" <<'JS'
import fs from 'node:fs';const value=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const stage=JSON.parse(fs.readFileSync(process.argv[3],'utf8')),sameTarget=value.chainId===97&&value.releaseId===stage.releaseId&&typeof value.target==='string'&&value.target.toLowerCase()===stage.target.toLowerCase()&&value.allocationPeriodSeconds===3600;const codes=(value.blockers||[]).filter(code=>typeof code==='string'&&/^[A-Z][A-Z0-9_]{2,100}$/.test(code));console.log(sameTarget&&value.dailyAutomationActive===true?'DAILY_PLAN_AUTOMATION_ACTIVE':'DAILY_PLAN_WAITING '+(codes.join(',')||'INSPECT_ACTIVATION_STATUS'));const credits=(sameTarget?(value.automation?.dailyCredits||[]):[]).filter(entry=>entry?.status==='credited'&&/^0x[0-9a-f]{64}$/i.test(entry.transactionHash||''));if(credits.length)for(const entry of credits)console.log('DAILY_CREDIT_TX_HASH='+entry.transactionHash);else console.log('NO_NEW_PROFIT_CREDIT_CONFIRMED_IN_THIS_CHECK');
JS
trap - ERR INT TERM
echo "ZERO_ARCHIVE_RPC_UPDATED: verified existing history; API and full worker restarted. backup=$backup"
echo 'The contract, accounts, hourly policy, fee reservations and reward funding were preserved.'
