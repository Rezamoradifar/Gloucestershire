import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Interface,Wallet,ZeroAddress,getAddress,keccak256} from 'ethers';
import {dailyAbi} from '../scripts/daily-profit.mjs';
import {runZeroStartAutomation,zeroStartWorkerDiagnostic,validateZeroStartPendingTransactions} from '../scripts/zero-start-automation.mjs';

const address=n=>getAddress('0x'+n.toString(16).padStart(40,'0'));
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const target=address(10),token=address(11),owner=address(12),operator=address(13),queueAddress=address(14),member=address(15);
const registration=new Interface(['event Registered(address indexed user,address indexed referrer)']);
function harness(){
 let unavailable=true,sends=0,credited=false,phases=[];
 const runtime='0x6000',state={transactions:{}},policy={version:1,chainId:97,vaultAddress:target,runtimeHash:keccak256(runtime),deploymentBlock:1,startTimestamp:100000,activationBlock:10,activationBlockHash:hash(10),basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true};
 const failure=Object.assign(Error('Private provider https://private.invalid/secret credentials and transaction data must remain private'),{code:'UNKNOWN_ERROR',info:{error:{code:-32005,message:'Provider credential secret must not be published'}}});
 const provider={send:async()=> '0x61',getCode:async()=>runtime,getBlockNumber:async()=>30,getBlock:async n=>({number:n,hash:hash(n),timestamp:n*10000}),getLogs:async()=>{
  if(unavailable)throw failure;
  const event=registration.encodeEventLog(registration.getEvent('Registered'),[member,ZeroAddress]);
  return [{address:target,blockNumber:1,blockHash:hash(1),transactionHash:hash(70),index:0,removed:false,...event}];
 }};
 const vault={target,getAddress:async()=>target,usdt:async()=>token,reporters:async()=>true,dailyTargetBps:async()=>100n,
  users:async()=>({registered:true,referrer:ZeroAddress,active:true,vipKyc:false}),tierOf:async()=>0n,tierConfig:async()=>({referrals:[800n,400n,200n,0n]}),
  accounts:async(who,asset)=>({principal:who===member&&asset===token?1000n:0n}),
  ledgers:async asset=>({principal:asset===token?1000n:0n,rewards:100n}),assetBalance:async()=>100n,usedRewardBatch:async()=>credited,
  batchProfit:{staticCall:async()=>{},populateTransaction:async()=>({to:target,data:'0x1234'})}};
 const queue={vault:async()=>target,APPROVAL_VERSION:async()=>1n,requestCount:async()=>0n};
 const readiness={version:1,kind:'fresh-zero-daily-readiness',releaseId:'global-fresh-zero-v1',chainId:97,target,owner,operator,queue:queueAddress,hash:hash(80),runtimeHash:policy.runtimeHash,block:1,ready:true,blockers:[]};
 state.identity={version:1,chainId:97,target,owner,operator,queue:queueAddress,hash:readiness.hash,runtimeHash:policy.runtimeHash};
 const run=extra=>runZeroStartAutomation({provider,vault,queue,readiness,state,save:()=>{},loadPolicy:()=>policy,savePolicy:()=>{throw Error('EXISTING_POLICY_MUST_BE_PRESERVED');},transact:async()=>{sends++;credited=true;return {status:1,hash:hash(81)};},maintainOracles:async()=>({status:'TESTNET_ORACLES_VALID'}),processVolume:async()=>({complete:true}),onPhase:phase=>phases.push(phase),...extra});
 return {state,policy,failure,provider,run,recover:()=>{unavailable=false;},get sends(){return sends;},get phases(){return phases;}};
}

test('worker diagnostics expose only allowlisted phases, ethers codes, numeric RPC codes and pending flags',()=>{
 const s=harness();
 const result=zeroStartWorkerDiagnostic(s.failure,{phase:'DAILY_PERIOD_PLAN',state:{transactions:{'daily-private-label':{raw:'private raw data'}}}});
 assert.deepEqual(result,{phase:'DAILY_PERIOD_PLAN',errorCode:'UNKNOWN_ERROR',rpcCode:-32005,pendingSignedTransaction:true,pendingFinancialTransaction:true});
 assert.doesNotMatch(JSON.stringify(result),/https|secret|credentials|raw|private|label/);
 assert.equal(zeroStartWorkerDiagnostic({code:'https://private.invalid',info:{error:{code:'private'}}},{phase:'private',state:{}}).phase,'UNKNOWN');
 assert.equal(zeroStartWorkerDiagnostic({code:'private'}).errorCode,null);
 const oracle=zeroStartWorkerDiagnostic(s.failure,{phase:'ORACLE_MAINTENANCE',state:{transactions:{'oracle-refresh-1':{raw:'private'}}}});
 assert.equal(oracle.pendingSignedTransaction,true);assert.equal(oracle.pendingFinancialTransaction,false);
});

test('historical planning RPC failure waits without advancing a period or changing its saved policy, then resumes once',async()=>{
 const s=harness(),saved=structuredClone(s.policy);
 const waiting=await s.run();
 assert.equal(waiting.status,'waiting');assert.equal(waiting.dailyCredits.length,0);assert.equal(s.state.daily.epoch,0);assert.equal(s.sends,0);
 assert.ok(waiting.blockers.includes('DAILY_PERIOD_PLAN_RPC_UNAVAILABLE'));
 assert.deepEqual(waiting.diagnostic,{phase:'DAILY_PERIOD_PLAN',errorCode:'UNKNOWN_ERROR',rpcCode:-32005,pendingSignedTransaction:false,pendingFinancialTransaction:false});
 assert.deepEqual(s.policy,saved);assert.doesNotMatch(JSON.stringify(waiting),/https|credentials|secret/);
 s.recover();const completed=await s.run();assert.equal(completed.status,'scheduled');assert.equal(completed.dailyCredits[0].status,'credited');assert.equal(s.state.daily.epoch,1);assert.equal(s.sends,1);
 await s.run();assert.equal(s.sends,1);assert.equal(s.state.daily.epoch,1);assert.deepEqual(s.policy,saved);
});
test('the testnet worker rejects an ordinary mainnet policy before daily planning or credit',async()=>{
 const s=harness(),policy={...s.policy,chainId:56};
 await assert.rejects(s.run({loadPolicy:()=>policy}),/ZERO_START_AUTOMATION_POLICY_CHANGED/);
 assert.equal(s.sends,0);assert.equal(s.state.daily.epoch,0);assert.equal(s.state.daily.registry,undefined);
});

test('a pending signed financial transaction prevents a read failure from being downgraded to waiting',async()=>{
 const s=harness();s.state.transactions['daily-pending']={raw:'pending signed data'};
 const saved=structuredClone(s.state.transactions);
 await assert.rejects(s.run(),error=>{
  assert.equal(error.code,'UNKNOWN_ERROR');assert.equal(error.info.error.code,-32005);assert.equal(error.logProbeDiagnostic.operation,'eth_getLogs');assert.equal(error.cause,undefined);assert.doesNotMatch(JSON.stringify(error),/private|secret|credentials|https/);return true;
 });assert.equal(s.sends,0);assert.equal(s.state.daily.epoch,0);assert.deepEqual(s.state.transactions,saved);
});

test('identity and canonical activation failures remain blocking',async()=>{
 const s=harness();
 const provider={...s.provider,getBlock:async n=>({number:n,hash:hash(n===10?999:n),timestamp:n*10000})};
 await assert.rejects(s.run({provider}),/ZERO_START_ACTIVATION_CHECKPOINT_REORG/);assert.equal(s.sends,0);assert.equal(s.state.daily.epoch,0);
});

test('read failures in volume and withdrawal checks identify their phase without claiming credits',async()=>{
 for(const phase of ['NETWORK_VOLUME','APPROVED_WITHDRAWALS']){
  const s=harness(),extra=phase==='NETWORK_VOLUME'?{processVolume:async()=>{throw s.failure;}}:{queue:{vault:async()=>target,APPROVAL_VERSION:async()=>1n,requestCount:async()=>{throw s.failure;}}};
  const report=await s.run(extra);assert.equal(report.status,'waiting');assert.equal(report.diagnostic.phase,phase);assert.ok(report.blockers.includes(phase+'_RPC_UNAVAILABLE'));assert.equal(s.sends,0);assert.equal(s.state.daily.epoch,0);
 }
});

test('an incomplete registration index remains waiting with the original epoch and no credit claim',async()=>{
 const s=harness();s.recover();
 s.policy.startTimestamp=500010000;s.policy.activationBlock=50001;s.policy.activationBlockHash=hash(50001);
 const provider={...s.provider,getBlockNumber:async()=>70000,getLogs:async()=>[]};
 const report=await s.run({provider});
 assert.equal(report.status,'waiting');assert.equal(report.dailyStatus,'indexing');assert.ok(report.blockers.includes('DAILY_MEMBER_INDEX_INCOMPLETE'));
 assert.equal(s.state.daily.registry.through,50000);assert.equal(s.state.daily.epoch,0);assert.equal(s.sends,0);assert.deepEqual(report.dailyCredits,[]);
});

async function pendingHarness(overrides={}){
 const signer=new Wallet('0x'+'11'.repeat(32)),other=new Wallet('0x'+'22'.repeat(32));
 const feed=new Interface(['function set(int256,uint256,uint80,uint80)']);
 const abi=new Interface(dailyAbi),data=abi.encodeFunctionData('batchProfit',[hash(80),token,[member],[10n]]);
 const request={to:target,data,type:0,chainId:97,nonce:7,gasPrice:1000000000n,gasLimit:100000n,value:0n,...overrides};
 const raw=await signer.signTransaction(request),label='daily-'+hash(80);
 const state={transactions:{[label]:{raw,hash:keccak256(raw),maxFee:'100000000000000'}},maxTotalFee:'100000000000000000',daily:{epoch:5},oracle:{pending:{label:'oracle-refresh-1',request:{to:address(16),data:feed.encodeFunctionData('set',[100000000n,100n,1n,1n])}}}};
 const options={state,wallet:signer,readiness:{target,operator:signer.address,queue:queueAddress},release:{deployer:signer.address,bnbFeed:address(16),tokenFeed:address(17)},artifact:{abi:feed.fragments}};
 let sends=0;
 const resume=async extra=>{const entries=await validateZeroStartPendingTransactions({...options,...extra});for(const entry of entries){assert.equal(entry.request.to,request.to);sends++;}return entries;};
 return {options,state,signer,other,raw,label,request,resume,get sends(){return sends;}};
}

test('one saved daily transaction can resume before its separately planned oracle refresh without changing the journal',async()=>{
 const s=await pendingHarness(),before=structuredClone(s.state);
 const entries=await s.resume();assert.equal(s.sends,1);assert.deepEqual(entries,[{label:s.label,request:{to:target,data:s.request.data}}]);assert.deepEqual(s.state,before);
});

test('multiple pending entries, including a malformed later entry, prevent the first saved transaction from sending',async()=>{
 const s=await pendingHarness();s.state.transactions['later-malformed']={raw:'unparseable private data',hash:'private'};
 await assert.rejects(s.resume(),/ZERO_START_MULTIPLE_SIGNED_PENDING_TRANSACTIONS/);assert.equal(s.sends,0);
});

test('pending signer, chain, hash, native value, destination and method guards all run before broadcast',async()=>{
 for(const change of [{chainId:56},{value:1n},{to:address(99)},{data:new Interface(dailyAbi).encodeFunctionData('dailyTargetBps',[member])}]){
  const s=await pendingHarness(change);await assert.rejects(s.resume(),/ZERO_START_PENDING_TRANSACTION_(?:MISMATCH|TARGET_MISMATCH)/);assert.equal(s.sends,0);
 }
 const wrongSigner=await pendingHarness();wrongSigner.state.transactions[wrongSigner.label].raw=await wrongSigner.other.signTransaction(wrongSigner.request);wrongSigner.state.transactions[wrongSigner.label].hash=keccak256(wrongSigner.state.transactions[wrongSigner.label].raw);
 await assert.rejects(wrongSigner.resume(),/ZERO_START_PENDING_TRANSACTION_MISMATCH/);assert.equal(wrongSigner.sends,0);
 const wrongHash=await pendingHarness();wrongHash.state.transactions[wrongHash.label].hash=hash(500);
 await assert.rejects(wrongHash.resume(),/ZERO_START_PENDING_TRANSACTION_MISMATCH/);assert.equal(wrongHash.sends,0);
 const malformed=await pendingHarness();malformed.state.transactions[malformed.label].raw='private malformed transaction';
 await assert.rejects(malformed.resume(),/ZERO_START_PENDING_TRANSACTION_INVALID/);assert.equal(malformed.sends,0);
});

test('seed and million-token pending scopes still require their exact dedicated verifier before resumption',async()=>{
 for(const scope of ['seed','million']){
  const s=await pendingHarness({to:address(30)});let checked=0;
  const check={isLabel:label=>label===s.label,verify:async(label,request)=>{checked++;assert.equal(label,s.label);assert.equal(request.to,address(30));throw Error('EXACT_GRANT_VERIFICATION_REQUIRED');}};
  await assert.rejects(s.resume({[scope]:check}),/EXACT_GRANT_VERIFICATION_REQUIRED/);assert.equal(checked,1);assert.equal(s.sends,0);
 }
});
