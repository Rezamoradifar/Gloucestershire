import {getAddress} from 'ethers';
import {assertHourlyTestTarget,hourlyTestPolicyFields,isHourlyTestPolicy,validateDailyPolicy} from './daily-profit.mjs';

export {hourlyTestPolicyFields};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function makeHourlyTestPolicy(readiness){
 if(readiness?.version!==1||readiness.chainId!==97||readiness.releaseId!==hourlyTestPolicyFields.releaseId||readiness.testMode!==true||readiness.initialServerReporter!==true||readiness.fastTestnetVersion!==1||readiness.siteConnected!==true)throw Error('HOURLY_TEST_VERIFIED_FAST_PROFILE_REQUIRED');
 const c=readiness.checkpoint;
 if(!Number.isSafeInteger(c?.block)||c.block<readiness.block||!/^0x[0-9a-f]{64}$/i.test(c.blockHash||''))throw Error('HOURLY_TEST_CONFIRMED_CHECKPOINT_REQUIRED');
 return validateDailyPolicy({version:1,chainId:97,vaultAddress:getAddress(readiness.target),runtimeHash:readiness.runtimeHash,deploymentBlock:readiness.block,startTimestamp:c.timestamp,activationBlock:c.block,activationBlockHash:c.blockHash,basis:'period-start-active-principal',periodSeconds:3600,includeReinvestment:true,...hourlyTestPolicyFields});
}

function assertIdentity(readiness,state,policy){
 if(policy.chainId!==97||policy.vaultAddress!==getAddress(readiness.target)||policy.runtimeHash!==readiness.runtimeHash||policy.deploymentBlock!==readiness.block)throw Error('HOURLY_TEST_POLICY_TARGET_MISMATCH');
 const expected={version:1,chainId:97,target:readiness.target,owner:readiness.owner,operator:readiness.operator,queue:readiness.queue,hash:readiness.hash,runtimeHash:readiness.runtimeHash};
 if(!same(state.identity,expected))throw Error('HOURLY_TEST_JOURNAL_IDENTITY_MISMATCH');
}

async function assertActivation(provider,activation){
 if(!activation)return;
 const block=await provider.getBlock(activation.block);
 if(block?.hash!==activation.blockHash||(activation.startTimestamp!==undefined&&block.timestamp!==activation.startTimestamp))throw Error('HOURLY_TEST_CONFIRMED_CHECKPOINT_REQUIRED');
}

async function assertJournalReady(provider,state){
 for(const [label,entry] of Object.entries(state.transactions||{})){
  if(!Number.isSafeInteger(entry.block)||entry.block<1)throw Error('HOURLY_TEST_PENDING_TRANSACTION_REQUIRED_FIRST');
  if(!/^0x[0-9a-f]{64}$/i.test(entry.blockHash||'')||(await provider.getBlock(entry.block))?.hash!==entry.blockHash)throw Error('HOURLY_TEST_JOURNAL_CHECKPOINT_REORG');
  if(label.startsWith('daily-'))throw Error('HOURLY_TEST_PREVIOUS_CREDITS_REQUIRE_REVIEW');
 }
 if((state.daily?.epoch||0)!==0||state.daily?.lastCredit||state.hourlyTestHistory)throw Error('HOURLY_TEST_PREVIOUS_CREDITS_REQUIRE_REVIEW');
}

// A saved transition intent makes a policy-file replacement recoverable without
// changing journal reservations or choosing another start time after a restart.
export async function transitionHourlyTestPolicy({provider,vault,readiness,state,policy,save,saveArchive,savePolicy}){
 policy=validateDailyPolicy(policy);
 const candidate=makeHourlyTestPolicy(readiness);
 assertIdentity(readiness,state,policy);
 await assertHourlyTestTarget({provider,vault,policy:isHourlyTestPolicy(policy)?policy:candidate});
 const existing=state.hourlyTestTransition;
 if(isHourlyTestPolicy(policy)&&!existing){await assertActivation(provider,state.activation||{block:policy.activationBlock,blockHash:policy.activationBlockHash,startTimestamp:policy.startTimestamp});return {policy,transitioned:false};}
 if(existing?.status==='completed'){
  if(!same(policy,existing.policy)||!same(state.activation,existing.activation))throw Error('HOURLY_TEST_TRANSITION_STATE_MISMATCH');
  await assertActivation(provider,existing.activation);
  return {policy,transitioned:false};
 }
 await assertJournalReady(provider,state);
 let intent=existing;
 if(intent){
  if(intent.version!==1||intent.status!=='prepared'||!same(intent.identity,state.identity)||(!same(policy,intent.previousPolicy)&&!same(policy,intent.policy)))throw Error('HOURLY_TEST_TRANSITION_STATE_MISMATCH');
  validateDailyPolicy(intent.policy);
  if(!isHourlyTestPolicy(intent.policy)||intent.policy.vaultAddress!==policy.vaultAddress||intent.policy.runtimeHash!==policy.runtimeHash||intent.policy.deploymentBlock!==policy.deploymentBlock||intent.policy.activationBlock!==intent.activation?.block||intent.policy.activationBlockHash!==intent.activation?.blockHash||intent.policy.startTimestamp!==intent.activation?.startTimestamp||!same(state.daily??{epoch:0},intent.previousDaily))throw Error('HOURLY_TEST_TRANSITION_STATE_MISMATCH');
 }else{
  if(policy.periodSeconds!==86400)throw Error('HOURLY_TEST_PREVIOUS_POLICY_REQUIRED');
  await assertActivation(provider,state.activation||(policy.activationBlockHash?{block:policy.activationBlock,blockHash:policy.activationBlockHash,startTimestamp:policy.startTimestamp}:null));
  const checkpoint=await provider.getBlock(candidate.activationBlock);
  if(checkpoint?.hash!==candidate.activationBlockHash||checkpoint.timestamp!==candidate.startTimestamp||candidate.startTimestamp<policy.startTimestamp)throw Error('HOURLY_TEST_CONFIRMED_CHECKPOINT_REQUIRED');
  if(candidate.startTimestamp>=policy.startTimestamp+policy.periodSeconds)throw Error('HOURLY_TEST_UNPAID_PERIOD_REQUIRES_REVIEW');
  intent={version:1,status:'prepared',identity:structuredClone(state.identity),previousPolicy:structuredClone(policy),previousActivation:structuredClone(state.activation??null),previousDaily:structuredClone(state.daily??{epoch:0}),policy:candidate,activation:{block:candidate.activationBlock,blockHash:candidate.activationBlockHash,startTimestamp:candidate.startTimestamp}};
  state.hourlyTestTransition=intent;await save();
 }
 const checkpoint=await provider.getBlock(intent.activation.block);
 if(checkpoint?.hash!==intent.activation.blockHash||checkpoint.timestamp!==intent.activation.startTimestamp)throw Error('HOURLY_TEST_CONFIRMED_CHECKPOINT_REQUIRED');
 const archive={version:1,kind:'pre-hourly-fast-test-policy',identity:intent.identity,policy:intent.previousPolicy,activation:intent.previousActivation,daily:intent.previousDaily,replacementPolicy:intent.policy};
 await saveArchive(archive);
 await savePolicy(intent.policy);
 state.activation=structuredClone(intent.activation);
 state.daily={...structuredClone(intent.previousDaily),epoch:0};
 delete state.daily.lastCredit;
 intent.status='completed';await save();
 return {policy:structuredClone(intent.policy),transitioned:true};
}
