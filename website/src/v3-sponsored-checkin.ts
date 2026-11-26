import {Transaction,getAddress,id,toQuantity,type Eip1193Provider} from 'ethers';
import {checkWalletStillSelected,confirmV3Transaction,type V3TransactionProgressCallback} from './v3-actions';
import type {V3SiteReleaseConfig} from './v3-site-config';

const endpoint='https://bsc-megafuel-testnet.nodereal.io/';
const checkInData=id('checkIn()').slice(0,10);
export class SponsorUnavailable extends Error {}

async function sponsorRpc(method:string,params:unknown[]){
 const response=await fetch(endpoint,{method:'POST',credentials:'omit',redirect:'error',
  headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 if(!response.ok)throw Error('Sponsor unavailable.');
 const body=await response.json();
 if(body?.jsonrpc!=='2.0'||body.id!==1||body.error||body.result===undefined)throw Error('Sponsor unavailable.');
 return body.result;
}

export async function sendSponsoredCheckIn(provider:Eip1193Provider,wallet:string,config:V3SiteReleaseConfig,
 gasLimit:bigint,nonce:number,onProgress?:V3TransactionProgressCallback){
 if(!config.unified?.portfolio||!Number.isSafeInteger(nonce)||nonce<0||gasLimit<=0n)
  throw Error('A verified BNB Testnet portfolio account is required.');
 const from=getAddress(wallet),to=getAddress(config.address);
 const call={from,to,data:checkInData,value:'0x0',gas:toQuantity(gasLimit)};
 let quote;
 try{quote=await sponsorRpc('pm_isSponsorable',[call]);}
 catch{throw new SponsorUnavailable('The renewal sponsor is unavailable. No transaction was sent.');}
 if(quote?.sponsorable!==true)throw new SponsorUnavailable('A funded sponsor is required for free renewal. No transaction was sent.');
 await checkWalletStillSelected(provider,from);
 const transaction={...call,chainId:'0x61',type:'0x0',nonce:toQuantity(nonce),gasPrice:'0x0'};
 const notify=(step:'signature'|'verification',hash?:string)=>{
  try{onProgress?.({step,action:'check_in',hash});}catch{/* View updates do not affect signing. */}
 };
 notify('signature');
 let signed;
 try{signed=await provider.request({method:'eth_signTransaction',params:[transaction]});}
 catch(error){
  if((error as {code?:number})?.code===4001)throw Error('Renewal was declined in your wallet.');
  throw new SponsorUnavailable('This wallet could not sign a zero-fee transaction. No transaction was sent.');
 }
 const raw=typeof signed==='string'?signed:signed?.raw;
 let tx:Transaction;
 try{
  if(typeof raw!=='string'||raw.length>2048)throw Error();
  tx=Transaction.from(raw);
  if(!tx.isSigned()||tx.chainId!==97n||tx.type!==0||tx.from!==from||tx.to!==to||
     tx.nonce!==nonce||tx.gasLimit!==gasLimit||tx.gasPrice!==0n||tx.value!==0n||tx.data!==checkInData)throw Error();
 }catch{throw Error('The wallet changed the requested zero-fee renewal. No transaction was sent.');}
 await checkWalletStillSelected(provider,from);
 const hash=tx.hash!;
 notify('verification',hash);
 // A relay timeout after submission can mean the transaction was accepted.
 // Verify the locally computed hash on chain before allowing a retry.
 try{await sponsorRpc('eth_sendRawTransaction',[raw]);}catch{/* The independent receipt is authoritative. */}
 return confirmV3Transaction(provider,from,config,to,checkInData,hash,'Sponsored renewal','check_in',onProgress,true);
}
