// Local installer harness: all mutable host paths are redirected to a temporary test root.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {afterEach,test} from 'node:test';
import {readNewDeployerPrivateText} from '../scripts/connect-new-deployer-testnet.mjs';

const rootDirectories=[];
const target='0x1111111111111111111111111111111111111111';
const repository=process.cwd();
const installer=fs.readFileSync(path.join(repository,'ubuntu-connect-new-deployer-testnet.sh'),'utf8');

function write(file,value,mode=0o600){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,value,{mode});fs.chmodSync(file,mode);}
function executable(file,value){write(file,value,0o700);}
function makeHost(){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'new-deployer-installer-'));rootDirectories.push(root);
    const data=path.join(root,'var/lib/globaldroptrade');
    const state=path.join(data,'new-deployer-testnet-v1');
    const parents=['fresh-fast-reset-20261107','fast-testnet-setup-v1','zero-oracle-repair-v1','fresh-fast-testnet-connection','worker-sync-v1','smart-worker-v1','rpc-failover-v1','fresh-fast-testnet-v1','fresh-fast-testnet-automation-v1'];
    for(const name of parents)fs.mkdirSync(path.join(data,name),{recursive:true,mode:0o700});
    fs.chmodSync(data,0o755);
    fs.mkdirSync(path.join(data,'new-deployer-testnet-connection'),{recursive:true,mode:0o700});
    write(path.join(state,'deployment-public.json'),'{}\n');write(path.join(data,'fresh-fast-reset-20261107','session.json'),'{}\n');
    write(path.join(root,'etc/globaldroptrade/trades.env'),'TRADES_CHAIN_ID="97"\nTRADES_RPC_URL="https://rpc.example.invalid"\nORIGINAL="preserve"\n');
    write(path.join(root,'etc/systemd/system/globaldroptrade-api.service'),'[Service]\nExecStart=/old\n',0o644);
    const previous=path.join(root,'opt/globaldroptrade-api/releases/previous');fs.mkdirSync(previous,{recursive:true,mode:0o700});fs.mkdirSync(path.join(root,'opt/globaldroptrade-api'),{recursive:true,mode:0o700});fs.symlinkSync(previous,path.join(root,'opt/globaldroptrade-api/current'));
    write(path.join(root,'etc/nginx/sites-available/globaldroptrade.com'),'old-conf\n',0o644);fs.mkdirSync(path.join(root,'etc/nginx/sites-enabled'),{recursive:true,mode:0o700});fs.symlinkSync(path.join(root,'etc/nginx/sites-available/globaldroptrade.com'),path.join(root,'etc/nginx/sites-enabled/globaldroptrade.com'));write(path.join(root,'etc/nginx/snippets/globaldroptrade-api.conf'),'old-snippet\n',0o644);
    const bin=path.join(root,'bin');fs.mkdirSync(bin,{recursive:true,mode:0o700});
    executable(path.join(bin,'node'),`#!/bin/bash
set -eu
if [ "\${1:-}" = -e ]; then exit 0; fi
if [ "\${1:-}" = --input-type=module ] && [ "\${2:-}" = - ]; then
 source=$(cat); shift 2
 case "$source" in
  *NEW_DEPLOYER_NEW_WORKER_SETUP_LOCK_REQUIRED*)
   root=$1; directory=$2; setup=$3; mkdir -p "$directory"; chmod 700 "$directory"; : > "$setup"; chmod 600 "$setup";;
  *NEW_DEPLOYER_NEW_WORKER_LOCK_ACTIVE*)
   directory=$1; lock=$2; pid=$3
   if [ -e "$lock" ]; then
    existing=$(cat "$lock" 2>/dev/null || true)
    case "$existing" in ''|*[!0-9]*) echo NEW_DEPLOYER_NEW_WORKER_LOCK_INVALID >&2; exit 1;; esac
    if kill -0 "$existing" 2>/dev/null; then echo NEW_DEPLOYER_NEW_WORKER_LOCK_ACTIVE >&2; else echo NEW_DEPLOYER_NEW_WORKER_LOCK_STALE_REVIEW_REQUIRED >&2; fi
    exit 1
   fi
   mkdir -p "$directory"; printf '%s' "$pid" > "$lock"; chmod 600 "$lock";;
  *NEW_DEPLOYER_NEW_WORKER_LOCK_CHANGED*)
   lock=$1; pid=$2; [ "$(cat "$lock")" = "$pid" ] || { echo NEW_DEPLOYER_NEW_WORKER_LOCK_CHANGED >&2; exit 1; }; rm -f "$lock";;
  *NEW_DEPLOYER_LEGACY_LOCK_PATH_REQUIRED*)
   for lock in "$@"; do [ -d "$(dirname "$lock")" ] && printf '%s\\n' "$lock"; done;;
 esac
 exit 0
fi
if [ "\${1:-}" = scripts/connect-new-deployer-testnet.mjs ]; then
 mode=\${2:-}; stage=\${3:-}
 if [ "\$mode" = prepare ]; then
  printf 'TRADES_CHAIN_ID="97"\\nTRADES_RPC_URL="https://rpc.example.invalid"\\nTRADES_VAULT_ADDRESS="${target}"\\nTRADES_START_BLOCK="44"\\nTRADES_PORT="3115"\\nGLOBAL_MIGRATION_ENABLED="false"\\nTRADES_ZERO_START_PROFILE="global-new-deployer-testnet-v1"\\nGLOBAL_AUTOMATION_PUBLIC_STATUS="/var/www/globaldroptrade/automation-data/new-deployer-activation.json"\\n' > "\$stage/trades.env"
  printf '{"target":"${target}","queue":"0x2222222222222222222222222222222222222222","runtimeHash":"0x%s","archiveSessionSha256":"%s"}\\n' "\$(printf 1%.0s {1..64})" "\$(printf 2%.0s {1..64})" > "\$stage/new-deployer-testnet-connection.json"
 fi
 if [ "\$mode" = publish ]; then
  [ "$(/usr/bin/stat -c '%a' "\${FAKE_HOST:?}/etc/globaldroptrade")" = 700 ] || { echo NEW_DEPLOYER_PRIVATE_DIRECTORY_REQUIRED >&2; exit 1; }
 fi
 exit 0
fi
if [ "\${1:-}" = scripts/preflight-new-deployer-testnet.mjs ]; then exit 0; fi
exit 0
`);
    executable(path.join(bin,'npm'),'#!/bin/bash\nexit 0\n');
    executable(path.join(bin,'nginx'),'#!/bin/bash\n[ "${FAKE_NGINX_FAIL:-}" = 1 ] && exit 1 || exit 0\n');
    executable(path.join(bin,'tar'),`#!/bin/bash
set -eu
out=; while [ "\$#" -gt 0 ]; do if [ "\$1" = -C ]; then out=\$2; shift 2; else shift; fi; done
mkdir -p "\$out/globaldroptrade-package/site"; printf '<html>new</html>\\n' > "\$out/globaldroptrade-package/site/index.html"; : > "\$out/globaldroptrade-package/install.sh"
`);
    executable(path.join(bin,'bash'),`#!/bin/bash
case "\${1:-}" in
 scripts/unpack-website.sh) exit 0;;
 ubuntu-api.sh) [ "\${FAKE_API_FAIL:-}" = 1 ] && exit 1 || exec /bin/bash "\${FAKE_HOST:?}/ubuntu-api.sh";;
 */globaldroptrade-package/install.sh) exit 0;;
 *) exec /bin/bash "\$@";;
esac
`);
    executable(path.join(bin,'curl'),`#!/bin/bash
set -eu
out=; while [ "\$#" -gt 0 ]; do if [ "\$1" = -o ]; then out=\$2; shift 2; else shift; fi; done
[ -n "\$out" ] || { [ "\${FAKE_API_HEALTH_FAIL:-}" = 1 ] && exit 1 || exit 0; }
case "\$out" in
 *active.json) printf '{"version":1,"chainId":97,"vaultAddress":"${target}"}\\n' > "\$out";;
 *health.json) printf '{"status":"ok","configured":true}\\n' > "\$out";;
 *) printf '<html>new</html>\\n' > "\$out";;
esac
`);
    executable(path.join(bin,'systemctl'),`#!/bin/bash
set -eu
printf '%s\\n' "\$*" >> "\${FAKE_SYSTEMCTL_LOG:?}"
if [ "\${FAKE_SYSTEMD_ERROR:-}" = 1 ] && [ "\${1:-}" = show ]; then exit 1; fi
if [ "\${1:-}" = show ]; then
 property=; for value in "\$@"; do case "\$value" in --property=*) property=\${value#--property=};; esac; done
 unit=\${!#}
 case "\$property" in
  LoadState) printf 'loaded\\n';;
  ActiveState) case "\$unit" in globaldroptrade-new-deployer-daily.service|globaldroptrade-new-deployer-daily.timer) [ "\${FAKE_NEW_WORKER_ACTIVE:-}" = 1 ] && printf 'active\\n' || printf 'inactive\\n';; *.service) [ "\${FAKE_SIGNER_BUSY:-}" = 1 ] && printf 'active\\n' || printf 'inactive\\n';; *) printf 'inactive\\n';; esac;;
  UnitFileState) case "\$unit" in globaldroptrade-new-deployer-daily.service|globaldroptrade-new-deployer-daily.timer) [ "\${FAKE_NEW_WORKER_ENABLED:-}" = 1 ] && printf 'enabled\\n' || printf 'disabled\\n';; *) printf 'disabled\\n';; esac;;
 esac
fi
exit 0
`);
    executable(path.join(bin,'sleep'),'#!/bin/bash\nexit 0\n');
    executable(path.join(bin,'id'),'#!/bin/bash\nif [ "${1:-}" = -u ]; then echo 0; fi\nexit 0\n');
    executable(path.join(bin,'stat'),'#!/bin/bash\nif [ "${1:-}" = -c ] && [ "${2:-}" = %u ]; then echo 0; else exec /usr/bin/stat "$@"; fi\n');
    const apiSource=fs.readFileSync(path.join(repository,'ubuntu-api.sh'),'utf8');
    const apiCopy=apiSource.replaceAll('/opt/globaldroptrade-api',root+'/opt/globaldroptrade-api')
        .replaceAll('/etc/globaldroptrade',root+'/etc/globaldroptrade')
        .replaceAll('/etc/systemd/system',root+'/etc/systemd/system');
    write(path.join(root,'ubuntu-api.sh'),apiCopy,0o700);
    for(const [file,contents] of Object.entries({
        'server/fake.mjs':'export {};\n','server/trades.env.example':'TRADES_PORT=3115\n',
        'scripts/fake.mjs':'export {};\n','artifacts/TestnetDeferredMigrationVault.json':'{}\n',
        'package.json':'{}\n','package-lock.json':'{}\n'
    }))write(path.join(root,file),contents);
    // The production executable stays root-only with fixed host paths. This isolated copy
    // changes only literal host roots and shortens the bounded wait for deterministic tests.
    const copied=installer
        .replace('[ "$(id -u)" -eq 0 ] || { echo \'Run as root\'; exit 1; }',': # harness-only root guard bypass')
        .replaceAll('/var/lib/globaldroptrade',root+'/var/lib/globaldroptrade')
        .replaceAll('/etc/globaldroptrade',root+'/etc/globaldroptrade')
        .replaceAll('/etc/systemd/system',root+'/etc/systemd/system')
        .replaceAll('/opt/globaldroptrade-api',root+'/opt/globaldroptrade-api')
        .replaceAll('/var/backups/globaldroptrade',root+'/var/backups/globaldroptrade')
        .replaceAll('/etc/nginx',root+'/etc/nginx')
        .replace('signer_wait_seconds=180','signer_wait_seconds=0');
    const script=path.join(root,'ubuntu-connect-new-deployer-testnet.sh');write(script,copied,0o700);
    return {root,data,bin,script,env:path.join(root,'etc/globaldroptrade/trades.env'),conf:path.join(root,'etc/nginx/sites-available/globaldroptrade.com'),archive:path.join(root,'var/lib/globaldroptrade/fresh-fast-reset-20261107/session.json'),current:path.join(root,'opt/globaldroptrade-api/current'),previous,log:path.join(root,'systemctl.log'),newWorkerLock:path.join(data,'new-deployer-testnet-automation-v1/run.lock')};
}

function run(host,extra={}){
    return spawnSync('/bin/bash',[host.script,'--execute'],{cwd:path.dirname(host.script),encoding:'utf8',env:{...process.env,PATH:host.bin+path.delimiter+process.env.PATH,FAKE_SYSTEMCTL_LOG:host.log,FAKE_HOST:host.root,...extra}});
}

afterEach(()=>{while(rootDirectories.length)fs.rmSync(rootDirectories.pop(),{recursive:true,force:true});});

test('happy cutover stages the new environment without stopping signer services',()=>{
    const host=makeHost(),result=run(host);
    assert.equal(result.status,0,result.stderr+result.stdout);
    assert.match(fs.readFileSync(host.env,'utf8'),new RegExp('TRADES_VAULT_ADDRESS="'+target+'"'));
    assert.match(fs.readFileSync(host.env,'utf8'),/GLOBAL_AUTOMATION_PUBLIC_STATUS="\/var\/www\/globaldroptrade\/automation-data\/new-deployer-activation\.json"/);
    assert.equal(fs.statSync(path.dirname(host.env)).mode&0o777,0o700,'actual API installer must preserve private env parent');
    assert.match(readNewDeployerPrivateText(host.env,{expectedUid:process.getuid()}),/TRADES_CHAIN_ID="97"/);
    const calls=fs.readFileSync(host.log,'utf8');assert.doesNotMatch(calls,/stop globaldroptrade-[^ ]+\.service/);
    assert.equal(fs.existsSync(host.newWorkerLock),false,'connection must release only its own worker lock');
});

test('a busy signer fails before environment cutover and is never force-stopped',()=>{
    const host=makeHost(),before=fs.readFileSync(host.env,'utf8'),result=run(host,{FAKE_SIGNER_BUSY:'1'});
    assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/NEW_DEPLOYER_SIGNER_WORKER_BUSY_RETRY_SAME_COMMAND/);
    assert.equal(fs.readFileSync(host.env,'utf8'),before);
    assert.doesNotMatch(fs.readFileSync(host.log,'utf8'),/stop globaldroptrade-[^ ]+\.service/);
});

test('systemd inspection failure is fail-closed before cutover',()=>{
    const host=makeHost(),before=fs.readFileSync(host.env,'utf8'),result=run(host,{FAKE_SYSTEMD_ERROR:'1'});
    assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/NEW_DEPLOYER_SYSTEMD_INSPECTION_REQUIRED/);
    assert.equal(fs.readFileSync(host.env,'utf8'),before);
});

test('new worker systemd activity or enablement blocks a connection re-run without stopping it',()=>{
    for(const extra of [{FAKE_NEW_WORKER_ACTIVE:'1'},{FAKE_NEW_WORKER_ENABLED:'1'}]){
        const host=makeHost(),before=fs.readFileSync(host.env,'utf8'),result=run(host,extra),output=result.stdout+result.stderr;
        assert.notEqual(result.status,0,output);assert.match(output,/NEW_DEPLOYER_NEW_WORKER_(ACTIVE|ENABLED)/);assert.equal(fs.readFileSync(host.env,'utf8'),before);
        assert.doesNotMatch(fs.readFileSync(host.log,'utf8'),/stop globaldroptrade-new-deployer-daily\.(service|timer)/);
    }
});

test('a live manual new-worker lock blocks connection before any cutover',()=>{
    const host=makeHost(),before=fs.readFileSync(host.env,'utf8');fs.mkdirSync(path.dirname(host.newWorkerLock),{recursive:true,mode:0o700});write(host.newWorkerLock,String(process.pid));
    const result=run(host),output=result.stdout+result.stderr;
    assert.notEqual(result.status,0,output);assert.match(output,/NEW_DEPLOYER_NEW_WORKER_LOCK_ACTIVE/);assert.equal(fs.readFileSync(host.env,'utf8'),before);assert.equal(fs.readFileSync(host.newWorkerLock,'utf8'),String(process.pid));
});

test('invalid or stale new-worker locks fail closed without being removed',()=>{
    for(const [entry,reason] of [['not-a-pid','NEW_DEPLOYER_NEW_WORKER_LOCK_INVALID'],['2147483647','NEW_DEPLOYER_NEW_WORKER_LOCK_STALE_REVIEW_REQUIRED']]){
        const host=makeHost(),before=fs.readFileSync(host.env,'utf8');fs.mkdirSync(path.dirname(host.newWorkerLock),{recursive:true,mode:0o700});write(host.newWorkerLock,entry);
        const result=run(host),output=result.stdout+result.stderr;
        assert.notEqual(result.status,0,output);assert.match(output,new RegExp(reason));assert.equal(fs.readFileSync(host.env,'utf8'),before);assert.equal(fs.readFileSync(host.newWorkerLock,'utf8'),entry);
    }
});

test('missing optional legacy lock directories do not block an otherwise safe fresh host',()=>{
    const host=makeHost();
    for(const directory of ['zero-oracle-repair-v1','worker-sync-v1','smart-worker-v1','rpc-failover-v1','fresh-fast-testnet-automation-v1'])fs.rmSync(path.join(host.data,directory),{recursive:true,force:true});
    const result=run(host);assert.equal(result.status,0,result.stderr+result.stdout);
});

test('cutover failure restores the previous environment and nginx configuration',()=>{
    const host=makeHost(),beforeEnv=fs.readFileSync(host.env,'utf8'),beforeConf=fs.readFileSync(host.conf,'utf8'),beforeArchive=fs.readFileSync(host.archive,'utf8'),result=run(host,{FAKE_API_FAIL:'1'});
    assert.notEqual(result.status,0);assert.equal(fs.readFileSync(host.env,'utf8'),beforeEnv);assert.equal(fs.readFileSync(host.conf,'utf8'),beforeConf);assert.equal(fs.readFileSync(host.archive,'utf8'),beforeArchive);assert.equal(fs.realpathSync(host.current),host.previous);
    assert.match(result.stdout+result.stderr,/NEW_DEPLOYER_CONNECTION_FAILED_(PREVIOUS_SITE_RESTORED|RECOVERY_REQUIRED)/);
});

test('real API installer health failure preserves private directory and connection rollback',()=>{
    const host=makeHost(),beforeEnv=fs.readFileSync(host.env,'utf8'),beforeConf=fs.readFileSync(host.conf,'utf8');
    const result=run(host,{FAKE_API_HEALTH_FAIL:'1'});
    assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/API health check failed/);
    assert.equal(fs.readFileSync(host.env,'utf8'),beforeEnv);assert.equal(fs.readFileSync(host.conf,'utf8'),beforeConf);
    assert.equal(fs.statSync(path.dirname(host.env)).mode&0o777,0o700);assert.equal(fs.realpathSync(host.current),host.previous);
    assert.match(readNewDeployerPrivateText(host.env,{expectedUid:process.getuid()}),/ORIGINAL="preserve"/);
});

test('a rollback verification failure reports recovery-required without claiming restoration',()=>{
    const host=makeHost(),result=run(host,{FAKE_API_FAIL:'1',FAKE_NGINX_FAIL:'1'});
    assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/NEW_DEPLOYER_CONNECTION_FAILED_RECOVERY_REQUIRED/);assert.doesNotMatch(result.stdout+result.stderr,/PREVIOUS_SITE_RESTORED/);
});
