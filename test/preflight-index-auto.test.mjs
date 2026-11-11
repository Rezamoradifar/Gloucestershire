import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getAddress,keccak256,toUtf8Bytes} from 'ethers';
import {probeIndexSnapshot} from '../scripts/preflight-index-auto.mjs';

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
