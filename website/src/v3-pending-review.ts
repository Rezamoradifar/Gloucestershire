import type {V3TransactionProgress} from './v3-actions';
import {V3TransactionProgressTracker} from './v3-transaction-progress';

export type V3ReviewScope={chainId:97;contract:string;wallet:string};
export type V3PendingReview={id:string;hash?:string};
type ReviewStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const fallback=new Map<string,string>();
const volatile=new Set<string>();
const address=/^0x[0-9a-f]{40}$/i,hash=/^0x[0-9a-f]{64}$/i;
export const V3_PENDING_REVIEW_MESSAGE='An earlier wallet request may have been sent. Check its transaction history before trying again.';

export function v3ReviewKey(scope:V3ReviewScope){
 if(scope.chainId!==97||!address.test(scope.contract)||!address.test(scope.wallet))
  throw Error('Invalid testnet transaction review identity.');
 return 'global-v3-pending-review:97:'+scope.contract.toLowerCase()+':'+scope.wallet.toLowerCase();
}
function browserStorage():ReviewStorage|null{
 try{return typeof window==='undefined'?null:window.localStorage;}catch{return null;}
}
export function readV3PendingReview(scope:V3ReviewScope,storage:ReviewStorage|null=browserStorage()):V3PendingReview|null{
 const key=v3ReviewKey(scope);
 let raw:string|null;
 try{
  const stored=storage?storage.getItem(key):null;
  raw=volatile.has(key)||!storage?fallback.get(key)??null:stored;
  if(volatile.has(key)&&stored!==null){
   let sameOperation=false;
   try{sameOperation=JSON.parse(stored)?.id===JSON.parse(raw??'null')?.id;}catch{/* A different unreadable record also requires review. */}
   if(!sameOperation){
    // Another tab can successfully persist a newer operation while this tab
    // is using its quota-failure fallback. Preserve that operation's ownership.
    raw=stored;volatile.delete(key);fallback.delete(key);
   }
  }
 }
 catch{raw=fallback.get(key)??null;}
 if(raw===null)return null;
 try{
  if(raw.length>2048)return {id:'unreadable'};
  const value=JSON.parse(raw);
  if(value?.version===1&&typeof value.id==='string'&&/^[a-z0-9-]{1,100}$/i.test(value.id)&&
   (value.hash===undefined||(typeof value.hash==='string'&&hash.test(value.hash))))
   return {id:value.id,...(value.hash?{hash:value.hash}:{} )};
 }catch{/* Keep an unreadable existing reminder blocked until the user reviews it. */}
 return {id:'unreadable'};
}
function writeReview(scope:V3ReviewScope,value:V3PendingReview,storage:ReviewStorage|null){
 const key=v3ReviewKey(scope),raw=JSON.stringify({version:1,...value});
 fallback.set(key,raw);
 try{
  if(storage){storage.setItem(key,raw);volatile.delete(key);}else volatile.add(key);
 }catch{volatile.add(key);}
}
export function clearV3PendingReview(scope:V3ReviewScope,storage:ReviewStorage|null=browserStorage(),expectedId?:string){
 if(expectedId&&readV3PendingReview(scope,storage)?.id!==expectedId)return;
 const key=v3ReviewKey(scope);
 try{storage?.removeItem(key);}catch{/* The reminder remains conservative on the next reload. */}
 fallback.delete(key);
 volatile.delete(key);
}

// Store only a public transaction hash and its wallet/contract scope, never
// provider errors, calldata, signatures or keys. Confirmation of the outer
// action clears the reminder after its accounting/event checks also succeed.
// Each dashboard action constructs a new tracker; completed trackers are not reused.
export class V3PersistentTransactionTracker extends V3TransactionProgressTracker{
 private readonly id=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 private transactionHash:string|undefined;
 private started=false;
 constructor(private readonly scope:V3ReviewScope,private readonly storage:ReviewStorage|null=browserStorage()){
  super();v3ReviewKey(scope);
 }
 record(detail:V3TransactionProgress){
  super.record(detail);
  if(detail.step==='wallet_request')this.transactionHash=undefined;
  if(detail.hash&&hash.test(detail.hash))this.transactionHash=detail.hash;
  if(detail.step==='wallet_request'||detail.step==='verification'||detail.step==='confirmed')this.remember();
 }
 private remember(){
  // Once another operation has replaced this marker, a delayed result from
  // the older operation must not replace or remove the newer reminder.
  if(this.started&&readV3PendingReview(this.scope,this.storage)?.id!==this.id)return;
  this.started=true;
  writeReview(this.scope,{id:this.id,...(this.transactionHash?{hash:this.transactionHash}:{})},this.storage);
 }
 needsReview(message:string){
  const needed=super.needsReview(message);
  if(needed)this.remember();else this.complete();
  return needed;
 }
 complete(){clearV3PendingReview(this.scope,this.storage,this.id);}
}
