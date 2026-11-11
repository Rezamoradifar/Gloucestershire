import {test} from 'node:test';
import assert from 'node:assert/strict';
import {id} from 'ethers';
import {indexProgressSnapshot,creditBlockTimestamp} from '../scripts/index-progress-snapshot.mjs';

test('report extracts aggregate counts and cursors without exposing journal members',()=>{
 const daily={registry:{through:200,members:{'0xprivate':1}},positionIndex:{through:190,positions:{'0xsecret':{member:'private'}}},positionScanTarget:{number:205}};
 const report=indexProgressSnapshot(daily);
 assert.deepEqual(report,{memberThrough:200,positionThrough:190,target:205,memberCount:1,positionCount:1});
 assert.doesNotMatch(JSON.stringify(report),/private|secret/);
 assert.deepEqual(indexProgressSnapshot(undefined),{memberThrough:null,positionThrough:null,target:null,memberCount:null,positionCount:null});
 assert.equal(indexProgressSnapshot({registry:{through:-1,members:[]}}).memberThrough,null);
});
test('credit block time requires a canonical confirmed testnet receipt and profit event',async()=>{
 const blockHash='0x'+'ab'.repeat(32),transactionHash='0x'+'dd'.repeat(32),target='0x'+'1'.repeat(40),last={batches:[{block:123,blockHash,transactionHash}]};
 const receipt={hash:transactionHash,status:1,blockNumber:123,blockHash,logs:[{address:target,topics:[id('ProfitCredited(address,address,uint256,bytes32)')]}]};
 const provider={send:async()=>97,getBlock:async n=>({number:n,hash:blockHash,timestamp:1700000000}),getBlockNumber:async()=>126,getTransactionReceipt:async()=>receipt};
 assert.equal(await creditBlockTimestamp(provider,last,target),1700000000);
 assert.equal(await creditBlockTimestamp({...provider,send:async()=>56},last,target),null);
 assert.equal(await creditBlockTimestamp({...provider,getBlock:async()=>({number:123,hash:'0x'+'cd'.repeat(32),timestamp:1700000000})},last,target),null);
 assert.equal(await creditBlockTimestamp({...provider,getTransactionReceipt:async()=>({...receipt,logs:[]})},last,target),null);
 assert.equal(await creditBlockTimestamp({...provider,getBlockNumber:async()=>125},last,target),null);
 assert.equal(await creditBlockTimestamp({...provider,getBlock:async()=>{throw Error('RPC');}},last,target),null);
 assert.equal(await creditBlockTimestamp({...provider,getBlock:()=>new Promise(()=>{})},last,target,{timeoutMs:5}),null);
 assert.equal(await creditBlockTimestamp(provider,null,target),null);
});
