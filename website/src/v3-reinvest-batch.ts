// Plan a bounded, atomic testnet reinvestment from independently verified
// position balances and group pages. This module never requests a signature.
import {formatUnits,getAddress,toQuantity} from 'ethers';
import type {V3WalletPosition,v3ReadSession} from './v3-chain';
import {readUnifiedPositionPage,type UnifiedBookReader,type UnifiedPositionPage,type UnifiedVaultReader} from './v3-unified-position';

export type ReinvestmentSource={positionId:number;amount:bigint;start:number;limit:number};
const MAX_SOURCES=16,MAX_GROUP_SPAN=128;
const validIndex=(value:number)=>Number.isSafeInteger(value)&&value>=0;

export function planUnifiedReinvestment(positions:V3WalletPosition[],pages:UnifiedPositionPage[],amount:bigint){
 if(typeof amount!=='bigint'||amount<=0n)throw Error('Enter a positive USDT amount.');
 if(positions.length>100)throw Error('The complete position list is required.');
 const ids=new Set<number>();let group:V3WalletPosition|undefined,total=0n;
 const ordered=[...positions].sort((a,b)=>a.id-b.id);
 for(let i=0;i<ordered.length;i++){
  const p=ordered[i];
  if(!validIndex(p.id)||p.id!==i||ids.has(p.id)||typeof p.fromReinvestment!=='boolean'||
     typeof p.availableProfit!=='bigint'||typeof p.availableDaily!=='bigint'||typeof p.availableCompound!=='bigint'||
     typeof p.compoundedBasis!=='bigint'||p.availableProfit<0n||p.availableDaily<0n||p.availableCompound<0n||
     p.availableProfit!==p.availableDaily+p.availableCompound||p.compoundedBasis!==p.availableProfit)
   throw Error('The verified position claims do not reconcile.');
  ids.add(p.id);total+=p.availableProfit;
  if(p.fromReinvestment){if(group)throw Error('More than one reinvestment position was found.');group=p;}
 }
 if(amount>total)throw Error('The amount exceeds recorded position profit.');
 const sourcePages=[...pages].sort((a,b)=>a.start-b.start);
 let lastEnd=0,pageSum=0n,identity:UnifiedPositionPage|undefined;
 for(const p of sourcePages){
  if(!group||p.positionId!==group.id||!validIndex(p.start)||!validIndex(p.block)||p.block===0||
     !validIndex(p.asOf)||!validIndex(p.totalLots)||!validIndex(p.limit)||p.limit<1||p.limit>16||
     p.lots.length<1||p.lots.length>p.limit||p.start<lastEnd||p.start+p.lots.length>p.totalLots||
     p.daily!==group.availableDaily||p.compound!==group.availableCompound||p.principal!==group.principal)
   throw Error('The verified reinvestment page is inconsistent.');
  if(identity&&(p.wallet!==identity.wallet||p.block!==identity.block||p.asOf!==identity.asOf||p.totalLots!==identity.totalLots))
   throw Error('Reinvestment pages must come from the same verified block.');
  identity??=p;
  const available=p.lots.reduce((sum,lot,index)=>{
   if(lot.id!==p.start+index||typeof lot.daily!=='bigint'||typeof lot.compound!=='bigint'||lot.daily<0n||lot.compound<0n)
    throw Error('The verified reinvestment lot is inconsistent.');
   return sum+lot.daily+lot.compound;
  },0n);
  if(available!==p.availableProfitOnPage)throw Error('The verified reinvestment page does not reconcile.');
  pageSum+=available;lastEnd=p.start+p.lots.length;
 }
 if(group&&pageSum>group.availableProfit)throw Error('Reinvestment pages exceed recorded profit.');
 let remaining=amount,span=0;const sources:ReinvestmentSource[]=[];
 const add=(positionId:number,available:bigint,start:number,limit:number)=>{
  if(remaining===0n||available===0n)return;
  if(sources.length===MAX_SOURCES||span+limit>MAX_GROUP_SPAN)
   throw Error('This amount requires more than one transaction. Reinvest up to '+formatUnits(amount-remaining,18)+' USDT in this transaction, then refresh the remaining recorded profit.');
  const take=available<remaining?available:remaining;
  sources.push({positionId,amount:take,start,limit});remaining-=take;span+=limit;
 };
 for(const p of ordered)if(!p.fromReinvestment)add(p.id,p.availableProfit,0,0);
 for(const p of sourcePages)if(group)add(group.id,p.availableProfitOnPage,p.start,p.lots.length);
 if(remaining!==0n)throw Error('More verified reinvestment pages are required before continuing.');
 return {amount,total,sources};
}

// Read all ordinary sources and only as many bounded group pages as needed,
// all at the verified block belonging to the caller's independent session.
export async function readUnifiedReinvestmentPlan(session:Awaited<ReturnType<typeof v3ReadSession>>,wallet:string,amount:bigint){
 if(!session.config.unified||!session.book)throw Error('A verified unified testnet deployment is required.');
 if(typeof amount!=='bigint'||amount<=0n)throw Error('Enter a positive USDT amount.');
 const who=getAddress(wallet),{vault,book,options,block,provider}=session;
 const [countRaw,groupRaw]=await Promise.all([vault.positionCount(who,options),vault.reinvestmentPositionPlusOne(who,options)]);
 const count=Number(countRaw),groupPlusOne=Number(groupRaw);
 if(!validIndex(count)||count>100||!validIndex(groupPlusOne)||groupPlusOne>count)
  throw Error('The complete verified position list is unavailable.');
 const positions:V3WalletPosition[]=[];
 for(let start=0;start<count;start+=5){
  const length=Math.min(5,count-start);
  const next=await Promise.all(Array.from({length},async(_,offset)=>{
   const id=start+offset;
   const [p,daily,compound]=await Promise.all([
    vault.positionOf(who,id,options),vault.claimableDaily(who,id,options),vault.claimableCompound(who,id,options)
   ]);
   return {id,principal:BigInt(p.principal),compoundedBasis:BigInt(p.compoundedBasis),
    availableProfit:BigInt(p.availableProfit),availableDaily:BigInt(daily),availableCompound:BigInt(compound),
    reservedProfit:BigInt(p.reservedProfit),reservedPrincipal:BigInt(p.reservedPrincipal),
    cumulativeDaily:BigInt(p.cumulativeDaily),cumulativeCompound:BigInt(p.cumulativeCompound),
    openedAt:Number(p.openedAt),lastAccruedAt:Number(p.lastAccruedAt),fromReinvestment:Boolean(p.fromReinvestment)};
  }));
  positions.push(...next);
 }
 const flagged=positions.filter(p=>p.fromReinvestment);
 if((groupPlusOne===0&&flagged.length!==0)||(groupPlusOne!==0&&
   (flagged.length!==1||flagged[0].id!==groupPlusOne-1)))
  throw Error('The verified reinvestment position index is inconsistent.');
 const total=positions.reduce((sum,p)=>sum+p.availableProfit,0n);
 if(amount>total)throw Error('The amount exceeds recorded position profit.');
 let covered=positions.filter(p=>!p.fromReinvestment).reduce((sum,p)=>sum+p.availableProfit,0n);
 const pages:UnifiedPositionPage[]=[];
 if(amount>covered&&groupPlusOne!==0){
  const summary=await book.position(who,options),lotCount=Number(summary.lots);
  if(!validIndex(lotCount)||lotCount<1)throw Error('The verified reinvestment lot count is invalid.');
  for(let start=0;start<lotCount&&covered<amount;start+=8){
   const page=await readUnifiedPositionPage(vault as unknown as UnifiedVaultReader,
    book as unknown as UnifiedBookReader,who,groupPlusOne-1,block.number,block.timestamp,start,8);
   if(page.availableProfitOnPage>0n){pages.push(page);covered+=page.availableProfitOnPage;}
   // The contract caps the contributing sources, not the index of a contributing lot.
   if(pages.length>MAX_SOURCES)break;
  }
 }
 const plan=planUnifiedReinvestment(positions,pages,amount);
 const canonical=await provider.send('eth_getBlockByNumber',[toQuantity(block.number),false]);
 if(!block.hash||!canonical?.hash||String(canonical.hash).toLowerCase()!==block.hash.toLowerCase())
  throw Error('The verified reinvestment block changed; refresh before continuing.');
 return {...plan,block:block.number,destination:groupPlusOne===0?count:groupPlusOne-1};
}
