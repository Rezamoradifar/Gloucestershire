import test from 'node:test';
import assert from 'node:assert/strict';
import {ZeroAddress,parseEther} from 'ethers';
import {planVolumeJob,reportVolumeReadiness} from '../scripts/v3-volume-keeper.mjs';

const address='0x1111111111111111111111111111111111111111';
const mock=rows=>({volumeJobCount:async()=>BigInt(rows.length),volumeJobs:async i=>({ancestor:rows[i]})});
test('readiness logs safe details before failing on gas, pause or privileged signer',()=>{
 const base={contract:address,wallet:address,balance:parseEther('0.001'),
  privileged:false,paused:false,source:'https://example.test'};
 const messages=[];
 const record=message=>messages.push(message);
 for(const [change,expected] of [
  [{balance:0n},'INSUFFICIENT_TEST_BNB'],
  [{paused:true},'CONTRACT_PAUSED'],
  [{privileged:true},'SIGNER_HAS_PRIVILEGED_ROLE']
 ]){
  messages.length=0;
  assert.throws(()=>reportVolumeReadiness({...base,...change},record),/V3_VOLUME_SIGNER_NOT_READY/);
  assert.equal(messages.length,1);
  const data=JSON.parse(messages[0].slice('V3_VOLUME_READINESS '.length));
  assert.equal(data.ready,false);
  assert.equal(data.transactionSent,false);
  assert.equal(data.minimumTestBNB,'0.001');
  assert.deepEqual(data.reasons,[expected]);
 }
 messages.length=0;
 const ready=reportVolumeReadiness(base,record);
 assert.equal(ready.ready,true);
 assert.equal(ready.enoughTestBNB,true);
 assert.deepEqual(ready.reasons,[]);
 assert.equal(messages.length,1);
 assert.throws(()=>reportVolumeReadiness({...base,balance:-1n},record),/V3_INVALID_KEEPER_READINESS_INPUT/);
});
test('scan finds pending work, wraps safely, and returns no work for completed jobs',async()=>{
 const v=mock([ZeroAddress,address,ZeroAddress,address]);
 assert.deepEqual(await planVolumeJob(v,0),{count:4,selected:1,next:1,scanned:2});
 assert.deepEqual(await planVolumeJob(v,2),{count:4,selected:3,next:3,scanned:2});
 assert.equal((await planVolumeJob(v,4)).selected,1);
 assert.deepEqual(await planVolumeJob(mock([]),0),{count:0,selected:null,next:0,scanned:0});
 assert.deepEqual(await planVolumeJob(mock([ZeroAddress,ZeroAddress]),0),{count:2,selected:null,next:0,scanned:2});
});
test('bounded scans progress through large queues and reject malformed cursors',async()=>{
 const rows=Array(150).fill(ZeroAddress);rows[120]=address;
 const v=mock(rows);
 const first=await planVolumeJob(v,0,100);
 assert.equal(first.selected,null);assert.equal(first.next,100);assert.equal(first.scanned,100);
 const second=await planVolumeJob(v,first.next,100);
 assert.equal(second.selected,120);assert.equal(second.scanned,21);
 for(const cursor of [-1,NaN,0.5,Number.MAX_SAFE_INTEGER+1])
  await assert.rejects(planVolumeJob(v,cursor));
 await assert.rejects(planVolumeJob(v,0,101));
});
