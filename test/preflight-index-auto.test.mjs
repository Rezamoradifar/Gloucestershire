import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getAddress,keccak256,toUtf8Bytes} from 'ethers';
import {probeIndexSnapshot,countDuePositionHours,suppressUnstableBacklog} from '../scripts/preflight-index-auto.mjs';

const h=value=>keccak256(toUtf8Bytes(String(value)));
const block=number=>({number,hash:h('block-'+number),timestamp:1700000000+number});
const vault=getAddress('0x4C0F6141b18971db4b14e45c0bE8CddB09febc14');
const runtime='0x1234';
function fixture(){
 let chain=97,head=1010,code=runtime,reorg=null;const operations=[];
 const provider={send:async(method,args)=>{operations.push({method,args});assert.equal(method,'eth_chainId','must never submit a transaction');return chain;},
  getBlockNumber:async()=>head,getCode:async address=>{assert.equal(address,vault);return code;},
  getBlock:async number=>number===reorg?{...block(number),hash:h('reorg')}:block(number)};
 const state={identity:{chainId:97,target:vault},transactions:{settled:{block:700,blockHash:block(700).hash,hash:h('tx'),raw:'DO_NOT_EXPOSE_RAW'}},
  daily:{positionScanTarget:{number:1000,hash:block(1000).hash},
   registry:{through:900,hash:block(900).hash,members:{secret:'DO_NOT_EXPOSE_MEMBER'}},
   positionIndex:{through:800,hash:block(800).hash,positions:{secret:'DO_NOT_EXPOSE_POSITION'}}}};
 return {state,provider,operations,options:{provider,state,confirmations:3,expectedRuntimeHash:keccak256(runtime),expectedTarget:vault},
  setChain:value=>{chain=value;},setCode:value=>{code=value;},setHead:value=>{head=value;},setReorg:value=>{reorg=value;}};
}

test('read-only probe reports confirmed head and index lag without leaking journal contents',async()=>{
 const f=fixture(),before=JSON.stringify(f.state),result=await probeIndexSnapshot(f.options);
 assert.equal(result.chainId,97);assert.equal(result.confirmedHead,1007);
 assert.equal(result.targetBlock,1000);assert.equal(result.memberThrough,900);assert.equal(result.positionThrough,800);
 assert.equal(result.memberLagBlocks,107);assert.equal(result.positionLagBlocks,207);
 assert.equal(result.runtimeMatches,true);assert.deepEqual(result.blockChecks,{target:true,member:true,position:true});
 assert.ok(result.financialBlockChecks.every(value=>value===true));assert.equal(result.pendingFinancial,false);
 assert.equal(typeof result.timingsMs,'object');assert.equal(JSON.stringify(f.state),before);
 assert.doesNotMatch(JSON.stringify(result),/DO_NOT_EXPOSE|raw|private|secret/);
 assert.ok(f.operations.every(row=>row.method==='eth_chainId'));
});

test('probe reveals reorgs, runtime mismatch and pending transactions rather than claiming readiness',async()=>{
 for(const [number,key] of [[1000,'target'],[900,'member'],[800,'position']]){
  const f=fixture();f.setReorg(number);const result=await probeIndexSnapshot(f.options);assert.equal(result.blockChecks[key],false);
 }
 const f=fixture();f.setCode('0x4321');f.setReorg(700);f.state.transactions.pending={hash:h('pending'),raw:'DO_NOT_EXPOSE_PENDING'};
 const result=await probeIndexSnapshot(f.options);assert.equal(result.runtimeMatches,false);
 assert.ok(result.financialBlockChecks.some(value=>value===false));assert.equal(result.pendingFinancial,true);
 assert.doesNotMatch(JSON.stringify(result),/DO_NOT_EXPOSE|raw|private|secret/);
});

test('probe rejects the wrong chain without submitting any transactions',async()=>{
 const f=fixture();f.setChain(56);
 await assert.rejects(probeIndexSnapshot(f.options),/INDEX_PROBE_CHAIN_MISMATCH/);
 assert.ok(f.operations.every(row=>row.method==='eth_chainId'));
});

test('target identity mismatch is rejected without exposing the other address',async()=>{
 const f=fixture();f.state.identity.target=getAddress('0x4444444444444444444444444444444444444444');
 await assert.rejects(probeIndexSnapshot(f.options),/INDEX_PROBE_INPUT_MISMATCH/);
 assert.equal(f.operations.length,0);
});

test('probe counts only due position-hours within a fully indexed canonical target',async()=>{
 const f=fixture(),target=block(1000).timestamp;
 f.state.daily.registry={through:1000,hash:block(1000).hash,members:{}};
 f.state.daily.positionIndex={through:1000,hash:block(1000).hash,positions:{
  alpha:{openedAt:target-3*3600,openedBlock:700},
  beta:{openedAt:target-2*3600,openedBlock:800},
  closed:{openedAt:target-3*3600,openedBlock:900}
 }};
 f.state.daily.positionPaid={alpha:1,beta:1};f.state.daily.positionClosed={closed:true};
 const result=await probeIndexSnapshot({...f.options,intervalSeconds:3600});
 assert.deepEqual(result.scheduledBacklog,{positionCount:2,positionHours:3,eligibilityAndAmountsChecked:false});
 assert.equal(result.targetTimestamp,target);assert.equal(result.financialDistinctBlocks,1);
 assert.doesNotMatch(JSON.stringify(result),/alpha|beta|closed|later/);
 f.setReorg(1000);const reorg=await probeIndexSnapshot({...f.options,intervalSeconds:3600});
 assert.equal(reorg.scheduledBacklog,null);
});

test('incomplete indexes, invalid entries and unsupported schedules never claim a backlog',async()=>{
 const f=fixture();f.state.daily.positionIndex.positions={p:{openedAt:1,openedBlock:1}};
 assert.equal((await probeIndexSnapshot({...f.options,intervalSeconds:3600})).scheduledBacklog,null);
 f.state.daily.positionIndex.through=1000;f.state.daily.positionIndex.hash=block(1000).hash;
 f.state.daily.registry.through=1000;f.state.daily.registry.hash=block(1000).hash;
 f.state.daily.positionPaid={p:-1};
 assert.equal((await probeIndexSnapshot({...f.options,intervalSeconds:3600})).scheduledBacklog,null);
 assert.equal((await probeIndexSnapshot({...f.options,intervalSeconds:900})).scheduledBacklog,null);
});

test('suppress backlog when journal changes, runtime differs, financial state is pending, or confirmed head is behind target',async()=>{
 const f=fixture(),target=block(1000);
 f.state.daily.registry={through:1000,hash:target.hash,members:{}};
 f.state.daily.positionIndex={through:1000,hash:target.hash,positions:{p:{openedAt:target.timestamp-3600,openedBlock:999}}};
 const result=await probeIndexSnapshot({...f.options,intervalSeconds:3600});
 assert.equal(result.scheduledBacklog.positionHours,1);
 assert.equal(suppressUnstableBacklog(result,false,true).scheduledBacklog,null);
 assert.equal(suppressUnstableBacklog(result,true,false).scheduledBacklog,null);
 assert.equal(suppressUnstableBacklog(result,true,undefined).scheduledBacklog,null);
 assert.equal(suppressUnstableBacklog(result,true,true).scheduledBacklog.positionHours,1);
 f.setCode('0x4321');assert.equal((await probeIndexSnapshot({...f.options,intervalSeconds:3600})).scheduledBacklog,null);
 f.setCode(runtime);f.setReorg(700);assert.equal((await probeIndexSnapshot({...f.options,intervalSeconds:3600})).scheduledBacklog,null);
 f.setReorg(null);f.state.transactions.pending={hash:h('pending')};assert.equal((await probeIndexSnapshot({...f.options,intervalSeconds:3600})).scheduledBacklog,null);
 delete f.state.transactions.pending;f.setHead(1002);assert.equal((await probeIndexSnapshot({...f.options,intervalSeconds:3600})).scheduledBacklog,null);
});

test('malformed closed marker or positions beyond the snapshot suppress backlog',()=>{
 const daily={positionIndex:{positions:{p:{openedAt:100,openedBlock:99}}},positionPaid:{p:0},positionClosed:{p:'false'}};
 assert.equal(countDuePositionHours(daily,100,4000,3600),null);
 daily.positionClosed.p=false;daily.positionIndex.positions.p.openedBlock=101;
 assert.equal(countDuePositionHours(daily,100,4000,3600),null);
 daily.positionIndex.positions.p.openedBlock=99;daily.positionIndex.positions.p.openedAt=0;
 assert.equal(countDuePositionHours(daily,100,4000,3600),null);
});

test('pending plans or malformed transaction journals suppress the due-hour aggregate',async()=>{
 const f=fixture(),target=block(1000);
 f.state.daily.registry={through:1000,hash:target.hash,members:{}};
 f.state.daily.positionIndex={through:1000,hash:target.hash,positions:{p:{openedAt:target.timestamp-3600,openedBlock:999}}};
 const options={...f.options,intervalSeconds:3600};
 assert.equal((await probeIndexSnapshot(options)).scheduledBacklog.positionHours,1);
 let result;
 for(const pending of [{version:1},null,false,0]){
  f.state.daily.pendingDailyPlan=pending;
  result=await probeIndexSnapshot(options);
  assert.equal(result.pendingFinancial,true);assert.equal(result.scheduledBacklog,null);
 }
 delete f.state.daily.pendingDailyPlan;
 for(const invalidOracle of [null,false,0,'invalid',[]]){
  f.state.oracle=invalidOracle;
  result=await probeIndexSnapshot(options);
  assert.equal(result.pendingFinancial,true);assert.equal(result.scheduledBacklog,null);
 }
 delete f.state.oracle;
 f.state.oracle={};assert.equal((await probeIndexSnapshot(options)).pendingFinancial,false);
 f.state.oracle={pending:{}};assert.equal((await probeIndexSnapshot(options)).pendingFinancial,true);
 delete f.state.oracle;
 const original=f.state.transactions;
 for(const invalid of [null,[],{bad:{block:700,blockHash:block(700).hash}}]){
  f.state.transactions=invalid;
  result=await probeIndexSnapshot(options);
  assert.equal(result.pendingFinancial,true);assert.equal(result.scheduledBacklog,null);
 }
 f.state.transactions=original;
 assert.equal((await probeIndexSnapshot(options)).pendingFinancial,false);
});

test('each required canonical index checkpoint is checked before reporting due-hour aggregate',async()=>{
 const f=fixture(),target=block(1000);
 f.state.daily.registry={through:1000,hash:target.hash,members:{}};
 f.state.daily.positionIndex={through:1000,hash:target.hash,positions:{p:{openedAt:target.timestamp-3600,openedBlock:999}}};
 const options={...f.options,intervalSeconds:3600};
 for(const key of ['registry','positionIndex']){
  const old=f.state.daily[key].hash;f.state.daily[key].hash=h('bad');
  assert.equal((await probeIndexSnapshot(options)).scheduledBacklog,null);
  f.state.daily[key].hash=old;
 }
 assert.equal((await probeIndexSnapshot(options)).scheduledBacklog.positionHours,1);
});
