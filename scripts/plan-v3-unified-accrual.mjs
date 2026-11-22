// Read-only planning for the experimental unified V3 keeper. This does not
// query or verify an RPC, sign, send a transaction, or establish eligibility.
// Callers must verify the chain, deployment, book, confirmed block and account
// eligibility before using a proposed page.
import {getAddress,ZeroAddress} from 'ethers';

const PAGE_LIMIT=8;
const PERIOD=3600;
const BPS=10000n;
const integer=(value,name)=>{
 if(!Number.isSafeInteger(value)||value<0)throw Error('INVALID_'+name);
 return value;
};
const units=(value,name)=>{
 if(typeof value!=='bigint'||value<0n)throw Error('INVALID_'+name);
 return value;
};

export function planUnifiedLotPage({wallet,start,totalLots,lots,now,rateBps,eligible,paused,limit=PAGE_LIMIT,dailyPlan=false}){
 const who=getAddress(wallet);
 integer(start,'LOT_START');integer(totalLots,'LOT_COUNT');integer(now,'BLOCK_TIME');integer(rateBps,'RATE');
 if(who===ZeroAddress||rateBps>10000||typeof eligible!=='boolean'||typeof paused!=='boolean'||
    !Number.isSafeInteger(limit)||limit<1||limit>PAGE_LIMIT||start>totalLots||!Array.isArray(lots))
  throw Error('INVALID_UNIFIED_PAGE');
 const expected=Math.min(limit,totalLots-start);
 if(lots.length!==expected)throw Error('INCOMPLETE_UNIFIED_LOT_PAGE');
 let daily=0n,compound=0n,dueLots=0;
 for(let i=0;i<lots.length;i++){
  const lot=lots[i];
  if(!lot||integer(lot.id,'LOT_ID')!==start+i)throw Error('UNEXPECTED_UNIFIED_LOT_ID');
  const principal=units(lot.principal,'LOT_PRINCIPAL');
  const basis=units(lot.basis,'LOT_BASIS');
  const last=integer(lot.lastAccruedAt,'LOT_TIME');
  if(last>Number.MAX_SAFE_INTEGER-(dailyPlan?86400:PERIOD))throw Error('INVALID_LOT_TIME');
  const due=dailyPlan?integer(lot.due,'DAILY_DUE'):last+PERIOD;
  const rate=dailyPlan?integer(lot.bps,'DAILY_RATE'):rateBps;
  if(dailyPlan&&(due<last+86400||rate>10000))throw Error('INVALID_DAILY_TERMS');
  if(!paused&&eligible&&principal>0n&&now>=due){
   const d=principal*BigInt(rate)/BPS,c=basis*BigInt(rate)/BPS;
   if(d+c>0n){daily+=d;compound+=c;dueLots++;}
  }
 }
 return Object.freeze({
  wallet:who,start,count:lots.length,next:start+lots.length,totalLots,dueLots,daily,compound,
  proposal:dueLots?Object.freeze({method:'accrueReinvestmentPage',args:[who,start,limit]}):null,
  transactionSent:false
 });
}
