import {BrowserProvider, ZeroAddress, getAddress, isAddress, toQuantity, type Eip1193Provider} from 'ethers';
import {checkedGas, submitVerified, type V3TransactionProgressCallback} from './v3-actions';
import {v3ReadSession} from './v3-chain';
import type {V3SiteReleaseConfig} from './v3-site-config';

type Session = Awaited<ReturnType<typeof v3ReadSession>>;
export type VipRecord = {member:string; registered:boolean; approved:boolean; block:number; timestamp:number};
export type VipChange = {kind:'setVipKyc'; member:string; previous:boolean; approved:boolean};

export type StatusChange={kind:'setSuspended';member:string;previous:boolean;suspended:boolean};
export type MemberChange=VipChange|StatusChange;
export type MemberDetails=VipRecord&{suspended:boolean;canGuard:boolean;referrer:string;capital:bigint;deposits:bigint;
  reinvestments:bigint;referral:bigint;network:bigint;tier:number;positions:number;requests:number;lastCheckIn:number};

export function vipMemberAddress(input:string) {
  const value=input.trim();
  if(!/^0x[0-9a-fA-F]{40}$/.test(value)||!isAddress(value)||getAddress(value)===ZeroAddress)
    throw Error('Enter the full member wallet address.');
  return getAddress(value);
}

async function verifyBlock(session:Session, number:number, hash:string|null) {
  const block=await session.provider.send('eth_getBlockByNumber',[toQuantity(number),false]);
  if(!hash||block?.hash?.toLowerCase()!==hash.toLowerCase()||Number(BigInt(block.number))!==number)
    throw Error('The confirmed block changed. Look up the member again.');
}

async function requireManager(session:Session,manager:string){
  const {vault,options}=session;
  if(!await vault.hasRole(await vault.MANAGER_ROLE(options),manager,options))throw Error('Member review requires the vault manager role.');
}
async function lookup(session:Session, manager:string, member:string):Promise<VipRecord> {
  await requireManager(session,manager);
  const {vault,options,block}=session,user=await vault.users(member,options);
  await verifyBlock(session,block.number,block.hash);
  return {member,registered:user.registered,approved:user.vipKyc,block:block.number,timestamp:block.timestamp};
}

export async function readMemberDirectory(provider:Eip1193Provider,manager:string,config:V3SiteReleaseConfig,page:number){
  if(!config.unified?.portfolio||!Number.isSafeInteger(page)||page<0)throw Error('Invalid member registry page.');
  const session=await v3ReadSession(provider,manager,config,true);
  try{
    await requireManager(session,manager);
    const {vault,options,block}=session,total=Number(await vault.memberCount(options));
    if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid member count.');
    const start=page*10;
    const members=await Promise.all(Array.from({length:Math.max(0,Math.min(10,total-start))},async(_,i)=>
      vipMemberAddress(await vault.memberAt(start+i,options))));
    await verifyBlock(session,block.number,block.hash);
    return {page,total,members};
  }finally{session.provider.destroy();}
}

export async function readMemberDetails(provider:Eip1193Provider, manager:string,input:string,config:V3SiteReleaseConfig):Promise<MemberDetails>{
  if(!config.unified?.portfolio)throw Error('A verified portfolio vault is required.');
  const member=vipMemberAddress(input),session=await v3ReadSession(provider,manager,config,true);
  try{
    await requireManager(session,manager);
    const {vault,options,block}=session;
    const [user,canGuard,network,tier,positions,requests]=await Promise.all([
      vault.users(member,options),vault.hasRole(await vault.GUARDIAN_ROLE(options),manager,options),
      vault.networkAvailable(member,options),vault.tierOf(member,options),vault.positionCount(member,options),vault.userWithdrawalCount(member,options)
    ]);
    await verifyBlock(session,block.number,block.hash);
    return {member,registered:user.registered,approved:user.vipKyc,block:block.number,timestamp:block.timestamp,
      suspended:user.suspended,canGuard,referrer:user.referrer,capital:user.capital,deposits:user.originalDeposits,
      reinvestments:user.reinvestments,referral:user.referralAvailable,network,tier:Number(tier),positions:Number(positions),requests:Number(requests),lastCheckIn:Number(user.lastCheckIn)};
  }finally{session.provider.destroy();}
}

export async function readManagerVip(provider:Eip1193Provider, manager:string, input:string, config:V3SiteReleaseConfig) {
  if(!config.unified?.portfolio)throw Error('A verified portfolio vault is required.');
  const member=vipMemberAddress(input),session=await v3ReadSession(provider,manager,config,true);
  try{return await lookup(session,manager,member);}finally{session.provider.destroy();}
}

export async function sendManagerChange(provider:Eip1193Provider, manager:string, change:MemberChange,
  config:V3SiteReleaseConfig, enabled:boolean, onProgress?:V3TransactionProgressCallback) {
  if(!enabled||!config.unified?.portfolio)throw Error('This vault is not enabled for manager wallet actions.');
  const member=vipMemberAddress(change.member);
  const status=change.kind==='setSuspended',method=change.kind,next=status?change.suspended:change.approved;
  const label=status?'Member status':'VIP verification',action=status?'member_status':'vip_verification';
  onProgress?.({step:'preflight',action});
  const session=await v3ReadSession(provider,manager,config,true);
  let browser:BrowserProvider|undefined;
  try{
    const previous=await lookup(session,manager,member);
    if(!previous.registered)throw Error('The member is not registered in this vault.');
    let current=previous.approved;
    if(status){
      const role=await session.vault.GUARDIAN_ROLE(session.options);
      if(!await session.vault.hasRole(role,manager,session.options))throw Error('Changing member status requires the guardian role.');
      current=(await session.vault.users(member,session.options)).suspended;
    }
    if(current!==change.previous||current===next)throw Error('The member status changed or already matches. Look up the member again.');
    onProgress?.({step:'simulation',action});
    const args=[member,next];
    const gas=await checkedGas(session,session.vault,method,args,manager);
    await verifyBlock(session,session.block.number,session.block.hash);
    browser=new BrowserProvider(provider,undefined,{cacheTimeout:-1});
    const signer=await browser.getSigner(manager);
    const data=session.vault.interface.encodeFunctionData(method,args);
    const receipt=await submitVerified(provider,manager,signer,config,config.address,data,gas,
      label,action,onProgress);
    // Require the canonical member state at the transaction block.
    try{
      const record=await session.vault.users(member,{blockTag:receipt.blockNumber});
      await verifyBlock(session,receipt.blockNumber,receipt.blockHash);
      if(!record.registered||(status?record.suspended:record.vipKyc)!==next)throw Error('Member state mismatch');
    }catch{
      throw Error(label+' '+receipt.hash+' was confirmed but its result could not be verified. Check wallet history before retrying.');
    }
    return receipt.hash;
  }finally{browser?.destroy();session.provider.destroy();}
}

export function sendManagerVip(provider:Eip1193Provider,manager:string,change:VipChange,config:V3SiteReleaseConfig,
  enabled:boolean,onProgress?:V3TransactionProgressCallback){
  return sendManagerChange(provider,manager,change,config,enabled,onProgress);
}
