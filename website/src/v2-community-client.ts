import {signInSupport} from './support-sign-in';
import {V2_ADDRESS,V2_CHAIN_ID} from './v2-chain';

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
export function signInV2Support(who:string,valid:()=>boolean,request=v2SupportApi):Promise<string>{
 return signInSupport(who,V2_ADDRESS,V2_CHAIN_ID,valid,request);
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
