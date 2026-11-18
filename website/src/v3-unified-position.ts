// Read one bounded group page at an independently verified testnet block.
// Deployment identity, canonicality and wallet account must be rechecked by
// the calling session before a page is displayed or a transaction is signed.
import {getAddress,ZeroAddress} from 'ethers';

const LOCK=90*86400,PERIOD=3600,MAX_PAGE=16;
type At={blockTag:number};
type Position={principal:bigint;compoundedBasis:bigint;availableProfit:bigint;reservedProfit:bigint;
 reservedPrincipal:bigint;cumulativeDaily:bigint;cumulativeCompound:bigint;fromReinvestment:boolean};
type Summary={principal:bigint;reservedPrincipal:bigint;daily:bigint;compound:bigint;basis:bigint;
 reservedProfit:bigint;cumulativeDaily:bigint;cumulativeCompound:bigint;lots:bigint};
type RawLot={principal:bigint;reservedPrincipal:bigint;daily:bigint;compound:bigint;basis:bigint;
 reservedProfit:bigint;openedAt:bigint;lastAccruedAt:bigint};
export type UnifiedVaultReader={
 reinvestmentPositionPlusOne:(wallet:string,options:At)=>Promise<bigint>;
 positionOf:(wallet:string,id:number,options:At)=>Promise<Position>;
 claimableDaily:(wallet:string,id:number,options:At)=>Promise<bigint>;
 claimableCompound:(wallet:string,id:number,options:At)=>Promise<bigint>;
};
export type UnifiedBookReader={
 position:(wallet:string,options:At)=>Promise<Summary>;
 lot:(wallet:string,id:number,options:At)=>Promise<RawLot>;
};
export type UnifiedLot={id:number;principal:bigint;reservedPrincipal:bigint;daily:bigint;compound:bigint;
 basis:bigint;reservedProfit:bigint;openedAt:number;lastAccruedAt:number;unlockAt:number;nextAccrualAt:number};
export type UnifiedPositionPage={wallet:string;positionId:number;block:number;asOf:number;start:number;limit:number;
 totalLots:number;principal:bigint;daily:bigint;compound:bigint;reservedProfit:bigint;
 availableProfitOnPage:bigint;maturedPrincipalOnPage:bigint;lots:UnifiedLot[]};

function integer(value:unknown,label:string){
 const n=typeof value==='bigint'?Number(value):value;
 if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)throw Error('Invalid unified '+label+'.');
 return n;
}
function units(value:unknown,label:string){
 if(typeof value!=='bigint'||value<0n)throw Error('Invalid unified '+label+'.');
 return value;
}

export async function readUnifiedPositionPage(vault:UnifiedVaultReader,book:UnifiedBookReader,wallet:string,
 positionId:number,block:number,asOf:number,start:number,limit=8):Promise<UnifiedPositionPage>{
 const who=getAddress(wallet);
 if(who===ZeroAddress||integer(block,'block')===0||integer(positionId,'position')!==positionId||positionId>=Number.MAX_SAFE_INTEGER||
    integer(asOf,'time')!==asOf||integer(start,'page')!==start||
    !Number.isSafeInteger(limit)||limit<1||limit>MAX_PAGE)throw Error('Invalid unified position page.');
 const options={blockTag:block};
 const [group,p,daily,compound,summary]=await Promise.all([
  vault.reinvestmentPositionPlusOne(who,options),vault.positionOf(who,positionId,options),
  vault.claimableDaily(who,positionId,options),vault.claimableCompound(who,positionId,options),
  book.position(who,options)
 ]);
 if(group!==BigInt(positionId+1)||p.fromReinvestment!==true)throw Error('The selected position is not the verified reinvestment position.');
 const totalLots=integer(summary.lots,'lot count');
 if(totalLots===0||start>=totalLots)throw Error('Invalid unified position page.');
 const fields=[p.principal,p.compoundedBasis,p.availableProfit,p.reservedProfit,p.reservedPrincipal,
  p.cumulativeDaily,p.cumulativeCompound,daily,compound,summary.principal,summary.basis,
  summary.reservedProfit,summary.reservedPrincipal,summary.daily,summary.compound,
  summary.cumulativeDaily,summary.cumulativeCompound];
 fields.forEach(value=>units(value,'balance'));
 if(p.principal!==summary.principal||p.compoundedBasis!==summary.basis||
    p.availableProfit!==daily+compound||daily!==summary.daily||compound!==summary.compound||
    p.reservedProfit!==summary.reservedProfit||p.reservedPrincipal!==summary.reservedPrincipal||
    p.cumulativeDaily!==summary.cumulativeDaily||p.cumulativeCompound!==summary.cumulativeCompound||
    summary.basis!==summary.daily+summary.compound||summary.reservedPrincipal>summary.principal)
  throw Error('The verified reinvestment balances do not reconcile.');
 const length=Math.min(limit,totalLots-start);
 const lots=await Promise.all(Array.from({length},async(_,i):Promise<UnifiedLot>=>{
  const id=start+i,l=await book.lot(who,id,options);
  const openedAt=integer(l.openedAt,'opening time'),lastAccruedAt=integer(l.lastAccruedAt,'accrual time');
  const principal=units(l.principal,'principal'),reservedPrincipal=units(l.reservedPrincipal,'reserved principal');
  const lotDaily=units(l.daily,'daily claim'),lotCompound=units(l.compound,'compound claim');
  const basis=units(l.basis,'compound basis'),reservedProfit=units(l.reservedProfit,'reserved profit');
  if(reservedPrincipal>principal||basis!==lotDaily+lotCompound||openedAt>lastAccruedAt||
     lastAccruedAt>asOf||openedAt>Number.MAX_SAFE_INTEGER-LOCK||lastAccruedAt>Number.MAX_SAFE_INTEGER-PERIOD)
   throw Error('The verified reinvestment lot is inconsistent.');
  return {id,principal,reservedPrincipal,daily:lotDaily,compound:lotCompound,basis,reservedProfit,
   openedAt,lastAccruedAt,unlockAt:openedAt+LOCK,nextAccrualAt:lastAccruedAt+PERIOD};
 }));
 const sums=lots.reduce((a,lot)=>({principal:a.principal+lot.principal,reservedPrincipal:a.reservedPrincipal+lot.reservedPrincipal,
  daily:a.daily+lot.daily,compound:a.compound+lot.compound,reservedProfit:a.reservedProfit+lot.reservedProfit}),
 {principal:0n,reservedPrincipal:0n,daily:0n,compound:0n,reservedProfit:0n});
 if(sums.principal>summary.principal||sums.reservedPrincipal>summary.reservedPrincipal||
    sums.daily>summary.daily||sums.compound>summary.compound||sums.reservedProfit>summary.reservedProfit)
  throw Error('The verified reinvestment page exceeds the group totals.');
 return {wallet:who,positionId,block,asOf,start,limit,totalLots,principal:p.principal,daily,
  compound,reservedProfit:p.reservedProfit,lots,
  availableProfitOnPage:lots.reduce((sum,lot)=>sum+lot.daily+lot.compound,0n),
  maturedPrincipalOnPage:lots.reduce((sum,lot)=>sum+(asOf>=lot.unlockAt?lot.principal-lot.reservedPrincipal:0n),0n)};
}

type Account={registered:boolean;suspended:boolean;paused:boolean;pendingWithdrawal:boolean;nextRequestAt:number;requestCap:bigint};
export type UnifiedPageAction={method:'reinvestFromPage'|'requestProfitFromPage'|'requestPrincipalFromPage';args:[number,bigint,number,number]};
export function prepareUnifiedPageAction(page:UnifiedPositionPage,account:Account,
 kind:'reinvest'|'profit'|'principal',amount:bigint):UnifiedPageAction{
 if(typeof amount!=='bigint'||amount<=0n)throw Error('Enter a positive TEST amount.');
 if(account.registered!==true||account.suspended!==false||account.paused!==false)
  throw Error('This test account cannot perform that action.');
 if(kind!=='reinvest'){
  if(account.pendingWithdrawal!==false||!Number.isSafeInteger(account.nextRequestAt)||account.nextRequestAt<0||page.asOf<account.nextRequestAt)
   throw Error('A withdrawal is pending or the cooldown is active.');
  if(kind==='profit'&&(typeof account.requestCap!=='bigint'||account.requestCap<0n||amount>account.requestCap))
   throw Error('The request exceeds the verified profit cap.');
 }
 if(kind==='principal'&&amount>page.maturedPrincipalOnPage)
  throw Error('The selected page does not have that much unlocked principal.');
 if(kind!=='principal'&&amount>page.availableProfitOnPage)
  throw Error('The selected page does not have that much recorded profit.');
 return {method:kind==='reinvest'?'reinvestFromPage':kind==='profit'?'requestProfitFromPage':'requestPrincipalFromPage',
  args:[page.positionId,amount,page.start,page.limit]};
}
