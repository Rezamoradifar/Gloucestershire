import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexMembers} from '../scripts/daily-profit.mjs';
import {retryableDailyReadFailure} from '../scripts/zero-start-automation.mjs';

const blockHash=n=>'0x'+n.toString(16).padStart(64,'0');
const member='0x1111111111111111111111111111111111111111';
const policy={deploymentBlock:10,vaultAddress:'0x2222222222222222222222222222222222222222'};
const fixture=()=>({
 registry:{through:12,hash:blockHash(12),members:{[member]:10}},
 positionIndex:{through:12,hash:blockHash(12),positions:{saved:{principal:'100'}}},
 positionPaid:{saved:4},positionClosed:{},epoch:7,
 transactions:{personal:{raw:'preserved-signed-data',block:11}},
});

for(const [name,checkpoint]of [
 ['null',null],['undefined',undefined],['missing hash',{number:12}],
 ['invalid hash',{number:12,hash:'0x1234'}],['wrong block number',{number:13,hash:blockHash(12)}],
 ['missing block number',{hash:blockHash(12)}],
 ['array hash',{number:12,hash:[blockHash(12)]}],['boxed hash',{number:12,hash:new String(blockHash(12))}],
])test('an unavailable or malformed '+name+' checkpoint preserves every saved cursor',async()=>{
 const state=fixture(),original=structuredClone(state),registry=state.registry;
 let saves=0,logReads=0;
 const provider={getBlock:async()=>checkpoint,getLogs:async()=>{logReads++;return [];}};
 await assert.rejects(indexMembers({provider,policy,state,through:13,save:()=>{saves++;}}),error=>{
  assert.equal(error.message,'HISTORICAL_BLOCK_UNAVAILABLE');
  assert.equal(error.code,'BAD_DATA');
  assert.equal(retryableDailyReadFailure(error,{transactions:{confirmed:{block:11}}}),true);
  assert.equal(retryableDailyReadFailure(error,{transactions:{pending:{raw:'pending'}}}),false);
  return true;
 });
 assert.deepEqual(state,original);assert.equal(state.registry,registry);
 assert.equal(saves,0);assert.equal(logReads,0);
});

test('a thrown transport error never clears a previously verified checkpoint',async()=>{
 const state=fixture(),original=structuredClone(state),registry=state.registry;
 const failure=Object.assign(Error('private transport detail must remain internal'),{code:'TIMEOUT'});
 let saves=0,logReads=0;
 const provider={getBlock:async()=>{throw failure;},getLogs:async()=>{logReads++;return [];}};
 await assert.rejects(indexMembers({provider,policy,state,through:13,save:()=>{saves++;}}),error=>error===failure);
 assert.deepEqual(state,original);assert.equal(state.registry,registry);
 assert.equal(saves,0);assert.equal(logReads,0);
});

test('a valid checkpoint hash mismatch still resets and rescans the original deployment range',async()=>{
 const state=fixture(),otherState=structuredClone(state);delete otherState.registry;
 const ranges=[],snapshots=[];
 const provider={
  getBlock:async number=>({number,hash:blockHash(number===12?120:13)}),
  getLogs:async filter=>{ranges.push([filter.fromBlock,filter.toBlock]);return [];},
 };
 assert.equal(await indexMembers({provider,policy,state,through:13,pageSize:100,
  save:()=>snapshots.push(structuredClone(state.registry))}),true);
 assert.deepEqual(snapshots[0],{through:9,hash:null,members:{}});
 assert.deepEqual(ranges,[[10,13]]);
 assert.deepEqual(state.registry,{through:13,hash:blockHash(13),members:{}});
 const after=structuredClone(state);delete after.registry;assert.deepEqual(after,otherState);
});

test('an already complete valid checkpoint makes no log reads, writes or payment changes',async()=>{
 const state=fixture(),original=structuredClone(state);let saves=0,logReads=0;
 const provider={getBlock:async number=>({number,hash:blockHash(number)}),getLogs:async()=>{logReads++;return [];}};
 assert.equal(await indexMembers({provider,policy,state,through:12,save:()=>{saves++;}}),true);
 assert.deepEqual(state,original);assert.equal(saves,0);assert.equal(logReads,0);
});

test('equivalent checkpoint hash casing does not trigger a false reorg or clear members',async()=>{
 const state=fixture();state.registry.hash='0x'+'ab'.repeat(32);
 const original=structuredClone(state);let saves=0,logReads=0;
 const provider={getBlock:async number=>({number,hash:'0x'+'AB'.repeat(32)}),getLogs:async()=>{logReads++;return [];}};
 assert.equal(await indexMembers({provider,policy,state,through:12,save:()=>{saves++;}}),true);
 assert.deepEqual(state,original);assert.equal(saves,0);assert.equal(logReads,0);
});
