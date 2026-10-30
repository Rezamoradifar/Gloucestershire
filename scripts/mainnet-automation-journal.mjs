// Chain-56-only sender. It cannot approve withdrawals or deploy owner capital.
import {Interface,Transaction,ZeroAddress,getAddress,keccak256} from 'ethers';
const abi=new Interface(['function batchProfit(bytes32,address,address[],uint256[])','function pay(uint256)','function processNetworkVolume(uint256,uint256)']);
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
export function validateMainnetWorkerRequest({label,request,target,queue,token}){
 target=getAddress(target);queue=getAddress(queue);token=getAddress(token);
 let method;try{method=abi.parseTransaction(request);}catch{}
 if(!request.to||BigInt(request.value??0)!==0n||!method)throw Error('MAINNET_WORKER_SCOPE_REQUIRED');
 const destination=getAddress(request.to);
 if(/^daily-0x[0-9a-f]{64}$/i.test(label)&&destination===target&&method.name==='batchProfit'){
  const [id,asset,recipients,amounts]=method.args;
  if(id.toLowerCase()!==label.slice(6).toLowerCase()||id==='0x'+'00'.repeat(32)||![ZeroAddress,token].includes(getAddress(asset))||recipients.length<1||recipients.length>100||recipients.length!==amounts.length||amounts.some(x=>x<=0n)||recipients.some(x=>getAddress(x)===ZeroAddress)||new Set(recipients.map(x=>getAddress(x))).size!==recipients.length)throw Error('MAINNET_WORKER_SCOPE_REQUIRED');
 }else if(/^withdrawal-(0|[1-9][0-9]*)$/.test(label)&&destination===queue&&method.name==='pay'){
  if(method.args[0].toString()!==label.slice(11))throw Error('MAINNET_WORKER_SCOPE_REQUIRED');
 }else if(/^volume-(0|[1-9][0-9]*)-0x[0-9a-f]{40}$/i.test(label)&&destination===target&&method.name==='processNetworkVolume'){
  if(method.args[0].toString()!==label.split('-')[1]||method.args[1]<1n||method.args[1]>64n)throw Error('MAINNET_WORKER_SCOPE_REQUIRED');
 }else throw Error('MAINNET_WORKER_SCOPE_REQUIRED');
 return {to:destination,data:request.data,value:0n};
}
export function validateMainnetJournal({state,operator,target,queue,token,maxTotalFee}){
 if(typeof maxTotalFee!=='bigint'||maxTotalFee<=0n)throw Error('MAINNET_EXPLICIT_FEE_BUDGET_REQUIRED');
 operator=getAddress(operator);let total=0n;const pending=[];
 for(const [label,entry]of Object.entries(state.transactions||{})){
  let tx;try{tx=Transaction.from(entry.raw);}catch{throw Error('MAINNET_SAVED_TRANSACTION_INVALID');}
  if(tx.chainId!==56n||tx.from!==operator||tx.value!==0n||tx.type!==0||!hash(entry.hash)||keccak256(entry.raw)!==entry.hash||typeof entry.maxFee!=='string'||!/^(0|[1-9][0-9]*)$/.test(entry.maxFee)||tx.gasLimit*(tx.gasPrice??0n)!==BigInt(entry.maxFee))throw Error('MAINNET_SAVED_TRANSACTION_INVALID');
  const request=validateMainnetWorkerRequest({label,request:tx,target,queue,token});total+=BigInt(entry.maxFee);
  if(entry.block!==undefined&&(!Number.isSafeInteger(entry.block)||entry.block<1||!hash(entry.blockHash)))throw Error('MAINNET_SAVED_TRANSACTION_INVALID');
  if(!entry.block)pending.push({label,request});
 }
 if(total>maxTotalFee||pending.length>1)throw Error('MAINNET_FEE_BUDGET_OR_PENDING_SET_INVALID');
 return {total,pending};
}
export async function journalMainnetTransaction({provider,wallet,state,save,label,request,guard,target,queue,token,maxTotalFee,confirmations=3,timeout=60000}){
 if(typeof guard!=='function'||typeof save!=='function'||!Number.isSafeInteger(confirmations)||confirmations<1)throw Error('MAINNET_TRANSACTION_GUARD_REQUIRED');
 await guard();if(Number(await provider.send('eth_chainId',[]))!==56)throw Error('MAINNET_CHAIN_56_REQUIRED');
 const scope=validateMainnetWorkerRequest({label,request,target,queue,token});
 const checked=validateMainnetJournal({state,operator:wallet.address,target,queue,token,maxTotalFee});
 state.transactions??={};let entry=state.transactions[label];
 if(!entry){
  if(checked.pending.length)throw Error('MAINNET_PENDING_RECONCILIATION_REQUIRED');
  const [latest,pending]=await Promise.all([provider.getTransactionCount(wallet.address,'latest'),provider.getTransactionCount(wallet.address,'pending')]);
  if(latest!==pending)throw Error('MAINNET_OPERATOR_PENDING_NONCE');
  const gasLimit=(await provider.estimateGas({...scope,from:wallet.address}))*120n/100n,gasPrice=(await provider.getFeeData()).gasPrice,block=await provider.getBlock('latest');
  if(!gasPrice||gasPrice<=0n||gasLimit<=0n||!block||gasLimit>block.gasLimit)throw Error('MAINNET_GAS_ESTIMATE_REQUIRED');
  const maxFee=gasLimit*gasPrice;if(checked.total+maxFee>maxTotalFee)throw Error('MAINNET_CUMULATIVE_FEE_BUDGET_EXCEEDED');
  if(await provider.getBalance(wallet.address)<maxFee)throw Error('MAINNET_OPERATOR_GAS_REQUIRED');
  await guard();const raw=await wallet.signTransaction({...scope,chainId:56,type:0,nonce:pending,gasLimit,gasPrice});
  entry={raw,hash:keccak256(raw),maxFee:maxFee.toString()};state.transactions[label]=entry;save();
 }
 const signed=Transaction.from(entry.raw);
 if(signed.to!==scope.to||signed.data!==scope.data)throw Error('MAINNET_SAVED_REQUEST_MISMATCH');
 let receipt=await provider.getTransactionReceipt(entry.hash);
 if(!receipt){
  await guard();try{await provider.broadcastTransaction(entry.raw);}catch{
   if(!await provider.getTransaction(entry.hash)&&!await provider.getTransactionReceipt(entry.hash))throw Error('MAINNET_BROADCAST_UNCERTAIN_RESUME_SAME_BYTES');
  }
 }
 receipt=await provider.waitForTransaction(entry.hash,confirmations,timeout);
 if(!receipt)throw Error('MAINNET_PENDING_RESUME_SAME_BYTES');
 if(receipt.status!==1||receipt.hash!==entry.hash||getAddress(receipt.from)!==wallet.address||getAddress(receipt.to)!==scope.to)throw Error('MAINNET_TRANSACTION_RECEIPT_INVALID');
 const canonical=await provider.getBlock(receipt.blockNumber);
 if(canonical?.hash!==receipt.blockHash)throw Error('MAINNET_TRANSACTION_REORG');
 entry.block=receipt.blockNumber;entry.blockHash=receipt.blockHash;
 if(!state.confirmedCheckpoint||receipt.blockNumber>state.confirmedCheckpoint.block)state.confirmedCheckpoint={block:receipt.blockNumber,hash:receipt.blockHash};
 else if(receipt.blockNumber===state.confirmedCheckpoint.block&&receipt.blockHash!==state.confirmedCheckpoint.hash)throw Error('MAINNET_TRANSACTION_REORG');
 save();return receipt;
}
