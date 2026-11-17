import assert from 'node:assert/strict';
import test from 'node:test';
import {Interface,parseEther} from 'ethers';
import {planUnifiedDeployment} from '../scripts/v3-unified-deploy-preflight.mjs';

const who='0x0000000000000000000000000000000000000001';
const hash='0x'+'aa'.repeat(32);
const block={number:'0x8',hash};
const tokenAbi=new Interface(['function decimals() view returns(uint8)']);
const compile=()=>({GlobalV3UnifiedTestnet:{abi:['constructor(address,address,address)'],evm:{bytecode:{object:'60006000'}}}});
function mock(){
 let n=0;const calls=[];
 return {calls,send:async(method)=>{
  calls.push(method);
  if(method==='eth_chainId')return '0x61';
  if(method==='eth_blockNumber')return '0xa';
  if(method==='eth_getBlockByNumber'){n++;return block;}
  throw Error('Unexpected RPC method');
 },getCode:async()=> '0x6000',call:async()=>tokenAbi.encodeFunctionResult('decimals',[18]),
 estimateGas:async tx=>{assert.equal(tx.from,who);return 100000n;},
 getFeeData:async()=>({gasPrice:1000000000n}),getBalance:async()=>parseEther('1'),
 getTransactionCount:async()=>0,getBlock:async()=>({gasLimit:30000000n})};
}
test('preflight reports a bounded estimate without a signer, broadcast or release',async()=>{
 const provider=mock(),result=await planUnifiedDeployment({provider,from:who,compile});
 assert.equal(result.chainId,97);assert.equal(result.gasLimit,'125000');
 assert.equal(result.enoughTestBNB,true);assert.equal(result.releaseReady,false);
 assert.equal(result.transactionSent,false);assert.equal(result.siteUpdated,false);
 assert.equal(result.migrationPerformed,false);
 assert.ok(provider.calls.every(method=>!method.startsWith('eth_send')));
});
test('preflight rejects wrong chains and changed blocks before reporting readiness',async()=>{
 const wrong=mock(),send=wrong.send;
 wrong.send=async method=>method==='eth_chainId'?'0x38':send(method);
 await assert.rejects(planUnifiedDeployment({provider:wrong,from:who,compile}),/CHAIN_REQUIRED/);
 const changed=mock(),original=changed.send;let blocks=0;
 changed.send=async(...args)=>args[0]==='eth_getBlockByNumber'&&++blocks===2?
  {...block,hash:'0x'+'bb'.repeat(32)}:original(...args);
 await assert.rejects(planUnifiedDeployment({provider:changed,from:who,compile}),/BLOCK_CHANGED/);
});
test('pending account transactions suppress the predicted address',async()=>{
 const provider=mock();provider.getTransactionCount=async(_address,tag)=>tag==='pending'?1:0;
 const result=await planUnifiedDeployment({provider,from:who,compile});
 assert.equal(result.hasPendingTransactions,true);assert.equal(result.candidateAddress,null);
 assert.equal(result.releaseReady,false);assert.equal(result.transactionSent,false);
});
test('preflight rejects missing token code, wrong decimals and an unsafe fee',async()=>{
 const badCode=mock();badCode.getCode=async()=> '0x';
 await assert.rejects(planUnifiedDeployment({provider:badCode,from:who,compile}),/TOKEN_MISSING/);
 const decimals=mock();decimals.call=async()=>tokenAbi.encodeFunctionResult('decimals',[6]);
 await assert.rejects(planUnifiedDeployment({provider:decimals,from:who,compile}),/DECIMALS_MISMATCH/);
 const highFee=mock();highFee.getFeeData=async()=>({gasPrice:100000000001n});
 await assert.rejects(planUnifiedDeployment({provider:highFee,from:who,compile}),/OUTSIDE_LIMITS/);
});
