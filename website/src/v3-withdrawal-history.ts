import {getAddress,ZeroAddress,type Contract,type Eip1193Provider,type Provider} from 'ethers';
import {v3ReadSession,type V3Withdrawal} from './v3-chain';
import {v3WithdrawalFee} from './v3-withdrawal-form';
import type {V3SiteReleaseConfig} from './v3-site-config';

export type V3WithdrawalAnchor={block:number;hash:string};
export type V3WithdrawalPage={anchor:V3WithdrawalAnchor;page:number;total:number;items:V3Withdrawal[]};
const pageSize=20;
const safe=(value:bigint,name:string)=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<0||n>1000000)throw Error('Invalid withdrawal '+name+'.');
 return n;
};

export async function checkV3WithdrawalAnchor(provider:Provider,anchor:V3WithdrawalAnchor){
 const block=await provider.getBlock(anchor.block);
 if(!block?.hash||block.hash.toLowerCase()!==anchor.hash.toLowerCase())
  throw Error('Withdrawal history block changed. Refresh the list.');
}

export async function readVerifiedWithdrawal(vault:Contract,raw:number|bigint,options:{blockTag:number},portfolio:boolean,owner?:string):Promise<V3Withdrawal>{
 const id=Number(raw);
 if(!Number.isSafeInteger(id)||id<0)throw Error('Invalid withdrawal request ID.');
 const w=await vault.withdrawalOf(raw,options);
 const beneficiary=getAddress(w.beneficiary),gross=BigInt(w.gross),fee=BigInt(w.fee);
 const requestedAt=Number(w.requestedAt),status=Number(w.status),kind=Number(w.kind);
 if(!Number.isSafeInteger(requestedAt)||requestedAt<0||requestedAt>8640000000000)throw Error('Invalid withdrawal timestamp.');
 if(beneficiary===ZeroAddress||(owner&&beneficiary!==owner)||gross<=0n||fee<0n||fee>gross)
  throw Error('Withdrawal request does not match the recorded beneficiary or amount.');
 if(!Number.isInteger(status)||status<0||status>5||!Number.isInteger(kind)||kind<0||kind>(portfolio?4:3)||(portfolio&&kind!==4))
  throw Error('Unrecognized withdrawal status or source.');
 let allocation:V3Withdrawal['allocation'];
 if(portfolio){
  const a=await vault.withdrawalAllocation(raw,options);
  const personal=BigInt(a.personal),referral=BigInt(a.referral),network=BigInt(a.network),principal=BigInt(a.principal);
  const earnings=personal+referral+network;
  if([personal,referral,network,principal].some(part=>part<0n)||earnings+principal!==gross||
   v3WithdrawalFee(earnings,false,true)+v3WithdrawalFee(principal,true)!==fee)
   throw Error('Withdrawal sources do not match the recorded amount.');
  allocation={personal,referral,network,principal};
 }
 return {id,beneficiary,...(allocation?{allocation}:{}),positionId:safe(BigInt(w.positionId),'position'),gross,fee,requestedAt,status,kind};
}

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
  await checkV3WithdrawalAnchor(session.provider,selected);
  const options={blockTag:selected.block};
  const total=safe(await session.vault.userWithdrawalCount(who,options),'count');
  if(page>0&&page*pageSize>=total)throw Error('No earlier withdrawal requests.');
  const count=Math.min(pageSize,Math.max(0,total-page*pageSize));
  const ids=await Promise.all(Array.from({length:count},(_,i)=>
   session.vault.userWithdrawalId(who,total-1-page*pageSize-i,options) as Promise<bigint>));
  if(new Set(ids.map(String)).size!==ids.length)throw Error('Duplicate withdrawal request ID.');
  const items=await Promise.all(ids.map(raw=>readVerifiedWithdrawal(session.vault,raw,options,Boolean(config.unified?.portfolio),who)));
  await checkV3WithdrawalAnchor(session.provider,selected);
  return {anchor:selected,page,total,items};
 }finally{session.provider.destroy();}
}
