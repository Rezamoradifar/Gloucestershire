export type ContractTarget={chainId:number;vaultAddress:string};
export type TransactionIdentity=ContractTarget&{who:string;provider:object|null};
export type SessionTransaction=ContractTarget&{who:string;hash:string;label:string};
export function sameContractTarget(a:ContractTarget,b:ContractTarget){
 return a.chainId===b.chainId&&a.vaultAddress.toLowerCase()===b.vaultAddress.toLowerCase();
}
export function requireContractTarget(reviewed:ContractTarget,current:ContractTarget){
 if(!sameContractTarget(reviewed,current))throw Error('The contract changed. Reload your account data and review the transaction again.');
}
// Wallet events invalidate pending results even if the same account reconnects.
export class TransactionSession {
 private revision=0;
 invalidate(){this.revision++;}
 capture(identity:TransactionIdentity){
  const revision=this.revision;
  const current=(next:TransactionIdentity)=>revision===this.revision&&identity.provider===next.provider&&identity.who.toLowerCase()===next.who.toLowerCase()&&sameContractTarget(identity,next);
  return {identity,current,verify:async(read:()=>Promise<TransactionIdentity>)=>{if(!current(identity))return false;try{return current(await read());}catch{return false;}}};
 }
}
