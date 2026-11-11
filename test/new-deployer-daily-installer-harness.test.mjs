// The production script remains fixed-path and root-only. This harness rewrites
// literal host paths in a temporary copy and substitutes bounded fake services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {afterEach,test} from 'node:test';

const roots=[];
const repository=process.cwd();
const source=fs.readFileSync('ubuntu-enable-new-deployer-daily.sh','utf8');
const target='0x1111111111111111111111111111111111111111';
function write(file,value,mode=0o600){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,value,{mode});fs.chmodSync(file,mode);}

function makeHost(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'new-daily-installer-'));roots.push(root);
 const bin=path.join(root,'bin');fs.mkdirSync(bin,{mode:0o700});
 for(const name of ['scripts','server','artifacts','config','package.json','package-lock.json'])fs.symlinkSync(path.join(repository,name),path.join(root,name));
 write(path.join(root,'etc/globaldroptrade/trades.env'),'ORIGINAL=preserve\n',0o600);
 fs.mkdirSync(path.join(root,'etc/globaldroptrade/new-deployer-testnet-v1'),{recursive:true,mode:0o700});
 fs.mkdirSync(path.join(root,'etc/systemd/system'),{recursive:true,mode:0o700});
 fs.mkdirSync(path.join(root,'var/lib/globaldroptrade'),{recursive:true,mode:0o700});
 fs.mkdirSync(path.join(root,'var/lib/globaldroptrade/new-deployer-testnet-automation-v1'),{recursive:true,mode:0o700});
 fs.mkdirSync(path.join(root,'var/www/globaldroptrade/automation-data'),{recursive:true,mode:0o700});
 write(path.join(bin,'git'),`#!/bin/bash
case "$1" in rev-parse) printf '%040d\\n' 1;; status) :;; *) exit 1;; esac
`,0o700);
 write(path.join(bin,'npm'),'#!/bin/bash\nexit 0\n',0o700);
 write(path.join(bin,'curl'),`#!/bin/bash
set -eu
out=; while [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then out=$2; shift 2; else shift; fi; done
printf '{"version":1,"chainId":97,"vaultAddress":"${target}","origin":"https://globaldroptrade.com","windowSeconds":86400,"requirementEnabled":true,"activationTimestamp":1794106400}\\n' > "$out"
`,0o700);
 write(path.join(bin,'node'),`#!/bin/bash
set -eu
if [ "\${1:-}" = --input-type=module ] && [ "\${2:-}" = - ] && [[ "\${3:-}" = */setup.lock ]]; then touch "$3"; chmod 600 "$3"; exit 0; fi
if [ "\${1:-}" = --input-type=module ] && [ "\${2:-}" = - ] && [[ "\${3:-}" = */run.lock ]]; then
 if [ "\${5:-}" = acquire ]; then
  if [ -e "$3" ]; then echo NEW_DEPLOYER_WORKER_LOCK_REVIEW_REQUIRED >&2; exit 1; fi
  (set -o noclobber; printf '%s' "$4" > "$3") || exit 1
 elif [ "\${5:-}" = cleanup ]; then
  if [ -f "$3" ] && [ "$(<"$3")" = "$4" ]; then rm -f "$3"; else exit 1; fi
 fi
 exit 0
fi
if [ "\${1:-}" = scripts/replace-new-deployer-env.mjs ]; then cmp -s "$2" "$FAKE_HOST/etc/globaldroptrade/trades.env" || exit 1; cp "$3" "$FAKE_HOST/etc/globaldroptrade/trades.env"; exit 0; fi
if [ "\${1:-}" = scripts/prepare-new-deployer-activity.mjs ]; then
 stage=$2; cp "$FAKE_HOST/etc/globaldroptrade/trades.env" "$stage/trades.original"
 printf 'ORIGINAL=preserve\\nDAILY_ACTIVITY_FILE=test\\n' > "$stage/trades.staged"
 printf '{"version":1,"chainId":97,"vaultAddress":"${target}","origin":"https://globaldroptrade.com","windowSeconds":86400,"activationTimestamp":1794106400,"historyFile":"/var/lib/globaldroptrade-api/new-deployer-testnet-activity-v1/history.json"}\\n' > "$stage/activity-policy.json"
 printf '{"version":1,"target":"${target}","activationTimestamp":1794106400}\\n' > "$stage/activity-preflight.json"
 exit 0
fi
if [ "\${1:-}" = scripts/new-deployer-testnet-automation.mjs ]; then exit 0; fi
if [ "\${1:-}" = --input-type=module ] && [ "\${2:-}" = - ] && [[ "\${3:-}" = */daily-activity-policy.json ]]; then
 if [ ! -e "$3" ]; then cp "$4" "$3"; fi
 exit 0
fi
exit 0
`,0o700);
 write(path.join(bin,'systemctl'),`#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$FAKE_HOST/systemctl.log"
if [ "\${FAKE_SYSTEMD_ERROR:-}" = 1 ] && [ "\${1:-}" = show ]; then exit 1; fi
if [ "\${1:-}" = show ]; then
 property=; for value in "$@"; do case "$value" in --property=*) property=\${value#--property=};; esac; done
 unit=\${!#}
 if [ "$property" = LoadState ]; then [ -e "$FAKE_HOST/etc/systemd/system/$unit" ] && echo loaded || echo not-found; exit 0; fi
 if [ "$property" = UnitFileState ]; then echo disabled; exit 0; fi
 if [ "$property" = ActiveState ]; then
  if [ "$unit" = globaldroptrade-new-deployer-daily.timer ] && [ -f "$FAKE_HOST/timer-active" ]; then echo active
  elif [ "$unit" = globaldroptrade-new-deployer-daily.service ] && [ "\${FAKE_WORKER_BUSY_AFTER_START:-}" = 1 ] && [ -f "$FAKE_HOST/timer-started" ]; then echo active
  else echo inactive; fi
  exit 0
 fi
fi
case "\${1:-}" in
 restart) [ "\${FAKE_API_RESTART_FAIL:-}" != 1 ]; exit $?;;
 start) if [ "\${2:-}" = globaldroptrade-new-deployer-daily.timer ]; then touch "$FAKE_HOST/timer-active" "$FAKE_HOST/timer-started"; fi;;
 stop) if [ "\${2:-}" = globaldroptrade-new-deployer-daily.timer ]; then rm -f "$FAKE_HOST/timer-active"; fi;;
 is-active) if [ "\${FAKE_TIMER_VERIFY_FAIL:-}" = 1 ] && [ "\${3:-}" = globaldroptrade-new-deployer-daily.timer ]; then exit 1; fi;;
esac
exit 0
`,0o700);
 const copied=source.replace('[ "$(id -u)" -eq 0 ] || { echo \'ROOT_REQUIRED\'; exit 1; }',': # harness-only root bypass')
  .replaceAll('/var/lib/globaldroptrade',root+'/var/lib/globaldroptrade')
  .replaceAll('/var/www/globaldroptrade',root+'/var/www/globaldroptrade')
  .replaceAll('/etc/globaldroptrade',root+'/etc/globaldroptrade')
  .replaceAll('/etc/systemd/system',root+'/etc/systemd/system')
  .replaceAll('/opt/globaldroptrade-new-deployer-daily',root+'/opt/globaldroptrade-new-deployer-daily');
 const script=path.join(root,'installer.sh');write(script,copied,0o700);
 return {root,bin,script,env:path.join(root,'etc/globaldroptrade/trades.env'),policy:path.join(root,'etc/globaldroptrade/new-deployer-testnet-v1/daily-activity-policy.json'),log:path.join(root,'systemctl.log')};
}

function run(host,extra={}){return spawnSync('/bin/bash',[host.script,'--execute'],{cwd:host.root,encoding:'utf8',env:{...process.env,PATH:host.bin+path.delimiter+process.env.PATH,FAKE_HOST:host.root,...extra}});}
afterEach(()=>{while(roots.length)fs.rmSync(roots.pop(),{recursive:true,force:true});});

test('successful installation activates the actual timer and preserves the old API setting',()=>{
 const host=makeHost(),result=run(host);assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/NEW_DEPLOYER_DAILY_TIMER_ACTIVE/);assert.match(fs.readFileSync(host.env,'utf8'),/ORIGINAL=preserve/);
 assert.ok(fs.existsSync(host.policy));assert.ok(fs.existsSync(path.join(host.root,'timer-active')));
 const unit=fs.readFileSync(path.join(host.root,'etc/systemd/system/globaldroptrade-new-deployer-daily.service'),'utf8');
 assert.match(unit,/new-deployer-testnet-automation\.mjs --execute/);assert.doesNotMatch(unit,/seed-test-rewards/);
});

test('systemd inspection failure leaves the API unchanged',()=>{
 const host=makeHost(),before=fs.readFileSync(host.env,'utf8'),result=run(host,{FAKE_SYSTEMD_ERROR:'1'});
 assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/NEW_DEPLOYER_SYSTEMD_INSPECTION_REQUIRED/);assert.equal(fs.readFileSync(host.env,'utf8'),before);
});

test('timer verification failure stops only the timer and restores the API without deleting activity policy',()=>{
 const host=makeHost(),before=fs.readFileSync(host.env,'utf8'),result=run(host,{FAKE_TIMER_VERIFY_FAIL:'1'});
 assert.notEqual(result.status,0);assert.match(result.stdout,/recoveryVerified=1/);assert.equal(fs.readFileSync(host.env,'utf8'),before);
 assert.ok(fs.existsSync(host.policy));assert.ok(!fs.existsSync(path.join(host.root,'timer-active')));
 const calls=fs.readFileSync(host.log,'utf8');assert.match(calls,/stop globaldroptrade-new-deployer-daily\.timer/);assert.doesNotMatch(calls,/stop globaldroptrade-new-deployer-daily\.service/);
});

test('busy new signer prevents env rollback and is never killed',()=>{
 const host=makeHost(),result=run(host,{FAKE_TIMER_VERIFY_FAIL:'1',FAKE_WORKER_BUSY_AFTER_START:'1'});
 assert.notEqual(result.status,0);assert.match(result.stdout,/NEW_DEPLOYER_DAILY_MANUAL_RECOVERY_REQUIRED/);
 assert.match(fs.readFileSync(host.env,'utf8'),/DAILY_ACTIVITY_FILE=test/);
 const calls=fs.readFileSync(host.log,'utf8');assert.match(calls,/stop globaldroptrade-new-deployer-daily\.timer/);assert.doesNotMatch(calls,/stop globaldroptrade-new-deployer-daily\.service/);
});

test('an existing manual worker lock blocks installation and remains untouched',()=>{
 const host=makeHost(),lock=path.join(host.root,'var/lib/globaldroptrade/new-deployer-testnet-automation-v1/run.lock');
 write(lock,'12345');const before=fs.readFileSync(host.env,'utf8'),result=run(host);
 assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/NEW_DEPLOYER_WORKER_LOCK_REVIEW_REQUIRED/);
 assert.equal(fs.readFileSync(lock,'utf8'),'12345');assert.equal(fs.readFileSync(host.env,'utf8'),before);
 assert.ok(!fs.existsSync(path.join(host.root,'timer-active')));
});
