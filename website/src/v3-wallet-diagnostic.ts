// Read-only wallet diagnostics. No signing, transaction submission or secrets.
import {formatEther,getAddress,isAddress,type Eip1193Provider} from 'ethers';
import {v3ReadSession} from './v3-chain';
import type {V3SiteReleaseConfig} from './v3-site-config';

type WalletStatus='ok'|'unavailable'|'wrong_network'|'account_mismatch'|'changed';
export type V3WalletDiagnostic={
 wallet:{status:WalletStatus;chainId:number|null;accountMatches:boolean|null;testBNB:string|null};
 independent:{status:'ok'|'unavailable';block:number|null;testBNB:string|null};
};

async function bounded<T>(work:Promise<T>,milliseconds:number):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>reject(Error('TIMEOUT')),milliseconds);
 })]);}finally{if(timer!==undefined)clearTimeout(timer);}
}
async function selection(provider:Eip1193Provider,wallet:string){
 try{
  const [rawChain,rawAccounts]=await Promise.all([
   bounded(provider.request({method:'eth_chainId'}),8000),
   bounded(provider.request({method:'eth_accounts'}),8000)
  ]);
  const big=BigInt(String(rawChain));
  if(big<0n||big>BigInt(Number.MAX_SAFE_INTEGER)||!Array.isArray(rawAccounts))throw Error('INVALID');
  const chainId=Number(big);
  const accountMatches=rawAccounts.some(a=>typeof a==='string'&&isAddress(a)&&getAddress(a)===wallet);
  return {status:(chainId!==97?'wrong_network':!accountMatches?'account_mismatch':'ok') as WalletStatus,chainId,accountMatches};
 }catch{return {status:'unavailable' as WalletStatus,chainId:null,accountMatches:null};}
}

/** Query only public information for the selected account on BNB Testnet.
 * A successful check does not prove that the wallet will accept a transaction.
 */
export async function diagnoseV3Wallet(provider:Eip1193Provider,walletInput:string,
 config:V3SiteReleaseConfig|null):Promise<V3WalletDiagnostic>{
 if(!isAddress(walletInput))throw Error('Connect a valid wallet to run diagnostics.');
 const wallet=getAddress(walletInput),first=await selection(provider,wallet);
 const empty={status:'unavailable' as const,block:null,testBNB:null};
 if(first.status!=='ok')return {wallet:{...first,testBNB:null},independent:empty};
 const walletRead=async()=>{
  try{
   const value=await bounded(provider.request({method:'eth_getBalance',params:[wallet,'latest']}),8000);
   if(typeof value!=='string'||!/^0x[0-9a-f]+$/i.test(value))throw Error('INVALID');
   return formatEther(BigInt(value));
  }catch{return null;}
 };
 const independentRead=async()=>{
  try{
   const session=await v3ReadSession(provider,wallet,config,true);
   try{
    if(!Number.isSafeInteger(session.block.number)||session.block.number<0)throw Error('INVALID');
    return {status:'ok' as const,block:session.block.number,
     testBNB:formatEther(await session.provider.getBalance(wallet,session.block.number))};
   }finally{session.provider.destroy();}
  }catch{return empty;}
 };
 const [walletBalance,independent]=await Promise.all([walletRead(),independentRead()]);
 const final=await selection(provider,wallet);
 if(final.status!=='ok')return {wallet:{status:'changed',chainId:final.chainId,
  accountMatches:final.accountMatches,testBNB:null},independent:empty};
 return {wallet:{...final,status:walletBalance===null?'unavailable':'ok',testBNB:walletBalance},independent};
}
