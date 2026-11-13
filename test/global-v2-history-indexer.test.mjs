import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {keccak256,toUtf8Bytes} from 'ethers';
import {GlobalV2EventIndex,syncGlobalV2Index} from '../scripts/global-v2-history-indexer.mjs';

const start=142416836;
const address='0xA98D8d3709f5D3730BAD5d76C334731784e7CF07';
const code='0x6001600055';
const hash=n=>keccak256(toUtf8Bytes('V2_TEST_EVENT:'+n));
const fixture=(block,index=0)=>({
 blockNumber:block,blockHash:hash('block-'+block),
 transactionHash:hash('tx-'+block+'-'+index),index,
 topics:[hash('event'),hash('member')],
 data:'0x'+('00'.repeat(32)),address
});
function mockChain(total=10,changes=new Map()){
 return {
  async send(method){assert.equal(method,'eth_chainId');return '0x61';},
  async getBlockNumber(){return start+total;},
  async getCode(){return code;},
  async getBlock(height){return {number:height,hash:changes.get(height)||hash('block-'+height)};},
  async getLogs({fromBlock,toBlock}){
   const logs=[];
   for(let height=fromBlock;height<=toBlock;height++)
    if(height===start+1||height===start+3)
     logs.push({...fixture(height),blockHash:changes.get(height)||hash('block-'+height)});
   return logs;
  }
 };
}
test('durable index is identity pinned, deduplicates and supports bounded rollback',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'gv2-index-'));
 const file=path.join(folder,'events.sqlite');
 try{
  const index=new GlobalV2EventIndex(file);
  assert.equal(index.cursor,start-1);
  index.record(start,start+1,hash('block-'+(start+1)),[fixture(start),fixture(start+1)]);
  assert.equal(index.cursor,start+1);
  assert.equal(index.logCount,2);
  assert.throws(()=>index.record(start,start+1,hash('block-'+(start+1)),[]),/V2_INDEX_RANGE_INVALID/);
  assert.throws(()=>index.record(start+2,start+2,hash('block-'+(start+2)),
   [{...fixture(start+2),address:'0x1111111111111111111111111111111111111111'}]),/V2_INDEX_LOG_INVALID/);
  assert.equal(index.cursor,start+1);
  index.rewind(start);
  assert.equal(index.cursor,start);
  assert.equal(index.logCount,1);
  index.close();
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  const reopened=new GlobalV2EventIndex(file);
  assert.equal(reopened.logCount,1);
  assert.equal(reopened.cursor,start);
  reopened.close();
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('read-only mock chain sync backfills, resumes idempotently and rewinds the 72-block tail after reorg',async()=>{
 const index=new GlobalV2EventIndex(':memory:');
 try{
  const provider=mockChain();
  const opts={provider,index,confirmations:3,batchSize:3,expectedCodeHash:keccak256(code),expectedAddress:address};
  const first=await syncGlobalV2Index(opts);
  assert.equal(first.cursor,start+7);
  assert.equal(first.rawEvents,2);
  const second=await syncGlobalV2Index(opts);
  assert.equal(second.rawEvents,2);
  assert.equal(second.cursor,first.cursor);
  const different=new Map([[start+1,hash('new-block-'+(start+1))]]);
  const newChain=mockChain(10,different);
  const third=await syncGlobalV2Index({...opts,provider:newChain});
  assert.equal(third.rawEvents,2);
  assert.equal(third.cursor,start+7);
  assert.equal(index.db.prepare('SELECT block_hash FROM logs WHERE height=?').get(start+1).block_hash,
   hash('new-block-'+(start+1)).toLowerCase());
 }finally{index.close();}
});
test('deep canonical reorg stops rather than silently replacing older indexed history',async()=>{
 const index=new GlobalV2EventIndex(':memory:');
 try{
  const first=mockChain(90);
  const opts={provider:first,index,confirmations:3,batchSize:6,expectedCodeHash:keccak256(code),expectedAddress:address};
  await syncGlobalV2Index(opts);
  const current=index.cursor;
  const protectedCheckpoint=index.checkpointAtOrBefore(current-72);
  assert.ok(protectedCheckpoint);
  const changed=new Map([[protectedCheckpoint.height,hash('deep-change')]]);
  await assert.rejects(syncGlobalV2Index({...opts,provider:mockChain(90,changed)}),
   /V2_INDEX_DEEP_REORG_MANUAL_REVIEW/);
  assert.equal(index.cursor,current);
 }finally{index.close();}
});
test('indexer rejects wrong chain, invalid RPC policy and forged data without advancing cursor',async()=>{
 const index=new GlobalV2EventIndex(':memory:');
 try{
  const opts={provider:mockChain(),index,confirmations:3,batchSize:3,expectedCodeHash:keccak256(code),expectedAddress:address};
  await assert.rejects(syncGlobalV2Index({...opts,confirmations:0}),/V2_INDEX_POLICY_INVALID/);
  await assert.rejects(syncGlobalV2Index({...opts,provider:{send:async()=> '0x38'}}),/V2_INDEX_CHAIN_MISMATCH/);
  await assert.rejects(syncGlobalV2Index({...opts,expectedCodeHash:hash('wrong-code')}),/V2_INDEX_CODE_HASH_MISMATCH/);
  assert.equal(index.cursor,start-1);
 }finally{index.close();}
});
