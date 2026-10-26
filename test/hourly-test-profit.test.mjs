import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,keccak256,parseEther as E,toUtf8Bytes} from 'ethers';
import {assertHourlyTestTarget,executeDailyPlan,hourlyTestPolicyFields,planDailyEpoch,validateDailyPolicy} from '../scripts/daily-profit.mjs';
import {makeHourlyTestPolicy,transitionHourlyTestPolicy} from '../scripts/zero-start-hourly-test.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const fast=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json'));
const tx=async promise=>(await promise).wait();
const proxy=(target,overrides)=>new Proxy(target,{get(object,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,owner,operator,signers,addresses,token,feed,vault,snapshot,baseReadiness;
const mine=async()=>{for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});};
const advance=async seconds=>{await rpc.request({method:'evm_increaseTime',params:[seconds]});await mine();};
const deploy=async(name,args,signer=signers[0])=>{const a=artifact(name),value=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await value.waitForDeployment();return value;};
const identity=ready=>({version:1,chainId:97,target:ready.target,owner:ready.owner,operator:ready.operator,queue:ready.queue,hash:ready.hash,runtimeHash:ready.runtimeHash});
const oldPolicy=ready=>validateDailyPolicy({...makeHourlyTestPolicy(ready),periodSeconds:86400,testMode:undefined,releaseId:undefined,testInterval:undefined,fastTestnetVersion:undefined});
const activation=policy=>({block:policy.activationBlock,blockHash:policy.activationBlockHash,startTimestamp:policy.startTimestamp});

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:12,unlockedAccounts:[fast.owner,fast.deployer]},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const address of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[address,'0x'+E('10').toString(16)]});
 owner=await provider.getSigner(fast.owner);operator=await provider.getSigner(fast.deployer);
 signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(value=>value.getAddress()));
 token=await deploy('MockToken',[18]);feed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('FastTestnetVault',[fast.owner,token.target,feed.target,feed.target,86400,addresses.slice(0,7),addresses[11]],operator);
 await tx(token.mint(addresses[1],E('100')));await tx(token.connect(signers[1]).approve(vault.target,E('100')));
 await tx(vault.connect(signers[1]).deposit(token.target,E('100'),ZeroAddress));
 await tx(token.mint(fast.deployer,E('1000')));await tx(token.connect(operator).approve(vault.target,E('1000')));await tx(vault.fundRewards(token.target,E('1000')));await mine();
 const receipt=await vault.deploymentTransaction().wait(),block=await provider.getBlock((await provider.getBlockNumber())-1);
 baseReadiness={version:1,chainId:97,target:vault.target,owner:fast.owner,operator:fast.deployer,queue:await vault.withdrawalQueue(),hash:receipt.hash,runtimeHash:keccak256(await provider.getCode(vault.target)),block:receipt.blockNumber,releaseId:fast.releaseId,testMode:true,initialServerReporter:true,fastTestnetVersion:1,siteConnected:true,checkpoint:{block:block.number,blockHash:block.hash,timestamp:block.timestamp}};
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('hourly policies require the exact fast test markers and remain testnet-only',async()=>{
 const policy=makeHourlyTestPolicy(baseReadiness);
 assert.equal(policy.periodSeconds,3600);assert.deepEqual(Object.fromEntries(Object.keys(hourlyTestPolicyFields).map(key=>[key,policy[key]])),hourlyTestPolicyFields);
 assert.equal(await assertHourlyTestTarget({provider,vault,policy}),true);
 for(const change of [{testMode:false},{releaseId:'global-fresh-zero-v1'},{testInterval:'daily'},{fastTestnetVersion:0}])assert.throws(()=>validateDailyPolicy({...policy,...change}),/HOURLY_TEST_POLICY_MARKERS_REQUIRED/);
 assert.throws(()=>validateDailyPolicy({...policy,chainId:56}),/MAINNET_DAILY_POLICY_REQUIRED/);
 assert.throws(()=>makeHourlyTestPolicy({...baseReadiness,initialServerReporter:false}),/VERIFIED_FAST_PROFILE_REQUIRED/);
 assert.throws(()=>makeHourlyTestPolicy({...baseReadiness,checkpoint:{...baseReadiness.checkpoint,blockHash:'0x00'}}),/CONFIRMED_CHECKPOINT_REQUIRED/);
 await assert.rejects(planDailyEpoch({provider:proxy(provider,{send:async()=> '0x38'}),vault,policy,state:{},epoch:0}),/TESTNET_ONLY/);
 const ordinary=await deploy('AutomaticGroupVault',[fast.owner,token.target,feed.target,feed.target,86400,addresses.slice(0,7),addresses[11]],operator);
 const ordinaryPolicy={...policy,vaultAddress:ordinary.target,runtimeHash:keccak256(await provider.getCode(ordinary.target))};
 await assert.rejects(assertHourlyTestTarget({provider,vault:ordinary,policy:ordinaryPolicy}),/HOURLY_TEST_FAST_TARGET_REQUIRED/);
});

test('a full plan percentage is credited after each full test hour and the same batch cannot be credited twice',async()=>{
 const policy=makeHourlyTestPolicy(baseReadiness),state={},requests=[];
 const options={provider,vault,policy,state,epoch:0,save:()=>{},confirmations:1};
 const transact=async(label,request)=>{requests.push(label);return tx(operator.sendTransaction(request));};
 assert.equal((await planDailyEpoch(options)).status,'not_due');
 await advance(3590);assert.equal((await planDailyEpoch(options)).status,'not_due');assert.equal((await vault.accounts(addresses[1],token.target)).profit,0n);
 await advance(11);
 const first=await planDailyEpoch(options);assert.equal(first.status,'ready');assert.equal(first.end-first.start,3600);
 const expected=E('100')*await vault.dailyTargetBps(addresses[1])/10000n;
 assert.equal(BigInt(first.batches[0].amounts[0]),expected);
 await executeDailyPlan({provider,vault,plan:first,transact});assert.equal((await vault.accounts(addresses[1],token.target)).profit,expected);
 assert.equal((await executeDailyPlan({provider,vault,plan:first,transact}))[0].status,'already_credited');assert.equal(requests.length,1);
 await advance(3600);const second=await planDailyEpoch({...options,epoch:1});assert.equal(second.start,first.end);assert.equal(second.end,first.end+3600);assert.notEqual(second.batches[0].id,first.batches[0].id);
 await executeDailyPlan({provider,vault,plan:second,transact});assert.equal((await vault.accounts(addresses[1],token.target)).profit,expected*2n);assert.equal(requests.length,2);
});

test('ordinary daily timing and existing batch identifiers remain unchanged',async()=>{
 const policy=oldPolicy(baseReadiness),state={};
 await advance(3601);assert.equal((await planDailyEpoch({provider,vault,policy,state,epoch:0,confirmations:1})).status,'not_due');
 await advance(82800);const daily=await planDailyEpoch({provider,vault,policy,state,epoch:0,confirmations:1});assert.equal(daily.status,'ready');assert.equal(daily.end-daily.start,86400);
 const expected=keccak256(toUtf8Bytes(['GLOBAL_DAILY_V1',97,vault.target.toLowerCase(),policy.startTimestamp,0,token.target.toLowerCase(),0].join(':')));
 assert.equal(daily.batches[0].id,expected);
 const hourly=await planDailyEpoch({provider,vault,policy:makeHourlyTestPolicy(baseReadiness),state:{},epoch:0,confirmations:1});assert.notEqual(hourly.batches[0].id,expected);
});

test('hourly transition preserves the financial journal, archives the unused old policy and starts at the current checkpoint',async()=>{
 const previous=oldPolicy(baseReadiness),originalActivation=activation(previous),completed=await provider.getBlock('latest');
 const journal={'oracle-refresh-1':{block:completed.number,blockHash:completed.hash,maxFee:E('0.07').toString(),hash:'0x'+'44'.repeat(32),raw:'saved-canonical-fixture'}};
 const state={identity:identity(baseReadiness),transactions:structuredClone(journal),daily:{epoch:0,registry:{through:previous.deploymentBlock-1,hash:null,members:{}}},activation:originalActivation};
 await advance(8000);const checkpoint=await provider.getBlock((await provider.getBlockNumber())-1),ready={...baseReadiness,checkpoint:{block:checkpoint.number,blockHash:checkpoint.hash,timestamp:checkpoint.timestamp}};
 let current=previous,archived,saves=0;
 const result=await transitionHourlyTestPolicy({provider,vault,readiness:ready,state,policy:current,save:()=>{saves++;},saveArchive:value=>{archived=structuredClone(value);},savePolicy:value=>{current=structuredClone(value);}});
 assert.equal(result.transitioned,true);assert.equal(current.startTimestamp,checkpoint.timestamp);assert.equal(current.periodSeconds,3600);assert.equal(state.daily.epoch,0);assert.deepEqual(state.transactions,journal);assert.equal(saves,2);
 assert.deepEqual(archived.policy,previous);assert.deepEqual(archived.activation,originalActivation);assert.deepEqual(archived.daily.registry,state.daily.registry);assert.deepEqual(state.activation,activation(current));assert.equal(state.hourlyTestTransition.status,'completed');
 const policyAtFirstStart=structuredClone(current);
 await advance(100);const second=await transitionHourlyTestPolicy({provider,vault,readiness:ready,state,policy:current,save:()=>{throw Error('UNEXPECTED_SAVE');},saveArchive:()=>{throw Error('UNEXPECTED_ARCHIVE');},savePolicy:()=>{throw Error('UNEXPECTED_POLICY');}});
 assert.equal(second.transitioned,false);assert.deepEqual(second.policy,policyAtFirstStart);
});

test('an interrupted policy replacement resumes the same start and preserves its archive',async()=>{
 const previous=oldPolicy(baseReadiness),state={identity:identity(baseReadiness),transactions:{},daily:{epoch:0},activation:activation(previous)};let current=previous,archived,saved;
 await advance(5000);const checkpoint=await provider.getBlock((await provider.getBlockNumber())-1),ready={...baseReadiness,checkpoint:{block:checkpoint.number,blockHash:checkpoint.hash,timestamp:checkpoint.timestamp}};
 const options={provider,vault,readiness:ready,state,save:()=>{saved=structuredClone(state);},saveArchive:value=>{if(archived)assert.deepEqual(archived,value);else archived=structuredClone(value);},savePolicy:value=>{current=structuredClone(value);throw Error('RESTART_AFTER_POLICY_REPLACEMENT');}};
 await assert.rejects(transitionHourlyTestPolicy({...options,policy:current}),/RESTART_AFTER_POLICY_REPLACEMENT/);
 assert.equal(saved.hourlyTestTransition.status,'prepared');assert.equal(current.periodSeconds,3600);
 const corrupt=structuredClone(saved);corrupt.hourlyTestTransition.activation.startTimestamp++;
 await assert.rejects(transitionHourlyTestPolicy({...options,state:corrupt,policy:current,save:()=>{throw Error('UNEXPECTED_SAVE');},savePolicy:()=>{throw Error('UNEXPECTED_POLICY');}}),/TRANSITION_STATE_MISMATCH/);
 const recovered=structuredClone(saved);
 await advance(1000);
 const result=await transitionHourlyTestPolicy({...options,state:recovered,policy:current,save:()=>{},savePolicy:value=>{current=structuredClone(value);}});
 assert.equal(result.policy.startTimestamp,checkpoint.timestamp);assert.equal(recovered.hourlyTestTransition.status,'completed');assert.deepEqual(recovered.activation,activation(current));
});

test('previous credits, pending signatures, changed identity and noncanonical checkpoints block a transition',async()=>{
 const previous=oldPolicy(baseReadiness),base={identity:identity(baseReadiness),transactions:{},daily:{epoch:0},activation:activation(previous)};
 await assert.rejects(transitionHourlyTestPolicy({provider,vault,readiness:baseReadiness,state:structuredClone(base),policy:JSON.parse(JSON.stringify({...previous,chainId:56})),save:()=>{throw Error('UNEXPECTED_SAVE');},saveArchive:()=>{throw Error('UNEXPECTED_ARCHIVE');},savePolicy:()=>{throw Error('UNEXPECTED_POLICY');}}),/HOURLY_TEST_POLICY_TARGET_MISMATCH/);
 const run=state=>transitionHourlyTestPolicy({provider,vault,readiness:baseReadiness,state,policy:previous,save:()=>{throw Error('UNEXPECTED_SAVE');},saveArchive:()=>{throw Error('UNEXPECTED_ARCHIVE');},savePolicy:()=>{throw Error('UNEXPECTED_POLICY');}});
 await assert.rejects(run({...structuredClone(base),transactions:{pending:{raw:'saved-signature'}}}),/PENDING_TRANSACTION_REQUIRED_FIRST/);
 await assert.rejects(run({...structuredClone(base),daily:{epoch:1}}),/PREVIOUS_CREDITS_REQUIRE_REVIEW/);
 await assert.rejects(run({...structuredClone(base),daily:{epoch:0,lastCredit:{epoch:0,credited:[]}}}),/PREVIOUS_CREDITS_REQUIRE_REVIEW/);
 const block=await provider.getBlock('latest');
 await assert.rejects(run({...structuredClone(base),transactions:{'daily-old':{block:block.number,blockHash:block.hash,maxFee:'0'}}}),/PREVIOUS_CREDITS_REQUIRE_REVIEW/);
 await assert.rejects(run({...structuredClone(base),identity:{...base.identity,target:addresses[5]}}),/JOURNAL_IDENTITY_MISMATCH/);
 await assert.rejects(run({...structuredClone(base),activation:{...base.activation,blockHash:'0x'+'11'.repeat(32)}}),/CONFIRMED_CHECKPOINT_REQUIRED/);
});

test('an already due unpaid daily period cannot be discarded at the hourly transition boundary',async()=>{
 const previous=oldPolicy(baseReadiness),state={identity:identity(baseReadiness),transactions:{},daily:{epoch:0},activation:activation(previous)};
 await advance(86400);
 const checkpoint=await provider.getBlock((await provider.getBlockNumber())-1);
 assert.equal(checkpoint.timestamp,previous.startTimestamp+86400);
 const ready={...baseReadiness,checkpoint:{block:checkpoint.number,blockHash:checkpoint.hash,timestamp:checkpoint.timestamp}};
 await assert.rejects(transitionHourlyTestPolicy({provider,vault,readiness:ready,state,policy:previous,save:()=>{throw Error('UNEXPECTED_SAVE');},saveArchive:()=>{throw Error('UNEXPECTED_ARCHIVE');},savePolicy:()=>{throw Error('UNEXPECTED_POLICY');}}),/HOURLY_TEST_UNPAID_PERIOD_REQUIRES_REVIEW/);
 assert.equal(state.hourlyTestTransition,undefined);assert.equal(state.daily.epoch,0);
});
