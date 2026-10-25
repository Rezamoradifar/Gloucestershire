import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {inspect} from 'node:util';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,getAddress,keccak256,parseEther,toUtf8Bytes} from 'ethers';
import {prepareZeroStartConnection} from '../scripts/connect-zero-start.mjs';
import {verifyZeroStartReadiness} from '../scripts/zero-start-readiness.mjs';
import {makeHourlyTestPolicy} from '../scripts/zero-start-hourly-test.mjs';
import {blockAtTime,planDailyEpoch} from '../scripts/daily-profit.mjs';
import {prepareZeroArchiveRpc} from '../scripts/prepare-zero-archive-rpc.mjs';
import {repairZeroMemberIndex} from '../scripts/repair-zero-member-index.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const fast=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json'));
const digest=value=>createHash('sha256').update(value).digest('hex');
const tx=async promise=>(await promise).wait();
const proxy=(target,overrides)=>new Proxy(target,{get(object,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,vault,base,policy,state,periodSnapshot,addresses,deposits,broadcasts=0;
const readonly=overrides=>proxy(provider,{broadcastTransaction:async()=>{broadcasts++;throw Error('READ_ONLY_MUST_NOT_BROADCAST');},...overrides});
const mine=async count=>{for(let i=0;i<count;i++)await rpc.request({method:'evm_mine',params:[]});};
const stripRegistry=value=>{const copy=structuredClone(value);delete copy.daily.registry;return copy;};

function controller(extra={},initial=null){
 let progress=structuredClone(initial);const saves=[],commits=[];
 const callbacks={loadProgress:async()=>structuredClone(progress),saveProgress:async value=>{progress=structuredClone(value);saves.push(structuredClone(value));},commitJournal:async text=>{commits.push(text);}};
 return {saves,commits,get progress(){return structuredClone(progress);},run:more=>repairZeroMemberIndex({...base,primary:readonly(),candidate:readonly(),...callbacks,...extra,...more})};
}

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:12,unlockedAccounts:[fast.owner,fast.deployer]},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const who of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[who,'0x'+parseEther('10').toString(16)]});
 await rpc.request({method:'evm_setAccountNonce',params:[fast.deployer,'0x10']});
 const signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(value=>value.getAddress()));
 const deploy=async(name,args,signer=signers[0])=>{const a=artifact(name),value=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await value.waitForDeployment();return value;};
 const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]);
 const release={...fast,token:token.target,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
 vault=await deploy('FastTestnetVault',[release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations],await provider.getSigner(fast.deployer));
 const deploymentReport={hash:vault.deploymentTransaction().hash};deposits=[];
 for(const [index,amount]of [[1,'1000'],[2,'2000']]){
  if(index===2)await mine(510);
  await tx(token.mint(addresses[index],parseEther(amount)));await tx(token.connect(signers[index]).approve(vault.target,parseEther(amount)));
  deposits.push(await tx(vault.connect(signers[index]).deposit(token.target,parseEther(amount),ZeroAddress)));
 }
 await tx(token.mint(addresses[0],parseEther('500')));await tx(token.approve(vault.target,parseEther('500')));const fund=await tx(vault.connect(signers[0]).fundRewards(token.target,parseEther('500')));await mine(5);
 const original='TRADES_CHAIN_ID=97\nTRADES_RPC_URL="https://private.invalid/?key=private-rpc-secret"\nTRADES_VAULT_ADDRESS='+vault.target+'\nTRADES_PORT=3115\nTRADES_CONFIRMATIONS=3\nTRADES_LOG_PAGE_SIZE=20\nGLOBAL_MIGRATION_ENABLED=false\nTRADES_ZERO_START_PROFILE=global-fresh-fast-test-v1\nAPI_KEY="keep-private-key"\n';
 const prepared=await prepareZeroStartConnection({provider,artifact:artifact('FastTestnetVault'),release,deploymentReport,original,confirmations:3}),connectionReport={...prepared.report,siteConnected:true};
 const ready=await verifyZeroStartReadiness({provider,artifact:artifact('FastTestnetVault'),release,deploymentReport,connectionReport,original:prepared.env,confirmations:3,hourlyTest:true});
 policy=makeHourlyTestPolicy(ready);
 await rpc.request({method:'evm_increaseTime',params:[7202]});await mine(5);
 periodSnapshot=await blockAtTime(provider,policy.startTimestamp,ready.block,await provider.getBlockNumber());
 state={identity:{version:1,chainId:97,target:ready.target,owner:ready.owner,operator:ready.operator,queue:ready.queue,hash:ready.hash,runtimeHash:ready.runtimeHash},daily:{epoch:0,withdrawals:{through:3},lastChecked:'preserve-daily-metadata',registry:{through:periodSnapshot.number,hash:periodSnapshot.hash,members:{[addresses[1]]:deposits[0].blockNumber}}},activation:{block:policy.activationBlock,blockHash:policy.activationBlockHash,startTimestamp:policy.startTimestamp},transactions:{'old-confirmed-fund':{hash:fund.hash,block:fund.blockNumber,blockHash:fund.blockHash,maxFee:'17',raw:'preserve-signed-data'}},millionTestRewardGrant:{completed:true,marker:'keep-million-grant'},maxTotalFee:'100000000000000000'};
 base={artifact:artifact('FastTestnetVault'),release,original:prepared.env,deploymentText:JSON.stringify(deploymentReport),connectionText:JSON.stringify(connectionReport),policyText:JSON.stringify(policy),journalText:JSON.stringify(state),confirmations:3};
 assert.ok(periodSnapshot.number-policy.deploymentBlock>500);
 await assert.rejects(prepareZeroArchiveRpc({...base,primary:readonly(),candidate:readonly()}),/INCOMPLETE_DAILY_MEMBER_INDEX/);
},60000);
after(async()=>{assert.equal(broadcasts,0);await provider?.destroy();await rpc?.disconnect();});

test('a complete rebuild replaces only the registry after proving the original unpaid period',async()=>{
 const c=controller(),result=await c.run();
 assert.equal(result.status,'repaired');assert.equal(result.epoch,0);assert.equal(result.snapshot.block,periodSnapshot.number);assert.equal(result.snapshot.hash,periodSnapshot.hash);assert.equal(result.transactionsSent,0);assert.equal(result.signerOpened,false);
 assert.equal(c.commits.length,1);const replacement=JSON.parse(c.commits[0]);
 assert.deepEqual(stripRegistry(replacement),stripRegistry(state));assert.deepEqual(JSON.parse(base.journalText),state);assert.equal(base.policyText,JSON.stringify(policy));
 assert.equal(replacement.daily.registry.through,periodSnapshot.number);assert.equal(replacement.daily.registry.hash,periodSnapshot.hash);
 assert.deepEqual(replacement.daily.registry.members,{[addresses[1]]:deposits[0].blockNumber,[addresses[2]]:deposits[1].blockNumber});
 assert.equal(result.originalJournalSha256,digest(base.journalText));assert.equal(result.journalSha256,digest(c.commits[0]));
 assert.doesNotMatch(JSON.stringify(result),/private|secret|signed-data|https/);
});

test('a bounded pass persists complete auxiliary pages and resumes without replacing the original registry early',async()=>{
 const c=controller(),first=await c.run({maxPages:1});
 assert.equal(first.status,'in-progress');assert.equal(first.pages,1);assert.equal(c.saves.length,1);assert.equal(c.commits.length,0);assert.equal(c.progress.registry.through,policy.deploymentBlock+499);
 assert.deepEqual(c.progress.registry.members,{[addresses[1]]:deposits[0].blockNumber});assert.deepEqual(JSON.parse(base.journalText),state);
 const previous=c.progress,second=await c.run({maxPages:1});assert.equal(second.status,'repaired');assert.equal(second.pages,1);assert.equal(c.commits.length,1);
 assert.equal(c.saves.length,2);assert.equal(previous.registry.through,policy.deploymentBlock+499);assert.equal(c.progress.registry.through,periodSnapshot.number);assert.equal(c.progress.binding.epoch,0);
});

test('the elapsed-time start budget can yield without writing or discarding the saved cursor',async()=>{
 const c=controller();let calls=0;
 const result=await c.run({maxMilliseconds:1,now:()=>calls++===0?0:2});
 assert.equal(result.status,'in-progress');assert.equal(result.pages,0);assert.equal(c.saves.length,0);assert.equal(c.commits.length,0);assert.equal(result.through,policy.deploymentBlock-1);
});

test('progress binds every original input, selected candidate and exact snapshot',async()=>{
 const initial=controller();await initial.run({maxPages:1});const saved=initial.progress;
 for(const changes of [
  {journalText:JSON.stringify({...state,millionTestRewardGrant:{...state.millionTestRewardGrant,marker:'changed'}})},
  {policyText:JSON.stringify({...policy,operatorNote:'changed'})},
  {original:base.original+'EXTRA_PRIVATE_SETTING="changed"\n'},
  {deploymentText:JSON.stringify({...JSON.parse(base.deploymentText),operatorNote:'changed'})},
  {connectionText:JSON.stringify({...JSON.parse(base.connectionText),operatorNote:'changed'})},
  {candidateUrl:'https://candidate.invalid/new-private',candidateProof:{kind:'private',sha256:digest('https://candidate.invalid/new-private'),fileSha256:digest('new-file')}}
 ]){
  const c=controller({},saved);await assert.rejects(c.run(changes),/MEMBER_INDEX_REBUILD_BINDING_MISMATCH/);assert.equal(c.saves.length,0);assert.equal(c.commits.length,0);
 }
 const forged=structuredClone(saved);forged.binding.snapshot.hash='0x'+'44'.repeat(32);const c=controller({},forged);
 await assert.rejects(c.run(),/MEMBER_INDEX_REBUILD_BINDING_MISMATCH/);assert.equal(c.commits.length,0);
});

test('a failing old-log page retains complete progress and never commits a partial registration list',async()=>{
 const topic=vault.interface.getEvent('Registered').topicHash;
 const candidate=readonly({getLogs:async filter=>{if(filter.topics[0]===topic&&filter.fromBlock>policy.deploymentBlock+499)throw Object.assign(Error('private URL https://private.invalid/secret'),{code:'SERVER_ERROR'});return provider.getLogs(filter);}});
 const c=controller({candidate});
 await assert.rejects(c.run(),error=>{assert.equal(error.message,'COMPLETE_LOG_QUERY_FAILED');assert.doesNotMatch(inspect(error,{depth:10}),/https|private|secret/);return true;});
 assert.equal(c.saves.length,1);assert.equal(c.progress.registry.through,policy.deploymentBlock+499);assert.equal(c.commits.length,0);assert.deepEqual(JSON.parse(base.journalText),state);
 const recovered=await c.run({candidate:readonly()});assert.equal(recovered.status,'repaired');assert.equal(c.commits.length,1);
});

test('an exhausted old registration-log timeout yields the last saved page and resumes the same boundary',async()=>{
 const topic=vault.interface.getEvent('Registered').topicHash,firstEnd=policy.deploymentBlock+499,rebuildRanges=[];let failed=true,phase;
 const candidate=readonly({getLogs:async filter=>{
  if(phase==='MEMBER_INDEX_REBUILD'&&filter.topics[0]===topic)rebuildRanges.push({fromBlock:filter.fromBlock,toBlock:filter.toBlock});
  if(filter.topics[0]===topic&&filter.fromBlock>firstEnd&&failed)throw Object.assign(Error('private timeout at https://private.invalid/timeout-secret'),{code:'TIMEOUT'});
  return provider.getLogs(filter);
 }}),c=controller({candidate,onPhase:value=>{phase=value;}}),first=await c.run();
 assert.equal(first.status,'in-progress');assert.equal(first.waitingFor,'RPC_TIMEOUT');assert.equal(first.through,firstEnd);assert.equal(first.pages,1);assert.equal(first.members,1);assert.equal(first.epoch,0);assert.equal(first.snapshot.block,periodSnapshot.number);
 assert.equal(first.logProbeDiagnostic.operation,'eth_getLogs');assert.equal(first.logProbeDiagnostic.reason,'TIMEOUT');assert.equal(first.logProbeDiagnostic.errorCode,'TIMEOUT');assert.equal(first.logProbeDiagnostic.fromBlock,firstEnd+1);assert.equal(first.logProbeDiagnostic.toBlock,periodSnapshot.number);
 assert.equal(c.saves.length,1);assert.equal(c.progress.registry.through,firstEnd);assert.equal(c.commits.length,0);assert.deepEqual(JSON.parse(base.journalText),state);assert.doesNotMatch(inspect(first,{depth:10}),/private|secret|https/);
 const attempts=rebuildRanges.filter(value=>value.fromBlock===firstEnd+1);assert.equal(attempts.length,3);assert.ok(attempts.every(value=>value.toBlock===periodSnapshot.number));
 failed=false;rebuildRanges.length=0;const recovered=await c.run();
 assert.equal(recovered.status,'repaired');assert.equal(recovered.epoch,0);assert.equal(recovered.snapshot.block,periodSnapshot.number);assert.equal(c.commits.length,1);assert.equal(c.progress.registry.through,periodSnapshot.number);
 assert.deepEqual(rebuildRanges,[{fromBlock:firstEnd+1,toBlock:periodSnapshot.number}]);assert.deepEqual(stripRegistry(JSON.parse(c.commits[0])),stripRegistry(state));
});

test('a first-page registration-log timeout yields without saving an empty or partially read registry',async()=>{
 const topic=vault.interface.getEvent('Registered').topicHash,rebuildRanges=[];let failed=true,phase;
 const candidate=readonly({getLogs:async filter=>{
  if(phase==='MEMBER_INDEX_REBUILD'&&filter.topics[0]===topic){rebuildRanges.push({fromBlock:filter.fromBlock,toBlock:filter.toBlock});if(failed)throw Object.assign(Error('private timeout at https://private.invalid/first-page-secret'),{code:'TIMEOUT'});}
  return provider.getLogs(filter);
 }}),c=controller({candidate,onPhase:value=>{phase=value;}}),first=await c.run();
 assert.equal(first.status,'in-progress');assert.equal(first.waitingFor,'RPC_TIMEOUT');assert.equal(first.pages,0);assert.equal(first.members,0);assert.equal(first.through,policy.deploymentBlock-1);assert.equal(c.progress,null);assert.equal(c.saves.length,0);assert.equal(c.commits.length,0);
 assert.equal(first.logProbeDiagnostic.operation,'eth_getLogs');assert.equal(first.logProbeDiagnostic.reason,'TIMEOUT');assert.equal(first.logProbeDiagnostic.errorCode,'TIMEOUT');assert.equal(first.logProbeDiagnostic.fromBlock,policy.deploymentBlock);assert.equal(first.logProbeDiagnostic.toBlock,policy.deploymentBlock+499);assert.equal(rebuildRanges.length,3);
 assert.doesNotMatch(inspect(first,{depth:10}),/private|secret|https/);assert.deepEqual(JSON.parse(base.journalText),state);
 failed=false;rebuildRanges.length=0;const recovered=await c.run();assert.equal(recovered.status,'repaired');assert.equal(c.commits.length,1);assert.equal(recovered.epoch,0);assert.equal(rebuildRanges[0].fromBlock,policy.deploymentBlock);assert.equal(c.saves.length,2);
});

test('numeric block retries recover snapshot, cursor, page-anchor, end-header and pre-save canonical reads',async()=>{
 const seed=controller();await seed.run({maxPages:1});const saved=seed.progress,firstEnd=policy.deploymentBlock+499;
 const cases=[
  {name:'snapshot discovery',matches:({phase})=>phase==='MEMBER_INDEX_REBUILD_SNAPSHOT'},
  {name:'loaded cursor',initial:saved,matches:({loaded,number})=>loaded&&number===firstEnd},
  {name:'pre-page snapshot',matches:({phase,number,ordinal})=>phase==='MEMBER_INDEX_REBUILD'&&number===periodSnapshot.number&&ordinal===1},
  {name:'helper page anchor',matches:({phase,number,ordinal})=>phase==='MEMBER_INDEX_REBUILD'&&number===firstEnd&&ordinal===1},
  {name:'index end header',matches:({phase,number,ordinal})=>phase==='MEMBER_INDEX_REBUILD'&&number===firstEnd&&ordinal===3},
  {name:'post-page canonical',matches:({phase,number,ordinal})=>phase==='MEMBER_INDEX_REBUILD'&&number===periodSnapshot.number&&ordinal===2}
 ];
 for(const entry of cases){
  let phase,loaded=false,triggered=false,target,triggerIndex,failures=0;const calls=[],counts=new Map(),waits=[];
  const candidate=readonly({getBlock:async(number,...rest)=>{
   const key=phase+':'+number,ordinal=(counts.get(key)??0)+1;counts.set(key,ordinal);calls.push(number);
   if(!triggered&&entry.matches({phase,loaded,number,ordinal})){triggered=true;target=number;triggerIndex=calls.length-1;}
   if(triggered&&number===target&&failures<2){failures++;throw Object.assign(Error('private block timeout https://private.invalid/block-secret'),{code:'TIMEOUT'});}
   return provider.getBlock(number,...rest);
  }}),c=controller({candidate,onPhase:value=>{phase=value;},waitForBlockRetry:async ms=>waits.push(ms),loadProgress:async()=>{loaded=true;return structuredClone(entry.initial??null);}},entry.initial??null),result=await c.run();
  assert.equal(result.status,'repaired',entry.name);assert.equal(triggered,true,entry.name);assert.equal(failures,2,entry.name);assert.deepEqual(waits,[500,1500],entry.name);assert.deepEqual(calls.slice(triggerIndex,triggerIndex+3),[target,target,target],entry.name);assert.equal(c.commits.length,1,entry.name);assert.deepEqual(stripRegistry(JSON.parse(c.commits[0])),stripRegistry(state),entry.name);
 }
});

test('an exhausted saved-page block timeout waits with durable progress and resumes the same registration boundary',async()=>{
 const firstEnd=policy.deploymentBlock+499,topic=vault.interface.getEvent('Registered').topicHash,waits=[],ranges=[];let phase,stored=null,failed=true;const commits=[],saves=[];
 const candidate=readonly({getBlock:async(number,...rest)=>{
  if(failed&&stored&&phase==='MEMBER_INDEX_REBUILD'&&number===periodSnapshot.number)throw Object.assign(Error('private block timeout https://private.invalid/saved-page-secret'),{code:'TIMEOUT'});
  return provider.getBlock(number,...rest);
 },getLogs:async filter=>{if(phase==='MEMBER_INDEX_REBUILD'&&filter.topics[0]===topic)ranges.push({fromBlock:filter.fromBlock,toBlock:filter.toBlock});return provider.getLogs(filter);}}),c=controller({candidate,onPhase:value=>{phase=value;},waitForBlockRetry:async ms=>waits.push(ms),loadProgress:async()=>structuredClone(stored),saveProgress:async value=>{stored=structuredClone(value);saves.push(structuredClone(value));},commitJournal:async text=>commits.push(text)}),first=await c.run();
 assert.equal(first.status,'in-progress');assert.equal(first.waitingFor,'RPC_TIMEOUT');assert.equal(first.pages,1);assert.equal(first.through,firstEnd);assert.equal(first.members,1);assert.equal(saves.length,1);assert.equal(stored.registry.through,firstEnd);assert.equal(commits.length,0);assert.deepEqual(waits,[500,1500]);
 assert.deepEqual(first.blockReadDiagnostic,{operation:'getBlock',blockNumber:periodSnapshot.number,attempts:3,errorCode:'TIMEOUT',rpcCode:null,httpStatus:null,reason:'TIMEOUT'});assert.doesNotMatch(inspect(first,{depth:10}),/private|secret|https/);assert.deepEqual(JSON.parse(base.journalText),state);
 failed=false;ranges.length=0;const recovered=await c.run();assert.equal(recovered.status,'repaired');assert.equal(recovered.epoch,0);assert.equal(commits.length,1);assert.deepEqual(ranges,[{fromBlock:firstEnd+1,toBlock:periodSnapshot.number}]);assert.deepEqual(stripRegistry(JSON.parse(commits[0])),stripRegistry(state));
});

test('a pre-save block timeout never publishes or persists the candidate page as completed progress',async()=>{
 const firstEnd=policy.deploymentBlock+499;
 for(const entry of [{name:'post-page canonical',block:periodSnapshot.number,firstFailure:2,ranges:[{fromBlock:policy.deploymentBlock,toBlock:firstEnd}]},{name:'wrapped helper anchor',block:firstEnd,firstFailure:1,ranges:[]}]){
  const waits=[],ranges=[];let phase,targetReads=0,failed=true;
  const candidate=readonly({getBlock:async(number,...rest)=>{
   if(phase==='MEMBER_INDEX_REBUILD'&&number===entry.block){targetReads++;if(failed&&targetReads>=entry.firstFailure)throw Object.assign(Error('private pre-save timeout https://private.invalid/candidate-page-secret'),{code:'TIMEOUT'});}
   return provider.getBlock(number,...rest);
  },getLogs:async filter=>{if(phase==='MEMBER_INDEX_REBUILD')ranges.push({fromBlock:filter.fromBlock,toBlock:filter.toBlock});return provider.getLogs(filter);}}),c=controller({candidate,onPhase:value=>{phase=value;},waitForBlockRetry:async ms=>waits.push(ms)}),first=await c.run();
  assert.equal(first.status,'in-progress',entry.name);assert.equal(first.waitingFor,'RPC_TIMEOUT',entry.name);assert.equal(first.pages,0,entry.name);assert.equal(first.members,0,entry.name);assert.equal(first.through,policy.deploymentBlock-1,entry.name);assert.equal(c.progress,null,entry.name);assert.equal(c.saves.length,0,entry.name);assert.equal(c.commits.length,0,entry.name);assert.deepEqual(waits,[500,1500],entry.name);assert.equal(first.blockReadDiagnostic.blockNumber,entry.block,entry.name);assert.equal(first.blockReadDiagnostic.attempts,3,entry.name);assert.deepEqual(ranges,entry.ranges,entry.name);assert.doesNotMatch(inspect(first,{depth:10}),/private|secret|https/);
  failed=false;ranges.length=0;const recovered=await c.run();assert.equal(recovered.status,'repaired',entry.name);assert.equal(c.commits.length,1,entry.name);assert.equal(ranges[0].fromBlock,policy.deploymentBlock,entry.name);assert.deepEqual(JSON.parse(base.journalText),state);
 }
});

test('a prebinding block timeout fails with safe exact-block diagnostics and never starts a cache rebuild',async()=>{
 let phase,target;const waits=[],calls=[];
 const c=controller({onPhase:value=>{phase=value;},waitForBlockRetry:async ms=>waits.push(ms),candidate:readonly({getBlock:async(number,...rest)=>{
  if(phase==='MEMBER_INDEX_REBUILD_SNAPSHOT'){target??=number;calls.push(number);throw Object.assign(Error('private discovery timeout https://private.invalid/prebinding-secret'),{code:'TIMEOUT'});}
  return provider.getBlock(number,...rest);
 }})});
 await assert.rejects(c.run(),error=>{assert.equal(error.message,'MEMBER_INDEX_BLOCK_RPC_TIMEOUT');assert.deepEqual(error.blockReadDiagnostic,{operation:'getBlock',blockNumber:target,attempts:3,errorCode:'TIMEOUT',rpcCode:null,httpStatus:null,reason:'TIMEOUT'});assert.doesNotMatch(inspect(error,{depth:10}),/private|secret|https/);return true;});
 assert.deepEqual(calls,[target,target,target]);assert.deepEqual(waits,[500,1500]);assert.equal(c.saves.length,0);assert.equal(c.commits.length,0);assert.equal(c.progress,null);
});

test('nontransport block failures, invalid headers and persistence exceptions are never retried or softened',async()=>{
 const failures=[
  {info:{responseStatus:'401 Unauthorized'}},
  {info:{responseStatus:'429 Too Many Requests'}},
  {info:{responseStatus:'400 Bad Request'}},
  {info:{error:{code:-32603,message:'historical state unavailable'}}},
  {info:{error:{code:-32000,message:'missing trie node'}}},
  {info:{error:{code:-32600,message:'invalid request'}}}
 ];
 for(const details of failures){
  let loaded=false,attempts=0;const waits=[],c=controller({loadProgress:async()=>{loaded=true;return null;},waitForBlockRetry:async ms=>waits.push(ms),candidate:readonly({getBlock:async(number,...rest)=>{if(loaded&&number===periodSnapshot.number){attempts++;throw Object.assign(Error('private block request failed'),{code:'TIMEOUT',...details});}return provider.getBlock(number,...rest);}})});
  await assert.rejects(c.run(),error=>error.message!=='MEMBER_INDEX_BLOCK_RPC_TIMEOUT');assert.equal(attempts,1);assert.deepEqual(waits,[]);assert.equal(c.saves.length,0);assert.equal(c.commits.length,0);
 }
 for(const change of [()=>null,block=>({...block,number:block.number+1}),block=>({...block,hash:'invalid'}),block=>({...block,timestamp:-1}),block=>({...block,timestamp:undefined}),block=>({...block,hash:'0x'+'66'.repeat(32)})]){
  let loaded=false,attempts=0;const waits=[],c=controller({loadProgress:async()=>{loaded=true;return null;},waitForBlockRetry:async ms=>waits.push(ms),candidate:readonly({getBlock:async(number,...rest)=>{const block=await provider.getBlock(number,...rest);if(loaded&&number===periodSnapshot.number){attempts++;return change(block);}return block;}})});
  await assert.rejects(c.run(),/MEMBER_INDEX_BLOCK_HEADER_INVALID|MEMBER_INDEX_REBUILD_SNAPSHOT_REORG/);assert.equal(attempts,1);assert.deepEqual(waits,[]);assert.equal(c.saves.length,0);assert.equal(c.commits.length,0);
 }
 const waits=[],c=controller({waitForBlockRetry:async ms=>waits.push(ms),saveProgress:async()=>{throw Object.assign(Error('PERSISTENCE_TIMEOUT'),{code:'TIMEOUT'});}});
 await assert.rejects(c.run(),/PERSISTENCE_TIMEOUT/);assert.deepEqual(waits,[]);assert.equal(c.commits.length,0);assert.deepEqual(JSON.parse(base.journalText),state);
});

test('an index reset followed by a block timeout remains a hard checkpoint failure without saving the reset',async()=>{
 const seed=controller();await seed.run({maxPages:1});const saved=seed.progress,firstEnd=policy.deploymentBlock+499,waits=[];let phase,cursorReads=0,reset=false;
 const candidate=readonly({getBlock:async(number,...rest)=>{
  const block=await provider.getBlock(number,...rest);
  if(phase==='MEMBER_INDEX_REBUILD'&&number===firstEnd){
   cursorReads++;
   if(cursorReads===2){reset=true;return {...block,hash:'0x'+'77'.repeat(32)};}
   if(reset)throw Object.assign(Error('private timeout after reset https://private.invalid/reset-secret'),{code:'TIMEOUT'});
  }
  return block;
 }}),c=controller({candidate,onPhase:value=>{phase=value;},waitForBlockRetry:async ms=>waits.push(ms)},saved);
 await assert.rejects(c.run(),/MEMBER_INDEX_REBUILD_CHECKPOINT_REORG/);assert.equal(reset,true);assert.deepEqual(waits,[500,1500]);assert.equal(c.saves.length,0);assert.equal(c.commits.length,0);assert.deepEqual(c.progress,saved);assert.deepEqual(JSON.parse(base.journalText),state);
});

test('a fully scanned registry that still fails the principal invariant remains auxiliary',async()=>{
 const candidate=readonly({getLogs:async filter=>(await provider.getLogs(filter)).filter(log=>log.transactionHash!==deposits[1].hash)}),c=controller({candidate});
 await assert.rejects(c.run(),/INCOMPLETE_DAILY_MEMBER_INDEX/);assert.equal(c.progress.registry.through,periodSnapshot.number);assert.equal(c.commits.length,0);assert.ok(c.saves.length>=2);assert.deepEqual(JSON.parse(base.journalText),state);
});

test('snapshot changes and changed original inputs prevent a final replacement',async()=>{
 let switched=false;const c=controller({candidate:readonly({getBlock:async number=>{const block=await provider.getBlock(number);return switched&&number===periodSnapshot.number?{...block,hash:'0x'+'55'.repeat(32)}:block;}}),saveProgress:async()=>{switched=true;}});
 await assert.rejects(c.run(),/MEMBER_INDEX_REBUILD_SNAPSHOT_REORG/);assert.equal(c.commits.length,0);
 let changed=false;const d=controller({assertCurrent:async()=>{if(changed)throw Error('MEMBER_INDEX_REPAIR_PRIVATE_INPUT_CHANGED');},saveProgress:async()=>{changed=true;}});
 await assert.rejects(d.run(),/MEMBER_INDEX_REPAIR_PRIVATE_INPUT_CHANGED/);assert.equal(d.commits.length,0);
});

test('current-period used batch identifiers require reconciliation while prior confirmed journal entries remain intact',async()=>{
 const selector=vault.interface.getFunction('usedRewardBatch').selector,c=controller({candidate:readonly({call:async request=>request.to===vault.target&&request.data.startsWith(selector)?vault.interface.encodeFunctionResult('usedRewardBatch',[true]):provider.call(request)})});
 await assert.rejects(c.run(),/MEMBER_INDEX_REPAIR_REQUIRES_BATCH_RECONCILIATION/);assert.equal(c.commits.length,0);assert.equal(c.progress.registry.through,periodSnapshot.number);
 const reads=new Map();let recheckedAfterCompleteSet=false;
 const raced=controller({candidate:readonly({call:async request=>{
  if(request.to!==vault.target||!request.data.startsWith(selector))return provider.call(request);
  const id=vault.interface.decodeFunctionData('usedRewardBatch',request.data)[0],count=(reads.get(id)??0)+1;
  if(count>1)recheckedAfterCompleteSet=reads.size===4&&Array.from(reads.values()).every(value=>value===1);
  reads.set(id,count);return vault.interface.encodeFunctionResult('usedRewardBatch',[count>1]);
 }})});
 await assert.rejects(raced.run(),/MEMBER_INDEX_REPAIR_REQUIRES_BATCH_RECONCILIATION/);assert.equal(reads.size,4);assert.equal(Array.from(reads.values()).reduce((sum,value)=>sum+value,0),5);assert.equal(recheckedAfterCompleteSet,true);assert.equal(raced.commits.length,0);
 const credited=structuredClone(state);credited.daily.lastCredit={epoch:0,credited:[{id:'preserve-current-epoch-batch'}]};const current=controller();
 await assert.rejects(current.run({journalText:JSON.stringify(credited)}),/MEMBER_INDEX_REPAIR_REQUIRES_BATCH_RECONCILIATION/);assert.equal(current.commits.length,0);assert.equal(current.saves.length,0);
 const previous=structuredClone(state);previous.daily.epoch=1;previous.daily.lastCredit={epoch:0,credited:[{id:'preserve-prior-epoch-batch'}]};previous.transactions['daily-prior-confirmed']={...previous.transactions['old-confirmed-fund'],raw:'preserve-prior-epoch-signed-data'};
 const d=controller(),result=await d.run({journalText:JSON.stringify(previous)});assert.equal(result.status,'repaired');assert.deepEqual(JSON.parse(d.commits[0]).transactions,previous.transactions);
 assert.equal(result.epoch,1);assert.deepEqual(JSON.parse(d.commits[0]).daily.lastCredit,previous.daily.lastCredit);
});

test('current identifiers from larger old caches remain blocked when the replacement plan has fewer batches',async()=>{
 const original=structuredClone(state);
 for(let index=1;index<=101;index++)original.daily.registry.members[getAddress('0x'+(100000n+BigInt(index)).toString(16).padStart(40,'0'))]=periodSnapshot.number+1;
 const used=keccak256(toUtf8Bytes(['GLOBAL_HOURLY_TEST_V1',97,policy.vaultAddress.toLowerCase(),policy.startTimestamp,0,base.release.token.toLowerCase(),1].join(':'))),selector=vault.interface.getFunction('usedRewardBatch').selector,requested=[];
 const candidate=readonly({call:async request=>{
  if(request.to!==vault.target||!request.data.startsWith(selector))return provider.call(request);
  const id=vault.interface.decodeFunctionData('usedRewardBatch',request.data)[0];requested.push(id);return vault.interface.encodeFunctionResult('usedRewardBatch',[id===used]);
 }}),c=controller({candidate});
 await assert.rejects(c.run({journalText:JSON.stringify(original)}),/MEMBER_INDEX_REPAIR_REQUIRES_BATCH_RECONCILIATION/);
 assert.equal(c.commits.length,0);assert.equal(c.progress.registry.through,periodSnapshot.number);assert.equal(Object.keys(c.progress.registry.members).length,2);assert.ok(requested.includes(used));
 const plan=await planDailyEpoch({provider,vault,policy,state:{...original.daily,registry:c.progress.registry},epoch:0,confirmations:3});
 assert.equal(plan.status,'ready');assert.ok(plan.batches.length>0);assert.ok(plan.batches.every(batch=>batch.id!==used));assert.deepEqual(JSON.parse(base.journalText),state);
});

test('zero new profit rows still require unused current-period identifiers before replacing the cache',async()=>{
 const used=keccak256(toUtf8Bytes(['GLOBAL_HOURLY_TEST_V1',97,policy.vaultAddress.toLowerCase(),policy.startTimestamp,0,base.release.token.toLowerCase(),0].join(':'))),usedSelector=vault.interface.getFunction('usedRewardBatch').selector,rateSelector=vault.interface.getFunction('dailyTargetBps').selector,requested=[];
 const candidate=readonly({call:async request=>{
  if(request.to===vault.target&&request.data.startsWith(rateSelector))return vault.interface.encodeFunctionResult('dailyTargetBps',[0n]);
  if(request.to===vault.target&&request.data.startsWith(usedSelector)){const id=vault.interface.decodeFunctionData('usedRewardBatch',request.data)[0];requested.push(id);return vault.interface.encodeFunctionResult('usedRewardBatch',[id===used]);}
  return provider.call(request);
 }}),c=controller({candidate});
 await assert.rejects(c.run(),/MEMBER_INDEX_REPAIR_REQUIRES_BATCH_RECONCILIATION/);assert.equal(c.commits.length,0);assert.ok(requested.includes(used));assert.equal(c.progress.registry.through,periodSnapshot.number);
 const plan=await planDailyEpoch({provider:candidate,vault:new Contract(vault.target,base.artifact.abi,candidate),policy,state:{...state.daily,registry:c.progress.registry},epoch:0,confirmations:3});
 assert.equal(plan.status,'ready');assert.deepEqual(plan.batches,[]);assert.deepEqual(JSON.parse(base.journalText),state);
});

test('pending state never starts a rebuild and an already-complete journal needs no repair',async()=>{
 for(const mutate of [value=>{value.pending={saved:true};},value=>{value.oracle={pending:{label:'saved-oracle'}};},value=>{value.transactions.pending={raw:'saved-signed-data'};}]){
  const pending=structuredClone(state);mutate(pending);const c=controller();await assert.rejects(c.run({journalText:JSON.stringify(pending)}),/ARCHIVE_RPC_PENDING_TRANSACTION_REQUIRES_RECONCILIATION/);assert.equal(c.saves.length,0);assert.equal(c.commits.length,0);
 }
 const complete=structuredClone(state);complete.daily.registry.members[addresses[2]]=deposits[1].blockNumber;const c=controller(),result=await c.run({journalText:JSON.stringify(complete)});
 assert.equal(result.status,'not-required');assert.equal(c.saves.length,0);assert.equal(c.commits.length,0);
});
