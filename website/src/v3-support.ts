import {getAddress} from 'ethers';
import {getWalletProvider} from './wallet';
import {readWalletSelection} from './wallet-read';
import {signInSupport} from './support-sign-in';

export type SupportSession={token:string};
export type TicketStatus='open'|'closed';
export type TicketRow={id:string;wallet:string;title:string;status:TicketStatus;createdAt:string;updatedAt:string;messages:number};
export type Ticket=Omit<TicketRow,'messages'>&{messages:{id:string;message:string;admin:boolean;createdAt:string}[]};
export type Announcement={id:string;title:string;message:string;published:boolean;revision?:number;createdAt:string;updatedAt?:string};
export type SupportPage<T>={items:T[];page:number;pageSize:number;total:number};

export class SupportError extends Error{
 constructor(message:string,readonly status:number){super(message);}
}

export function portfolioSupport(vault:string,wallet:string,session:SupportSession){
 const address=getAddress(vault),provider=getWalletProvider(),events=new EventTarget();
 async function request<T>(route:string,method='GET',body?:unknown,token=''):Promise<T>{
  const response=await fetch('/api/v3/community/'+address.toLowerCase()+'/'+route,{
   method,credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(35000),
   headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok){
   if(response.status===401&&token&&token===session.token){session.token='';events.dispatchEvent(new Event('expired'));}
   throw new SupportError(typeof data?.error==='string'?data.error:'Support is temporarily unavailable.',response.status);
  }
  if(data?.chainId!==97||data?.vault!==address)throw Error('The support response does not match this workspace.');
  if(method!=='GET'&&!['challenge','session'].includes(route))events.dispatchEvent(new Event('change'));
  return data as T;
 }
 async function authenticate(valid:()=>boolean,interactive=true){
  if(!wallet||!valid())throw Error('Connect your wallet on BNB Testnet to use support.');
  if(!provider||provider!==getWalletProvider())throw Error('Wallet connection changed. Reconnect to open support.');
  if(session.token){
   const selection=await readWalletSelection(provider);
   if(!valid()||provider!==getWalletProvider()||Number(selection.chainId)!==97||!Array.isArray(selection.accounts)||
    String(selection.accounts[0]).toLowerCase()!==wallet.toLowerCase()){
    session.token='';throw new SupportError('Wallet changed. Open support with the selected account.',401);
   }
  }else{
   if(!interactive)throw new SupportError('Open your inbox to sign in again.',401);
   const token=await signInSupport(wallet,address,97,valid,request);
   if(!valid())throw Error('Wallet context changed.');
   session.token=token;events.dispatchEvent(new Event('signed-in'));
  }
  return session.token;
 }
 return {request,authenticate,session,events};
}
export type SupportClient=ReturnType<typeof portfolioSupport>;
