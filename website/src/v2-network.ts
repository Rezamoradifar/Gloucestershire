// V2 NEW contract-only member registry and wallet hierarchy read.
// The existing V2 vault has no direct-member index; count is exact only for
// scanned registration rows, NEVER implied for the entire team until completed.
import {getAddress,type Eip1193Provider} from 'ethers';
import {v2Session} from './v2-chain';

export type V2MemberRow={wallet:string;referrer:string;eligible:boolean;kyc:boolean;
 suspended:boolean;capitalUsd:bigint;level:number|null};
export type V2RegistryPage={from:number;to:number;total:number;block:number;members:V2MemberRow[];
 coverage:'REGISTRY_SLICE_ONLY'};
export async function readV2RegistrySlice(providerWallet:Eip1193Provider,wallet:string,
 offset=0,limit=20):Promise<V2RegistryPage>{
 if(!Number.isSafeInteger(offset)||offset<0||offset>2000000||
  !Number.isSafeInteger(limit)||limit<1||limit>25)throw Error('Invalid V2 registry page.');
 const {vault,block,options}=await v2Session(providerWallet,wallet);
 const n=Number(await vault.memberCount(options));
 if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid V2 on-chain registry size.');
 const last=Math.min(n,offset+limit);
 const ids=Array.from({length:Math.max(0,last-offset)},(_,i)=>i+offset);
 const rows=await Promise.all(ids.map(async index=>{
  const address=getAddress(await vault.memberAt(index,options));
  const [user,eligible]=await Promise.all([vault.users(address,options),vault.isEligible(address,options)]);
  return {wallet:address,referrer:getAddress(user.referrer),eligible:Boolean(eligible),
   kyc:Boolean(user.vipKyc),suspended:Boolean(user.suspended),capitalUsd:BigInt(user.capitalUsd),
   level:null} as V2MemberRow;
 }));
 const current=getAddress(wallet).toLowerCase();
 const cached=new Map(rows.map(row=>[row.wallet.toLowerCase(),row.referrer]));
 async function referrerOf(address:string){
  const key=address.toLowerCase();
  if(cached.has(key))return cached.get(key)!;
  const parent=getAddress((await vault.users(address,options)).referrer);
  cached.set(key,parent);return parent;
 }
 // The four-level path is derived using verified parents in the NEW vault,
 // regardless of whether some intermediate users are outside this page.
 await Promise.all(rows.map(async row=>{
  let cursor=row.referrer;
  for(let depth=1;depth<=4&&cursor!=='0x0000000000000000000000000000000000000000';depth++){
   if(cursor.toLowerCase()===current){row.level=depth;return;}
   cursor=await referrerOf(cursor);
  }
 }));
 return {from:offset,to:last,total:n,block:block.number,members:rows,
  coverage:'REGISTRY_SLICE_ONLY'};
}
