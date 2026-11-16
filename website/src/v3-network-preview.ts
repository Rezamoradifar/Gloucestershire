import type {Contract} from 'ethers';

export type V3NetworkPreview={eligible:boolean;volume:bigint};

// The contract's preview iterates every branch. Keep the optional read bounded
// and require it to agree with the independently read stage terms.
export async function readV3NetworkPreview(vault:Contract,wallet:string,group:number,
 branches:number,target:bigint,reward:bigint,options:{blockTag:number}):Promise<V3NetworkPreview|null>{
 if(!Number.isSafeInteger(branches)||branches<1||branches>64||target<=0n||reward<0n)return null;
 try{
  const preview=await vault.rewardPreview(wallet,group,options);
  if(BigInt(preview.volumeUsd)!==target||BigInt(preview.rewardUsd)!==reward||
   typeof preview.eligible!=='boolean'||!Array.isArray(preview.consume)||preview.consume.length!==branches)return null;
  const amounts=Array.from(preview.consume,(value)=>BigInt(value as bigint));
  if(amounts.some(value=>value<0n))return null;
  const volume=amounts.reduce((sum,value)=>sum+value,0n);
  if(volume>target||preview.eligible!==(volume===target))return null;
  return {eligible:preview.eligible,volume};
 }catch{return null;}
}
