import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {getAddress,keccak256,toUtf8Bytes} from 'ethers';
import {newDeployerTestnetPolicyFields,validateDailyPolicy} from '../scripts/daily-profit.mjs';
import {verifyIndexCommit} from '../scripts/auto-index-new-deployer.mjs';
import {acquireCatchupLock} from '../scripts/index-new-deployer-catchup.mjs';

const h=value=>keccak256(toUtf8Bytes(String(value)));
const block=number=>({number,hash:h('block-'+number),timestamp:1700000000+number});
const vault=getAddress('0x3333333333333333333333333333333333333333');
const owner=getAddress('0x1111111111111111111111111111111111111111');
const operator=getAddress('0x2222222222222222222222222222222222222222');
const queue=getAddress('0x5555555555555555555555555555555555555555');
const runtime='0x1234';
const policy=validateDailyPolicy({version:1,chainId:97,vaultAddress:vault,runtimeHash:keccak256(runtime),deploymentBlock:1000,startTimestamp:1700001000,basis:'position-anniversary-principal',positionScheduleVersion:1,periodSeconds:3600,includeReinvestment:true,owner,operator,...newDeployerTestnetPolicyFields});
const target={target:vault,owner,operator,queue,hash:h('creation'),runtimeHash:policy.runtimeHash,block:1000};
const identity={version:1,chainId:97,target:vault,owner,operator,queue,hash:target.hash,runtimeHash:target.runtimeHash};
function fixture(){
 const candidate={identity,transactions:{},daily:{epoch:19,positionPaid:{alice:3},positionClosed:{},
  positionScanTarget:{number:1999,hash:block(1999).hash},
  registry:{through:1900,hash:block(1900).hash,members:{}},
  positionIndex:{through:1800,hash:block(1800).hash,positions:{}}}};
 let chain=97,head=2500,code=runtime,reorg=null;
 const provider={send:async method=>{assert.equal(method,'eth_chainId');return chain;},getBlockNumber:async()=>head,getCode:async address=>{assert.equal(address,vault);return code;},getBlock:async number=>number===reorg?{...block(number),hash:h('reorg')}:block(number)};
 return {candidate,provider,options:{candidate,provider,policy,target,confirmations:3},setChain:v=>{chain=v;},setHead:v=>{head=v;},setCode:v=>{code=v;},setReorg:v=>{reorg=v;}};
}

test('commit verifier checks live testnet chain, runtime, confirmations, and fixed target and prefixes',async()=>{
 const f=fixture();await assert.doesNotReject(verifyIndexCommit(f.options));
 for(const number of [1999,1900,1800]){
  f.setReorg(number);await assert.rejects(verifyIndexCommit(f.options),/INDEX_AUTO_PREFIX_REORG/);
 }
 f.setReorg(null);f.setChain(56);await assert.rejects(verifyIndexCommit(f.options),/INDEX_AUTO_IDENTITY_CHANGED/);
 f.setChain(97);f.setCode('0x');await assert.rejects(verifyIndexCommit(f.options),/INDEX_AUTO_IDENTITY_CHANGED/);
 f.setCode('0x4321');await assert.rejects(verifyIndexCommit(f.options),/INDEX_AUTO_IDENTITY_CHANGED/);
 f.setCode(runtime);f.setHead(2001);await assert.rejects(verifyIndexCommit(f.options),/INDEX_AUTO_CONFIRMATIONS_REQUIRED/);
});

test('commit verifier rejects a changed canonical block in the financial journal',async()=>{
 const f=fixture();f.candidate.transactions.paid={block:1200,blockHash:block(1200).hash,hash:h('paid')};
 await assert.doesNotReject(verifyIndexCommit(f.options));
 f.setReorg(1200);await assert.rejects(verifyIndexCommit(f.options),/ZERO_START_COMPLETED_JOURNAL_NOT_CANONICAL/);
});

test('unconfirmed financial transaction blocks speculative index commit',async()=>{
 const f=fixture();f.candidate.transactions.pending={hash:h('pending')};
 await assert.rejects(verifyIndexCommit(f.options),/INDEX_CATCHUP_PENDING_RECONCILIATION_REQUIRED/);
});

test('failure while registering a newly acquired lock cleans it up',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auto-index-acquire-'));
 try{
  await assert.rejects(acquireCatchupLock(dir,{expectedUid:process.getuid(),waitMilliseconds:0,onAcquire:()=>{throw Error('registration failed');}}),/registration failed/);
  assert.equal(fs.existsSync(path.join(dir,'run.lock')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('SIGTERM removes an actually held PID lock before exiting',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auto-index-signal-'));
 const auto=pathToFileURL(path.resolve('scripts/auto-index-new-deployer.mjs')).href;
 const catchup=pathToFileURL(path.resolve('scripts/index-new-deployer-catchup.mjs')).href;
 const js=`import {installSignalCleanup} from ${JSON.stringify(auto)};\nimport {acquireCatchupLock,releaseCatchupLock} from ${JSON.stringify(catchup)};\nconst lock=await acquireCatchupLock(process.argv[1],{expectedUid:process.getuid(),waitMilliseconds:0});\ninstallSignalCleanup({getLock:()=>lock,release:releaseCatchupLock});\nconsole.log('LOCKED');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--input-type=module','-e',js,dir],{stdio:['ignore','pipe','pipe']});
 let stderr='',signalled=false;child.stderr.on('data',chunk=>{stderr+=chunk;});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);
 try{
  child.stdout.on('data',chunk=>{if(!signalled&&chunk.toString().includes('LOCKED')){signalled=true;child.kill('SIGTERM');}});
  const [code,signal]=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(a,b)=>resolve([a,b]));});
  assert.equal(signalled,true,stderr);assert.equal(code,143,stderr);assert.equal(signal,null);
  assert.equal(fs.existsSync(path.join(dir,'run.lock')),false);
 }finally{clearTimeout(timeout);if(child.exitCode===null&&!child.killed)child.kill('SIGKILL');fs.rmSync(dir,{recursive:true,force:true});}
});
