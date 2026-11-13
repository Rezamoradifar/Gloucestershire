import {BrowserProvider,isAddress} from 'ethers';
import {V2_ADDRESS,V2_CHAIN_ID} from './v2-chain';
import {getWalletProvider} from './wallet';

export class V2SupportError extends Error{
 constructor(message:string,public status:number){super(message);}
}
export async function v2SupportApi<T>(route:string,method='GET',body?:unknown,token=''):Promise<T>{
 if(!/^(?:announcements(?:\/[a-zA-Z0-9-]+)?|challenge|session|tickets(?:\/[a-zA-Z0-9-]+)?)(?:\?admin=1)?$/.test(route))
  throw new V2SupportError('Unsupported V2 support action.',400);
 const res=await fetch('/api/v2/community/'+route,{method,headers:{
  ...(body?{'Content-Type':'application/json'}:{}),
  ...(token?{Authorization:'Bearer '+token}:{})
 },body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 let json:unknown;try{json=await res.json();}catch{
  throw new V2SupportError('V2 support service not installed or currently unavailable.',503);
 }
 if(!json||typeof json!=='object'||Array.isArray(json))
  throw new V2SupportError('Invalid V2 support server response.',503);
 if(!res.ok)throw new V2SupportError(
  (json as {error?:string}).error||'V2 support operation failed.',res.status);
 return json as T;
}
export async function signInV2Support(who:string,valid:()=>boolean,request=v2SupportApi):Promise<string>{
 if(!isAddress(who))throw Error('Connect a valid V2 wallet.');
 const wallet=getWalletProvider();if(!wallet)throw Error('Connect a wallet before signing in.');
 const check=async()=>{
  if(!valid()||wallet!==getWalletProvider())throw Error('Wallet context changed.');
  const [chain,accounts]=await Promise.all([
   wallet.request({method:'eth_chainId'}),wallet.request({method:'eth_accounts'})
  ]);
  if(!valid()||Number(chain)!==V2_CHAIN_ID||!Array.isArray(accounts)||
    accounts[0]?.toLowerCase()!==who.toLowerCase())
   throw Error('Connect the same wallet on BNB Testnet (97).');
 };
 await check();
 const challenge=await request<{nonce:string;message:string}>('challenge','POST',{wallet:who});
 const origin=window.location.origin;
 const allowed=[origin];
 if(origin==='https://www.globaldroptrade.com')allowed.push('https://globaldroptrade.com');
 if(origin==='https://globaldroptrade.com')allowed.push('https://www.globaldroptrade.com');
 const lines=challenge.message?.split('\n');
 if(!/^[a-f0-9]{48}$/.test(challenge.nonce)||lines?.length!==8||
  lines[0]!=='GlobalDropTrade support sign-in'||!lines[1]?.startsWith('Origin: ')||
  !allowed.includes(lines[1].slice(8))||lines[2]!=='Chain: '+V2_CHAIN_ID||
  lines[3]?.toLowerCase()!=='Contract: '.concat(V2_ADDRESS).toLowerCase()||
  lines[4]?.toLowerCase()!=='Wallet: '.concat(who).toLowerCase()||
  lines[5]!=='Nonce: '+challenge.nonce||!lines[6]?.startsWith('Expires: ')||
  !Number.isFinite(Date.parse(lines[6].slice(9)))||
  lines[7]!=='This signature authenticates support access only. It does not authorize a transaction.')
  throw Error('Support challenge does not belong to NEW V2 account.');
 const provider=new BrowserProvider(wallet);
 try{
  await check();
  const signature=await (await provider.getSigner(who)).signMessage(challenge.message);
  await check();
  const result=await request<{token:string}>('session','POST',{nonce:challenge.nonce,signature});
  await check();return result.token;
 }finally{provider.destroy();}
}
export async function withV2SupportSession<T>(token:string,authenticate:()=>Promise<string>,
 remember:(value:string)=>void,action:(session:string)=>Promise<T>):Promise<T>{
 let auth=token;
 if(!auth){auth=await authenticate();remember(auth);}
 try{return await action(auth);}catch(error){
  if(!(error instanceof V2SupportError)||error.status!==401)throw error;
  remember('');throw new V2SupportError('V2 support session expired. Sign in again.',401);
 }
}
