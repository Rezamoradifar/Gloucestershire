import fs from 'node:fs';
import {Transaction,getAddress,keccak256,parseEther} from 'ethers';
export function check(ok,message){if(!ok)throw Error(message);}
export function save(file,value){
 fs.writeFileSync(file+'.tmp',JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2),{mode:0o600});
 fs.renameSync(file+'.tmp',file);
}
// Store the signed transaction before broadcast. A resumed step always reuses it.
export function createJournalSender({provider,state,journal,record,afterBroadcast,maxCost,maxGasPrice=parseEther('0.000000003')}){
 return async function send(name,signer,request){
  let step=state.steps.find(s=>s.name===name);
  if(!step){
   check(Number((await provider.getNetwork()).chainId)===97,'RPC network changed');
   const gasPrice=(await provider.getFeeData()).gasPrice;
   check(gasPrice>0n&&gasPrice<=maxGasPrice,'Gas price exceeds the test budget limit; retry later');
   const gasLimit=(await provider.estimateGas({...request,from:signer.address}))*125n/100n;
   check(gasLimit<=3000000n,'Unexpected test gas estimate');
   const cost=gasPrice*gasLimit+(request.value??0n);
   check(state.steps.reduce((sum,s)=>sum+BigInt(s.maxCost),0n)+cost<=maxCost,'Maximum test budget exceeded; stopped');
   check(await provider.getBalance(signer.address)>=cost,'Insufficient tBNB for '+signer.address);
   const nonce=await provider.getTransactionCount(signer.address,'pending');
   const raw=await signer.signTransaction({...request,chainId:97,type:0,gasPrice,gasLimit,nonce,value:request.value??0n});
   step={name,raw,hash:keccak256(raw),maxCost:cost.toString()};state.steps.push(step);save(journal,state);record();
  }
  const tx=Transaction.from(step.raw);
  check(tx.chainId===97n&&tx.from===signer.address&&tx.to===getAddress(request.to)&&tx.data===(request.data??'0x')&&tx.value===(request.value??0n)&&keccak256(step.raw)===step.hash,'Saved transaction mismatch: '+name);
  let receipt=await provider.getTransactionReceipt(step.hash);
  if(!receipt){
   if(!await provider.getTransaction(step.hash)){
    try{await provider.broadcastTransaction(step.raw);}catch{check(await provider.getTransaction(step.hash),'Broadcast not confirmed. Keep the journal and rerun the same command.');}
   }
   if(afterBroadcast)await afterBroadcast(name);
   console.log(name+': https://testnet.bscscan.com/tx/'+step.hash);
   receipt=await provider.waitForTransaction(step.hash,1,45000);
  }
  check(receipt?.status===1,'Pending or reverted transaction: '+step.hash+'. Keep the journal; rerun for a pending transaction only.');
  step.blockNumber=receipt.blockNumber;save(journal,state);record();return receipt;
 };
}
