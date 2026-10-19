import fs from 'node:fs';
import path from 'node:path';
import {Transaction,keccak256,parseEther} from 'ethers';

export function writePrivateJson(file,value) {
 const temp=file+'.tmp';
 const fd=fs.openSync(temp,fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
 try {fs.writeFileSync(fd,JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
 fs.renameSync(temp,file);
 const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}

// Persist the signed transaction BEFORE broadcasting. Resume never chooses a new nonce.
export async function journalTransaction({provider,wallet,state,save,label,request,guard,log=()=>{},confirmations=3,timeout=180000,maxTotalFee=parseEther('0.1')}) {
 await guard();
 let entry=state.transactions[label];
 if(!entry){
  const latest=await provider.getTransactionCount(wallet.address,'latest');
  const pending=await provider.getTransactionCount(wallet.address,'pending');
  if(latest!==pending)throw Error('OWNER_HAS_PENDING_TRANSACTIONS');
  const gas=await provider.estimateGas({...request,from:wallet.address});
  const gasLimit=gas*120n/100n,block=await provider.getBlock('latest');
  if(gasLimit>block.gasLimit)throw Error('BLOCK_GAS_LIMIT');
  const gasPrice=(await provider.getFeeData()).gasPrice;
  if(!gasPrice||gasPrice<=0n)throw Error('GAS_PRICE_UNAVAILABLE');
  const fee=gasLimit*gasPrice;
  const reserved=Object.values(state.transactions).reduce((sum,t)=>sum+BigInt(t.maxFee),0n);
  if(reserved+fee>maxTotalFee)throw Error('TOTAL_TEST_BNB_FEE_LIMIT_0_1');
  if(await provider.getBalance(wallet.address)<fee)throw Error('INSUFFICIENT_TEST_BNB');
  await guard();
  const raw=await wallet.signTransaction({...request,type:0,chainId:97,nonce:pending,value:0n,gasLimit,gasPrice});
  entry={raw,hash:keccak256(raw),maxFee:fee.toString()};state.transactions[label]=entry;save();
 }
 const parsed=Transaction.from(entry.raw);
 if(parsed.from!==wallet.address||parsed.chainId!==97n||parsed.to!==(request.to??null)||parsed.data!==(request.data??'0x')||parsed.value!==0n||keccak256(entry.raw)!==entry.hash)throw Error('JOURNAL_TRANSACTION_MISMATCH');
 let receipt=await provider.getTransactionReceipt(entry.hash);
 if(!receipt){
  await guard();
  try{await provider.broadcastTransaction(entry.raw);}catch{
   // A lost RPC response may mean the identical transaction was already accepted.
   if(!await provider.getTransaction(entry.hash)&&!await provider.getTransactionReceipt(entry.hash))throw Error('BROADCAST_UNCONFIRMED_RESUME_SAME_JOURNAL');
  }
 }
 log(label+' TX '+entry.hash);
 receipt=await provider.waitForTransaction(entry.hash,confirmations,timeout);
 if(!receipt)throw Error('TRANSACTION_PENDING_RESUME_SAME_JOURNAL');
 if(receipt.status!==1)throw Error('TRANSACTION_REVERTED_STOPPED');
 const canonical=await provider.getBlock(receipt.blockNumber);
 if(canonical?.hash!==receipt.blockHash)throw Error('TRANSACTION_REORG');
 entry.block=receipt.blockNumber;entry.blockHash=receipt.blockHash;save();
 return receipt;
}
