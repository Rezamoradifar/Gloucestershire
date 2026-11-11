import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {optimisticIndexCommit} from '../scripts/auto-index-new-deployer.mjs';
import {acquireCatchupLock,releaseCatchupLock} from '../scripts/index-new-deployer-catchup.mjs';

// A complete JSON journal is used so that checking the index update also
// verifies that payment, epoch, activity and signed-transaction state survive.
function fixture(){
 const current={identity:{chainId:97,target:'0xtest'},transactions:{paid:{hash:'0xabc',block:7}},
  activation:{block:1},daily:{epoch:17,lastProcessedEpoch:16,positionPaid:{'member:0':4},
   positionClosed:{},activityPolicyBinding:'binding',registry:{through:7,hash:'old',members:{}},
   positionIndex:{through:6,hash:'old',positions:{}},positionScanTarget:{number:10,hash:'fixed'}}};
 const beforeText=JSON.stringify(current);let disk=beforeText,held=false,writes=0,verifications=0,releases=0;
 const proposedState=structuredClone(current);
 proposedState.daily.registry={through:9,hash:'new',members:{alice:2}};
 proposedState.daily.positionIndex={through:9,hash:'new',positions:{}};
 const options={beforeText,proposedState,deadlineMs:100,
  acquire:async()=>{assert.equal(held,false);held=true;return {pid:1};},
  release:()=>{assert.equal(held,true);held=false;releases++;},
  readJournal:()=>disk,
  writeJournal:value=>{assert.equal(held,true);writes++;disk=JSON.stringify(value);},
  guardSync:()=>{},verify:async()=>{assert.equal(held,true);verifications++;}};
 return {current,options,setDisk:value=>{disk=value;},getDisk:()=>disk,
  get held(){return held;},get writes(){return writes;},get releases(){return releases;},get verifications(){return verifications;}};
}

test('commits indexed fields under the shared lock and keeps all financial state',async()=>{
 const f=fixture();
 assert.equal(await optimisticIndexCommit(f.options),'committed');
 const after=JSON.parse(f.getDisk());
 assert.deepEqual(after.transactions,f.current.transactions);
 assert.deepEqual(after.activation,f.current.activation);
 assert.equal(after.daily.epoch,17);
 assert.equal(after.daily.lastProcessedEpoch,16);
 assert.deepEqual(after.daily.positionPaid,{'member:0':4});
 assert.equal(after.daily.activityPolicyBinding,'binding');
 assert.deepEqual(after.daily.registry,f.options.proposedState.daily.registry);
 assert.deepEqual(after.daily.positionIndex,f.options.proposedState.daily.positionIndex);
 assert.deepEqual(after.daily.positionScanTarget,f.current.daily.positionScanTarget);
 assert.equal(f.verifications,1);assert.equal(f.writes,1);assert.equal(f.releases,1);assert.equal(f.held,false);
});

test('a worker already holding the lock causes an immediate no-write skip',async()=>{
 const f=fixture();
 f.options.acquire=async()=>{throw Error('INDEX_CATCHUP_WORKER_BUSY');};
 assert.equal(await optimisticIndexCommit(f.options),'busy');
 assert.equal(f.getDisk(),f.options.beforeText);assert.equal(f.writes,0);assert.equal(f.releases,0);
});

test('a real held worker lock prevents speculative commit without being removed',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auto-index-worker-lock-'));
 const uid=process.getuid();let worker;
 try{
  worker=await acquireCatchupLock(dir,{expectedUid:uid,waitMilliseconds:0});
  const f=fixture();
  f.options.acquire=()=>acquireCatchupLock(dir,{expectedUid:uid,waitMilliseconds:0});
  f.options.release=releaseCatchupLock;
  assert.equal(await optimisticIndexCommit(f.options),'busy');
  assert.equal(f.writes,0);assert.equal(f.getDisk(),f.options.beforeText);
  assert.equal(fs.readFileSync(path.join(dir,'run.lock'),'utf8'),String(process.pid));
 }finally{if(worker)releaseCatchupLock(worker);fs.rmSync(dir,{recursive:true,force:true});}
});

test('worker journal changes during scanning cause discard',async()=>{
 const f=fixture();
 const newer=structuredClone(f.current);newer.daily.epoch++;
 const newerText=JSON.stringify(newer);f.setDisk(newerText);
 assert.equal(await optimisticIndexCommit(f.options),'changed');
 assert.equal(f.getDisk(),newerText);assert.equal(f.writes,0);assert.equal(f.releases,1);
});

test('a stale speculative result is discarded; a refreshed snapshot can commit',async()=>{
 const f=fixture();
 const newer=structuredClone(f.current);newer.daily.epoch=18;newer.daily.positionPaid['member:0']=5;
 const newerText=JSON.stringify(newer);f.setDisk(newerText);
 assert.equal(await optimisticIndexCommit(f.options),'changed');assert.equal(f.writes,0);
 const refreshed=structuredClone(newer);
 refreshed.daily.registry=structuredClone(f.options.proposedState.daily.registry);
 refreshed.daily.positionIndex=structuredClone(f.options.proposedState.daily.positionIndex);
 f.options.beforeText=newerText;f.options.proposedState=refreshed;
 assert.equal(await optimisticIndexCommit(f.options),'committed');
 const after=JSON.parse(f.getDisk());assert.equal(after.daily.epoch,18);
 assert.equal(after.daily.positionPaid['member:0'],5);assert.equal(f.writes,1);
});

test('journal changes during verification are detected before writing',async()=>{
 const f=fixture();
 const newer=structuredClone(f.current);newer.daily.positionPaid['member:0']=5;
 const newerText=JSON.stringify(newer);
 f.options.verify=async()=>{f.setDisk(newerText);};
 assert.equal(await optimisticIndexCommit(f.options),'changed');
 assert.equal(f.getDisk(),newerText);assert.equal(f.writes,0);assert.equal(f.releases,1);
});

test('reorg rejection and bounded verification timeout never write and always release',async()=>{
 const f=fixture();
 f.options.verify=async()=>{throw Error('INDEX_AUTO_REORG');};
 await assert.rejects(optimisticIndexCommit(f.options),/INDEX_AUTO_REORG/);
 assert.equal(f.getDisk(),f.options.beforeText);assert.equal(f.writes,0);assert.equal(f.releases,1);
 const g=fixture();let resolveVerification;
 g.options.deadlineMs=20;g.options.verify=()=>new Promise(resolve=>{resolveVerification=resolve;});
 await assert.rejects(optimisticIndexCommit(g.options),/INDEX_AUTO_VERIFY_TIMEOUT/);
 assert.equal(g.getDisk(),g.options.beforeText);assert.equal(g.writes,0);assert.equal(g.releases,1);
 resolveVerification();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(g.writes,0,'late RPC response must never write after timeout and release');
});

test('changed static configuration aborts and releases the shared lock',async()=>{
 const f=fixture();f.options.guardSync=()=>{throw Error('INDEX_AUTO_INPUT_CHANGED');};
 await assert.rejects(optimisticIndexCommit(f.options),/INDEX_AUTO_INPUT_CHANGED/);
 assert.equal(f.getDisk(),f.options.beforeText);assert.equal(f.writes,0);assert.equal(f.releases,1);
});

test('unchanged index is a no-op',async()=>{
 const f=fixture();f.options.proposedState=structuredClone(f.current);
 assert.equal(await optimisticIndexCommit(f.options),'no_progress');
 assert.equal(f.getDisk(),f.options.beforeText);assert.equal(f.writes,0);
});

test('malicious changes to financial fields cannot reach the journal',async()=>{
 const f=fixture();f.options.proposedState.daily.positionPaid['member:0']=999;
 try{await optimisticIndexCommit(f.options);}catch{}
 assert.deepEqual(JSON.parse(f.getDisk()).daily.positionPaid,f.current.daily.positionPaid);
});

test('automatic work cannot silently replace the fixed target',async()=>{
 const f=fixture();f.options.proposedState.daily.positionScanTarget={number:12,hash:'newtarget'};
 await assert.rejects(optimisticIndexCommit(f.options));
 assert.equal(f.getDisk(),f.options.beforeText);assert.equal(f.writes,0);
});

test('regressing cursors or dropping previously indexed members or positions is rejected',async()=>{
 for(const mutate of [
  proposed=>{proposed.daily.registry.through=6;},
  proposed=>{proposed.daily.positionIndex.through=5;},
  proposed=>{delete proposed.daily.registry.members.alice;},
  proposed=>{delete proposed.daily.positionIndex.positions['alice:0'];},
  proposed=>{proposed.daily.registry.members.alice=999;},
 ]){
  const f=fixture(),before=structuredClone(f.current);
  before.daily.registry.members={alice:5};before.daily.positionIndex.positions={'alice:0':{member:'alice',id:'0'}};
  f.options.beforeText=JSON.stringify(before);f.setDisk(f.options.beforeText);
  const proposed=structuredClone(before);proposed.daily.registry.through=9;proposed.daily.positionIndex.through=9;
  mutate(proposed);f.options.proposedState=proposed;
  await assert.rejects(optimisticIndexCommit(f.options),/INDEX_AUTO_PREFIX_REGRESSION/);
  assert.equal(f.getDisk(),f.options.beforeText);assert.equal(f.writes,0);
 }
});
