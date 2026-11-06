import {test} from 'node:test';
import assert from 'node:assert/strict';
import {payApprovedRequests} from '../scripts/daily-profit.mjs';

const target='0x1111111111111111111111111111111111111111',asset='0x2222222222222222222222222222222222222222';
function fixture(count=2000){
 const rows=new Map(),reads=[],sent=[];
 const request=id=>rows.get(id)||{status:1n,asset,gross:100n,fee:5n};
 const vault={target,assetBalance:async()=>100000n};
 const queue={APPROVAL_VERSION:async()=>1n,vault:async()=>target,requestCount:async()=>BigInt(count),requests:async id=>{reads.push(id);return request(id);},pay:{
  staticCall:async id=>{assert.equal(request(id).status,3n);},populateTransaction:async id=>({id})
 }};
 const transact=async(label,{id})=>{assert.equal(label,'withdrawal-'+id);assert.equal(request(id).status,3n);sent.push(id);rows.set(id,{...request(id),status:1n});return {status:1,hash:'0x'+(id+1).toString(16).padStart(64,'0')};};
 return {rows,reads,sent,vault,queue,transact};
}

test('a newly approved tracked request is paid on the next bounded pass despite a distant history cursor',async()=>{
 const f=fixture(),state={queue:{cursor:1500,pending:[0],requestCount:2000}};
 f.rows.set(0,{status:0n,asset,gross:100n,fee:5n});
 await payApprovedRequests({...f,state,maxScan:4});assert.deepEqual(f.sent,[]);assert.ok(state.queue.pending.includes(0));assert.equal(f.reads.length,4);
 f.rows.get(0).status=3n;f.reads.length=0;
 const result=await payApprovedRequests({...f,state,maxScan:4});assert.deepEqual(f.sent,[0]);assert.equal(result.scanned,4);assert.equal(f.reads.length,5);assert.equal(state.queue.pending.includes(0),false);
 await payApprovedRequests({...f,state,maxScan:4});assert.deepEqual(f.sent,[0]);
});

test('pending rechecks rotate fairly while the independent history scan keeps advancing',async()=>{
 const f=fixture(),pending=Array.from({length:10},(_,id)=>id),state={queue:{cursor:500,pending}};
 for(const id of pending)f.rows.set(id,{status:0n,asset,gross:100n,fee:5n});
 for(let i=0;i<5;i++){const result=await payApprovedRequests({...f,state,maxScan:4});assert.equal(result.scanned,4);}
 assert.equal(state.queue.cursor,510);assert.deepEqual(new Set(f.reads.filter(id=>id<10)),new Set(pending));assert.deepEqual(f.sent,[]);
});

test('unresolved tracking is bounded without dropping the rotating scan or auto-approving requests',async()=>{
 const f=fixture(),pending=Array.from({length:1000},(_,id)=>id),state={queue:{cursor:1000,pending}};
 for(let id=0;id<2000;id++)f.rows.set(id,{status:0n,asset,gross:100n,fee:5n});
 const result=await payApprovedRequests({...f,state,maxScan:4});assert.equal(result.trackingLimited,true);assert.equal(state.queue.pending.length,1000);assert.equal(state.queue.cursor,1002);assert.deepEqual(f.sent,[]);
});

test('invalid scan limits, corrupt cursors and a shrinking request history cannot trigger a payment',async()=>{
 const f=fixture();
 for(const maxScan of [0,-1,1.5,1001])await assert.rejects(payApprovedRequests({...f,state:{},maxScan}),/WITHDRAWAL_SCAN_LIMIT_INVALID/);
 for(const queue of [{cursor:-1,pending:[]},{cursor:0,pending:[2000]},{cursor:0,pending:[],requestCount:2001}])await assert.rejects(payApprovedRequests({...f,state:{queue}}),/WITHDRAWAL_(?:SCAN_STATE_INVALID|INDEX_REGRESSION)/);
 assert.deepEqual(f.sent,[]);
});
