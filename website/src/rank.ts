import type {Contract} from 'ethers';
export type RankEligibility={qualified:bigint;requiredDirect:bigint;minimum:bigint;volume:bigint;target:bigint;missing:bigint;cap:bigint};
export async function readRankEligibility(vault:Contract,who:string,tier:number,block:number):Promise<RankEligibility>{
 const options={blockTag:block};
 const [qualified,config,count,minimum]=await Promise.all([vault.qualifiedDirects(who,options),vault.tierConfig(tier,options),vault.networkBranchCount(who,options),vault.ACTIVE_DIRECT_USD(options)]);
 const target:bigint=config.requiredSalesUsd,cap:bigint=await vault.branchCapBps(target,options);
 let volume=0n,start=0n;
 while(start<count&&volume<target){const page=await vault.rankVolumePage(who,target,start,64,options);if(page.next<=start)throw Error('Rank volume scan did not advance.');volume+=page.eligibleUsd;start=page.next;}
 if(volume>target)volume=target;
 return {qualified,requiredDirect:config.requiredDirect,minimum,volume,target,missing:target-volume,cap};
}
