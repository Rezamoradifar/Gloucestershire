import type {Contract} from 'ethers';
import {mapBounded} from './levels';
export async function suggestRewardBranches(vault:Contract,who:string,block:number,signal?:AbortSignal){
 const options={blockTag:block};
 const [count,stage]=await Promise.all([vault.networkBranchCount(who,options),vault.rewardStage(0,options)]);
 if(count>4096n)throw Error('This network requires a server index for a complete automatic calculation.');
 const goal=BigInt(stage.volumeUsd),cap=goal*BigInt(await vault.branchCapBps(goal,options))/10000n;
 const candidates=await mapBounded(Array.from({length:Number(count)},(_,i)=>i),async i=>{const address=String(await vault.networkBranch(who,i,options));const [assigned,volume]=await Promise.all([vault.groupedBranch(who,address,options),vault.branchVolumeUsd(who,address,options)]);return {address,assigned,eligible:volume<cap?volume:cap};},signal);
 candidates.sort((a,b)=>a.eligible===b.eligible?a.address.toLowerCase().localeCompare(b.address.toLowerCase()):a.eligible>b.eligible?-1:1);
 const branches:string[]=[];let eligible=0n;
 for(const candidate of candidates){if(candidate.assigned||candidate.eligible===0n)continue;if(eligible>=goal)break;branches.push(candidate.address);eligible+=candidate.eligible;}
 if(eligible>goal)eligible=goal;
 return {branches,eligible,goal,missing:goal-eligible,cap};
}
