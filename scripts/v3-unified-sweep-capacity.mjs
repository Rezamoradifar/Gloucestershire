// Read-only snapshot measurement. This does not enable a keeper, predict future
// demand, guarantee completion time, or recover periods missed during outages.
import {DAILY_CAPITAL_PROFILE} from './v3-unified-release-pins.mjs';
import {scanUnifiedAccrual} from './scan-v3-unified-accrual.mjs';
import {verifyUnifiedDeployment,recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';

const initial=()=>({member:0,position:0,lot:0});
const isStart=c=>c.member===0&&c.position===0&&c.lot===0;

// The caller must pin vault/book reads to one validated canonical block and
// recheck that block after this function. Partial scans are never extrapolated.
export async function measureUnifiedSweepSnapshot({vault,book,blockNumber,blockTimestamp,
 maxTotalWork=10000,lotPageSize=8,dailyPlan=false}){
 if(!Number.isSafeInteger(maxTotalWork)||maxTotalWork<1||maxTotalWork>100000||
    !Number.isSafeInteger(lotPageSize)||lotPageSize<1||lotPageSize>8)
  throw Error('INVALID_UNIFIED_SWEEP_LIMIT');
 let cursor=initial(),work=0,proposals=0,pages=0,members;
 for(;;){
  const budget=Math.min(20,maxTotalWork-work);
  if(budget===0)return {state:'SCAN_LIMIT_REACHED',work,proposals,pages,members,
   complete:false,transactionSent:false};
  const plan=await scanUnifiedAccrual({vault,book,blockNumber,blockTimestamp,cursor,
   maxWork:budget,maxResults:budget,lotPageSize,dailyPlan});
  pages++;
  if(plan.paused)return {state:'PAUSED',work,proposals,pages,complete:false,transactionSent:false};
  if(members!==undefined&&plan.members!==members)throw Error('UNIFIED_SWEEP_SNAPSHOT_INCONSISTENT');
  members=plan.members;
  work+=plan.work;proposals+=plan.selected.length;
  if(plan.completed||members===0)return {state:'SNAPSHOT_COMPLETE',work,proposals,pages,members,
   complete:true,transactionSent:false};
  if(plan.work===0||isStart(plan.next))throw Error('UNIFIED_SWEEP_CURSOR_DID_NOT_ADVANCE');
  cursor=plan.next;
 }
}

// Independent deployment proof and canonical-block verification are mandatory.
export async function inspectUnifiedSweepCapacity({provider,proof,maxTotalWork=10000,lotPageSize=8,makeContract}){
 const verified=await verifyUnifiedDeployment(provider,proof,makeContract?{makeContract}:{});
 const dailyPlan=verified.proof.status===DAILY_CAPITAL_PROFILE.status;
 const snapshot=await measureUnifiedSweepSnapshot({vault:verified.vault,book:verified.book,
  blockNumber:verified.block.number,blockTimestamp:verified.block.timestamp,maxTotalWork,lotPageSize,dailyPlan});
 await recheckUnifiedBlock(provider,verified.block);
 return {...snapshot,chainId:97,vault:verified.proof.vault,block:verified.block,
  periodSeconds:dailyPlan?86400:3600,keeperReady:false,canGuaranteeTimelyCredits:false,
  reason:dailyPlan?'Eligible daily periods can be recorded after delays. A snapshot cannot guarantee future keeper capacity.':'Snapshot demand is not a future capacity guarantee; missed periods are not backfilled.'};
}
