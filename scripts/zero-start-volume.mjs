import {Interface,ZeroAddress,getAddress} from 'ethers';

const volumeInterface=new Interface(['function processNetworkVolume(uint256 job,uint256 steps)']);

const index=value=>{
 if(typeof value!=='bigint'&&!(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)))throw Error('ZERO_START_VOLUME_INDEX_REQUIRED');
 const result=BigInt(value);if(result<0n)throw Error('ZERO_START_VOLUME_INDEX_REQUIRED');return result;
};
const bounded=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const jobState=value=>{
 let child,ancestor,usd;
 try{child=getAddress(value.child);ancestor=getAddress(value.ancestor);usd=BigInt(value.usd);}catch{throw Error('ZERO_START_VOLUME_JOB_INVALID');}
 if(child===ZeroAddress||usd<=0n)throw Error('ZERO_START_VOLUME_JOB_INVALID');
 return {child,ancestor,usd};
};
const checkpoint=value=>{
 if(!Number.isSafeInteger(value?.block)||value.block<0||!/^0x[0-9a-f]{64}$/i.test(value.hash||''))throw Error('ZERO_START_VOLUME_CHECKPOINT_REQUIRED');
 return {block:value.block,hash:value.hash.toLowerCase()};
};

// Finish permissionless propagation in bounded transactions. Signing, fee limits,
// canonical receipts and interrupted signed-transaction recovery belong to transact.
export async function processZeroStartVolume({vault,provider,state,save=()=>{},transact,maxTransactions=4,maxScans=100,steps=64}){
 if(!bounded(maxTransactions,0,16)||!bounded(maxScans,1,1000)||!bounded(steps,1,64))throw Error('ZERO_START_VOLUME_LIMIT_INVALID');
 if(!state||typeof state!=='object'||Array.isArray(state)||typeof save!=='function'||(maxTransactions>0&&typeof transact!=='function'))throw Error('ZERO_START_VOLUME_STATE_REQUIRED');
 let target;try{target=getAddress(typeof vault.getAddress==='function'?await vault.getAddress():vault.target);}catch{throw Error('ZERO_START_VOLUME_TARGET_REQUIRED');}
 if(target===ZeroAddress)throw Error('ZERO_START_VOLUME_TARGET_REQUIRED');
 if(state.volume){
  let recordedTarget;try{recordedTarget=getAddress(state.volume.target);}catch{}
  if(state.volume.version!==1||recordedTarget!==target)throw Error('ZERO_START_VOLUME_STATE_TARGET_MISMATCH');
 }
 provider??=vault.runner?.provider??vault.runner;
 if(typeof provider?.getBlock!=='function')throw Error('ZERO_START_VOLUME_PROVIDER_REQUIRED');
 const canonical=async value=>{
  const observed=checkpoint(value),block=await provider.getBlock(observed.block);
  if(block?.hash?.toLowerCase()!==observed.hash)throw Error('ZERO_START_VOLUME_CHECKPOINT_REORG');
 };
 const head=async()=>{
  const block=await provider.getBlock('latest');
  return checkpoint({block:block?.number,hash:block?.hash});
 };
 if(state.volume?.checkpoint)await canonical(state.volume.checkpoint);
 else if(index(state.volume?.nextJob??'0')>0n)throw Error('ZERO_START_VOLUME_CHECKPOINT_REQUIRED');
 let anchor=await head();
 const count=index(await vault.volumeJobCount({blockTag:anchor.block}));
 let next=index(state.volume?.nextJob??'0');
 if(next>count)throw Error('ZERO_START_VOLUME_CURSOR_AHEAD');
 if(!state.volume)state.volume={version:1,target,nextJob:'0'};
 const remember=async(value,cursor=next)=>{
  // Never replace an orphaned prior anchor with a newer block: that would hide
  // an external completion reorg and permanently skip its unfinished job.
  if(state.volume.checkpoint)await canonical(state.volume.checkpoint);
  await canonical(value);
  state.volume.nextJob=cursor.toString();state.volume.checkpoint={...value};save();
 };
 await remember(anchor);
 const transactions=[];let scanned=0,processed=0;
 const advance=async()=>{await remember(anchor,next+1n);next++;processed++;};
 while(next<count&&scanned<maxScans){
  scanned++;
  const before=jobState(await vault.volumeJobs(next,{blockTag:anchor.block}));
  if(before.ancestor===ZeroAddress){await advance();continue;}
  if(transactions.length>=maxTransactions)break;
  await vault.processNetworkVolume.staticCall(next,steps);
  const request=await vault.processNetworkVolume.populateTransaction(next,steps);
  let requestMatches=false;
  try{requestMatches=getAddress(request.to)===target&&(request.value===undefined||BigInt(request.value)===0n)&&request.data.toLowerCase()===volumeInterface.encodeFunctionData('processNetworkVolume',[next,steps]);}catch{}
  if(!requestMatches)throw Error('ZERO_START_VOLUME_REQUEST_MISMATCH');
  const label='volume-'+next+'-'+before.ancestor.toLowerCase();
  const receipt=await transact(label,request);
  if(receipt?.status!==1||!/^0x[0-9a-f]{64}$/i.test(receipt.hash||''))throw Error('ZERO_START_VOLUME_NOT_CONFIRMED');
  anchor=await head();
  const after=jobState(await vault.volumeJobs(next,{blockTag:anchor.block}));
  if(after.usd!==before.usd)throw Error('ZERO_START_VOLUME_JOB_CHANGED');
  if(after.ancestor===before.ancestor)throw Error('ZERO_START_VOLUME_NO_PROGRESS');
  if(after.ancestor===ZeroAddress)await advance();else await remember(anchor);
  transactions.push({job:(after.ancestor===ZeroAddress?next-1n:next).toString(),fromAncestor:before.ancestor,nextAncestor:after.ancestor,hash:receipt.hash});
 }
 // A new deposit may queue a job while this run is working. Never report a
 // caught-up policy boundary until all jobs observed at completion are scanned.
 anchor=await head();
 const latestCount=index(await vault.volumeJobCount({blockTag:anchor.block}));
 if(latestCount<count||next>latestCount)throw Error('ZERO_START_VOLUME_JOB_COUNT_DECREASED');
 await remember(anchor);
 return {complete:next===latestCount,backlog:(latestCount-next).toString(),nextJob:next.toString(),count:latestCount.toString(),scanned,processed,transactions,checkpoint:{...state.volume.checkpoint}};
}
