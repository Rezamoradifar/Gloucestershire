import {BrowserProvider, ZeroAddress, getAddress, isAddress, toQuantity, type Eip1193Provider} from 'ethers';
import {checkedGas, submitVerified, type V3TransactionProgressCallback} from './v3-actions';
import {v3ReadSession} from './v3-chain';
import type {V3SiteReleaseConfig} from './v3-site-config';

type Session = Awaited<ReturnType<typeof v3ReadSession>>;
export type VipRecord = {member:string; registered:boolean; approved:boolean; block:number; timestamp:number};
export type VipChange = {kind:'setVipKyc'; member:string; previous:boolean; approved:boolean};

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

async function lookup(session:Session, manager:string, member:string):Promise<VipRecord> {
  const {vault,options,block}=session;
  const role=await vault.MANAGER_ROLE(options);
  if(!await vault.hasRole(role, manager, options))throw Error('VIP verification requires the vault manager role.');
  const user=await vault.users(member,options);
  await verifyBlock(session,block.number,block.hash);
  return {member,registered:user.registered,approved:user.vipKyc,block:block.number,timestamp:block.timestamp};
}

export async function readManagerVip(provider:Eip1193Provider, manager:string, input:string, config:V3SiteReleaseConfig) {
  if(!config.unified?.portfolio)throw Error('A verified portfolio vault is required.');
  const member=vipMemberAddress(input),session=await v3ReadSession(provider,manager,config,true);
  try{return await lookup(session,manager,member);}finally{session.provider.destroy();}
}

export async function sendManagerVip(provider:Eip1193Provider, manager:string, change:VipChange,
  config:V3SiteReleaseConfig, enabled:boolean, onProgress?:V3TransactionProgressCallback) {
  if(!enabled||!config.unified?.portfolio)throw Error('This vault is not enabled for manager wallet actions.');
  const member=vipMemberAddress(change.member);
  onProgress?.({step:'preflight',action:'vip_verification'});
  const session=await v3ReadSession(provider,manager,config,true);
  let browser:BrowserProvider|undefined;
  try{
    const previous=await lookup(session,manager,member);
    if(!previous.registered)throw Error('The member is not registered in this vault.');
    if(previous.approved!==change.previous||previous.approved===change.approved)
      throw Error('The VIP status changed or already matches. Look up the member again.');
    onProgress?.({step:'simulation',action:'vip_verification'});
    const args=[member,change.approved];
    const gas=await checkedGas(session,session.vault,'setVipKyc',args,manager);
    await verifyBlock(session,session.block.number,session.block.hash);
    browser=new BrowserProvider(provider,undefined,{cacheTimeout:-1});
    const signer=await browser.getSigner(manager);
    const data=session.vault.interface.encodeFunctionData('setVipKyc',args);
    const receipt=await submitVerified(provider,manager,signer,config,config.address,data,gas,
      'VIP verification','vip_verification',onProgress);
    // This setter emits no event. Require the canonical state at the transaction block.
    try{
      const record=await session.vault.users(member,{blockTag:receipt.blockNumber});
      await verifyBlock(session,receipt.blockNumber,receipt.blockHash);
      if(!record.registered||record.vipKyc!==change.approved)throw Error('VIP status mismatch');
    }catch{
      throw Error('VIP verification '+receipt.hash+' was confirmed but its result could not be verified. Check wallet history before retrying.');
    }
    return receipt.hash;
  }finally{browser?.destroy();session.provider.destroy();}
}
