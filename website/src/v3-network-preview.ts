import {getAddress,type Contract} from 'ethers';

export type V3NetworkPreview={eligible:boolean;volume:bigint;byBranch:bigint[]};
const unit=10n**18n;

// The verified fourteen-stage plan caps each independent branch by target size.
export function stageBranchCapBps(target:bigint){
 return target<=10_000n*unit?6000n:target<=100_000n*unit?4500n:3500n;
}

export async function readV3NetworkPreview(vault:Contract,wallet:string,group:number,
 branches:number,target:bigint,reward:bigint,options:{blockTag:number},daily=false,prepared=0n):Promise<V3NetworkPreview|null>{
 if(!Number.isSafeInteger(branches)||branches<1||branches>64||target<=0n||reward<0n)return null;
 try{
  const preview=daily?await vault.cyclePreview(wallet,group,options):await vault.rewardPreview(wallet,group,options);
  if(BigInt(preview.volumeUsd)!==target||BigInt(preview.rewardUsd)!==reward||
   typeof preview.eligible!=='boolean'||!Array.isArray(preview.consume)||preview.consume.length!==branches)return null;
  const byBranch=Array.from(preview.consume,(value)=>BigInt(value as bigint));
  const cap=target*stageBranchCapBps(target)/10000n;
  if(byBranch.some(amount=>amount<0n||amount>cap))return null;
  const volume=byBranch.reduce((sum,value)=>sum+value,0n);
  if(prepared<0n||volume<prepared||volume>target||preview.eligible!==(volume===target))return null;
  return {eligible:preview.eligible,volume,byBranch};
 }catch{return null;}
}

// Only the open automatically assigned group needs labels. Older completed or
// unbounded groups never trigger an unbounded array read.
export async function readGroupAddresses(network:Contract,wallet:string,id:number,stage:number,
 branches:number,prepared:bigint,at:{blockTag:number}):Promise<string[]|undefined>{
 if(branches<1||branches>64||stage>=14)return;
 try{
  const group=await network.rewardGroup(wallet,id,at);
  if(BigInt(group.stage)!==BigInt(stage)||BigInt(group.preparedUsd)!==prepared||
   !Array.isArray(group.branches)||group.branches.length!==branches)return;
  const addresses=Array.from(group.branches,address=>getAddress(String(address)));
  if(new Set(addresses).size===addresses.length)return addresses;
 }catch{/* The verified branch amounts remain usable without address labels. */}
}
