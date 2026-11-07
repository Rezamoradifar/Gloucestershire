import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,Interface,ZeroAddress,keccak256,parseEther} from 'ethers';
import {prepareZeroStartConnection} from '../scripts/connect-zero-start.mjs';
import {verifyZeroStartTarget} from '../scripts/zero-start-readiness.mjs';
import {blockAtTime,hourlyTestPolicyFields,validateDailyPolicy} from '../scripts/daily-profit.mjs';
import {getCompleteLogs,installHistoricalCallRetry} from '../scripts/complete-rpc-logs.mjs';
import {inspectReliabilityCandidate,prepareDailyReliability,reliabilityFailureDiagnostic,reliabilityPreflightFailure,sanitizeReliabilityDiagnostic} from '../scripts/prepare-daily-reliability.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
const fast=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json','utf8'));
const helpers={Contract,Interface,ZeroAddress,keccak256,verifyZeroStartTarget,blockAtTime,getCompleteLogs,installHistoricalCallRetry};
const privateMarker='https://private.invalid/SECRET_RPC_KEY';
const rpcFailure=(message,code=-32000)=>Object.assign(Error(privateMarker+' '+message),{code:'CALL_EXCEPTION',info:{error:{code,message},payload:{method:'eth_call',params:['PRIVATE_CALLDATA']}}});
let rpc,provider,vault,release,policy,journal,base,historical,confirmed,now,operatorNonce,broadcasts=0;

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:12,unlockedAccounts:[fast.owner,fast.deployer]},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const address of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[address,'0x'+parseEther('10').toString(16)]});
 const signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i))),addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const deploy=async(name,args,signer=signers[0])=>{const a=artifact(name),contract=await new ContractFactory(a.abi,a.bytecode||'0x'+a.evm.bytecode.object,signer).deploy(...args);await contract.waitForDeployment();return contract;};
 const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]);
 release={...fast,token:token.target,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
 vault=await deploy('FastTestnetVault',[release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations],await provider.getSigner(fast.deployer));
 const receipt=await vault.deploymentTransaction().wait(),created=await provider.getBlock(receipt.blockNumber),deployment={hash:receipt.hash};
 await (await vault.fundRewards(ZeroAddress,5n,{value:5n})).wait();
 await rpc.request({method:'evm_increaseTime',params:[60]});
 for(let i=0;i<15;i++)await rpc.request({method:'evm_mine',params:[]});
 confirmed=await provider.getBlock((await provider.getBlockNumber())-3);now=()=>confirmed.timestamp*1000;
 const original='TRADES_CHAIN_ID=97\nTRADES_RPC_URL="'+privateMarker+'"\nTRADES_VAULT_ADDRESS='+vault.target+'\nTRADES_START_BLOCK='+receipt.blockNumber+'\nTRADES_PORT=3115\nTRADES_CONFIRMATIONS=3\nGLOBAL_MIGRATION_ENABLED=false\nTRADES_ZERO_START_PROFILE=global-fresh-fast-test-v1\n';
 const connection=await prepareZeroStartConnection({provider,artifact:artifact('FastTestnetVault'),release,deploymentReport:deployment,original,confirmations:3,inspectSettlementLogs:false});
 policy=validateDailyPolicy({version:1,chainId:97,vaultAddress:vault.target,runtimeHash:keccak256(await provider.getCode(vault.target)),deploymentBlock:receipt.blockNumber,startTimestamp:created.timestamp,activationBlock:created.number,activationBlockHash:created.hash,basis:'position-anniversary-principal',positionScheduleVersion:1,periodSeconds:3600,includeReinvestment:true,...hourlyTestPolicyFields});
 journal={daily:{epoch:19,positionPaid:{'existing-position:0':7}},transactions:{}};
 historical=await blockAtTime(provider,policy.startTimestamp,policy.deploymentBlock,confirmed.number);
 operatorNonce=await provider.getTransactionCount(fast.deployer);
 base={artifact:artifact('FastTestnetVault'),release,policy,journal,original:connection.env,deployment,connection:{...connection.report,siteConnected:true},confirmations:3,helpers,target:vault.target,now};
});
after(async()=>{
 assert.equal(broadcasts,0);
 if(provider)assert.equal(await provider.getTransactionCount(fast.deployer),operatorNonce);
 await provider?.destroy();await rpc?.disconnect();
});

function readonly(intercept=async()=>undefined){
 const candidate=new BrowserProvider(rpc,undefined,{cacheTimeout:-1}),send=candidate.send.bind(candidate);
 candidate.send=async(method,params)=>{
  if(['eth_sendTransaction','eth_sendRawTransaction','eth_sign','personal_sign','eth_signTypedData_v4'].includes(method)){broadcasts++;throw Error('READ_ONLY_PROBE_MUST_NOT_SIGN');}
  const result=await intercept(method,params);
  return result===undefined?send(method,params):result;
 };
 return candidate;
}
const inspect=(candidate,extra={})=>inspectReliabilityCandidate({...base,provider:candidate,...extra});
const failure=async action=>{try{await action();assert.fail('Expected a blocked preflight');}catch(error){assert.ok(error.safeReport);return reliabilityPreflightFailure(error);}};
const historicalAccount=(method,params)=>method==='eth_call'&&params[0].to.toLowerCase()===vault.target.toLowerCase()&&params[0].data.startsWith(vault.interface.getFunction('accounts').selector)&&Number(BigInt(params[1]))===historical.number;

test('a single-block RPC passes the unchanged nine-block proof after raw getLogs rejects its range',async()=>{
 const ranges=[],reads=[],candidate=readonly(async(method,params)=>{
  if(historicalAccount(method,params))reads.push(structuredClone(params));
  if(method==='eth_getLogs'){
   const from=Number(BigInt(params[0].fromBlock)),to=Number(BigInt(params[0].toBlock));ranges.push([from,to]);
   if(from!==to)throw Object.assign(Error(privateMarker+' range limit'),{code:'UNKNOWN_ERROR',info:{error:{code:-32602,message:'maximum block range is 1'}}});
  }
 });
 const before=JSON.stringify({policy,journal}),topic=vault.interface.getEvent('SaleSettled').topicHash,first=confirmed.number-8;
 try{
  await assert.rejects(candidate.getLogs({address:vault.target,topics:[topic],fromBlock:first,toBlock:confirmed.number}),{code:'UNKNOWN_ERROR'});
  ranges.length=0;
  const result=await inspect(candidate);
  assert.equal(result.reporterAuthorized,true);assert.equal(result.checkpoint.number,confirmed.number);
  assert.equal(result.funding[0].rewardBudgetUnits,'5');
  assert.equal(ranges.length,10);assert.deepEqual(ranges[0],[first,confirmed.number]);
  assert.deepEqual(ranges.slice(1).sort((a,b)=>a[0]-b[0]),Array.from({length:9},(_,i)=>[first+i,first+i]));
  assert.equal(reads.length,1);assert.equal(Number(BigInt(reads[0][1])),historical.number);
  assert.equal(JSON.stringify({policy,journal}),before);
 }finally{candidate.destroy();}
});

test('historical transport retry repeats the same call and snapshot on the same candidate',async()=>{
 const calls=[],candidate=readonly(async(method,params)=>{
  if(historicalAccount(method,params)){
   calls.push(structuredClone(params));
   if(calls.length===1)throw Object.assign(Error(privateMarker+' transport timeout'),{code:'TIMEOUT'});
  }
 });
 try{
  await inspect(candidate);
  assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
  assert.equal(Number(BigInt(calls[1][1])),historical.number);
 }finally{candidate.destroy();}
});

test('missing original history reports the exact operation and never changes or skips the snapshot',async()=>{
 let calls=0,logs=0;
 const candidate=readonly(async(method,params)=>{
  if(historicalAccount(method,params)){calls++;throw rpcFailure('missing trie node');}
  if(method==='eth_getLogs')logs++;
 });
 const before=JSON.stringify({policy,journal});
 try{
  const report=await failure(()=>inspect(candidate));
  assert.equal(report.phase,'HISTORICAL_STATE');assert.equal(report.operation,'accounts-native');
  assert.equal(report.reason,'HISTORICAL_STATE_UNAVAILABLE');assert.equal(report.errorCode,'CALL_EXCEPTION');assert.equal(report.rpcCode,-32000);
  assert.equal(report.block,historical.number);assert.equal(report.requestedTimestamp,policy.startTimestamp);
  assert.equal(calls,1);assert.equal(logs,0);assert.equal(JSON.stringify({policy,journal}),before);
  assert.doesNotMatch(JSON.stringify(report),/private|SECRET|PRIVATE_CALLDATA|missing trie/);
 }finally{candidate.destroy();}
});

test('wrong-chain, unavailable creation proof and stale clock checks have separate safe reasons',async()=>{
 for(const [intercept,extra,phase,operation,reason]of [
  [async method=>method==='eth_chainId'?'0x38':undefined,{},'TARGET_VERIFICATION','verify-target','CHAIN_IDENTITY_MISMATCH'],
  [async method=>['eth_getTransactionReceipt','eth_getTransactionByHash'].includes(method)?null:undefined,{},'TARGET_VERIFICATION','verify-target','CREATION_PROOF_UNAVAILABLE'],
  [async()=>undefined,{now:()=>now()+601000},'CONFIRMED_CHECKPOINT','checkpoint-freshness','STALE_CHECKPOINT']
 ]){
  const candidate=readonly(intercept);
  try{const report=await failure(()=>inspect(candidate,extra));assert.equal(report.phase,phase);assert.equal(report.operation,operation);assert.equal(report.reason,reason);}
  finally{candidate.destroy();}
 }
});

test('a canonical historical anchor change remains fatal before permission or funding reads',async()=>{
 let historicalRead=false;
 const candidate=readonly(async(method,params)=>{
  if(historicalAccount(method,params))historicalRead=true;
  if(historicalRead&&method==='eth_getBlockByNumber'&&Number(BigInt(params[0]))===historical.number){
   const block=await rpc.request({method,params});return {...block,hash:'0x'+'44'.repeat(32)};
  }
 });
 try{
  const report=await failure(()=>inspect(candidate));
  assert.equal(report.phase,'CANONICAL_VERIFICATION');assert.equal(report.operation,'snapshot-block-hash');assert.equal(report.reason,'CANONICAL_MISMATCH');
 }finally{candidate.destroy();}
});

test('a current funding RPC authorization error is not reported as missing historical principal',async()=>{
 const selector=vault.interface.getFunction('assetBalance').selector;
 const candidate=readonly(async(method,params)=>{
  if(method==='eth_call'&&params[0].data.startsWith(selector)&&vault.interface.decodeFunctionData('assetBalance',params[0].data)[0]===release.token)throw Object.assign(Error(privateMarker),{code:'SERVER_ERROR',info:{responseStatus:'403 Forbidden',responseBody:JSON.stringify({jsonrpc:'2.0',error:{code:-32001,message:'PRIVATE_RPC_AUTH_BODY'}})}});
 });
 try{
  const report=await failure(()=>inspect(candidate));
  assert.equal(report.phase,'CURRENT_FUNDING');assert.equal(report.operation,'asset-balance-token');assert.equal(report.reason,'AUTHENTICATION_REQUIRED');
  assert.equal(report.httpStatus,403);assert.equal(report.rpcCode,-32001);assert.equal(report.block,confirmed.number);assert.equal(report.requestedTimestamp,null);
  assert.doesNotMatch(JSON.stringify(report),/private|SECRET|PRIVATE_RPC_AUTH_BODY|Forbidden/);
 }finally{candidate.destroy();}
});

test('invalid financial journal identity is a local validation blocker with no reset',async()=>{
 const candidate=readonly(),invalid={...journal,identity:{chainId:56}},before=JSON.stringify(invalid);
 try{
  const report=await failure(()=>inspect(candidate,{journal:invalid}));
  assert.equal(report.error,'RELIABILITY_JOURNAL_IDENTITY_MISMATCH');assert.equal(report.phase,'JOURNAL_VALIDATION');assert.equal(report.operation,'journal-fees');
  assert.equal(report.reason,'FINANCIAL_JOURNAL_INVALID');assert.equal(report.rpcCode,null);assert.equal(JSON.stringify(invalid),before);
 }finally{candidate.destroy();}
});

test('failure output reconstructs only fixed enums and bounded numeric fields',()=>{
 const poisoned={phase:privateMarker,operation:privateMarker,reason:privateMarker,errorCode:privateMarker,rpcCode:'-32000',httpStatus:true,block:Number.MAX_SAFE_INTEGER+1,requestedTimestamp:-1,raw:privateMarker};
 assert.deepEqual(sanitizeReliabilityDiagnostic(poisoned),{phase:'LOCAL_INPUTS',operation:'unknown',reason:'UNKNOWN',errorCode:null,rpcCode:null,httpStatus:null,block:null,requestedTimestamp:null});
 const diagnostic=reliabilityFailureDiagnostic(Object.assign(Error(privateMarker),{code:'UNKNOWN_ERROR',info:{error:{code:-32005,message:'too many requests '+privateMarker}}}),{phase:'SETTLEMENT_LOGS',operation:'settlement-logs'});
 const error=Object.assign(Error('SECRET_UPPERCASE_TOKEN'),{safeReport:{phase:'RPC_VERIFICATION',raw:privateMarker,attempts:[{candidate:0,verified:false,...diagnostic,calldata:privateMarker},{candidate:1,verified:false,...poisoned},...Array.from({length:10},(_,i)=>({candidate:i+2,verified:true,url:privateMarker}))]}});
 const report=reliabilityPreflightFailure(error);
 assert.equal(report.error,'RELIABILITY_PREFLIGHT_FAILED');assert.equal(report.phase,'RPC_VERIFICATION');assert.equal(report.attempts.length,4);
 assert.equal(report.attempts[0].reason,'RATE_LIMITED');assert.equal(report.attempts[0].rpcCode,-32005);assert.equal(report.transactionsSent,0);assert.equal(report.signerOpened,false);
 assert.doesNotMatch(JSON.stringify(report),/private|SECRET|calldata|raw|url/);
});

test('a missing installed runtime reports a local input failure before any RPC candidate is contacted',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'global-reliability-input-'));
 try{
  const report=await failure(()=>prepareDailyReliability({runtime:path.join(directory,'missing-runtime-SECRET')}));
  assert.equal(report.error,'RELIABILITY_PREFLIGHT_FAILED');assert.equal(report.phase,'LOCAL_INPUTS');assert.equal(report.operation,'runtime-import');assert.equal(report.reason,'INVALID_LOCAL_CONFIGURATION');
  assert.deepEqual(report.attempts,[]);assert.equal(report.transactionsSent,0);assert.doesNotMatch(JSON.stringify(report),/SECRET|missing-runtime|global-reliability-input/);
  assert.deepEqual(fs.readdirSync(directory),[]);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
