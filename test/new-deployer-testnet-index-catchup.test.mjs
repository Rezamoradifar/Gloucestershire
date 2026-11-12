import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {Interface,getAddress,keccak256,toUtf8Bytes} from 'ethers';
import {newDeployerTestnetPolicyFields,validateDailyPolicy} from '../scripts/daily-profit.mjs';
import {scanPositionHistory} from '../scripts/position-profit.mjs';
import {acquireCatchupLock,assertNewDeployerIndexBinding,catchUpNewDeployerIndex,releaseCatchupLock} from '../scripts/index-new-deployer-catchup.mjs';

const vault=getAddress('0x3333333333333333333333333333333333333333');
const member=getAddress('0x4444444444444444444444444444444444444444');
const token=getAddress('0x5555555555555555555555555555555555555555');
const owner=getAddress('0x1111111111111111111111111111111111111111');
const operator=getAddress('0x2222222222222222222222222222222222222222');
const h=value=>keccak256(toUtf8Bytes(String(value)));
const block=number=>({number,hash:h('block-'+number),timestamp:1700000000+number});
const events=new Interface([
 'event Registered(address indexed user,address indexed referrer)',
 'event Deposited(address indexed user,address indexed asset,uint256 indexed position,uint256 amount,uint256 usd,uint256 feeEach)',
 'event Reinvested(address indexed user,address indexed asset,uint256 amount,uint256 position)'
]);
const policy=validateDailyPolicy({version:1,chainId:97,vaultAddress:vault,runtimeHash:h('runtime'),deploymentBlock:1000,startTimestamp:1700001000,basis:'position-anniversary-principal',positionScheduleVersion:1,periodSeconds:3600,includeReinvestment:true,owner,operator,...newDeployerTestnetPolicyFields});
const target={target:vault,owner,operator,queue:token,hash:h('creation'),runtimeHash:policy.runtimeHash,block:1000};
const identity={version:1,chainId:97,target:vault,owner,operator,queue:token,hash:target.hash,runtimeHash:policy.runtimeHash};
const stateFor=(end=45000)=>({identity,transactions:{},activation:{preserve:true},daily:{epoch:9,positionPaid:{preserve:2},positionClosed:{preserve:true},positionScanTarget:{number:end,hash:block(end).hash}}});
function event(name,args,number,index){
 const encoded=events.encodeEventLog(events.getEvent(name),args);
 return {address:vault,...encoded,blockNumber:number,blockHash:block(number).hash,transactionHash:h('tx-'+index),index,removed:false};
}
function history(end=45000,{span=1000,extra=[]}={}){
 const logs=[event('Registered',[member,'0x0000000000000000000000000000000000000000'],1001,0),event('Deposited',[member,token,0,100n,100n,10n],1002,1)];
 if(end>=41000)logs.push(event('Reinvested',[member,token,5n,1],41000,2));
 logs.push(...extra);
 const requests=[];let broken=false;
 const provider={
  getBlockNumber:async()=>end,
  getBlock:async number=>block(number==='latest'?end:number),
  getLogs:async filter=>{
   requests.push(filter);
   if(filter.toBlock-filter.fromBlock+1>span)throw Object.assign(Error('maximum block range '+span),{code:'UNKNOWN_ERROR',info:{error:{code:-32602,message:'maximum block range '+span}}});
   if(broken&&filter.topics[0]===events.getEvent('Reinvested').topicHash&&filter.fromBlock>=2000)throw Object.assign(Error('unavailable'),{code:'NETWORK_ERROR'});
   return logs.filter(log=>log.blockNumber>=filter.fromBlock&&log.blockNumber<=filter.toBlock&&log.topics[0]===filter.topics[0]);
  }
 };
 return {provider,requests,setBroken:value=>{broken=value;}};
}

test('a 44,000-block backlog is completely verified with no paid-cursor or transaction changes',async()=>{
 const state=stateFor(),fixture=history();let saves=0;
 const before=JSON.stringify({transactions:state.transactions,activation:state.activation,paid:state.daily.positionPaid,closed:state.daily.positionClosed,epoch:state.daily.epoch});
 const result=await catchUpNewDeployerIndex({provider:fixture.provider,policy,state,save:()=>{saves++;}});
 assert.equal(result.status,'indexed');assert.equal(result.indexThrough,45000);assert.equal(result.memberThrough,45000);
 assert.equal(result.positions,2);assert.equal(state.daily.registry.members[member],1001);
 assert.equal(JSON.stringify({transactions:state.transactions,activation:state.activation,paid:state.daily.positionPaid,closed:state.daily.positionClosed,epoch:state.daily.epoch}),before);
 assert.ok(saves>40);assert.ok(fixture.requests.length<150,'adaptive large windows avoid thousands of empty requests');
 assert.equal(result.transactionsSent,0);assert.equal(result.signerOpened,false);
});

test('larger catch-up requests still adapt to a strict ten-block RPC limit',async()=>{
 const state=stateFor(1999),fixture=history(1999,{span:10});
 const result=await catchUpNewDeployerIndex({provider:fixture.provider,policy,state,save:()=>{}});
 assert.equal(result.status,'indexed');assert.equal(result.positions,1);assert.equal(state.daily.registry.members[member],1001);
 assert.ok(fixture.requests.some(filter=>filter.toBlock-filter.fromBlock+1>10));
 assert.ok(fixture.requests.some(filter=>filter.toBlock-filter.fromBlock+1<=10));
});

test('a previously completed target advances to the confirmed head observed at start',async()=>{
 const state=stateFor(1999);
 await catchUpNewDeployerIndex({provider:history(1999).provider,policy,state,save:()=>{}});
 const before=structuredClone({transactions:state.transactions,paid:state.daily.positionPaid,epoch:state.daily.epoch});
 const result=await catchUpNewDeployerIndex({provider:history(5000).provider,policy,state,save:()=>{}});
 assert.equal(result.status,'indexed');assert.equal(result.initialConfirmedHead,4997);
 assert.equal(result.indexThrough,4997);assert.equal(result.memberThrough,4997);
 assert.deepEqual({transactions:state.transactions,paid:state.daily.positionPaid,epoch:state.daily.epoch},before);
});

test('catch-up first finishes a stale partial target, then advances without skipping history',async()=>{
 const state=stateFor(1999),fixture=history(5000);
 const bounded=await catchUpNewDeployerIndex({provider:fixture.provider,policy,state,save:()=>{},maxPasses:1});
 assert.equal(bounded.status,'indexing');assert.equal(bounded.indexThrough,1999);
 assert.equal(bounded.indexTarget,1999);assert.equal(bounded.initialConfirmedHead,4997);
 const result=await catchUpNewDeployerIndex({provider:fixture.provider,policy,state,save:()=>{}});
 assert.equal(result.status,'indexed');assert.equal(result.indexThrough,4997);
 assert.equal(result.positions,1);assert.equal(state.daily.registry.members[member],1001);
});

test('a failed later position page persists complete pages and resumes without skipping a deposit',async()=>{
 const state=stateFor(3999),fixture=history(3999);fixture.setBroken(true);let saved;
 await assert.rejects(catchUpNewDeployerIndex({provider:fixture.provider,policy,state,save:()=>{saved=structuredClone(state);}}));
 assert.equal(saved.daily.positionIndex.through,1999);assert.equal(saved.daily.registry.through,2999);
 assert.deepEqual(saved.daily.positionPaid,{preserve:2});assert.deepEqual(saved.transactions,{});
 fixture.setBroken(false);
 const result=await catchUpNewDeployerIndex({provider:fixture.provider,policy,state:saved,save:()=>{}});
 assert.equal(result.status,'indexed');assert.equal(result.positions,1);assert.equal(result.indexThrough,3999);
});

test('bounded catch-up retains its fixed target; a reorg and pending financial transaction block writes',async()=>{
 const fixture=history(),state=stateFor();
 const result=await catchUpNewDeployerIndex({provider:fixture.provider,policy,state,save:()=>{},maxPasses:1});
 assert.equal(result.status,'indexing');assert.equal(result.indexThrough,2999);assert.equal(result.indexTarget,45000);
 const corrupted=structuredClone(state);corrupted.daily.positionIndex.hash=h('different');let saves=0;
 await assert.rejects(catchUpNewDeployerIndex({provider:fixture.provider,policy,state:corrupted,save:()=>{saves++;}}),/PREFIX_REORG/);assert.equal(saves,0);
 assert.doesNotThrow(()=>assertNewDeployerIndexBinding({state,policy,target}));
 assert.throws(()=>assertNewDeployerIndexBinding({state:{...state,transactions:{pending:{raw:'do-not-broadcast'}}},policy,target}),/PENDING/);
 assert.throws(()=>assertNewDeployerIndexBinding({state,policy:{...policy,periodSeconds:900},target}),/POLICY/);
});

test('default scanner request limits remain unchanged',async()=>{
 const fixture=history(3999),state=stateFor(3999);
 await scanPositionHistory({provider:fixture.provider,policy,state:state.daily,save:()=>{}});
 assert.ok(fixture.requests.every(filter=>filter.toBlock-filter.fromBlock+1<=10));
 assert.equal(state.daily.positionIndex.through,2999);
});

test('parallel testnet event scans preserve the sequential index and ten-block RPC windows',async()=>{
 const extra=[event('Reinvested',[member,token,5n,1],1100,11),event('Deposited',[member,token,2,9n,9n,1n],1150,12)];
 const sequential=history(1999,{span:10,extra}),parallel=history(1999,{span:10,extra});
 const before=stateFor(1999),after=stateFor(1999);let active=0,maxActive=0,overlap=false;const topics=new Map();
 const getLogs=parallel.provider.getLogs;
 parallel.provider.getLogs=async filter=>{
  active++;maxActive=Math.max(maxActive,active);topics.set(filter.topics[0],(topics.get(filter.topics[0])||0)+1);
  if(topics.has(events.getEvent('Deposited').topicHash)&&topics.has(events.getEvent('Reinvested').topicHash))overlap=true;
  try{await new Promise(resolve=>setTimeout(resolve,1));return await getLogs(filter);}
  finally{active--;const count=topics.get(filter.topics[0])-1;if(count)topics.set(filter.topics[0],count);else topics.delete(filter.topics[0]);}
 };
 const left=await scanPositionHistory({provider:sequential.provider,policy,state:before.daily,save:()=>{}});
 const right=await scanPositionHistory({provider:parallel.provider,policy,state:after.daily,save:()=>{},parallelPositionEvents:true});
 assert.equal(left.status,'indexed');assert.equal(right.status,'indexed');
 assert.deepEqual(after.daily,before.daily);assert.equal(Object.keys(after.daily.positionIndex.positions).length,3);
 assert.ok(overlap,'the two event streams overlap');assert.ok(maxActive<=4,'total concurrent log requests remain bounded');
 assert.ok(parallel.requests.every(filter=>filter.toBlock-filter.fromBlock+1<=10));
});

test('parallel position streams reuse the strict RPC range learned during member indexing',async()=>{
 const fixture=history(1299,{span:2}),state=stateFor(1299);
 const result=await scanPositionHistory({provider:fixture.provider,policy,state:state.daily,save:()=>{},parallelPositionEvents:true});
 assert.equal(result.status,'indexed');assert.equal(Object.keys(state.daily.positionIndex.positions).length,1);
 const registration=events.getEvent('Registered').topicHash;
 assert.ok(fixture.requests.some(filter=>filter.topics[0]===registration&&filter.toBlock-filter.fromBlock+1>2),'registry discovers the strict provider limit');
 const positionRequests=fixture.requests.filter(filter=>filter.topics[0]!==registration);
 assert.ok(positionRequests.length>2);
 assert.ok(positionRequests.every(filter=>filter.toBlock-filter.fromBlock+1<=2),'both streams reuse the learned limit across pages');
});

test('parallel page rejects a changed end-block before saving positions',async()=>{
 const fixture=history(1099,{span:10}),state=stateFor(1099);let seen=0,saves=0;
 state.daily.registry={through:1099,hash:block(1099).hash,members:{[member]:1001}};
 state.daily.positionIndex={through:999,hash:null,positions:{}};
 fixture.provider.getBlock=async number=>{
  if(number===1099&&++seen>=4)return {...block(number),hash:h('reorg')};
  return block(number);
 };
 await assert.rejects(scanPositionHistory({provider:fixture.provider,policy,state:state.daily,save:()=>{saves++;},parallelPositionEvents:true}),/CANONICAL|REORG/);
 assert.equal(state.daily.positionIndex.through,999);assert.deepEqual(state.daily.positionIndex.positions,{});assert.equal(saves,0);
});

test('parallel mode rejects an unapproved range before any journal mutation',async()=>{
 const fixture=history(1099),state=stateFor(1099),before=structuredClone(state);let saves=0;
 await assert.rejects(scanPositionHistory({provider:fixture.provider,policy,state:state.daily,save:()=>{saves++;},logBlockSpan:11,parallelPositionEvents:true}),/PARALLEL_TESTNET_SCOPE_REQUIRED/);
 assert.equal(saves,0);assert.deepEqual(state,before);assert.equal(fixture.requests.length,0);
});

test('parallel scan waits for both read-only streams to settle after one fails',async()=>{
 const fixture=history(1099,{span:10}),state=stateFor(1099);let active=0,saves=0;
 state.daily.registry={through:1099,hash:block(1099).hash,members:{[member]:1001}};
 state.daily.positionIndex={through:999,hash:null,positions:{}};
 const getLogs=fixture.provider.getLogs;
 fixture.provider.getLogs=async filter=>{
  active++;
  try{
   if(filter.topics[0]===events.getEvent('Deposited').topicHash)throw Object.assign(Error('provider failed'),{code:'SERVER_ERROR'});
   await new Promise(resolve=>setTimeout(resolve,3));return await getLogs(filter);
  }finally{active--;}
 };
 await assert.rejects(scanPositionHistory({provider:fixture.provider,policy,state:state.daily,save:()=>{saves++;},parallelPositionEvents:true}),/COMPLETE_LOG_QUERY_FAILED/);
 assert.equal(active,0);assert.equal(saves,0);assert.equal(state.daily.positionIndex.through,999);
});

test('parallel failed event page resumes from completed checkpoint without skipping positions',async()=>{
 const fixture=history(3999,{span:10,extra:[event('Reinvested',[member,token,5n,1],2500,30)]}),state=stateFor(3999);let saved;
 const financial=JSON.stringify({transactions:state.transactions,paid:state.daily.positionPaid,epoch:state.daily.epoch});
 fixture.setBroken(true);
 await assert.rejects(scanPositionHistory({provider:fixture.provider,policy,state:state.daily,save:()=>{saved=structuredClone(state);},parallelPositionEvents:true}));
 assert.equal(saved.daily.positionIndex.through,1999);
 assert.equal(JSON.stringify({transactions:saved.transactions,paid:saved.daily.positionPaid,epoch:saved.daily.epoch}),financial);
 fixture.setBroken(false);
 let result=await scanPositionHistory({provider:fixture.provider,policy,state:saved.daily,save:()=>{},parallelPositionEvents:true});
 if(result.status==='indexing')result=await scanPositionHistory({provider:fixture.provider,policy,state:saved.daily,save:()=>{},parallelPositionEvents:true});
 assert.equal(result.status,'indexed');assert.equal(result.final.number,3999);
 assert.equal(Object.keys(saved.daily.positionIndex.positions).length,2);
 assert.equal(JSON.stringify({transactions:saved.transactions,paid:saved.daily.positionPaid,epoch:saved.daily.epoch}),financial);
});

test('catch-up shares the live worker PID lock and never removes a competing lock',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'new-index-lock-')),expectedUid=process.getuid();
 try{
  const lock=await acquireCatchupLock(directory,{expectedUid,waitMilliseconds:0});
  await assert.rejects(acquireCatchupLock(directory,{expectedUid,waitMilliseconds:0}),/WORKER_BUSY/);
  assert.throws(()=>releaseCatchupLock({...lock,pid:process.pid+1}),/LOCK_CHANGED/);
  assert.equal(fs.readFileSync(lock.file,'utf8'),String(process.pid));
  releaseCatchupLock(lock);assert.equal(fs.existsSync(lock.file),false);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});


test('refreshes new depositor positions beyond a previously complete target without replaying older credits',async()=>{
 const second=getAddress('0x6666666666666666666666666666666666666666');
 const state=stateFor(1999);
 const initial=history(1999);
 const scanOptions={policy,state:state.daily,save:()=>{},maxRegistryPages:4,pageSize:1000,logBlockSpan:1000,advanceCompletedTarget:true};
 const original=await scanPositionHistory({provider:initial.provider,...scanOptions});
 assert.equal(original.status,'indexed');
 assert.equal(original.final.number,1999);
 const protectedFinancial=structuredClone({paid:state.daily.positionPaid,closed:state.daily.positionClosed,transactions:state.transactions,epoch:state.daily.epoch});
 const later=history(2499,{extra:[
  event('Registered',[second,member],2100,41),
  event('Deposited',[second,token,0,150n,150n,15n],2101,42)
 ]});
 const updated=await scanPositionHistory({provider:later.provider,...scanOptions});
 assert.equal(updated.status,'indexed');
 assert.equal(updated.final.number,2496);
 assert.equal(state.daily.registry.through,2496);
 assert.equal(state.daily.positionIndex.through,2496);
 assert.equal(state.daily.registry.members[second],2100);
 assert.equal(state.daily.positionIndex.positions[second.toLowerCase()+':0'].openedBlock,2101);
 assert.deepEqual({paid:state.daily.positionPaid,closed:state.daily.positionClosed,transactions:state.transactions,epoch:state.daily.epoch},protectedFinancial);
});
