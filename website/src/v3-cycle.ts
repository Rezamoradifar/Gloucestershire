// Derive a display-only clock and estimate from a verified chain snapshot.
// Time passing here never writes a claim, confirms a payout, or changes a rate.
import type {V3WalletPosition} from './v3-chain';

export const V3_PERIOD_SECONDS=86_400;
export function v3CycleView(positions:V3WalletPosition[],blockTime:number,
 elapsedSeconds:number,lastCheckIn:number,rateBps:number){
 if(!Number.isSafeInteger(blockTime)||blockTime<0||!Number.isSafeInteger(elapsedSeconds)||
  elapsedSeconds<0||!Number.isSafeInteger(lastCheckIn)||lastCheckIn<0||
  !Number.isSafeInteger(rateBps)||rateBps<0||rateBps>10_000)
  throw Error('Invalid confirmed V3 cycle data.');
 const now=blockTime+elapsedSeconds;
 if(!Number.isSafeInteger(now))throw Error('Invalid estimated V3 time.');
 if(positions.some(p=>p.principal<0n||p.compoundedBasis<0n))throw Error('Invalid V3 position amounts.');
 const live=positions.filter(p=>p.principal>0n);
 if(live.some(p=>!Number.isSafeInteger(p.lastAccruedAt)||p.lastAccruedAt<=0))
  throw Error('Invalid V3 position timing.');
 const nextAt=live.length?Math.min(...live.map(p=>p.lastAccruedAt+V3_PERIOD_SECONDS)):null;
 const secondsRemaining=nextAt===null?null:Math.max(0,nextAt-now);
 const activityRemaining=lastCheckIn&&now>=lastCheckIn?
  Math.max(0,lastCheckIn+V3_PERIOD_SECONDS-now):0;
 const rate=BigInt(rateBps);
 // Solidity rounds each position's components independently.
 const estimatedDaily=live.reduce((sum,p)=>sum+p.principal*rate/10_000n,0n);
 const estimatedCompound=live.reduce((sum,p)=>sum+p.compoundedBasis*rate/10_000n,0n);
 return {now,nextAt,secondsRemaining,activityRemaining,estimatedDaily,estimatedCompound};
}
export function v3Countdown(seconds:number){
 const n=Math.max(0,Math.floor(seconds));
 const h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;
 return [h,m,s].map(x=>String(x).padStart(2,'0')).join(':');
}
