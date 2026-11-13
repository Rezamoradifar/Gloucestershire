import {BrowserProvider,getAddress,isAddress} from 'ethers';
import {chainId,vaultAddress,configured} from './config';
import {getWalletProvider} from './wallet';
import {communityApi} from './community-client';

const validHash=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const safe=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const units=(v:unknown)=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v);
const invalid=():never=>{throw Error('Owner directory returned inconsistent contract information. No data was applied.');};
export class AdminUserApiError extends Error{
 constructor(message:string,public status:number){super(message);}
}
export type AdminHead={version:1;chainId:number;vaultAddress:string;deploymentBlock:number;confirmedHead:number;blockHash:string;kind:'head';source:string};
export type RegistryEvent={wallet:string;referrer:string;blockNumber:number;logIndex:number;transactionHash:string};
export type RegistryWindow=AdminHead&{kind:'registrations';from:number;to:number;events:RegistryEvent[];complete:boolean};
export type AccountDetail={symbol:'BNB'|'USDT';address:string;decimals:number;principal:string;profit:string;externalDeposited:string;nextWithdrawal:string;withdrawalCap:string;reinvested:string};
export type PositionDetail={id:number;symbol:'BNB'|'USDT';principal:string;capitalUsd:string;unlockAt:string;penaltyBps:number};
export type AdminUser=AdminHead&{kind:'user';wallet:string;profile:{registered:boolean;active:boolean;kycVerified:boolean;referrer:string;activeDirect:string;registeredDirect:string;qualifiedDirect:string;capitalUsd:string;salesUsd:string;tier:number;dailyTargetBps:number};positionCount:number;positionOffset:number;positions:PositionDetail[];assets:AccountDetail[];source:string};
export type AdminWithdrawals=AdminHead&{kind:'withdrawals';wallet:string;supported:boolean;queueAddress?:string;page?:number;total?:number;requests?:{id:string;asset:string;gross:string;fee:string;net:string;dueAt:string;status:number}[];note?:string;source:string};
const ensureAddress=(value:unknown)=>typeof value==='string'&&isAddress(value);
const same=(a:unknown,b:unknown)=>ensureAddress(a)&&ensureAddress(b)&&getAddress(a as string)===getAddress(b as string);
function base(value:unknown):asserts value is AdminHead{
 if(!value||typeof value!=='object'||Array.isArray(value))invalid();
 const d=value as Record<string,unknown>;
 if(d.version!==1||d.chainId!==chainId||!same(d.vaultAddress,vaultAddress)||
  !safe(d.deploymentBlock)||!safe(d.confirmedHead)||Number(d.deploymentBlock)>Number(d.confirmedHead)||
  !validHash(d.blockHash))invalid();
}
function ensureHeader(value:AdminHead,head:AdminHead){
 if(value.confirmedHead!==head.confirmedHead||value.blockHash.toLowerCase()!==head.blockHash.toLowerCase()||
  value.deploymentBlock!==head.deploymentBlock)invalid();
}
const params=(fields:Record<string,string|number>)=>new URLSearchParams(Object.entries(fields).map(([key,v])=>[key,String(v)]));
async function api(route:string,token:string,values:Record<string,string|number>={},signal?:AbortSignal):Promise<unknown>{
 if(!token||!/^[0-9a-f]{64}$/.test(token))throw new AdminUserApiError('Verify the owner wallet to open the user directory.',401);
 let res:Response;
 try{res=await fetch('/api/admin-users/'+route+'?'+params(values),{method:'GET',cache:'no-store',
  headers:{Authorization:'Bearer '+token},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(35000)]):AbortSignal.timeout(35000)});}
 catch(error){if((error as Error)?.name==='AbortError')throw error;throw new AdminUserApiError('The verified owner directory is not reachable.',503);}
 let data:unknown;
 try{data=await res.json();}catch{throw new AdminUserApiError('Invalid directory server response.',503);}
 if(!res.ok)throw new AdminUserApiError(res.status===401?'Owner audit sign-in expired. Sign again.':
  res.status===403?'Current wallet is not the verified contract owner.':
  res.status===400?'Invalid verified audit range.':'Verified blockchain directory is temporarily unavailable.',res.status);
 return data;
}
export async function adminSignIn(who:string,valid:()=>boolean):Promise<string>{
 if(!configured||!isAddress(who))throw Error('Connect the contract owner wallet.');
 const provider=getWalletProvider();
 if(!provider)throw Error('Connect the contract owner wallet.');
 const verifyWallet=async()=>{
  if(!valid()||getWalletProvider()!==provider)throw Error('The owner wallet changed. Reconnect.');
  const [network,accounts]=await Promise.all([provider.request({method:'eth_chainId'}),provider.request({method:'eth_accounts'})]);
  if(Number(network)!==chainId||!Array.isArray(accounts)||!accounts.some(x=>typeof x==='string'&&x.toLowerCase()===who.toLowerCase())||
     !valid())throw Error('Verify the connected owner wallet and chain.');
 };
 await verifyWallet();
 const challenge=await communityApi<{nonce:string;message:string}>('admin-challenge','POST',{wallet:who});
 await verifyWallet();
 const lines=challenge.message?.split('\n'),origin=window.location.origin;
 const origins=new Set([origin]);
 if(origin==='https://www.globaldroptrade.com')origins.add('https://globaldroptrade.com');
 if(!/^[a-f0-9]{48}$/.test(challenge.nonce)||lines?.length!==8||
   lines[0]!=='GlobalDropTrade owner user-audit sign-in'||
   !lines[1]?.startsWith('Origin: ')||!origins.has(lines[1].slice(8))||
   lines[2]!==`Chain: ${chainId}`||lines[3]?.toLowerCase()!==`Contract: ${vaultAddress}`.toLowerCase()||
   lines[4]?.toLowerCase()!==`Wallet: ${who}`.toLowerCase()||
   lines[5]!==`Nonce: ${challenge.nonce}`||
   !lines[6]?.startsWith('Expires: ')||!Number.isFinite(Date.parse(lines[6].slice(9)))||
   Date.parse(lines[6].slice(9))<=Date.now()||
   lines[7]!=='This signature grants the contract owner read-only access to indexed public user and contract account details. It does not authorize a transaction.')
  throw Error('The owner audit sign-in does not match this contract and wallet.');
 const browser=new BrowserProvider(provider);
 try{
  const signer=await browser.getSigner(who);
  await verifyWallet();
  const signature=await signer.signMessage(challenge.message);
  await verifyWallet();
  const session=await communityApi<{token:string;scope:string;wallet:string}>('admin-session','POST',{nonce:challenge.nonce,signature});
  await verifyWallet();
  if(session.scope!=='owner-audit'||!same(session.wallet,who)||!/^[0-9a-f]{64}$/.test(session.token))invalid();
  return session.token;
 }finally{browser.destroy();}
}
export async function adminHead(token:string,signal?:AbortSignal):Promise<AdminHead>{
 const d=await api('head',token,{},signal);base(d);
 if((d as AdminHead).kind!=='head')invalid();
 return d as AdminHead;
}
export async function adminRegistrations(token:string,head:AdminHead,from:number,to:number,signal?:AbortSignal):Promise<RegistryWindow>{
 if(!safe(from)||!safe(to)||from>to||to>head.confirmedHead||to-from+1>1024||from<head.deploymentBlock)invalid();
 const d=await api('registrations',token,{head:head.confirmedHead,hash:head.blockHash,from,to},signal);
 base(d);ensureHeader(d as AdminHead,head);
 const x=d as RegistryWindow;
 if(x.kind!=='registrations'||x.from!==from||x.to!==to||!Array.isArray(x.events)||x.events.length>256||
    x.complete!==(from===head.deploymentBlock))invalid();
 const ids=new Set<string>();
 for(const event of x.events){
  if(!ensureAddress(event.wallet)||!ensureAddress(event.referrer)||!safe(event.blockNumber)||
   event.blockNumber<from||event.blockNumber>to||!safe(event.logIndex)||!validHash(event.transactionHash))invalid();
  const id=event.transactionHash.toLowerCase()+':'+event.logIndex;
  if(ids.has(id))invalid();ids.add(id);
 }
 return x;
}
export async function adminUser(token:string,head:AdminHead,wallet:string,offset=0,signal?:AbortSignal):Promise<AdminUser>{
 if(!ensureAddress(wallet)||!safe(offset)||offset>1000000)invalid();
 const d=await api('user',token,{head:head.confirmedHead,hash:head.blockHash,wallet:getAddress(wallet),offset},signal);
 base(d);ensureHeader(d as AdminHead,head);
 const x=d as AdminUser;
 const p=x.profile;
 if(x.kind!=='user'||!same(x.wallet,wallet)||!p||
    typeof p.registered!=='boolean'||typeof p.active!=='boolean'||typeof p.kycVerified!=='boolean'||
    !ensureAddress(p.referrer)||!safe(p.tier)||p.tier>4||!safe(p.dailyTargetBps)||p.dailyTargetBps>10000||
    !['activeDirect','registeredDirect','qualifiedDirect','capitalUsd','salesUsd'].every(k=>units(p[k as keyof typeof p]))||
    !safe(x.positionCount)||!safe(x.positionOffset)||x.positionOffset!==offset||
    !Array.isArray(x.positions)||x.positions.length>8||!Array.isArray(x.assets)||x.assets.length!==2)invalid();
 for(const a of x.assets)if(!['BNB','USDT'].includes(a.symbol)||!ensureAddress(a.address)||
   !safe(a.decimals)||a.decimals>18||
   !['principal','profit','externalDeposited','nextWithdrawal','withdrawalCap','reinvested'].every(k=>units(a[k as keyof typeof a])))invalid();
 for(const row of x.positions)if(!safe(row.id)||row.id<offset||row.id>=offset+8||!['BNB','USDT'].includes(row.symbol)||
   !units(row.principal)||!units(row.capitalUsd)||!units(row.unlockAt)||!safe(row.penaltyBps))invalid();
 return x;
}
export async function adminWithdrawals(token:string,head:AdminHead,wallet:string,page=0,signal?:AbortSignal):Promise<AdminWithdrawals>{
 if(!ensureAddress(wallet)||!safe(page)||page>1000000)invalid();
 const d=await api('withdrawals',token,{head:head.confirmedHead,hash:head.blockHash,wallet:getAddress(wallet),page},signal);
 base(d);ensureHeader(d as AdminHead,head);const x=d as AdminWithdrawals;
 if(x.kind!=='withdrawals'||!same(x.wallet,wallet)||typeof x.supported!=='boolean')invalid();
 if(x.supported){
  if(!ensureAddress(x.queueAddress)||x.page!==page||!safe(x.total)||!Array.isArray(x.requests)||x.requests.length>8)invalid();
  for(const row of x.requests)if(!units(row.id)||!ensureAddress(row.asset)||
    !units(row.gross)||!units(row.fee)||!units(row.net)||!units(row.dueAt)||
    !safe(row.status)||row.status>3)invalid();
 }
 return x;
}
