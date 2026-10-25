import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspect} from 'node:util';
import {getCompleteLogs,sanitizeCompleteLogDiagnostic} from '../scripts/complete-rpc-logs.mjs';

const address='0x1111111111111111111111111111111111111111';
const topic='0x'+'ab'.repeat(32),hash=n=>'0x'+(n+1).toString(16).padStart(64,'0');
const log=(block,index=0,data='0x1234')=>({address,topics:[topic],blockNumber:block,blockHash:hash(block),transactionHash:hash(10000+block),index,data,removed:false});
const filter=(fromBlock=1,toBlock=100)=>({address,topics:[topic],fromBlock,toBlock});
const rpc=(code,message,extra={})=>Object.assign(Error(message),{code:'UNKNOWN_ERROR',info:{error:{code,message}},...extra});
const rangeError=()=>rpc(-32602,'You can make eth_getLogs requests with up to a 10 block range. private URL https://private.invalid/key');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function harness({limit=Infinity,records=[],throwFor,delayMs=0}={}){
 const calls=[],headers=[];let active=0,maxActive=0;
 const provider={getBlock:async number=>{headers.push(number);return {number,hash:hash(number)};},getLogs:async value=>{
  calls.push(structuredClone(value));active++;maxActive=Math.max(maxActive,active);
  try{
   if(delayMs)await delay(delayMs);
   if(throwFor){const error=throwFor(value,calls.length);if(error)throw error;}
   if(value.toBlock-value.fromBlock+1>limit)throw rangeError();
   return records.filter(row=>row.blockNumber>=value.fromBlock&&row.blockNumber<=value.toBlock).map(row=>structuredClone(row));
  }finally{active--;}
 }};
 return {provider,calls,headers,get active(){return active;},get maxActive(){return maxActive;}};
}

test('recognized block limits yield every log with unchanged filters, ordered nonoverlapping coverage and cached provider limits',async()=>{
 const h=harness({limit:10,records:[log(1),log(10),log(11),log(50),log(100),log(110),log(200)],delayMs:2}),original=filter(1,100),copy=structuredClone(original),requests=[];
 const rows=await getCompleteLogs({provider:h.provider,filter:original,onRequest:value=>requests.push(value)});
 assert.deepEqual(rows.map(row=>row.blockNumber),[1,10,11,50,100]);assert.deepEqual(original,copy);assert.equal(requests.length,h.calls.length);assert.ok(h.maxActive<=4&&h.maxActive>1);
 const successful=h.calls.filter(row=>row.toBlock-row.fromBlock+1<=10),coverage=new Array(100).fill(0);
 for(const row of successful){assert.equal(row.address,address);assert.deepEqual(row.topics,[topic]);for(let block=row.fromBlock;block<=row.toBlock;block++)coverage[block-1]++;}
 assert.ok(coverage.every(value=>value===1));
 const offset=h.calls.length;
 assert.deepEqual((await getCompleteLogs({provider:h.provider,filter:filter(101,200)})).map(row=>row.blockNumber),[110,200]);
 assert.ok(h.calls.slice(offset).every(row=>row.toBlock-row.fromBlock+1<=10),'Learned limit must prevent another failing 100-block request');
});

test('known result-size limits split completely while a single-block limit remains a failure',async()=>{
 const h=harness({records:[log(1),log(2),log(3),log(4)],throwFor:value=>value.toBlock>value.fromBlock?rpc(-32005,'query returned more than 10000 results'):null});
 assert.deepEqual((await getCompleteLogs({provider:h.provider,filter:filter(1,4)})).map(row=>row.blockNumber),[1,2,3,4]);
 const blocked=harness({throwFor:()=>rpc(-32005,'query returned more than 10000 results')});
 await assert.rejects(getCompleteLogs({provider:blocked.provider,filter:filter(1,1)}),error=>error.message==='COMPLETE_LOG_QUERY_FAILED'&&error.logProbeDiagnostic.reason==='RESULT_LIMIT');
 assert.equal(blocked.calls.length,1);
});

test('empty child ranges use only the logical window anchor instead of reading every empty child header',async()=>{
 const h=harness({limit:10});assert.deepEqual(await getCompleteLogs({provider:h.provider,filter:filter(1,100)}),[]);
 assert.deepEqual(h.headers,[100,100]);assert.ok(h.calls.length>1);
});

test('ambiguous quota errors, authentication, timeouts and pruned history never trigger subdivision',async()=>{
 const errors=[rpc(-32005,'limit exceeded'),rpc(-32602,'invalid argument with private key'),rpc(-32000,'invalid API key private secret'),Object.assign(Error('private request timeout; block range limit 10'),{code:'TIMEOUT'}),rpc(-32000,'missing trie node; private archive URL')];
 for(const original of errors){
  const h=harness({throwFor:()=>original});
  await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,100)}),error=>{assert.equal(error.message,'COMPLETE_LOG_QUERY_FAILED');assert.equal(error.logProbeDiagnostic.requests,1);assert.doesNotMatch(inspect(error),/private|secret|https:\/\//);assert.equal(Object.hasOwn(error,'cause'),false);return true;});
  assert.equal(h.calls.length,1);
 }
});

test('confirmed 429 responses retry the identical range twice with bounded backoff and never return partial success',async()=>{
 const waits=[],h=harness({records:[log(3)],throwFor:(_,count)=>count<=2?rpc(429,'private quota response',{info:{responseStatus:'429 Too Many Requests',error:{code:429,message:'private response'}}}):null});
 assert.deepEqual((await getCompleteLogs({provider:h.provider,filter:filter(1,10),waitForRetry:async ms=>waits.push(ms)})).map(row=>row.blockNumber),[3]);
 assert.deepEqual(waits,[250,750]);assert.equal(h.calls.length,3);assert.deepEqual(h.calls,[h.calls[0],h.calls[0],h.calls[0]]);
 const blocked=harness({throwFor:()=>rpc(429,'private quota response')});
 await assert.rejects(getCompleteLogs({provider:blocked.provider,filter:filter(1,10),waitForRetry:async()=>{}}),error=>error.logProbeDiagnostic.reason==='RATE_LIMITED'&&error.logProbeDiagnostic.requests===3);assert.equal(blocked.calls.length,3);
});

test('a failed parallel child waits for all in-flight reads and discards every partial result',async()=>{
 const h=harness({limit:10,records:[log(1),log(20),log(30)],delayMs:3,throwFor:value=>value.fromBlock===11?rpc(-32601,'private unavailable method'):null});
 await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,100)}),error=>error.logProbeDiagnostic.reason==='METHOD_UNAVAILABLE');
 assert.equal(h.active,0);assert.ok(h.maxActive<=4);const completed=h.calls.length;await delay(10);assert.equal(h.calls.length,completed);
});

test('the request budget counts every attempt and never yields a partially read logical page',async()=>{
 const h=harness({limit:10,records:[log(1),log(20)]}),counts=[];
 await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,100),maxRequests:3,onRequest:value=>counts.push(value)}),error=>error.message==='COMPLETE_LOG_REQUEST_BUDGET_EXCEEDED'&&error.logProbeDiagnostic.reason==='REQUEST_BUDGET_EXCEEDED');
 assert.equal(h.calls.length,3);assert.equal(counts.length,3);assert.equal(h.active,0);
});

test('window and returned-log canonical hashes remain mandatory',async()=>{
 const h=harness({records:[log(1)]});let reads=0;
 h.provider.getBlock=async number=>({number,hash:number===10&&++reads>1?hash(999):hash(number)});
 await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,10)}),/COMPLETE_LOG_CANONICAL_MISMATCH/);
 const wrong=harness({records:[{...log(1),blockHash:hash(999)}]});await assert.rejects(getCompleteLogs({provider:wrong.provider,filter:filter(1,10)}),/COMPLETE_LOG_CANONICAL_MISMATCH/);
});

test('consistent duplicates are deduplicated, conflicting duplicates and out-of-scope log records are rejected',async()=>{
 const duplicated=harness({records:[log(1),log(1)]});assert.equal((await getCompleteLogs({provider:duplicated.provider,filter:filter(1,10)})).length,1);
 const conflict=harness({records:[log(1),log(1,0,'0xabcd')]});await assert.rejects(getCompleteLogs({provider:conflict.provider,filter:filter(1,10)}),/COMPLETE_LOG_CONFLICTING_DUPLICATE/);
 for(const change of [{address:'0x2222222222222222222222222222222222222222'},{topics:[hash(999)]},{removed:true},{index:-1},{transactionHash:'private secret'},{data:'private secret'}]){
  const h=harness({records:[{...log(1),...change}]});await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,10)}),/COMPLETE_LOG_RESPONSE_INVALID/);
 }
});

test('diagnostics never retain raw exceptions or trust provider-supplied diagnostic objects',async()=>{
 const source=rpc(-32602,'private URL https://private.invalid/secret');source.logProbeDiagnostic={url:'https://private.invalid/secret'};
 const h=harness({throwFor:()=>source});await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,100)}),error=>{assert.doesNotMatch(inspect(error),/private|secret|https:\/\//);assert.equal(error.logProbeDiagnostic.rpcCode,-32602);return true;});
 const value=sanitizeCompleteLogDiagnostic({operation:'private',fromBlock:'private',toBlock:Infinity,errorCode:'private',rpcCode:'secret',httpStatus:9999,reason:'private',requests:'secret'});
 assert.deepEqual(value,{operation:'eth_getLogs',fromBlock:null,toBlock:null,errorCode:null,rpcCode:null,httpStatus:null,reason:'UNKNOWN',requests:null});
});

test('invalid or unconstrained filters fail before contacting the provider',async()=>{
 for(const change of [{fromBlock:'latest'},{toBlock:1001},{address:[]},{topics:[]},{topics:[null]},{blockHash:hash(1)}]){
  const h=harness();await assert.rejects(getCompleteLogs({provider:h.provider,filter:{...filter(1,100),...change}}),/COMPLETE_LOG_FILTER_REQUIRED/);assert.equal(h.calls.length,0);assert.equal(h.headers.length,0);
 }
});

test('the actual connection probe covers a limited provider completely and preserves fatal canonical validation',async()=>{
 const fs=await import('node:fs');
 const {BrowserProvider,ContractFactory,parseEther}=await import('ethers');
 const {default:ganache}=await import('ganache');
 const {prepareZeroStartConnection}=await import('../scripts/connect-zero-start.mjs');
 const {retryableDailyReadFailure}=await import('../scripts/zero-start-automation.mjs');
 const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
 const fast=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json'));
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:12,unlockedAccounts:[fast.owner,fast.deployer]},miner:{blockGasLimit:30000000}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const proxy=overrides=>new Proxy(provider,{get(object,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
 try{
  for(const account of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[account,'0x'+parseEther('10').toString(16)]});
  await rpc.request({method:'evm_setAccountNonce',params:[fast.deployer,'0x10']});
  const signer=await provider.getSigner(0),operator=await provider.getSigner(fast.deployer),addresses=await Promise.all(Array.from({length:12},async(_,i)=>(await provider.getSigner(i)).getAddress()));
  const deploy=async(name,args,from=signer)=>{const a=artifact(name),contract=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,from).deploy(...args);await contract.waitForDeployment();return contract;};
  const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]);
  const release={...fast,token:token.target,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
  const vault=await deploy('FastTestnetVault',[release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations],operator);
  for(let i=0;i<30;i++)await rpc.request({method:'evm_mine',params:[]});
  const options={artifact:artifact('FastTestnetVault'),release,deploymentReport:{hash:vault.deploymentTransaction().hash},original:'TRADES_CHAIN_ID=97\nTRADES_RPC_URL=https://private.invalid/credential\nTRADES_VAULT_ADDRESS='+vault.target+'\nTRADES_PORT=3115\nTRADES_CONFIRMATIONS=3\nGLOBAL_MIGRATION_ENABLED=false\n',confirmations:3};
  const calls=[];
  const limited=proxy({getLogs:async value=>{calls.push(value);if(value.toBlock-value.fromBlock+1>10)throw rangeError();return provider.getLogs(value);}});
  const prepared=await prepareZeroStartConnection({...options,provider:limited});assert.equal(prepared.report.currentState.settlementLogProbe.status,'supported');assert.ok(calls.length>1);assert.equal(prepared.report.transactionsSent,0);
  const unavailable=proxy({getLogs:async()=>{throw rpcError();}});
  function rpcError(){return Object.assign(Error('private credential at https://private.invalid/key'),{code:'UNKNOWN_ERROR',info:{error:{code:-32602,message:'private invalid argument'}}});}
  await assert.rejects(prepareZeroStartConnection({...options,provider:unavailable}),error=>{assert.equal(error.message,'ZERO_START_SETTLEMENT_LOG_RPC_REQUIRED');assert.equal(error.logProbeDiagnostic.rpcCode,-32602);assert.doesNotMatch(inspect(error),/https|credential|private\.invalid/);return true;});
  const corrupted=proxy({getLogs:async value=>[{address:vault.target,topics:[vault.interface.getEvent('SaleSettled').topicHash],data:'0x',blockNumber:value.fromBlock,blockHash:hash(999),transactionHash:hash(998),index:0,removed:false}]});
  await assert.rejects(prepareZeroStartConnection({...options,provider:corrupted}),error=>{assert.equal(error.message,'COMPLETE_LOG_CANONICAL_MISMATCH');assert.equal(retryableDailyReadFailure(error,{transactions:{}}),false);return true;});
  const invalid=proxy({getLogs:async()=>({private:'invalid response'})});
  await assert.rejects(prepareZeroStartConnection({...options,provider:invalid}),error=>{assert.equal(error.message,'COMPLETE_LOG_RESPONSE_INVALID');assert.equal(retryableDailyReadFailure(error,{transactions:{}}),false);return true;});
 }finally{await provider.destroy();await rpc.disconnect();}
});
