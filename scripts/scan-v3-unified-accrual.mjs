// Read-only, bounded scan of the EXPERIMENTAL unified testnet vault. The
// caller MUST verify chain/deployment/book, confirm and recheck the block hash,
// and must not advance past a failed/unresolved transaction. No keys or sends.
import {getAddress,ZeroAddress} from 'ethers';
import {planUnifiedLotPage} from './plan-v3-unified-accrual.mjs';

const integer=(value,name)=>{
 const number=typeof value==='bigint'?Number(value):value;
 if(!Number.isSafeInteger(number)||number<0)throw Error('INVALID_UNIFIED_'+name);
 return number;
};
const amount=(value,name)=>{
 if(typeof value!=='bigint'||value<0n)throw Error('INVALID_UNIFIED_'+name);
 return value;
};
const copy=cursor=>({member:cursor.member,position:cursor.position,lot:cursor.lot});

export async function scanUnifiedAccrual({vault,book,blockNumber,blockTimestamp,cursor,
 maxWork=20,maxResults=10,lotPageSize=8}){
 integer(blockNumber,'BLOCK');integer(blockTimestamp,'BLOCK_TIME');
 if(!cursor||typeof cursor!=='object')throw Error('INVALID_UNIFIED_CURSOR');
 const at={blockTag:blockNumber};
 const current={member:integer(cursor.member,'MEMBER_CURSOR'),
  position:integer(cursor.position,'POSITION_CURSOR'),lot:integer(cursor.lot,'LOT_CURSOR')};
 if(!Number.isSafeInteger(maxWork)||maxWork<1||maxWork>100||
    !Number.isSafeInteger(maxResults)||maxResults<1||maxResults>maxWork||
    !Number.isSafeInteger(lotPageSize)||lotPageSize<1||lotPageSize>8)
  throw Error('INVALID_UNIFIED_SCAN_LIMIT');
 const start=copy(current),paused=await vault.paused(at);
 if(typeof paused!=='boolean')throw Error('INVALID_UNIFIED_PAUSED');
 if(paused)return {paused:true,start,next:copy(current),selected:[],work:0,transactionSent:false};
 const members=integer(await vault.memberCount(at),'MEMBER_COUNT');
 if(members===0){
  if(current.member||current.position||current.lot)throw Error('INVALID_UNIFIED_EMPTY_CURSOR');
  return {paused:false,members,start,next:copy(current),selected:[],work:0,transactionSent:false};
 }
 if(current.member>=members)throw Error('INVALID_UNIFIED_MEMBER_CURSOR');
 const selected=[];let work=0;
 while(current.member<members&&work<maxWork&&selected.length<maxResults){
  const user=getAddress(await vault.memberAt(current.member,at));
  if(user===ZeroAddress)throw Error('INVALID_UNIFIED_MEMBER');
  const eligible=await vault.isEligible(user,at);
  if(typeof eligible!=='boolean')throw Error('INVALID_UNIFIED_ELIGIBILITY');
  if(!eligible){current.member++;current.position=0;current.lot=0;work++;continue;}
  const count=integer(await vault.positionCount(user,at),'POSITION_COUNT');
  if(current.position>count)throw Error('INVALID_UNIFIED_POSITION_CURSOR');
  if(current.position===count){
   if(current.lot!==0)throw Error('INVALID_UNIFIED_LOT_CURSOR');
   current.member++;current.position=0;work++;continue;
  }
  const groupPlusOne=integer(await vault.reinvestmentPositionPlusOne(user,at),'GROUP_INDEX');
  if(groupPlusOne>count)throw Error('INVALID_UNIFIED_GROUP_INDEX');
  const id=current.position,p=await vault.positionOf(user,id,at);
  const principal=amount(p.principal,'PRINCIPAL');
  const basis=amount(p.compoundedBasis,'BASIS');
  const grouped=groupPlusOne===id+1;
  if(typeof p.fromReinvestment!=='boolean'||p.fromReinvestment!==grouped)
   throw Error('UNIFIED_POSITION_GROUP_MISMATCH');
  const bps=integer(await vault.effectiveDailyBps(user,at),'RATE');
  if(bps>10000)throw Error('INVALID_UNIFIED_RATE');
  const retry=copy(current);
  const advancePosition=()=>{
   current.position++;current.lot=0;
   if(current.position===count){current.member++;current.position=0;}
  };
  if(grouped){
   const summary=await book.position(user,at);
   if(amount(summary.principal,'BOOK_PRINCIPAL')!==principal||
      amount(summary.basis,'BOOK_BASIS')!==basis)throw Error('UNIFIED_BOOK_LEDGER_MISMATCH');
   const totalLots=integer(summary.lots,'LOT_COUNT');
   if(totalLots===0||current.lot>totalLots)throw Error('INVALID_UNIFIED_LOT_CURSOR');
   if(current.lot===totalLots){advancePosition();work++;continue;}
   const startLot=current.lot,length=Math.min(lotPageSize,totalLots-startLot);
   const lots=await Promise.all(Array.from({length},async(_,offset)=>{
    const lot=await book.lot(user,startLot+offset,at);
    return {id:startLot+offset,principal:amount(lot.principal,'LOT_PRINCIPAL'),
     basis:amount(lot.basis,'LOT_BASIS'),lastAccruedAt:integer(lot.lastAccruedAt,'LOT_TIME')};
   }));
   const plan=planUnifiedLotPage({wallet:user,start:startLot,totalLots,lots,
    now:blockTimestamp,rateBps:bps,eligible:true,paused:false,limit:lotPageSize});
   current.lot=plan.next;if(current.lot===totalLots)advancePosition();
   if(plan.proposal)selected.push({member:user,positionId:id,method:plan.proposal.method,
    args:plan.proposal.args,dueLots:plan.dueLots,daily:plan.daily,compound:plan.compound,
    retryCursor:retry,nextCursor:copy(current)});
  }else{
   if(current.lot!==0)throw Error('INVALID_UNIFIED_LOT_CURSOR');
   const last=integer(p.lastAccruedAt,'POSITION_TIME');
   if(last>Number.MAX_SAFE_INTEGER-3600)throw Error('INVALID_UNIFIED_POSITION_TIME');
   const daily=principal*BigInt(bps)/10000n,compound=basis*BigInt(bps)/10000n;
   advancePosition();
   if(principal>0n&&blockTimestamp>=last+3600&&daily+compound>0n)
    selected.push({member:user,positionId:id,method:'accrueDaily',args:[user,id],
     daily,compound,retryCursor:retry,nextCursor:copy(current)});
  }
  work++;
 }
 const completed=current.member===members;
 const next=completed?{member:0,position:0,lot:0}:copy(current);
 // An item ending the member list may contain member===members; normalize it
 // so a successfully processed final item is a valid persisted cursor.
 for(const item of selected)if(item.nextCursor.member===members)item.nextCursor={member:0,position:0,lot:0};
 return {paused:false,members,start,next,selected,work,completed,transactionSent:false};
}
