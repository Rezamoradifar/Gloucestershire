import assert from 'node:assert/strict';
import test from 'node:test';
import {measureUnifiedSweepSnapshot} from '../scripts/v3-unified-sweep-capacity.mjs';

const members=Array.from({length:25},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0'));
const opts=o=>assert.deepEqual(o,{blockTag:42});
function fixture(){
 let paused=false;
 const vault={paused:async o=>(opts(o),paused),memberCount:async o=>(opts(o),BigInt(members.length)),
  memberAt:async (i,o)=>(opts(o),members[i]),isEligible:async (a,o)=>(opts(o),true),
  positionCount:async (a,o)=>(opts(o),1n),reinvestmentPositionPlusOne:async(a,o)=>(opts(o),0n),
  positionOf:async(a,i,o)=>(opts(o),{principal:100000n,compoundedBasis:0n,lastAccruedAt:0n,fromReinvestment:false}),
  effectiveDailyBps:async(a,o)=>(opts(o),70n)};
 return {vault,book:{},blockNumber:42,blockTimestamp:3600,pause:()=>{paused=true;}};
}
test('bounded sweep counts only due pages at one block and reports completion',async()=>{
 const result=await measureUnifiedSweepSnapshot(fixture());
 assert.equal(result.complete,true);assert.equal(result.work,25);
 assert.equal(result.proposals,25);assert.equal(result.pages,2);assert.equal(result.transactionSent,false);
});
test('a partial sweep is explicit and paused state has no completion claim',async()=>{
 const f=fixture();const partial=await measureUnifiedSweepSnapshot({...f,maxTotalWork:10});
 assert.equal(partial.state,'SCAN_LIMIT_REACHED');assert.equal(partial.complete,false);
 assert.equal(partial.work,10);assert.equal(partial.proposals,10);
 f.pause();const paused=await measureUnifiedSweepSnapshot(f);
 assert.equal(paused.state,'PAUSED');assert.equal(paused.complete,false);
});
test('limits are checked before any work',async()=>{
 const f=fixture();
 await assert.rejects(measureUnifiedSweepSnapshot({...f,maxTotalWork:0}),/SWEEP_LIMIT/);
 await assert.rejects(measureUnifiedSweepSnapshot({...f,lotPageSize:9}),/SWEEP_LIMIT/);
});
test('grouped lots consume one work item per bounded lot page',async()=>{
 const f=fixture();f.vault.memberCount=async o=>(opts(o),1n);
 f.vault.reinvestmentPositionPlusOne=async(a,o)=>(opts(o),1n);
 f.vault.positionOf=async(a,i,o)=>(opts(o),{principal:100000n,compoundedBasis:0n,lastAccruedAt:0n,fromReinvestment:true});
 f.book.position=async(a,o)=>(opts(o),{principal:100000n,basis:0n,lots:10n});
 f.book.lot=async(a,i,o)=>(opts(o),{principal:10000n,basis:0n,lastAccruedAt:0n});
 const result=await measureUnifiedSweepSnapshot(f);
 assert.equal(result.complete,true);assert.equal(result.work,2);assert.equal(result.proposals,2);
});
test('empty or unavailable source does not fabricate a proposal',async()=>{
 const f=fixture();f.vault.memberCount=async o=>(opts(o),0n);
 const result=await measureUnifiedSweepSnapshot(f);
 assert.equal(result.complete,true);assert.equal(result.members,0);assert.equal(result.proposals,0);
 f.vault.memberCount=async()=>{throw Error('RPC_FAILURE');};
 await assert.rejects(measureUnifiedSweepSnapshot(f),/RPC_FAILURE/);
});
