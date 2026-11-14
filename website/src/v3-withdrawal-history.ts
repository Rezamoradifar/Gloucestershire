import {getAddress,type Eip1193Provider} from 'ethers';
import {v3ReadSession,type V3Withdrawal} from './v3-chain';
import type {V3SiteReleaseConfig} from './v3-site-config';

export type V3WithdrawalAnchor={block:number;hash:string};
export type V3WithdrawalPage={anchor:V3WithdrawalAnchor;page:number;total:number;items:V3Withdrawal[]};
const pageSize=20;
const safe=(value:bigint,name:string)=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<0||n>1000000)throw Error('Invalid withdrawal '+name+'.');
 return n;
};

// Read a wallet's indexed requests as of a single confirmed block. This lets
// users browse older requests and their real on-chain status without scanning
// another user's requests or inventing withdrawal events.
export async function readV3WithdrawalPage(walletProvider:Eip1193Provider,wallet:string,
 config:V3SiteReleaseConfig,page:number,anchor:V3WithdrawalAnchor|null):Promise<V3WithdrawalPage>{
 if(!Number.isSafeInteger(page)||page<0||page>50000)throw Error('Invalid withdrawal page.');
 const who=getAddress(wallet);
 const session=await v3ReadSession(walletProvider,who,config);
 try{
  const selected=anchor??{block:session.block.number,hash:session.block.hash!};
  if(selected.block>session.block.number||selected.block<session.deploymentBlock)
   throw Error('Withdrawal history block is not verified.');
  const check=async()=>{
   const block=await session.provider.getBlock(selected.block);
   if(!block?.hash||block.hash.toLowerCase()!==selected.hash.toLowerCase())
    throw Error('Withdrawal history block changed. Refresh the list.');
  };
  await check();
  const options={blockTag:selected.block};
  const total=safe(await session.vault.userWithdrawalCount(who,options),'count');
  if(page>0&&page*pageSize>=total)throw Error('No earlier withdrawal requests.');
  const count=Math.min(pageSize,Math.max(0,total-page*pageSize));
  const ids=await Promise.all(Array.from({length:count},(_,i)=>
   session.vault.userWithdrawalId(who,total-1-page*pageSize-i,options) as Promise<bigint>));
  if(new Set(ids.map(String)).size!==ids.length)throw Error('Duplicate withdrawal request ID.');
  const items=await Promise.all(ids.map(async(raw):Promise<V3Withdrawal>=>{
   const id=safe(raw,'ID'),w=await session.vault.withdrawalOf(raw,options);
   const beneficiary=getAddress(w.beneficiary),gross=BigInt(w.gross),fee=BigInt(w.fee);
   const requestedAt=Number(w.requestedAt);
   if(!Number.isSafeInteger(requestedAt)||requestedAt<0||requestedAt>8640000000000)throw Error('Invalid withdrawal timestamp.');
   if(beneficiary!==who||gross<0n||fee<0n||fee>gross)throw Error('Withdrawal request does not match this wallet.');
   return {id,beneficiary,positionId:safe(BigInt(w.positionId),'position'),gross,fee,
    requestedAt,
    status:safe(BigInt(w.status),'status'),kind:safe(BigInt(w.kind),'kind')};
  }));
  await check();
  return {anchor:selected,page,total,items};
 }finally{session.provider.destroy();}
}
