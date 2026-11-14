import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface} from 'ethers';
import {diagnose,diagnoseWithFallback,TOKEN,USER,VAULT} from '../scripts/diagnose-v3-hourly-approval.mjs';

const abi=new Interface(['event Approval(address indexed owner,address indexed spender,uint256 value)',
 'function approve(address spender,uint256 value)','function allowance(address owner,address spender) view returns(uint256)']);
const hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64),baseline=142717262;
function mock({tip=baseline+500,failLogs=false,changedAnchor=false,indirect=false,empty=false}={}){
 const seen=[];let blocks=0;
 const event=abi.encodeEventLog(abi.getEvent('Approval'),[USER,VAULT,123n]);
 const log={...event,address:TOKEN,transactionHash:hash,blockHash,blockNumber:baseline+10,index:0,removed:false};
 const provider={send:async()=> '0x61',getBlockNumber:async()=>tip,
  getBlock:async()=>({hash:changedAnchor&&blocks++?'0x'+'c'.repeat(64):blockHash}),getCode:async()=> '0x1234',
  call:async()=>abi.encodeFunctionResult('allowance',[123n]),
  getLogs:async filter=>{seen.push(filter);if(failLogs&&seen.length===2)throw Error('LIMIT');
   return !empty&&filter.fromBlock<=log.blockNumber&&filter.toBlock>=log.blockNumber?[log]:[];},
  getTransaction:async()=>({hash,from:USER,to:indirect?VAULT:TOKEN,data:abi.encodeFunctionData('approve',[VAULT,123n]),value:0n}),
  getTransactionReceipt:async()=>({status:1,blockNumber:baseline+10,blockHash,logs:[log]}),
  getTransactionCount:async()=>1
 };
 return {provider,seen};
}

test('finds only confirmed matching explicit approval in bounded windows',async()=>{
 const {provider,seen}=mock();const result=await diagnose(provider);
 assert.equal(result.chainId,97);assert.equal(result.allowanceAtAnchorUnits,'123');
 assert.equal(result.confirmedApprovals.length,1);assert.equal(result.confirmedApprovals[0].hash,hash);
 assert.ok(result.confirmedApprovals[0].confirmations>=5);
 assert.ok(seen.every(f=>f.toBlock-f.fromBlock+1<=250));
 assert.match(result.note,/do not rule out pending/);
});
test('no matching events is not proof that a transaction was never submitted',async()=>{
 const {provider}=mock({empty:true});const result=await diagnose(provider);
 assert.deepEqual(result.confirmedApprovals,[]);assert.match(result.note,/pending, failed/);
});
test('incomplete RPC response or changed anchor produces no partial result',async()=>{
 await assert.rejects(diagnose(mock({failLogs:true}).provider));
 await assert.rejects(diagnose(mock({changedAnchor:true}).provider),/ANCHOR_CHANGED/);
});
test('indirect approval events are not mislabeled as a direct user approval',async()=>{
 const result=await diagnose(mock({indirect:true}).provider);assert.deepEqual(result.confirmedApprovals,[]);
});
test('historical scans are capped and truncation is visible',async()=>{
 const {provider,seen}=mock({tip:baseline+10000,empty:true});const result=await diagnose(provider);
 assert.equal(result.truncated,true);assert.ok(seen.length<=24);
});
test('rejects any chain other than BNB testnet',async()=>{
 const {provider}=mock();provider.send=async()=> '0x38';await assert.rejects(diagnose(provider),/WRONG_CHAIN/);
});

test('splits nested RPC range-limit responses and retains complete matching data',async()=>{
 const {provider,seen}=mock();const original=provider.getLogs;
 provider.getLogs=async filter=>{
  if(filter.toBlock-filter.fromBlock+1>80){seen.push(filter);throw {info:{error:{code:-32005,message:'limit exceeded'}}};}
  return original(filter);
 };
 const result=await diagnose(provider);
 assert.equal(result.confirmedApprovals.length,1);
 assert.ok(seen.some(item=>item.toBlock-item.fromBlock+1<=80));
 assert.ok(seen.length<120);
});

test('rate limits stop immediately and do not produce partial results',async()=>{
 const {provider}=mock();let requests=0;
 provider.getLogs=async()=>{requests++;throw {code:-32005,message:'rate limit exceeded'};};
 await assert.rejects(diagnose(provider),/DIAGNOSTIC_RPC_LOGS/);
 assert.equal(requests,1);
});

test('fallback starts a complete fresh scan on another source, sanitizing errors',async()=>{
 const first=mock().provider;first.getLogs=async()=>{throw Error('secret endpoint detail');};
 const second=mock().provider;first.destroy=()=>{};second.destroy=()=>{};
 const out=await diagnoseWithFallback(url=>url==='a'?first:second,['a','b']);
 assert.equal(out.source,'b');assert.equal(out.result.confirmedApprovals.length,1);
 assert.deepEqual(out.failures,[{source:'a',stage:'DIAGNOSTIC_RPC_LOGS'}]);
 const failed=await diagnoseWithFallback(()=>first,['a']);
 assert.equal(failed.result,null);assert.doesNotMatch(JSON.stringify(failed),/secret endpoint detail/);
});

test('gas balance and representative approval estimate never send a transaction',async()=>{
 const {provider}=mock();provider.getBalance=async()=>500000000000000000n;
 provider.getFeeData=async()=>({gasPrice:1000000000n});
 provider.estimateGas=async tx=>{assert.equal(tx.from,USER);assert.equal(tx.to,TOKEN);assert.equal(tx.value,0n);return 50000n;};
 provider.sendTransaction=()=>{throw Error('MUST_NOT_SEND');};
 const result=await diagnose(provider);
 assert.equal(result.gas.testBNB,'0.5');assert.equal(result.gas.approveUnits,'50000');
 assert.equal(result.gas.illustrativeFeeTestBNB,'0.00005');
 assert.match(result.gas.note,/wallet fees may differ/);
});
