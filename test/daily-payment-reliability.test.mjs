import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,keccak256,parseUnits} from 'ethers';
import {assertDailyJournalPlan,completeDailyPlan,dailyProfitAmount,executeDailyPlan,planDailyEpoch} from '../scripts/daily-profit.mjs';

const units=value=>parseUnits(value,6),tx=async promise=>(await promise).wait();
const proxy=(target,overrides)=>new Proxy(target,{get(object,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,signers,addresses,token,vault,policy,snapshot;
const advance=async seconds=>{await rpc.request({method:'evm_increaseTime',params:[seconds]});await rpc.request({method:'evm_mine',params:[]});};
const send=async(_label,request)=>tx(signers[0].sendTransaction(request));
const plan=(state={},activity,extra={})=>planDailyEpoch({provider,vault,policy,state,epoch:state.epoch??0,confirmations:0,activity,...extra});
const gate=(allowed,extra={})=>({binding:'activity-policy-fixture-v1',activationTimestamp:policy.startTimestamp,eligible:async member=>allowed.has(member),...extra});
const balances=()=>Promise.all(addresses.slice(1,4).map(member=>vault.accounts(member,token.target).then(row=>row.profit)));

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:12},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(signer=>signer.getAddress()));
 const deploy=async(name,args)=>{const artifact=JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));const contract=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signers[0]).deploy(...args);await contract.waitForDeployment();return contract;};
 token=await deploy('MockToken',[6]);const feed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('AutomaticGroupVault',[addresses[0],token.target,feed.target,feed.target,604800,addresses.slice(0,7),addresses[11]]);
 const deployment=await vault.deploymentTransaction().wait();
 for(const[index,capital]of [[1,'100'],[2,'1000'],[3,'100']]){
  const member=addresses[index];await tx(token.mint(member,units(capital)));await tx(token.connect(signers[index]).approve(vault.target,units(capital)));
  await tx(vault.connect(signers[index]).deposit(token.target,units(capital),index===1?ZeroAddress:addresses[index-1]));await tx(vault.setCustomerStatus(member,true,false));
 }
 await tx(token.mint(addresses[0],units('1000')));await tx(token.approve(vault.target,units('1000')));await tx(vault.fundRewards(token.target,units('1000')));
 policy={version:1,chainId:97,vaultAddress:vault.target,runtimeHash:keccak256(await provider.getCode(vault.target)),deploymentBlock:deployment.blockNumber,startTimestamp:(await provider.getBlock('latest')).timestamp+30,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true};
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('asset-unit arithmetic preserves exact rounding above the floating-point range',()=>{
 assert.equal(dailyProfitAmount(9007199254740993n,70n),63050394783186n);
 assert.equal(dailyProfitAmount(1000001n,70n),7000n);
 assert.equal(dailyProfitAmount(1n,1000n),0n);
 const maximum=(1n<<256n)-1n;assert.equal(dailyProfitAmount(maximum,1000n),maximum/10n);
 for(const[principal,rate]of [[-1n,50n],[maximum+1n,50n],[1,50n],[100n,1001n],[100n,-1n]])assert.throws(()=>dailyProfitAmount(principal,rate),/DAILY_CALCULATION_INPUT_INVALID/);
});

test('activity starts prospectively and leaves already-earned period amounts and IDs unchanged',async()=>{
 await advance(86431);const ordinary=await plan();let checked=0;
 const activity=gate(new Set(),{activationTimestamp:policy.startTimestamp+1,eligible:async()=>{checked++;return false;}});
 const preserved=await plan({},activity);
 assert.deepEqual(preserved.batches,ordinary.batches);assert.equal(preserved.activityRequired,false);assert.equal(checked,0);
 const state={epoch:0};await executeDailyPlan({provider,vault,plan:preserved,state,activity,transact:send});completeDailyPlan(state,preserved);
 assert.deepEqual(await balances(),['1.22','7.04','0.5'].map(units));
});

test('personal activity and referral activity are checked independently without compressing referral levels',async()=>{
 await advance(86431);const activity=gate(new Set([addresses[1],addresses[3]])),state={epoch:0},planned=await plan(state,activity);
 const personal=planned.batches.filter(batch=>!batch.kind).flatMap(batch=>batch.rows);
 assert.deepEqual(new Set(personal.map(row=>row.recipient)),new Set([addresses[1],addresses[3]]));
 const referrals=planned.batches.filter(batch=>batch.kind==='profit-referrals').flatMap(batch=>batch.rows);
 assert.equal(referrals.length,1);assert.equal(referrals[0].recipient,addresses[1]);assert.equal(referrals[0].amount,units('0.02').toString());assert.equal(referrals[0].sources[0].level,2);
 const before=await vault.ledgers(token.target);await executeDailyPlan({provider,vault,plan:planned,state,activity,transact:send});completeDailyPlan(state,planned);
 assert.deepEqual(await balances(),['0.52','0','0.5'].map(units));const after=await vault.ledgers(token.target);
 assert.equal(after.principal,before.principal);assert.equal(before.rewards-after.rewards,units('1.02'));
});

test('an empty skipped period completes once and a later check-in cannot backfill it through the journal',async()=>{
 await advance(2*86400+31);const allowed=new Set(),activity=gate(allowed),state={epoch:0};
 const skipped=await plan(state,activity);assert.equal(skipped.status,'ready');assert.deepEqual(skipped.batches,[]);
 let sends=0;const transact=async(label,request)=>{sends++;return send(label,request);};
 await executeDailyPlan({provider,vault,plan:skipped,state,activity,transact});completeDailyPlan(state,skipped);state.epoch++;
 allowed.add(addresses[2]);
 const next=await plan(state,activity);assert.equal(next.epoch,1);await executeDailyPlan({provider,vault,plan:next,state,activity,transact});completeDailyPlan(state,next);state.epoch++;
 assert.deepEqual(await balances(),['0','7','0'].map(units));assert.equal(sends,1);
 const old=await plan({},activity,{epoch:0});await assert.rejects(executeDailyPlan({provider,vault,plan:old,state,activity,transact}),/DAILY_EXECUTION_EPOCH_CHANGED/);
 assert.equal(sends,1);assert.equal(state.lastProcessedEpoch,1);
});

test('a crash after personal credit resumes frozen referrals without adding late activity or rereading account history',async()=>{
 await advance(86431);const allowed=new Set([addresses[1],addresses[2]]),activity=gate(allowed),state={epoch:0};
 const planned=await plan(state,activity);let durable,calls=0;
 const save=()=>{durable=structuredClone(state);};
 await assert.rejects(executeDailyPlan({provider,vault,plan:planned,state,save,activity,transact:async(label,request)=>{if(++calls===2)throw Error('SIMULATED_PROCESS_STOP');return send(label,request);}}),/SIMULATED_PROCESS_STOP/);
 assert.ok(durable.pendingDailyPlan);assert.equal(durable.epoch,0);assert.deepEqual(await balances(),['0.5','7','0'].map(units));
 allowed.add(addresses[3]);const restored=structuredClone(durable);
 const batch=planned.batches[1],request=await vault.batchProfit.populateTransaction(batch.id,batch.asset,batch.recipients,batch.amounts);
 assert.deepEqual(await assertDailyJournalPlan({provider,policy,state:restored,label:'daily-'+batch.id,request,activity}),planned);
 for(const patch of [{to:token.target},{value:1n},{data:'0x'}])await assert.rejects(assertDailyJournalPlan({provider,policy,state:restored,label:'daily-'+batch.id,request:{...request,...patch},activity}),/DAILY_PENDING_TRANSACTION_MISMATCH/);
 await assert.rejects(assertDailyJournalPlan({provider:proxy(provider,{getBlock:async()=>({hash:'0x'+'ab'.repeat(32)})}),policy,state:restored,label:'daily-'+batch.id,request,activity}),/DAILY_SNAPSHOT_REORG/);
 const historicalUnavailable=proxy(vault,{accounts:async()=>{throw Error('ARCHIVE_READ_MUST_NOT_REBUILD_PENDING_PLAN');},users:async()=>{throw Error('ARCHIVE_READ_MUST_NOT_REBUILD_PENDING_PLAN');}});
 const resumed=await plan(restored,activity,{vault:historicalUnavailable});assert.deepEqual(resumed,planned);
 let resumedSends=0;const result=await executeDailyPlan({provider,vault,plan:resumed,state:restored,activity,transact:async(label,request)=>{resumedSends++;return send(label,request);}});
 assert.equal(result[0].status,'already_credited');assert.equal(result[1].status,'credited');assert.equal(resumedSends,1);
 completeDailyPlan(restored,resumed);restored.epoch++;assert.equal(restored.pendingDailyPlan,undefined);assert.deepEqual(await balances(),['1.2','7','0'].map(units));
});

test('a frozen period rejects changed policy, changed activity, corrupted amounts and lost activity evidence before sending',async()=>{
 await advance(86431);const allowed=new Set(addresses.slice(1,4)),activity=gate(allowed),state={epoch:0},planned=await plan(state,activity);
 await assert.rejects(executeDailyPlan({provider,vault,plan:planned,state,activity,transact:async()=>{throw Error('STOP_BEFORE_BROADCAST');}}),/STOP_BEFORE_BROADCAST/);
 await assert.rejects(plan(state,{...activity,binding:'replacement-policy'}),/DAILY_ACTIVITY_POLICY_CHANGED/);
 await assert.rejects(plan(state,activity,{policy:{...policy,startTimestamp:policy.startTimestamp+1}}),/DAILY_PLAN_POLICY_CHANGED/);
 await assert.rejects(plan(state,undefined),/DAILY_ACTIVITY_POLICY_CHANGED/);
 const corrupt=structuredClone(state);corrupt.pendingDailyPlan.plan.batches[0].amounts[0]='1';await assert.rejects(plan(corrupt,activity),/DAILY_PLAN_CHECKPOINT_INVALID/);
 allowed.delete(addresses[2]);await assert.rejects(plan(state,activity),/DAILY_ACTIVITY_EVIDENCE_CHANGED/);
 assert.deepEqual(await balances(),[0n,0n,0n]);
});

test('failed durable save and a policy edit after static verification both prevent the first broadcast',async()=>{
 await advance(86431);const allowed=new Set(addresses.slice(1,4)),activity=gate(allowed),state={epoch:0},planned=await plan(state,activity);
 let broadcasts=0,saves=0;const transact=async(label,request)=>{broadcasts++;return send(label,request);};
 await assert.rejects(executeDailyPlan({provider,vault,plan:planned,state,activity,save:()=>{throw Error('DISK_WRITE_FAILED');},transact}),/DISK_WRITE_FAILED/);
 assert.equal(broadcasts,0);
 let guards=0;const changed={...activity,assertCurrent:()=>{if(++guards===2)throw Error('DAILY_ACTIVITY_POLICY_CHANGED');}};
 await assert.rejects(executeDailyPlan({provider,vault,plan:planned,state,activity:changed,save:()=>{saves++;},transact}),/DAILY_ACTIVITY_POLICY_CHANGED/);
 assert.equal(broadcasts,0);assert.equal(saves,1);
 await executeDailyPlan({provider,vault,plan:planned,state,activity,save:()=>{saves++;},transact});assert.equal(saves,2);assert.equal(broadcasts,2);
});

test('invalid or duplicated monetary rows cannot cause even a partial allocation',async()=>{
 await advance(86431);const planned=await plan();let broadcasts=0;
 const reject=async change=>{const malformed=structuredClone(planned);change(malformed);await assert.rejects(executeDailyPlan({provider,vault,plan:malformed,transact:async()=>{broadcasts++;}}),/DAILY_/);};
 await reject(value=>value.batches.push(structuredClone(value.batches[0])));
 await reject(value=>{value.batches[0].amounts[0]='0';});
 await reject(value=>{value.batches[0].amounts[0]='-1';});
 await reject(value=>{value.batches[0].amounts[0]=(1n<<256n).toString();});
 await reject(value=>{value.batches[0].rows[0].amount='1';});
 await reject(value=>{value.batches[1].rows[0].sources[0].personalProfit='1';});
 assert.equal(broadcasts,0);assert.deepEqual(await balances(),[0n,0n,0n]);
});

test('different spellings of the same asset cannot split the combined personal and referral funding check',async()=>{
 await advance(86431);const planned=await plan();assert.equal(planned.batches.length,2);
 planned.batches[1].asset=token.target.toLowerCase();
 // 8.00 personal + 0.76 referral exceeds the 8.50 remaining rewards budget.
 await tx(vault.connect(signers[4]).register(ZeroAddress));
 await tx(vault.batchProfit(keccak256('0x1234'),token.target,[addresses[4]],[units('991.5')]));
 let broadcasts=0;await assert.rejects(executeDailyPlan({provider,vault,plan:planned,transact:async()=>{broadcasts++;}}),/DAILY_PROFIT_FUNDING_REQUIRED/);
 assert.equal(broadcasts,0);assert.deepEqual(await balances(),[0n,0n,0n]);
});

test('installing a future activity gate preserves an ungated frozen partial period without reopening later skipped periods',async()=>{
 await advance(86431);const state={epoch:0},old=await plan(state);let calls=0,durable;
 await assert.rejects(executeDailyPlan({provider,vault,plan:old,state,save:()=>{durable=structuredClone(state);},transact:async(label,request)=>{if(++calls===2)throw Error('OLD_REFERRAL_PENDING');return send(label,request);}}),/OLD_REFERRAL_PENDING/);
 const restored=structuredClone(durable);let eligibilityReads=0,guards=0;
 const activity=gate(new Set(),{activationTimestamp:policy.startTimestamp+86400,eligible:async()=>{eligibilityReads++;return false;},assertCurrent:()=>{guards++;}});
 await assert.rejects(plan(restored,{...activity,activationTimestamp:policy.startTimestamp}),/DAILY_ACTIVITY_POLICY_CHANGED/);
 const resumed=await plan(restored,activity);assert.deepEqual(resumed,old);assert.equal(eligibilityReads,0);
 const result=await executeDailyPlan({provider,vault,plan:resumed,state:restored,activity,transact:send});assert.equal(result[0].status,'already_credited');assert.equal(result[1].status,'credited');assert.ok(guards>0);
 completeDailyPlan(restored,resumed);restored.epoch++;
 assert.deepEqual(await balances(),['1.22','7.04','0.5'].map(units));
 await advance(86400);const skipped=await plan(restored,activity);assert.deepEqual(skipped.batches,[]);assert.equal(skipped.activityRequired,true);assert.ok(eligibilityReads>0);
 await executeDailyPlan({provider,vault,plan:skipped,state:restored,activity,transact:async()=>{throw Error('SKIPPED_PERIOD_MUST_NOT_SEND');}});completeDailyPlan(restored,skipped);restored.epoch++;
 const late={...activity,eligible:async()=>true},oldSkipped=await plan({},late,{epoch:1});
 await assert.rejects(executeDailyPlan({provider,vault,plan:oldSkipped,state:restored,activity:late,transact:send}),/DAILY_EXECUTION_EPOCH_CHANGED/);assert.deepEqual(await balances(),['1.22','7.04','0.5'].map(units));
});
