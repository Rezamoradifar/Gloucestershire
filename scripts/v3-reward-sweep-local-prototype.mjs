// LOCAL SIMULATION PROTOTYPE ONLY. No CLI, provider, key loader, installer or
// public-chain transaction path exists here. A production keeper must first
// add deployment/bytecode/chain proofs, durable journaling and gas controls.
import {getAddress,Interface} from 'ethers';

const EVENTS=new Interface([
 'event NetworkClaimAccrued(address indexed user,uint256 indexed group,uint256 amount,uint8 stages)'
]);
const count=(n,label)=>{
 const value=Number(n);
 if(!Number.isSafeInteger(value)||value<0||value>1000000)throw Error('INVALID_'+label);
 return value;
};
const cursorValue=cursor=>{
 if(!cursor||!Number.isSafeInteger(cursor.member)||cursor.member<0||
  !Number.isSafeInteger(cursor.group)||cursor.group<0)throw Error('INVALID_REWARD_CURSOR');
 return cursor;
};
const advance=(member,group,groups,members)=>group+1<groups?
 {member,group:group+1}:{member:(member+1)%members,group:0};
const confirmedRevert=e=>e?.code==='CALL_EXCEPTION'&&typeof e?.data==='string'&&/^0x[0-9a-f]{8,}$/i.test(e.data);

// Scan bounded slices. A deterministic EVM revert means the stage is not
// claimable in this snapshot. An RPC/transport failure stops the scan.
export async function scanRewardStages(vault,cursor,{maxMembers=50,maxGroups=100}={}){
 cursor=cursorValue(cursor);
 if(!Number.isSafeInteger(maxMembers)||maxMembers<1||maxMembers>100||
    !Number.isSafeInteger(maxGroups)||maxGroups<1||maxGroups>128)
  throw Error('INVALID_REWARD_SCAN_BOUNDS');
 if(await vault.paused())return {status:'PAUSED',next:cursor};
 const members=count(await vault.memberCount(),'MEMBER_COUNT');
 if(!members)return {status:'EMPTY',members:0,next:{member:0,group:0}};
 let member=cursor.member%members,group=cursor.group,visitedMembers=0,visitedGroups=0;
 while(visitedMembers<Math.min(maxMembers,members)&&visitedGroups<maxGroups){
  const who=getAddress(await vault.memberAt(member));
  const [eligible,enabled,rawGroups]=await Promise.all([
   vault.isEligible(who),vault.autoNetworkEnabled(who),vault.rewardGroupCount(who)
  ]);
  const groups=count(rawGroups,'GROUP_COUNT');
  if(!eligible||!enabled||group>=groups){
   member=(member+1)%members;group=0;visitedMembers++;continue;
  }
  while(group<groups&&visitedGroups<maxGroups){
   const progress=await vault.rewardProgress(who,group);
   const stage=count(progress.stage,'STAGE'),branches=count(progress.branches,'BRANCH_COUNT');
   if(stage>14)throw Error('INVALID_REWARD_STAGE');
   const next=advance(member,group,groups,members);
   visitedGroups++;
   if(stage<14&&branches===3){
    try{
     await vault.claimNetworkRewardsFor.staticCall(who,group,stage,1);
     return {status:'READY',members,scannedGroups:visitedGroups,
      candidate:{who,group,stage,count:1},next};
    }catch(e){if(!confirmedRevert(e))throw e;}
   }
   group++;
  }
  if(group>=groups){member=(member+1)%members;group=0;visitedMembers++;}
 }
 return {status:'NO_READY_STAGE',members,scannedGroups:visitedGroups,next:{member,group}};
}

// Explicit injection makes the simulation harness responsible for persisting
// an intent before broadcast and an atomic cursor after receipt verification.
// A thrown send/receipt error MUST leave the intent unresolved for review.
export async function runLocalSimulationSweep({vault,cursor,journal,send,options}){
 if(!journal||typeof journal.begin!=='function'||typeof journal.commit!=='function'||
  typeof send!=='function')throw Error('LOCAL_SIMULATION_CALLBACKS_REQUIRED');
 const plan=await scanRewardStages(vault,cursor,options);
 if(plan.status!=='READY')return plan;
 const item=plan.candidate;
 await journal.begin(item);
 const receipt=await send(item);
 if(!receipt||Number(receipt.status)!==1||!/^0x[0-9a-f]{64}$/i.test(receipt.hash??''))
  throw Error('REWARD_RECEIPT_REQUIRES_REVIEW');
 const target=getAddress(vault.target);
 let found=null;
 for(const log of receipt.logs??[]){
  if(getAddress(log.address)!==target)continue;
  try{
   const event=EVENTS.parseLog({topics:log.topics,data:log.data});
   if(event?.name==='NetworkClaimAccrued'&&getAddress(event.args.user)===item.who&&
      BigInt(event.args.group)===BigInt(item.group)&&BigInt(event.args.stages)===1n&&
      event.args.amount>0n){found=event;break;}
  }catch{/* Ignore unrelated logs. */}
 }
 if(!found)throw Error('REWARD_EVENT_REQUIRES_REVIEW');
 await journal.commit({item,next:plan.next,hash:receipt.hash,amount:found.args.amount.toString()});
 return {...plan,status:'CONFIRMED_LOCAL_SIMULATION',txHash:receipt.hash,amount:found.args.amount};
}
