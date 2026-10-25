import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,parseEther} from 'ethers';
import {prepareZeroStartConnection} from '../scripts/connect-zero-start.mjs';
import {verifyZeroStartReadiness} from '../scripts/zero-start-readiness.mjs';
import {makeHourlyTestPolicy} from '../scripts/zero-start-hourly-test.mjs';
import {blockAtTime} from '../scripts/daily-profit.mjs';
import {prepareZeroArchiveRpc,renderZeroArchiveRpcEnvironment,writeZeroArchiveRpcStage,zeroArchiveRpcUrl,zeroArchiveReadinessSummary,zeroArchiveReadinessMaxAttempts} from '../scripts/prepare-zero-archive-rpc.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const fast=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const proxy=(target,overrides)=>new Proxy(target,{get(object,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,vault,release,base,policy,state,periodSnapshot,addresses,broadcasts=0;
const mine=async count=>{for(let i=0;i<count;i++)await rpc.request({method:'evm_mine',params:[]});};
const tx=async promise=>(await promise).wait();
const unavailable=()=>Object.assign(Error('Private provider https://private.invalid/credential returned missing trie node'),{code:'CALL_EXCEPTION',info:{error:{code:-32603,message:'Never publish this private message'}}});
const blockNumber=tag=>typeof tag==='number'?tag:typeof tag==='string'&&/^0x/.test(tag)?Number(BigInt(tag)):null;
const readonly=overrides=>proxy(provider,{broadcastTransaction:async()=>{broadcasts++;throw Error('READ_ONLY_MUST_NOT_BROADCAST');},...overrides});
const prepare=extra=>prepareZeroArchiveRpc({...base,primary:readonly({call:async request=>{
 if(request.to===vault.target&&request.data.startsWith(vault.interface.getFunction('accounts').selector)&&blockNumber(request.blockTag)<=periodSnapshot.number&&blockNumber(request.blockTag)!==null)throw unavailable();
 return provider.call(request);
}}),candidate:readonly(),...extra});

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:12,unlockedAccounts:[fast.owner,fast.deployer]},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const who of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[who,'0x'+parseEther('10').toString(16)]});
 await rpc.request({method:'evm_setAccountNonce',params:[fast.deployer,'0x10']});
 const signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(value=>value.getAddress()));
 const deploy=async(name,args,signer=signers[0])=>{const a=artifact(name),value=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await value.waitForDeployment();return value;};
 const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]);
 release={...fast,token:token.target,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
 vault=await deploy('FastTestnetVault',[release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations],await provider.getSigner(fast.deployer));
 const deploymentReport={hash:vault.deploymentTransaction().hash};
 await tx(token.mint(addresses[1],parseEther('1000')));await tx(token.connect(signers[1]).approve(vault.target,parseEther('1000')));await tx(vault.connect(signers[1]).deposit(token.target,parseEther('1000'),ZeroAddress));
 await tx(token.mint(addresses[0],parseEther('500')));await tx(token.approve(vault.target,parseEther('500')));const fund=await tx(vault.connect(signers[0]).fundRewards(token.target,parseEther('500')));await mine(5);
 const original='TRADES_CHAIN_ID=97\nTRADES_RPC_URL="https://private.invalid/?key=private-rpc-secret"\nTRADES_VAULT_ADDRESS='+vault.target+'\nTRADES_PORT=3115\nTRADES_CONFIRMATIONS=3\nTRADES_LOG_PAGE_SIZE=20\nGLOBAL_MIGRATION_ENABLED=false\nTRADES_ZERO_START_PROFILE=global-fresh-fast-test-v1\nAPI_KEY="keep-private-key"\nMULTILINE="first\nTRADES_RPC_URL=inside-another-secret\nlast"\n';
 const prepared=await prepareZeroStartConnection({provider,artifact:artifact('FastTestnetVault'),release,deploymentReport,original,confirmations:3});
 const connectionReport={...prepared.report,siteConnected:true};
 const ready=await verifyZeroStartReadiness({provider,artifact:artifact('FastTestnetVault'),release,deploymentReport,connectionReport,original:prepared.env,confirmations:3,hourlyTest:true});
 policy=makeHourlyTestPolicy(ready);
 state={identity:{version:1,chainId:97,target:ready.target,owner:ready.owner,operator:ready.operator,queue:ready.queue,hash:ready.hash,runtimeHash:ready.runtimeHash},daily:{epoch:0},activation:{block:policy.activationBlock,blockHash:policy.activationBlockHash,startTimestamp:policy.startTimestamp},transactions:{'old-confirmed-fund':{hash:fund.hash,block:fund.blockNumber,blockHash:fund.blockHash,maxFee:'17',raw:'preserve-signed-data'}},millionTestRewardGrant:{completed:true,marker:'keep-million-grant'},maxTotalFee:'100000000000000000'};
 await rpc.request({method:'evm_increaseTime',params:[3601]});await mine(5);await rpc.request({method:'evm_increaseTime',params:[3601]});await mine(5);
 periodSnapshot=await blockAtTime(provider,policy.startTimestamp,ready.block,await provider.getBlockNumber());
 base={artifact:artifact('FastTestnetVault'),release,original:prepared.env,deploymentText:JSON.stringify(deploymentReport),connectionText:JSON.stringify(connectionReport),policyText:JSON.stringify(policy),journalText:JSON.stringify(state),confirmations:3};
});
after(async()=>{assert.equal(broadcasts,0);await provider?.destroy();await rpc?.disconnect();});

test('a candidate with the original unpaid-period archive prepares the same target, policy and journal without sending',async()=>{
 const old=await verifyZeroStartReadiness({provider:readonly({call:async request=>{
  if(request.to===vault.target&&request.data.startsWith(vault.interface.getFunction('accounts').selector)&&blockNumber(request.blockTag)!==null&&blockNumber(request.blockTag)<=periodSnapshot.number)throw unavailable();
  return provider.call(request);
 }}),artifact:base.artifact,release,deploymentReport:JSON.parse(base.deploymentText),connectionReport:JSON.parse(base.connectionText),original:base.original,policy,hourlyTest:true,periodStartTimestamp:policy.startTimestamp,confirmations:3});
 assert.equal(old.ready,false);assert.equal(old.archive.status,'unavailable');assert.ok(old.archive.probes.some(probe=>probe.purpose==='previous-hour-retention'&&probe.supported));
 const result=await prepare();assert.equal(result.stage.ready,true);assert.equal(result.stage.target,vault.target);assert.equal(result.stage.period.epoch,0);assert.equal(result.stage.period.startTimestamp,policy.startTimestamp);assert.equal(result.stage.period.periodSeconds,3600);
 assert.equal(result.stage.candidateRpcUrl,zeroArchiveRpcUrl);assert.equal(result.stage.transactionsSent,0);assert.equal(result.stage.signerOpened,false);
 assert.equal(result.stage.originalEnvSha256,hash(base.original));assert.equal(result.stage.stagedEnvSha256,hash(result.env));assert.equal(result.stage.journalSha256,hash(base.journalText));assert.equal(result.stage.policySha256,hash(base.policyText));
 assert.equal(result.readiness.ready,true);assert.equal(result.readiness.archive.fullyVerified,true);assert.ok(result.readiness.archive.probes.some(probe=>probe.requestedTimestamp===policy.startTimestamp&&probe.supported));
 assert.equal(result.stage.period.historicalLogProbe.fromBlock,JSON.parse(base.connectionText).block);assert.ok(result.stage.period.historicalLogProbe.count>=1);
 assert.doesNotMatch(JSON.stringify(result.stage)+JSON.stringify(result.readiness),/private-rpc-secret|keep-private-key|inside-another-secret|https:\/\/private/);
 assert.deepEqual(JSON.parse(base.journalText),state);assert.deepEqual(JSON.parse(base.policyText),policy);assert.equal(broadcasts,0);
});

test('only the RPC assignment is appended while original bytes and every other parsed key remain intact',()=>{
 for(const original of [base.original,base.original.replace(/\n$/,''),base.original+'TRADES_RPC_URL="'+zeroArchiveRpcUrl+'"\n']){
  const staged=renderZeroArchiveRpcEnvironment(original),before=parseEnv(original),after=parseEnv(staged);
  assert.equal(after.TRADES_RPC_URL,zeroArchiveRpcUrl);
  if(before.TRADES_RPC_URL===zeroArchiveRpcUrl)assert.equal(staged,original);
  else assert.equal(staged,original+(original.endsWith('\n')?'':'\n')+'TRADES_RPC_URL="'+zeroArchiveRpcUrl+'"\n');
  delete before.TRADES_RPC_URL;delete after.TRADES_RPC_URL;assert.deepEqual(after,before);
 }
});

test('wrong network and a conflicting current canonical anchor refuse preparation',async()=>{
 await assert.rejects(prepare({primary:readonly({send:async()=> '0x38'})}),/TESTNET_ONLY/);
 await assert.rejects(prepare({candidate:readonly({send:async()=> '0x38'})}),/TESTNET_ONLY/);
 const anchor=(await provider.getBlockNumber())-3;
 await assert.rejects(prepare({candidate:readonly({getBlock:async number=>{const block=await provider.getBlock(number);return number===anchor?{...block,hash:'0x'+'11'.repeat(32)}:block;}})}),/ARCHIVE_RPC_CURRENT_CHAIN_DISAGREEMENT/);
});

test('missing old account state or a changed current owner cannot qualify an archive candidate',async()=>{
 const accounts=vault.interface.getFunction('accounts').selector,owner=vault.interface.getFunction('owner').selector;
 const waits=[];
 await assert.rejects(prepare({availabilityWait:async ms=>waits.push(ms),candidate:readonly({call:async request=>{if(request.to===vault.target&&request.data.startsWith(accounts)&&blockNumber(request.blockTag)!==null&&blockNumber(request.blockTag)<=periodSnapshot.number)throw unavailable();return provider.call(request);}})}),error=>{
  assert.equal(error.message,'ARCHIVE_RPC_FULL_READINESS_REQUIRED');assert.equal(error.readinessAttempts,zeroArchiveReadinessMaxAttempts);
  const summary=error.readinessSummary;
  assert.deepEqual(summary.blockers,['ARCHIVE_RPC_REQUIRED_FOR_PERIOD_START_PRINCIPAL']);assert.equal(summary.fundingReady,true);assert.equal(summary.operatorGasPositive,true);
  const failed=summary.archive.probes.find(probe=>probe.purpose==='requested-period-start');
  assert.equal(failed.requestedTimestamp,policy.startTimestamp);assert.equal(failed.block,periodSnapshot.number);assert.equal(failed.supported,false);assert.equal(failed.error,'HISTORICAL_CONTRACT_STATE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(error),/private\.invalid|Never publish|credential|private-rpc-secret/);return true;
 });
 assert.deepEqual(waits,[250,500]);
 await assert.rejects(prepare({candidate:readonly({call:async request=>request.to===vault.target&&request.data===owner?vault.interface.encodeFunctionResult('owner',[addresses[7]]):provider.call(request)})}),/ZERO_START_CURRENT_OWNER_MISMATCH/);
});

test('readiness summaries retain actual safe reasons while excluding unknown strings and provider details',()=>{
 const summary=zeroArchiveReadinessSummary({ready:false,blockers:['SERVER_OPERATOR_TEST_BNB_REQUIRED','https://private.invalid/secret'],funding:{ready:true,url:'private-rpc-secret'},operatorGas:{positive:false},archive:{status:'unavailable',fullyVerified:false,requiredRetentionSeconds:3600,probes:[{purpose:'requested-period-start',requestedTimestamp:policy.startTimestamp,block:periodSnapshot.number,supported:false,error:'HISTORICAL_CONTRACT_STATE_UNAVAILABLE',message:'Never publish private provider error'},{purpose:'secret credential',requestedTimestamp:'private',block:'private',error:'https://private.invalid/secret',supported:false}]}});
 assert.deepEqual(summary.blockers,['SERVER_OPERATOR_TEST_BNB_REQUIRED','UNKNOWN_READINESS_BLOCKER']);assert.equal(summary.fundingReady,true);assert.equal(summary.operatorGasPositive,false);
 assert.equal(summary.archive.probes[0].purpose,'requested-period-start');assert.equal(summary.archive.probes[1].purpose,'unknown');assert.equal(summary.archive.probes[1].requestedTimestamp,null);assert.equal(summary.archive.probes[1].block,null);assert.equal(summary.archive.probes[1].error,null);
 assert.doesNotMatch(JSON.stringify(summary),/private|secret|credential|https|Never publish/);
});

test('a transient archive failure retries the same complete candidate proof without changing the unpaid period',async()=>{
 const accounts=vault.interface.getFunction('accounts').selector,waits=[];let failed=false;
 const candidate=readonly({call:async request=>{
  if(!failed&&request.to===vault.target&&request.data.startsWith(accounts)&&blockNumber(request.blockTag)!==null&&blockNumber(request.blockTag)<=periodSnapshot.number){failed=true;throw unavailable();}
  return provider.call(request);
 }});
 const result=await prepare({candidate,availabilityWait:async ms=>waits.push(ms)});
 assert.equal(failed,true);assert.deepEqual(waits,[250]);assert.equal(result.stage.readinessAttempts,2);assert.equal(result.readiness.ready,true);assert.equal(result.stage.policySha256,hash(base.policyText));assert.equal(result.stage.journalSha256,hash(base.journalText));assert.equal(result.stage.period.startTimestamp,policy.startTimestamp);assert.equal(result.stage.period.epoch,0);
});

test('availability timeouts are bounded while funding, identity and fork failures are never retried as archive availability',async()=>{
 let waits=0,attempts=0;
 await assert.rejects(prepare({availabilityWait:async()=>{waits++;},candidate:readonly({getBlockNumber:async()=>{attempts++;throw Object.assign(Error('private timeout message'),{code:'TIMEOUT'});}})}),error=>error.code==='TIMEOUT');
 assert.equal(attempts,zeroArchiveReadinessMaxAttempts);assert.equal(waits,zeroArchiveReadinessMaxAttempts-1);
 const cash=vault.interface.getFunction('assetBalance').selector;
 waits=0;
 await assert.rejects(prepare({availabilityWait:async()=>{waits++;},candidate:readonly({call:async request=>request.to===vault.target&&request.data.startsWith(cash)?vault.interface.encodeFunctionResult('assetBalance',[0n]):provider.call(request)})}),error=>{
  assert.equal(error.readinessAttempts,1);assert.equal(error.readinessSummary.fundingReady,false);assert.ok(error.readinessSummary.blockers.includes('FUNDED_DAILY_REWARD_BUDGET_REQUIRED'));return error.message==='ARCHIVE_RPC_FULL_READINESS_REQUIRED';
 });
 assert.equal(waits,0);
 const owner=vault.interface.getFunction('owner').selector;
 await assert.rejects(prepare({availabilityWait:async()=>{waits++;},candidate:readonly({call:async request=>request.to===vault.target&&request.data===owner?vault.interface.encodeFunctionResult('owner',[addresses[7]]):provider.call(request)})}),/ZERO_START_CURRENT_OWNER_MISMATCH/);assert.equal(waits,0);
 let switched=false,failed=false;const anchor=(await provider.getBlockNumber())-3,accounts=vault.interface.getFunction('accounts').selector;
 await assert.rejects(prepare({availabilityWait:async()=>{switched=true;},candidate:readonly({getBlock:async number=>{const block=await provider.getBlock(number);return switched&&number===anchor?{...block,hash:'0x'+'44'.repeat(32)}:block;},call:async request=>{if(!failed&&request.to===vault.target&&request.data.startsWith(accounts)&&blockNumber(request.blockTag)!==null&&blockNumber(request.blockTag)<=periodSnapshot.number){failed=true;throw unavailable();}return provider.call(request);}})}),/ARCHIVE_RPC_CURRENT_CHECKPOINT_REORG/);
});

test('a historical snapshot reorganization is fatal instead of being masked as retryable archive unavailability',async()=>{
 const accounts=vault.interface.getFunction('accounts').selector;let oldAccountRead=false,waits=0;
 const candidate=readonly({call:async request=>{
  const result=await provider.call(request);
  if(request.to===vault.target&&request.data.startsWith(accounts)&&blockNumber(request.blockTag)===periodSnapshot.number)oldAccountRead=true;
  return result;
 },getBlock:async number=>{const block=await provider.getBlock(number);return oldAccountRead&&number===periodSnapshot.number?{...block,hash:'0x'+'55'.repeat(32)}:block;}});
 await assert.rejects(prepare({candidate,availabilityWait:async()=>{waits++;}}),/ARCHIVE_CHECKPOINT_REORG/);
 assert.equal(oldAccountRead,true);assert.equal(waits,0);
});

test('historical registration logs are required even when the saved member index is already complete',async()=>{
 const copy=structuredClone(state),snapshot=await provider.getBlock(periodSnapshot.number);
 copy.daily.registry={through:snapshot.number,hash:snapshot.hash,members:{[addresses[1]]:JSON.parse(base.connectionText).block+1}};
 const topic=vault.interface.getEvent('Registered').topicHash;
 await assert.rejects(prepare({journalText:JSON.stringify(copy),candidate:readonly({getLogs:async filter=>{if(filter.topics?.[0]===topic)throw Object.assign(Error('private log RPC data'),{code:'UNKNOWN_ERROR',info:{error:{code:-32005}}});return provider.getLogs(filter);}})}),error=>error.code==='UNKNOWN_ERROR');
});

test('pending signed or planned state and changed policy identity are never reconciled by an RPC switch',async()=>{
 for(const mutate of [value=>{value.transactions.pending={raw:'saved signed data'};},value=>{value.oracle={pending:{label:'oracle-refresh-3'}};},value=>{value.pending={saved:true};}]){
  const copy=structuredClone(state);mutate(copy);await assert.rejects(prepare({journalText:JSON.stringify(copy)}),/ARCHIVE_RPC_PENDING_TRANSACTION_REQUIRES_RECONCILIATION/);
 }
 await assert.rejects(prepare({policyText:JSON.stringify({...policy,startTimestamp:policy.startTimestamp+1})}),/ARCHIVE_RPC_POLICY_CHECKPOINT_REQUIRED/);
 await assert.rejects(prepare({policyText:JSON.stringify({...policy,vaultAddress:addresses[7]})}),/ARCHIVE_RPC_POLICY_IDENTITY_MISMATCH/);
});

test('canonical journal and configuration changes during proof prevent a staged result',async()=>{
 const copy=structuredClone(state);copy.transactions['old-confirmed-fund'].blockHash='0x'+'22'.repeat(32);
 await assert.rejects(prepare({journalText:JSON.stringify(copy)}),/ZERO_START_COMPLETED_JOURNAL_NOT_CANONICAL/);
 await assert.rejects(prepare({assertCurrent:async()=>{throw Error('ARCHIVE_RPC_PRIVATE_INPUT_CHANGED');}}),/ARCHIVE_RPC_PRIVATE_INPUT_CHANGED/);
});

test('private output contains only the verified staged environment and proof, without changing inputs',async()=>{
 const result=await prepare(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'global-archive-stage-'));
 try{
  fs.chmodSync(directory,0o700);writeZeroArchiveRpcStage(directory,result);
  assert.deepEqual(fs.readdirSync(directory).sort(),['archive-rpc-stage.json','readiness.json','trades.env']);
  for(const name of fs.readdirSync(directory))assert.equal(fs.statSync(path.join(directory,name)).mode&0o777,0o600);
  assert.equal(fs.readFileSync(path.join(directory,'trades.env'),'utf8'),result.env);assert.equal(hash(fs.readFileSync(path.join(directory,'readiness.json'))),result.stage.readinessSha256);
  assert.equal(fs.readFileSync(path.join(directory,'archive-rpc-stage.json'),'utf8'),JSON.stringify(result.stage,null,2)+'\n');
  assert.throws(()=>writeZeroArchiveRpcStage(directory,result),/ARCHIVE_RPC_EMPTY_PRIVATE_OUTPUT_REQUIRED/);
  assert.equal(base.journalText,JSON.stringify(state));assert.equal(base.policyText,JSON.stringify(policy));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('invalid CLI arguments fail before opening configuration or a signer',()=>{
 const result=spawnSync(process.execPath,['scripts/prepare-zero-archive-rpc.mjs','--check','--fast-testnet','unexpected'],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,1);assert.match(result.stdout,/USAGE_ROOT_FAST_CHECK_OR_STAGE_PRIVATE_OUTPUT_REQUIRED/);assert.match(result.stdout,/"signerOpened":false/);assert.equal(result.stderr,'');
});
