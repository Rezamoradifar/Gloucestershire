// One withdrawal form over verified records. Existing contract positions remain
// separate; a request must fit exactly one ordinary position or one book window.
import {formatUnits,getAddress} from 'ethers';
import type {V3Snapshot,V3WalletPosition} from './v3-chain';
import {prepareV3WithdrawalRequest,parseV3Amount,type V3WithdrawalKind} from './v3-withdrawal-form';
import type {UnifiedPositionPage,UnifiedLot} from './v3-unified-position';
import {MAX_UNIFIED_WITHDRAWAL_LOTS,unifiedWithdrawalWindow} from './v3-unified-position';

export {MAX_UNIFIED_WITHDRAWAL_LOTS};
const LOCK=90*86400,WINDOW=8;
const validTime=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const units=(n:unknown):n is bigint=>typeof n==='bigint'&&n>=0n;
const min=(a:bigint,b:bigint)=>a<b?a:b;
type Source={position:V3WalletPosition;profit:bigint;principal:bigint;page?:UnifiedPositionPage};
export type V3AccountWithdrawalPlan=
 |{source:'position';action:ReturnType<typeof prepareV3WithdrawalRequest>}
 |{source:'book';kind:'profit'|'principal';amount:bigint;page:UnifiedPositionPage};

export function v3AccountTotals(positions:V3WalletPosition[]){
 if(positions.length>100)throw Error('The complete verified account is required.');
 const ordered=[...positions].sort((a,b)=>a.id-b.id);
 let principal=0n,daily=0n,compound=0n,pendingProfit=0n;
 for(let index=0;index<ordered.length;index++){
  const p=ordered[index];
  if(p.id!==index||!Number.isSafeInteger(p.id)||
   [p.principal,p.reservedPrincipal,p.availableProfit,p.availableDaily,p.availableCompound,
    p.reservedProfit,p.compoundedBasis].some(value=>!units(value))||
   p.reservedPrincipal>p.principal||p.availableProfit!==p.availableDaily+p.availableCompound||
   p.compoundedBasis!==p.availableProfit||!validTime(p.openedAt)||!validTime(p.lastAccruedAt)||
   p.openedAt>p.lastAccruedAt||p.openedAt>Number.MAX_SAFE_INTEGER-LOCK)
   throw Error('The verified account records do not reconcile.');
  principal+=p.principal;daily+=p.availableDaily;compound+=p.availableCompound;pendingProfit+=p.reservedProfit;
 }
 return {principal,daily,compound,profit:daily+compound,pendingProfit};
}

export function unifiedLots(view:V3Snapshot,group:V3WalletPosition){
 if(view.withdrawalCoverageError)throw Error(view.withdrawalCoverageError);
 const selected=view.withdrawalPage;
 const pages=selected?[selected]:view.unifiedWithdrawalPages;
 if(!pages?.length)throw Error('Complete withdrawal records are still loading. Refresh the account before continuing.');
 const ordered=[...pages].sort((a,b)=>a.start-b.start),first=ordered[0];
 const large=first.totalLots>MAX_UNIFIED_WITHDRAWAL_LOTS;
 if(!Number.isSafeInteger(first.totalLots)||first.totalLots<1||large!==Boolean(selected))
  throw Error('This account exceeds the supported withdrawal scan of '+MAX_UNIFIED_WITHDRAWAL_LOTS+' additions. No partial withdrawal limit is shown.');
 const offset=selected?.start??0;
 const size=selected?unifiedWithdrawalWindow(view.singleCapital):WINDOW;
 if(!Number.isSafeInteger(offset)||offset<0||offset>=first.totalLots)throw Error('Invalid withdrawal page start.');
 const lots:UnifiedLot[]=[];
 for(const page of ordered){
  if(getAddress(page.wallet)!==getAddress(view.wallet)||page.block!==view.block||page.asOf!==view.asOf||
   page.positionId!==group.id||page.totalLots!==first.totalLots||page.start!==offset+lots.length||page.limit!==size||
   page.lots.length!==Math.min(size,page.totalLots-page.start)||
   page.principal!==group.principal||page.daily!==group.availableDaily||page.compound!==group.availableCompound||
   page.reservedProfit!==group.reservedProfit)
   throw Error('Withdrawal records must cover the complete account at one verified block.');
  let profit=0n,matured=0n;
  for(const lot of page.lots){
   if(lot.id!==offset+lots.length||[lot.principal,lot.reservedPrincipal,lot.daily,lot.compound,lot.basis,lot.reservedProfit].some(value=>!units(value))||
    lot.reservedPrincipal>lot.principal||lot.basis!==lot.daily+lot.compound||
    !validTime(lot.openedAt)||!validTime(lot.lastAccruedAt)||lot.openedAt>lot.lastAccruedAt||lot.lastAccruedAt>view.asOf||
    lot.openedAt>Number.MAX_SAFE_INTEGER-LOCK||lot.unlockAt!==lot.openedAt+LOCK)
    throw Error('The verified withdrawal additions do not reconcile.');
   profit+=lot.daily+lot.compound;
   if(view.asOf>=lot.unlockAt)matured+=lot.principal-lot.reservedPrincipal;
   lots.push(lot);
  }
  if(profit!==page.availableProfitOnPage||matured!==page.maturedPrincipalOnPage)
   throw Error('The verified withdrawal page balance is inconsistent.');
 }
 if(!large&&lots.length!==first.totalLots)throw Error('Complete withdrawal records are still loading. Refresh the account before continuing.');
 const sum=lots.reduce((total,lot)=>({principal:total.principal+lot.principal,reservedPrincipal:total.reservedPrincipal+lot.reservedPrincipal,
  daily:total.daily+lot.daily,compound:total.compound+lot.compound,reservedProfit:total.reservedProfit+lot.reservedProfit}),
 {principal:0n,reservedPrincipal:0n,daily:0n,compound:0n,reservedProfit:0n});
 const reconciles=(part:bigint,total:bigint)=>large?part<=total:part===total;
 if(!reconciles(sum.principal,group.principal)||!reconciles(sum.reservedPrincipal,group.reservedPrincipal)||
  !reconciles(sum.daily,group.availableDaily)||!reconciles(sum.compound,group.availableCompound)||!reconciles(sum.reservedProfit,group.reservedProfit))
  throw Error('The complete withdrawal additions do not match the account totals.');
 return {lots,first};
}

function withdrawalSources(view:V3Snapshot,unified:boolean){
 const totals=v3AccountTotals(view.positions);
 if(!validTime(view.block)||view.block===0||!validTime(view.asOf)||!validTime(view.nextRequestAt)||!units(view.ledger.requestCap))
  throw Error('The verified account time or withdrawal cap is invalid.');
 const grouped=unified?view.positions.filter(p=>p.fromReinvestment):[];
 if(grouped.length>1)throw Error('More than one unified reinvestment account was found.');
 const group=grouped[0],sources:Source[]=[];
 let maturedPrincipal=0n;
 for(const p of [...view.positions].sort((a,b)=>a.id-b.id)){
  if(p.lastAccruedAt>view.asOf)throw Error('The account accrual time exceeds the verified block.');
  if(p!==group){
   const principal=view.asOf>=p.openedAt+LOCK?p.principal-p.reservedPrincipal:0n;
   maturedPrincipal+=principal;sources.push({position:p,profit:p.availableProfit,principal});
   continue;
  }
  const {lots,first}=unifiedLots(view,p);
  maturedPrincipal+=lots.reduce((sum,lot)=>sum+(view.asOf>=lot.unlockAt?lot.principal-lot.reservedPrincipal:0n),0n);
  if(view.withdrawalPage){
   sources.push({position:p,profit:first.availableProfitOnPage,principal:first.maturedPrincipalOnPage,page:first});
   continue;
  }
  // Inspect every start, including windows crossing the read-page boundaries.
  const windowSize=unifiedWithdrawalWindow(view.singleCapital);
  for(let start=0;start<lots.length;start++){
   const window=lots.slice(start,start+windowSize);
   const profit=window.reduce((sum,lot)=>sum+lot.daily+lot.compound,0n);
   const principal=window.reduce((sum,lot)=>sum+(view.asOf>=lot.unlockAt?lot.principal-lot.reservedPrincipal:0n),0n);
   sources.push({position:p,profit,principal,page:{...first,start,limit:windowSize,lots:window,
    availableProfitOnPage:profit,maturedPrincipalOnPage:principal}});
  }
 }
 return {totals,sources,maturedPrincipal};
}

export function summarizeV3AccountWithdrawal(view:V3Snapshot,unified=false){
 const {totals,sources,maturedPrincipal}=withdrawalSources(view,unified);
 const ready=view.registered&&!view.suspended&&!view.paused&&!view.pendingWithdrawal&&view.asOf>=view.nextRequestAt;
 const capacityProfit=sources.reduce((max,source)=>source.profit>max?source.profit:max,0n);
 const capacityPrincipal=sources.reduce((max,source)=>source.principal>max?source.principal:max,0n);
 return {...totals,maturedPrincipal,
  maxProfit:ready?min(capacityProfit,view.ledger.requestCap):0n,
  maxPrincipal:ready?capacityPrincipal:0n,
  maxReferral:ready?min(view.referralAvailable,view.ledger.requestCap):0n,
  maxNetwork:ready?min(view.networkAvailable,view.ledger.requestCap):0n};
}

export function planV3AccountWithdrawal(view:V3Snapshot|null,input:string,kind:V3WithdrawalKind,unified=false):V3AccountWithdrawalPlan{
 if(!view)throw Error('No verified V3 account.');
 const amount=parseV3Amount(input);
 if(!view.registered||view.suspended||view.paused||view.pendingWithdrawal||!validTime(view.nextRequestAt)||view.asOf<view.nextRequestAt)
  throw Error('This account is paused, suspended, awaiting a withdrawal or within its 72-hour cooldown.');
 if(kind==='referral'||kind==='network')return {source:'position',action:prepareV3WithdrawalRequest(view,input,'',kind)};
 const {sources,totals,maturedPrincipal}=withdrawalSources(view,unified);
 if(amount>(kind==='profit'?totals.profit:maturedPrincipal))
  throw Error(kind==='profit'?'The amount exceeds the recorded account profit.':'The amount exceeds the unlocked account principal.');
 if(kind==='profit'&&amount>view.ledger.requestCap)throw Error('The amount exceeds the verified profit request cap.');
 const capacity=(source:Source)=>kind==='profit'?min(source.profit,view.ledger.requestCap):source.principal;
 const chosen=sources.find(source=>capacity(source)>=amount);
 if(!chosen){
  const maximum=sources.reduce((max,source)=>capacity(source)>max?capacity(source):max,0n);
  throw Error('This dashboard supports up to '+formatUnits(maximum,18)+' USDT in one '+kind+' request. The requested amount cannot be submitted as one supported transaction; no transaction was sent.');
 }
 if(chosen.page)return {source:'book',kind,amount,page:chosen.page};
 return {source:'position',action:prepareV3WithdrawalRequest(view,input,String(chosen.position.id),kind)};
}
