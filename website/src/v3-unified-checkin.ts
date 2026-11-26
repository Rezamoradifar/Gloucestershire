// BNB Testnet check-in for the explicitly enabled unified release.
// Check-in records activity only. It neither accrues nor transfers rewards;
// a separately verified keeper or user action is still required for accrual.
import {BrowserProvider,Interface,getAddress,toQuantity,type Eip1193Provider} from 'ethers';
import {checkedGas,checkedGasLimit,submitVerified,type V3TransactionProgressCallback} from './v3-actions';
import {sendSponsoredCheckIn} from './v3-sponsored-checkin';
import {V3_ABI,v3ReadSession} from './v3-chain';
import type {V3SiteReleaseConfig} from './v3-site-config';

const events=new Interface(V3_ABI);
export async function sendV3UnifiedCheckIn(walletProvider:Eip1193Provider,wallet:string,
 config:V3SiteReleaseConfig|null,options:{enabled?:boolean;onProgress?:V3TransactionProgressCallback;selfFunded?:true}={}){
 if(options.enabled!==true)throw Error('The unified testnet preview is read-only.');
 if(!config?.unified)throw Error('The verified unified testnet contract is required.');
 const who=getAddress(wallet),notify=(step:'preflight'|'simulation')=>{
  try{options.onProgress?.({step,action:'check_in'});}catch{/* Presentation must not affect transactions. */}
 };
 notify('preflight');
 const session=await v3ReadSession(walletProvider,who,config,true);
 let browser:BrowserProvider|undefined;
 try{
  const {vault,provider,block}=session;
  const [user,paused,period]=await Promise.all([
   vault.users(who,session.options),vault.paused(session.options),vault.ACCRUAL_PERIOD(session.options)
  ]);
  if(!user.registered||user.suspended||paused)throw Error('This test account cannot check in.');
  if(config.unified.dailyPlan&&(user.capital<10n*10n**18n||(user.capital>50000n*10n**18n&&!user.vipKyc)))
   throw Error('Check-in requires 10 test USDT of principal and VIP verification above 50,000.');
  if(BigInt(period)!==(config.unified.dailyPlan?86400n:3600n)||!Number.isSafeInteger(block.timestamp)||block.timestamp<0)
   throw Error('The verified check-in period is invalid.');
  const previous=BigInt(user.lastCheckIn);
  if(previous!==0n&&BigInt(block.timestamp)<previous+3600n)
   throw Error('Check-in is still on cooldown.');
  notify('simulation');
  const sponsored=config.unified.portfolio&&!options.selfFunded;
  const gas=sponsored?{gasLimit:await checkedGasLimit(session,vault,'checkIn',[],who,0n),gasPrice:0n}:
   await checkedGas(session,vault,'checkIn',[],who);
  const canonical=await provider.send('eth_getBlockByNumber',[toQuantity(block.number),false]);
  if(!block.hash||!canonical?.hash||String(canonical.hash).toLowerCase()!==block.hash.toLowerCase())
   throw Error('The verified check-in block changed; refresh before continuing.');
  const data=events.encodeFunctionData('checkIn',[]);
  let receipt;
  if(sponsored){
   const nonce=await provider.getTransactionCount(who,'pending');
   receipt=await sendSponsoredCheckIn(walletProvider,who,config,gas.gasLimit,nonce,options.onProgress);
  }else{
   browser=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
   const signer=await browser.getSigner(who);
   receipt=await submitVerified(walletProvider,who,signer,config,config.address,data,gas,
    'Check-in','check_in',options.onProgress);
  }
  try{
   const checkins=receipt.logs.flatMap(log=>{
    if(log.address.toLowerCase()!==config.address.toLowerCase())return [];
    try{const event=events.parseLog({topics:log.topics,data:log.data});
     return event?.name==='CheckIn'&&getAddress(event.args.user)===who?[event]:[];
    }catch{return [];}
   });
   if(checkins.length!==1)throw Error('CHECKIN_EVENT_MISMATCH');
   // `at` is also Array.prototype.at on ethers Result; use ABI index.
   const at=BigInt(checkins[0].args[1]);
   const [record,receiptBlock]=await Promise.all([
    vault.users(who,{blockTag:receipt.blockNumber}),
    provider.send('eth_getBlockByNumber',[toQuantity(receipt.blockNumber),false])
   ]);
   if(!receiptBlock?.hash||String(receiptBlock.hash).toLowerCase()!==receipt.blockHash.toLowerCase()||
      typeof receiptBlock.number!=='string'||BigInt(receiptBlock.number)!==BigInt(receipt.blockNumber)||
      typeof receiptBlock.timestamp!=='string'||BigInt(receiptBlock.timestamp)!==at||
      !record.registered||BigInt(record.lastCheckIn)!==at)throw Error('CHECKIN_RECORD_MISMATCH');
   const finalBlock=await provider.send('eth_getBlockByNumber',[toQuantity(receipt.blockNumber),false]);
   if(!finalBlock?.hash||String(finalBlock.hash).toLowerCase()!==receipt.blockHash.toLowerCase())
    throw Error('CHECKIN_BLOCK_CHANGED');
   return {hash:receipt.hash,at,accrualPerformed:false};
  }catch{
   throw Error('Check-in transaction '+receipt.hash+' was confirmed but its record could not be verified. Check wallet history before retrying.');
  }
 }finally{browser?.destroy();session.provider.destroy();}
}
