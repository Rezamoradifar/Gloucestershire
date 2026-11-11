import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseEnv} from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ACTIVITY_HISTORY,prepareActivitySettings} from '../scripts/prepare-new-deployer-activity.mjs';
import {replaceNewDeployerEnvironment} from '../scripts/replace-new-deployer-env.mjs';
import {ensureNewDeployerWaitingStatus} from '../scripts/create-new-deployer-waiting-status.mjs';
import {summarizeAutomation} from '../server/automation-status.mjs';

const target='0x1111111111111111111111111111111111111111';
const ready={chainId:97,releaseId:'global-new-deployer-testnet-v1',target,checkpoint:{timestamp:1794020000}};
const original=`TRADES_CHAIN_ID=97\nTRADES_ZERO_START_PROFILE=global-new-deployer-testnet-v1\nTRADES_VAULT_ADDRESS=${target}\nGLOBAL_MIGRATION_ENABLED=false\nRPC_SECRET="not-a-real-secret"\n`;

test('the new activity policy uses a 24-hour window and retains unrelated API settings',()=>{
 const result=prepareActivitySettings(original,ready,null),env=parseEnv(result.staged);
 assert.equal(result.policy.windowSeconds,86400);
 assert.equal(result.policy.activationTimestamp,ready.checkpoint.timestamp+86400);
 assert.equal(result.policy.historyFile,ACTIVITY_HISTORY);
 assert.equal(env.RPC_SECRET,'not-a-real-secret');
 assert.equal(env.DAILY_ACTIVITY_FILE,ACTIVITY_HISTORY);
 assert.equal(env.DAILY_ACTIVITY_ACTIVATION_TIMESTAMP,String(result.policy.activationTimestamp));
 assert.equal(env.GLOBAL_AUTOMATION_PUBLIC_STATUS,'/var/www/globaldroptrade/automation-data/new-deployer-activation.json');
});

test('retry preserves the previously established activity cutoff',()=>{
 const existing=prepareActivitySettings(original,ready,null).policy;
 const later={...ready,checkpoint:{timestamp:ready.checkpoint.timestamp+7200}};
 const retried=prepareActivitySettings(original,later,existing);
 assert.equal(retried.policy.activationTimestamp,existing.activationTimestamp);
 assert.equal(prepareActivitySettings(retried.staged,later,existing).staged,retried.staged);
});

test('wrong network, target, history and activity window fail closed',()=>{
 assert.throws(()=>prepareActivitySettings(original,{...ready,chainId:56},null));
 assert.throws(()=>prepareActivitySettings(original,{...ready,target:'0x2222222222222222222222222222222222222222'},null));
 const policy=prepareActivitySettings(original,ready,null).policy;
 assert.throws(()=>prepareActivitySettings(original,ready,{...policy,historyFile:'/var/lib/globaldroptrade-api/daily-activity.json'}));
 assert.throws(()=>prepareActivitySettings(original,ready,{...policy,windowSeconds:3600}));
});

test('invalid or wrong wallet keys never appear in verifier output',()=>{
 const shell=fs.readFileSync('ubuntu-enable-new-deployer-daily.sh','utf8');
 const captured=shell.match(/node --input-type=module - <<'JS'\n(import \{Wallet\} from 'ethers';[\s\S]*?)\nJS/);
 assert.ok(captured,'expected the key verifier');
 for(const dummy of ['0x'+'0'.repeat(64),'0x'+'1'.repeat(64)]){
  const js=captured[1].replace("import {readPrivateKey} from './scripts/migration-signers.mjs';",`const readPrivateKey=()=>${JSON.stringify(dummy)};`);
  const child=spawnSync(process.execPath,['--input-type=module','-e',js],{encoding:'utf8'});
  assert.notEqual(child.status,0);assert.match(child.stderr,/NEW_DEPLOYER_SERVER_OPERATOR_KEY_REQUIRED/);
  assert.ok(!(child.stdout+child.stderr).includes(dummy));
 }
});

test('environment replacement is atomic and refuses changed content or symlinks',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'new-deployer-env-'));
 try{
  const file=path.join(directory,'trades.env'),link=path.join(directory,'link.env');
  fs.writeFileSync(file,'old=1\n',{mode:0o600});fs.symlinkSync(file,link);
  const opts={target:file,expected:Buffer.from('old=1\n'),contents:Buffer.from('new=1\n'),expectedUid:process.getuid()};
  assert.throws(()=>replaceNewDeployerEnvironment({...opts,target:link}));
  assert.throws(()=>replaceNewDeployerEnvironment({...opts,expected:Buffer.from('changed\n')}));
  assert.equal(fs.readFileSync(file,'utf8'),'old=1\n');
  replaceNewDeployerEnvironment(opts);
  assert.equal(fs.readFileSync(file,'utf8'),'new=1\n');
  assert.equal(fs.statSync(file).mode&0o777,0o600);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('initial public status is target-bound, waiting and never replaces prior evidence',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'new-deployer-status-'));
 try{
  const file=path.join(directory,'activation.json'),now=()=>new Date('2026-11-08T00:00:00Z');
  const args={file,target,expectedUid:process.getuid(),now};
  ensureNewDeployerWaitingStatus(args);
  const raw=fs.readFileSync(file,'utf8'),status=summarizeAutomation(JSON.parse(raw),{chainId:97,vaultAddress:target,now:now().getTime()});
  assert.equal(status.status,'waiting');assert.equal(status.schedulerActive,false);
  assert.ok(status.blockers.includes('FIRST_NEW_DEPLOYER_WORKER_CYCLE_REQUIRED'));
  ensureNewDeployerWaitingStatus(args);assert.equal(fs.readFileSync(file,'utf8'),raw);
  assert.throws(()=>ensureNewDeployerWaitingStatus({...args,target:'0x2222222222222222222222222222222222222222'}));
  assert.equal(fs.readFileSync(file,'utf8'),raw);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('real worker PID lock excludes another process and is released only by its owner',()=>{
 const source=fs.readFileSync('ubuntu-enable-new-deployer-daily.sh','utf8');
 const acquire=source.match(/node --input-type=module - "\$state\/run\.lock" "\$\$" acquire <<'JS'\n([\s\S]*?)\nJS/);
 const cleanup=source.match(/node --input-type=module - "\$state\/run\.lock" "\$\$" cleanup <<'JS'[^\n]*\n([\s\S]*?)\nJS/);
 assert.ok(acquire);assert.ok(cleanup);
 assert.equal((source.match(/node scripts\/new-deployer-testnet-automation\.mjs --check/g)||[]).length,1);
 assert.ok(source.indexOf('node scripts/new-deployer-testnet-automation.mjs --check')<source.indexOf('"$state/run.lock" "$$" acquire'));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'new-deployer-lock-'));
 try{
  const file=path.join(directory,'run.lock'),pid=String(process.pid);
  const invoke=(script,owner)=>spawnSync(process.execPath,['--input-type=module','-',file,owner],{encoding:'utf8',input:script.replace('s.uid!==0','s.uid!==process.getuid()')});
  assert.equal(invoke(acquire[1],pid).status,0);assert.equal(fs.readFileSync(file,'utf8'),pid);
  assert.notEqual(invoke(acquire[1],pid).status,0);assert.equal(fs.readFileSync(file,'utf8'),pid);
  assert.notEqual(invoke(cleanup[1],'99999999').status,0);assert.equal(fs.readFileSync(file,'utf8'),pid);
  assert.equal(invoke(cleanup[1],pid).status,0);assert.ok(!fs.existsSync(file));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
