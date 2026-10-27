import {BrowserProvider,isAddress} from 'ethers';
import {chainId,vaultAddress,configured} from './config';
import {getWalletProvider} from './wallet';
export class CommunityApiError extends Error {
 constructor(message:string,public status:number){super(message);}
}
export async function communityApi<T>(route:string,method='GET',body?:unknown,token=''):Promise<T>{
 const response=await fetch('/api/community/'+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 let data;
 try{data=await response.json();}catch{throw new CommunityApiError('Support server unavailable. Check that its update is installed.',503);}
 if(!data||typeof data!=='object'||Array.isArray(data))throw new CommunityApiError('Invalid support server response.',503);
 if(!response.ok)throw new CommunityApiError(data.error||'Support request failed.',response.status);
 return data;
}
// Support authentication needs a wallet message, never vault reads or a transaction.
export async function signInSupport(who:string,valid:()=>boolean,request=communityApi):Promise<string>{
 if(!configured||!isAddress(who))throw Error('Connect your wallet first.');
 const wallet=getWalletProvider();if(!wallet)throw Error('Connect your wallet first.');
 async function check(){
  if(!valid())throw Error('Support account changed. Try again.');
  const network=await wallet!.request({method:'eth_chainId'}),accounts=await wallet!.request({method:'eth_accounts'}) as string[];
  if(!valid()||!accounts?.[0]||accounts[0].toLowerCase()!==who.toLowerCase())throw Error('The wallet account changed. Reconnect your wallet.');
  if(Number(network)!==chainId)throw Error('Switch your wallet to the configured network.');
 }
 await check();
 const challenge=await request<{nonce:string;message:string}>('challenge','POST',{wallet:who});
 await check();
 const lines=challenge.message?.split('\n');
 const origins=new Set([window.location.origin]);
 if(window.location.origin==='https://www.globaldroptrade.com')origins.add('https://globaldroptrade.com');
 if(!/^[a-f0-9]{48}$/.test(challenge.nonce)||lines?.length!==8||lines[0]!=='GlobalDropTrade support sign-in'||!origins.has(lines[1]?.slice(8)||'')||!lines[1]?.startsWith('Origin: ')||lines[2]!==`Chain: ${chainId}`||lines[3]?.toLowerCase()!==`Contract: ${vaultAddress}`.toLowerCase()||lines[4]?.toLowerCase()!==`Wallet: ${who}`.toLowerCase()||lines[5]!==`Nonce: ${challenge.nonce}`||!Number.isFinite(Date.parse(lines[6]?.slice(9)))||!lines[6]?.startsWith('Expires: ')||lines[7]!=='This signature authenticates support access only. It does not authorize a transaction.')throw Error('The support sign-in request does not match this website and account.');
 const provider=new BrowserProvider(wallet);
 try{
  const signer=await provider.getSigner(who);await check();
  const signature=await signer.signMessage(challenge.message);await check();
  const result=await request<{token:string}>('session','POST',{nonce:challenge.nonce,signature});
  await check();return result.token;
 }finally{provider.destroy();}
}
export async function withSupportSession<T>(token:string,authenticate:()=>Promise<string>,remember:(value:string)=>void,action:(value:string)=>Promise<T>):Promise<T>{
 let auth=token;
 if(!auth){auth=await authenticate();remember(auth);}
 try{return await action(auth);}catch(error){
  if(!(error instanceof CommunityApiError)||error.status!==401)throw error;
  remember('');throw new CommunityApiError('Support session expired. Sign in again to continue.',401);
 }
}
