import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther} from 'ethers';
import {createZeroStartProofProviders,prepareZeroStartConnection,verifyZeroStartCreation} from '../scripts/connect-zero-start.mjs';
import {verifyZeroStartReadiness,verifyZeroStartTarget} from '../scripts/zero-start-readiness.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const fast=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json'));
const proxy=(target,overrides)=>new Proxy(target,{get(object,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,release,vault,hash,receipt,transaction,creation,original,connectionReport,deploymentReport;
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:12,unlockedAccounts:[fast.owner,fast.deployer]},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const address of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[address,'0x'+parseEther('10').toString(16)]});
 await rpc.request({method:'evm_setAccountNonce',params:[fast.deployer,'0x10']});
 const signer=await provider.getSigner(0),operator=await provider.getSigner(fast.deployer),addresses=await Promise.all(Array.from({length:12},async(_,i)=>(await provider.getSigner(i)).getAddress()));
 const deploy=async(name,args,from=signer)=>{const a=artifact(name),value=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,from).deploy(...args);await value.waitForDeployment();return value;};
 const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]);
 release={...fast,token:token.target,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
 vault=await deploy('FastTestnetVault',[release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations],operator);
 hash=vault.deploymentTransaction().hash;receipt=await provider.getTransactionReceipt(hash);transaction=await provider.getTransaction(hash);deploymentReport={hash};
 for(let i=0;i<4;i++)await rpc.request({method:'evm_mine',params:[]});
 creation=await verifyZeroStartCreation({provider,artifact:artifact('FastTestnetVault'),release,hash,confirmations:3});
 const prepared=await prepareZeroStartConnection({provider,artifact:artifact('FastTestnetVault'),release,deploymentReport,original:'TRADES_CHAIN_ID=97\nTRADES_RPC_URL=https://private.invalid/credential\nTRADES_VAULT_ADDRESS='+vault.target+'\nTRADES_PORT=3115\nTRADES_CONFIRMATIONS=3\nGLOBAL_MIGRATION_ENABLED=false\n'});
 original=prepared.env;connectionReport={...prepared.report,siteConnected:true};
});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

function fallback(overrides={}){
 const calls=[];
 const value={
  send:async(method,params)=>{calls.push(method);assert.equal(method,'eth_chainId');return provider.send(method,params);},
  getTransactionReceipt:async value=>{calls.push('receipt');assert.equal(value,hash);return provider.getTransactionReceipt(value);},
  getTransaction:async value=>{calls.push('transaction');assert.equal(value,hash);return provider.getTransaction(value);},
  getBlock:async block=>{calls.push('header');return provider.getBlock(block);},
  ...overrides
 };
 return {provider:value,calls};
}
const verify=(primary,proofProviders=[])=>verifyZeroStartCreation({provider:primary,proofProviders,artifact:artifact('FastTestnetVault'),release,hash,confirmations:3});
const missingPrimary=()=>proxy(provider,{getTransactionReceipt:async()=>null,getTransaction:async()=>null});

test('public creation proof is opt-in and does not replace a complete primary proof',async()=>{
 const unused=fallback({send:async()=>{throw Error('UNEXPECTED_PUBLIC_READ');}});
 assert.deepEqual(await verify(provider,[unused.provider]),creation);assert.deepEqual(unused.calls,[]);
 await assert.rejects(verify(missingPrimary()),/ZERO_START_RECEIPT_REQUIRED/);
 const configured=createZeroStartProofProviders();
 assert.equal(configured.length,1);for(const value of configured)value.destroy();
 await assert.rejects(verify(provider,[provider]),/ZERO_START_PROOF_PROVIDERS_REQUIRED/);
 await assert.rejects(verify(provider,[{},{},{}]),/ZERO_START_PROOF_PROVIDERS_REQUIRED/);
});

test('missing creation rows can be supplied read-only while the primary anchors the canonical header and current state',async()=>{
 const publicProof=fallback();let currentReads=0;
 const primary=proxy(missingPrimary(),{getCode:async(...args)=>{currentReads++;return provider.getCode(...args);}});
 assert.deepEqual(await verify(primary,[publicProof.provider]),creation);
 assert.deepEqual(publicProof.calls,['eth_chainId','receipt','transaction','header']);
 const target=await verifyZeroStartTarget({provider:primary,proofProviders:[publicProof.provider],artifact:artifact('FastTestnetVault'),deploymentReport,connectionReport,original,release,confirmations:3,inspectSettlementLogs:false});
 assert.equal(target.target,vault.target);assert.equal(target.owner,fast.owner);assert.equal(target.siteConnected,true);assert.equal(target.transactionsSent,0);assert.ok(currentReads>=2);
 const readiness=await verifyZeroStartReadiness({provider:primary,proofProviders:[publicProof.provider],artifact:artifact('FastTestnetVault'),deploymentReport,connectionReport,original,release,confirmations:3,hourlyTest:true});
 assert.equal(readiness.target,vault.target);assert.equal(readiness.ready,false);assert.ok(readiness.blockers.includes('FUNDED_DAILY_REWARD_BUDGET_REQUIRED'));assert.equal(readiness.transactionsSent,0);
});

test('one missing row or a known missing-method response uses a matching public proof',async()=>{
 for(const overrides of [
  {getTransactionReceipt:async()=>null},
  {getTransaction:async()=>null},
  {getTransactionReceipt:async()=>{throw Object.assign(Error('unsupported receipt lookup'),{code:'UNSUPPORTED_OPERATION'});}},
  {getTransaction:async()=>{throw Object.assign(Error('historical lookup unavailable'),{code:'UNKNOWN_ERROR',info:{error:{code:-32601,message:'method not found'}}});}}
 ]){
  const publicProof=fallback();assert.deepEqual(await verify(proxy(provider,overrides),[publicProof.provider]),creation);assert.ok(publicProof.calls.includes('receipt'));
 }
});

test('any existing failed, malformed or conflicting primary result stops before consulting another provider',async()=>{
 const publicProof=fallback({send:async()=>{throw Error('UNEXPECTED_PUBLIC_READ');}});
 for(const overrides of [
  {getTransactionReceipt:async()=>({...receipt,status:0}),getTransaction:async()=>null},
  {getTransactionReceipt:async()=>({...receipt,hash:'0x'+'11'.repeat(32)}),getTransaction:async()=>null},
  {getTransactionReceipt:async()=>({...receipt,blockNumber:'malformed'}),getTransaction:async()=>null},
  {getTransactionReceipt:async()=>false,getTransaction:async()=>null},
  {getTransactionReceipt:async()=>({...receipt,from:release.owner}),getTransaction:async()=>null},
  {getTransactionReceipt:async()=>null,getTransaction:async()=>({...transaction,value:1n})},
  {getTransactionReceipt:async()=>null,getTransaction:async()=>false},
  {getTransactionReceipt:async()=>null,getTransaction:async()=>({...transaction,chainId:56n})},
  {getTransactionReceipt:async()=>null,getTransaction:async()=>({...transaction,data:transaction.data+'00'})},
  {getTransactionReceipt:async()=>null,getTransaction:async()=>({...transaction,from:release.owner})}
 ])await assert.rejects(verify(proxy(provider,overrides),[publicProof.provider]),/ZERO_START_(?:RECEIPT_REQUIRED|TRANSACTION_MISMATCH)/);
 assert.deepEqual(publicProof.calls,[]);
 await assert.rejects(verify(proxy(provider,{getTransactionReceipt:async()=>({...receipt,blockHash:'0x'+'22'.repeat(32)}),getTransaction:async()=>null}),[publicProof.provider]),/RECEIPT_NOT_FINAL/);
 assert.deepEqual(publicProof.calls,[]);
 const malformedError=Object.assign(Error('invalid receipt response'),{code:'BAD_DATA'});
 await assert.rejects(verify(proxy(provider,{getTransactionReceipt:async()=>{throw malformedError;}}),[publicProof.provider]),error=>error===malformedError);
 assert.deepEqual(publicProof.calls,[]);
});

test('public proof still requires the reviewed chain, exact initcode, matching primary rows and both canonical headers',async()=>{
 const primary=missingPrimary();
 for(const [overrides,pattern] of [
  [{send:async()=> '0x38'},/PROOF_FALLBACK_WRONG_CHAIN/],
  [{getTransaction:async()=>({...transaction,data:transaction.data+'00'})},/TRANSACTION_MISMATCH/],
  [{getTransactionReceipt:async()=>({...receipt,contractAddress:release.owner})},/CREATE_ADDRESS_MISMATCH/],
  [{getBlock:async()=>null},/PROOF_FALLBACK_HEADER_MISMATCH/],
  [{getBlock:async()=>({...await provider.getBlock(receipt.blockNumber),hash:'0x'+'22'.repeat(32)})},/PROOF_FALLBACK_HEADER_MISMATCH/]
 ])await assert.rejects(verify(primary,[fallback(overrides).provider]),pattern);
 const conflict=proxy(provider,{getTransactionReceipt:async()=>({...receipt,blockHash:'0x'+'22'.repeat(32)}),getTransaction:async()=>null});
 await assert.rejects(verify(conflict,[fallback().provider]),/RECEIPT_NOT_FINAL/);
 const nonceConflict=proxy(provider,{getTransactionReceipt:async()=>null,getTransaction:async()=>({...transaction,nonce:transaction.nonce+1})});
 await assert.rejects(verify(nonceConflict,[fallback().provider]),/PROOF_PRIMARY_CONFLICT/);
 for(const overrides of [
  {getBlock:async()=>null},
  {getBlock:async()=>({...await provider.getBlock(receipt.blockNumber),hash:'0x'+'33'.repeat(32)})},
  {getBlockNumber:async()=>receipt.blockNumber},
  {getBlockNumber:async()=>NaN}
 ])await assert.rejects(verify(proxy(primary,overrides),[fallback().provider]),/RECEIPT_NOT_FINAL/);
});

test('unavailable proof providers are bounded and missing data produces a clear error without changing the requested hash',async()=>{
 const empty=fallback({getTransactionReceipt:async()=>null,getTransaction:async()=>null});
 await assert.rejects(verify(missingPrimary(),[empty.provider]),/ZERO_START_CREATION_PROOF_UNAVAILABLE/);
 assert.deepEqual(empty.calls,['eth_chainId']);
 const first=fallback({getTransactionReceipt:async()=>null,getTransaction:async()=>null}),second=fallback();
 assert.deepEqual(await verify(missingPrimary(),[first.provider,second.provider]),creation);assert.equal(second.calls.filter(value=>value==='receipt').length,1);
 const wrongHash='0x'+'44'.repeat(32);
 await assert.rejects(verifyZeroStartCreation({provider:missingPrimary(),proofProviders:[fallback({getTransactionReceipt:async()=>({...receipt,hash:wrongHash})}).provider],artifact:artifact('FastTestnetVault'),release,hash,confirmations:3}),/RECEIPT_REQUIRED/);
});
