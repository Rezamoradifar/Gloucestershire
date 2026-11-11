import {BrowserProvider,getAddress,isAddress} from 'ethers';
import {chainId,vaultAddress,configured} from './config';
import {getWalletProvider} from './wallet';

export type DailyActivityStatus={version:1;chainId:number;vaultAddress:string;wallet:string;windowSeconds:number;requirementEnabled:boolean;requirementActive:boolean;activationTimestamp:number|null;activityCurrent:boolean;lastCheckInAt:number|null;activeUntil:number|null;nextCheckInAt:number|null;checkedAt:string;recorded?:boolean;alreadyRecorded?:boolean};
type ActivityChallenge={chainId:number;vaultAddress:string;origin:string;wallet:string;nonce:string;issuedAt:number;expiresAt:number;issuedBlock:{number:number;hash:string;timestamp:number};windowSeconds:number;message:string};
export type IndexProgress={memberThrough:number|null;positionThrough:number|null;target:number|null;memberCount:number|null;positionCount:number|null};
export type AllocationStatus={version:1;status:'unavailable'|'stale'|'waiting'|'credited'|'running';chainId:number;vaultAddress:string;checkedAt:string|null;fresh:boolean;dailyStatus?:string|null;indexProgress?:IndexProgress|null;lastCreditBlockTimestamp?:number|null;lastCredit:null|{epoch:number;batches:{transactionHash:string;block:number;blockHash:string}[]}};
export class DailyActivityApiError extends Error{constructor(message:string,public status:number){super(message);}}

export async function dailyActivityApi<T>(route:string,method='GET',body?:unknown):Promise<T>{
 const response=await fetch('/api/daily-activity/'+route,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(20000)});
 let data;try{data=await response.json();}catch{throw new DailyActivityApiError('Daily activity is unavailable. Please try again later.',503);}
 if(!data||typeof data!=='object'||Array.isArray(data))throw new DailyActivityApiError('Invalid activity service response.',503);
 if(!response.ok)throw new DailyActivityApiError(typeof data.error==='string'?data.error:'Daily activity is unavailable.',response.status);
 return data;
}

const timestamp=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;
const optionalTimestamp=(value:unknown)=>value===null||timestamp(value);
const same=(left:unknown,right:string)=>typeof left==='string'&&isAddress(left)&&left.toLowerCase()===right.toLowerCase();

export function requireDailyActivityStatus(value:DailyActivityStatus,who:string):DailyActivityStatus{
 if(value?.version!==1||value.chainId!==chainId||!same(value.vaultAddress,vaultAddress)||!same(value.wallet,who)||value.windowSeconds!==86400||!['requirementEnabled','requirementActive','activityCurrent'].every(key=>typeof value[key as keyof DailyActivityStatus]==='boolean')||![value.activationTimestamp,value.lastCheckInAt,value.activeUntil,value.nextCheckInAt].every(optionalTimestamp)||typeof value.checkedAt!=='string'||!Number.isFinite(Date.parse(value.checkedAt)))throw Error('The activity response does not match this wallet and contract.');
 if(value.requirementEnabled!==(value.activationTimestamp!==null)||value.requirementActive&&!value.requirementEnabled||value.activityCurrent&&(!value.lastCheckInAt||value.activeUntil!==value.lastCheckInAt+86400))throw Error('The activity response is incomplete. Refresh and try again.');
 return value;
}

export async function readDailyActivityStatus(who:string,request=dailyActivityApi){
 return requireDailyActivityStatus(await request<DailyActivityStatus>('status?wallet='+encodeURIComponent(who)),who);
}

function requireChallenge(c:ActivityChallenge,who:string){
 const origins=new Set([window.location.origin]);if(window.location.origin==='https://www.globaldroptrade.com')origins.add('https://globaldroptrade.com');
 if(!c||c.chainId!==chainId||!same(c.vaultAddress,vaultAddress)||!same(c.wallet,who)||!origins.has(c.origin)||c.windowSeconds!==86400||!/^[0-9a-f]{48}$/.test(c.nonce)||!timestamp(c.issuedAt)||!timestamp(c.expiresAt)||c.expiresAt-c.issuedAt!==300000||c.expiresAt<=Date.now()||c.issuedAt>Date.now()+120000||!timestamp(c.issuedBlock?.number)||!timestamp(c.issuedBlock?.timestamp)||!/^0x[0-9a-f]{64}$/.test(c.issuedBlock?.hash))throw Error('The activity signing request does not match this website and account.');
 const expected=[
  'GlobalDropTrade daily activity',`Origin: ${c.origin}`,`Chain: ${c.chainId}`,
  `Contract: ${getAddress(c.vaultAddress)}`,`Wallet: ${getAddress(c.wallet)}`,`Nonce: ${c.nonce}`,
  `Issued: ${new Date(c.issuedAt).toISOString()}`,`Expires: ${new Date(c.expiresAt).toISOString()}`,
  `Block: ${c.issuedBlock.number}`,`Block hash: ${c.issuedBlock.hash}`,`Block time: ${c.issuedBlock.timestamp}`,
  'Activity window: 86400 seconds',
  'This signature records a daily check-in only. It does not authorize a transaction or transfer.'
 ].join('\n');
 if(c.message!==expected)throw Error('The activity signing request does not match this website and account.');
}

// The existing wallet connection signs a strictly checked message. No token
// approval, contract write, or transaction request is made by a check-in.
export async function signDailyActivity(who:string,valid:()=>boolean,request=dailyActivityApi):Promise<DailyActivityStatus>{
 if(!configured||!isAddress(who))throw Error('Connect your wallet to check in.');
 const wallet=getWalletProvider();if(!wallet)throw Error('Connect your wallet to check in.');
 const target={chainId,vaultAddress};
 const check=async()=>{
  if(!valid()||wallet!==getWalletProvider()||chainId!==target.chainId||vaultAddress.toLowerCase()!==target.vaultAddress.toLowerCase())throw Error('The activity account changed. Please try again.');
  const [network,accounts]=await Promise.all([wallet.request({method:'eth_chainId'}),wallet.request({method:'eth_accounts'})]);
  if(!valid()||wallet!==getWalletProvider()||!(accounts as string[])?.[0]||String((accounts as string[])[0]).toLowerCase()!==who.toLowerCase())throw Error('The activity account changed. Please try again.');
  if(Number(network)!==target.chainId)throw Error('Switch your wallet to the configured network before checking in.');
 };
 await check();
 const challenge=await request<ActivityChallenge>('challenge','POST',{wallet:who});
 await check();requireChallenge(challenge,who);
 const provider=new BrowserProvider(wallet);
 try{
  const signer=await provider.getSigner(who);await check();requireChallenge(challenge,who);
  const signature=await signer.signMessage(challenge.message);await check();
  if(challenge.expiresAt<=Date.now())throw Error('The activity signing request expired. Please check in again.');
  const result=await request<DailyActivityStatus>('check-in','POST',{nonce:challenge.nonce,signature});
  await check();const status=requireDailyActivityStatus(result,who);
  if(status.recorded!==true)throw Error('Activity was not confirmed. Refresh your activity status before retrying.');
  return status;
 }finally{provider.destroy();}
}

export async function readAllocationStatus():Promise<AllocationStatus>{
 const response=await fetch('/api/automation/status',{cache:'no-store',signal:AbortSignal.timeout(20000)});
 const value=await response.json();
 if(!value||value.version!==1||value.chainId!==chainId||!same(value.vaultAddress,vaultAddress)||!['unavailable','stale','waiting','credited','running'].includes(value.status)||typeof value.fresh!=='boolean'||value.checkedAt!==null&&(typeof value.checkedAt!=='string'||!Number.isFinite(Date.parse(value.checkedAt))))throw Error('Allocation status is unavailable.');
 if(value.lastCredit!==null&&(!Number.isSafeInteger(value.lastCredit?.epoch)||value.lastCredit.epoch<0||!Array.isArray(value.lastCredit?.batches)||!value.lastCredit.batches.every((row:{transactionHash?:unknown;block?:unknown})=>typeof row.transactionHash==='string'&&/^0x[0-9a-f]{64}$/i.test(row.transactionHash)&&Number.isSafeInteger(row.block)&&Number(row.block)>=0)))throw Error('Allocation status is incomplete.');
 if(value.lastCreditBlockTimestamp!==undefined&&value.lastCreditBlockTimestamp!==null&&!timestamp(value.lastCreditBlockTimestamp))throw Error('Allocation status is incomplete.');
 if(value.indexProgress!==undefined&&value.indexProgress!==null){
  if(typeof value.indexProgress!=='object'||Array.isArray(value.indexProgress)||!['memberThrough','positionThrough','target','memberCount','positionCount'].every(key=>{
   const field=value.indexProgress[key];return field===null||(Number.isSafeInteger(field)&&field>=0);
  }))throw Error('Index status is unavailable.');
 }
 return value;
}
