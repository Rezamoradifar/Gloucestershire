// EXPERIMENTAL, read-only cycle proposal. No signing, network writes, cursor
// persistence or automatic recovery. A later worker must hold a shared lock
// through simulation, sending, confirmation and durable cursor checkpoint.
import {getAddress,ZeroAddress} from 'ethers';
import {checkUnifiedKeeper} from './check-v3-unified-keeper.mjs';
import {openUnifiedJournal} from './v3-unified-keeper-journal.mjs';

const hash=/^0x[0-9a-fA-F]{64}$/;
const cursor=value=>{
 if(!value||!['member','position','lot'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0))
  throw Error('INVALID_UNIFIED_SCHEDULER_CURSOR');
 return {member:value.member,position:value.position,lot:value.lot};
};
const same=(a,b)=>a.member===b.member&&a.position===b.position&&a.lot===b.lot;

// This function accepts ONLY a result directly produced by checkUnifiedKeeper;
// it does not authenticate arbitrary supplied objects and authorizes no action.
export function chooseUnifiedKeeperStep(preflight,expectedCursor){
 const initial=cursor(expectedCursor),plan=preflight?.plan;
 if(preflight?.chainId!==97||preflight.transactionSent!==false||preflight.siteUpdated!==false||
    !preflight.block||!Number.isSafeInteger(preflight.block.number)||preflight.block.number<1||
    !hash.test(String(preflight.block.hash))||getAddress(preflight.vault)===ZeroAddress||
    !plan||typeof plan.paused!=='boolean'||plan.transactionSent!==false||
    !Array.isArray(plan.selected)||plan.selected.length>100||
    !Number.isSafeInteger(plan.work)||plan.work<0||plan.work>100||plan.selected.length>plan.work||
    !same(cursor(plan.start),initial))throw Error('INVALID_UNIFIED_SCHEDULER_PREFLIGHT');
 const block={number:preflight.block.number,hash:preflight.block.hash};
 const base={chainId:97,vault:getAddress(preflight.vault),block,transactionSent:false,
  cursorPersisted:false,requiresBlockRecheck:true};
 if(plan.paused){
  if(plan.selected.length!==0||plan.work!==0||!same(cursor(plan.next),initial))
   throw Error('INVALID_UNIFIED_SCHEDULER_PAUSED');
  return {...base,state:'PAUSED',cursorToPersist:null};
 }
 if(plan.selected.length===0){
  return {...base,state:'NO_DUE_CANDIDATE',cursorToPersist:null,
   suggestedScanCursor:cursor(plan.next)};
 }
 const first=plan.selected[0];
 if(!first||!['accrueDaily','accrueReinvestmentPage'].includes(first.method)||
    !Array.isArray(first.args)||!Number.isSafeInteger(first.positionId)||first.positionId<0||
    getAddress(first.member)===ZeroAddress)throw Error('INVALID_UNIFIED_SCHEDULER_CANDIDATE');
 // Deliberately do not expose plan.next as safe to persist: later entries may
 // contain unsubmitted, failed or uncertain transactions.
 return {...base,state:'ONE_CANDIDATE_REQUIRES_CONFIRMATION',cursorToPersist:null,
  candidate:first,retryCursor:cursor(first.retryCursor),
  suggestedCursorAfterVerifiedConfirmation:cursor(first.nextCursor),
  additionalCandidatesDeferred:plan.selected.length-1};
}

export async function planUnifiedKeeperCycle({provider,proof,cursor:initial,journalDirectory,
 maxWork=20,maxResults=10,lotPageSize=8,makeContract}){
 const requested=cursor(initial),journal=openUnifiedJournal(journalDirectory);
 try{
  const record=journal.read();
  // Even a locally CONFIRMED journal record needs reconciliation against the
  // current chain and a durable checkpoint before any new worker may proceed.
  if(record)return {chainId:record.chainId,state:'JOURNAL_REQUIRES_RECONCILIATION',
   journalStatus:record.status,hash:record.hash,transactionSent:false,
   cursorPersisted:false,cursorToPersist:null};
  const preflight=await checkUnifiedKeeper({provider,proof,cursor:requested,maxWork,maxResults,lotPageSize,makeContract});
  return chooseUnifiedKeeperStep(preflight,requested);
 }finally{journal.close();}
}
