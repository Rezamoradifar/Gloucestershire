// Resume only the exact signed chain-97 accrual already stored under the keeper
// lock. Missing signed bytes and conflicting nonces never authorize a new send.
import {Contract,Interface,Transaction,getAddress,parseEther} from 'ethers';
import {simulateUnifiedAccrual} from './simulate-v3-unified-keeper.mjs';
import {recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';
import {waitV3KeeperReceipt} from './v3-keeper-receipt-poll.mjs';

const methods=new Interface(['function accrueDaily(address,uint256)',
 'function accrueReinvestmentPage(address,uint256,uint256)']);
const cursorAbi=['function memberCount() view returns(uint256)',
 'function memberAt(uint256) view returns(address)',
 'function positionCount(address) view returns(uint256)'];
const maxGas=1500000n,maxGasPrice=100000000000n,maxFee=parseEther('0.005');
const minimumBalance=parseEther('0.001');
const index=n=>Number.isSafeInteger(n)&&n>=0;

export function inspectUnifiedSignedAccrual(record,operator,vault){
 try{
  if(typeof record.rawTransaction!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(record.rawTransaction)||
     record.rawTransaction.length>4096||record.chainId!==97||!index(record.nonce)||!index(record.positionId)||
     !record.retryCursor||!['member','position','lot'].every(k=>index(record.retryCursor[k]))||
     record.retryCursor.position!==record.positionId)throw Error();
  const tx=Transaction.from(record.rawTransaction);
  const who=getAddress(operator),target=getAddress(vault),member=getAddress(record.member);
  const gasLimit=BigInt(record.gasLimit),gasPrice=BigInt(record.gasPrice);
  if(tx.type!==0||tx.chainId!==97n||tx.nonce!==record.nonce||tx.from!==who||
     getAddress(record.operator)!==who||tx.to!==target||getAddress(record.vault)!==target||tx.value!==0n||
     tx.hash?.toLowerCase()!==String(record.hash).toLowerCase()||
     tx.serialized.toLowerCase()!==record.rawTransaction.toLowerCase()||
     tx.data.toLowerCase()!==String(record.transactionData).toLowerCase()||
     tx.gasLimit!==gasLimit||tx.gasPrice!==gasPrice||gasLimit<=0n||gasLimit>maxGas||
     gasPrice<=0n||gasPrice>maxGasPrice||gasLimit*gasPrice>maxFee)throw Error();
  const call=methods.parseTransaction(tx);
  if(!call||call.name!==record.method||getAddress(call.args[0])!==member||
     methods.encodeFunctionData(call.name,call.args)!==tx.data)throw Error();
  let args;
  if(call.name==='accrueDaily'){
   if(call.args[1]!==BigInt(record.positionId)||record.retryCursor.lot!==0)throw Error();
   args=[member,record.positionId];
  }else{
   if(call.args[1]!==BigInt(record.retryCursor.lot)||call.args[2]<1n||call.args[2]>8n)throw Error();
   args=[member,record.retryCursor.lot,Number(call.args[2])];
  }
  return {tx,candidate:{member,positionId:record.positionId,method:record.method,args}};
 }catch{throw Error('UNIFIED_ACCRUAL_SIGNED_JOURNAL_MISMATCH');}
}

// Caller must hold the journal lock through receipt reconciliation/checkpointing.
// This cannot create a replacement, change fees, or sign another transaction.
export async function resumeUnifiedSignedAccrual({provider,proof,operator,record,journal,
 waitReceipt=waitV3KeeperReceipt,makeContract}){
 if(!['PREPARED','BROADCAST'].includes(record.status)||record.rawTransaction===undefined)
  return {transactionSent:false};
 const {tx,candidate}=inspectUnifiedSignedAccrual(record,operator,proof.vault);
 const observe=async()=>{
  const [receipt,seen,latest,pending,chain]=await Promise.all([
   provider.getTransactionReceipt(tx.hash),provider.getTransaction(tx.hash),
   provider.getTransactionCount(operator,'latest'),provider.getTransactionCount(operator,'pending'),
   provider.send('eth_chainId',[])
  ]);
  if(BigInt(chain)!==97n)throw Error('UNIFIED_TESTNET_CHAIN_REQUIRED');
  // A known transaction or any receipt is reconciled by the normal canonical
  // receipt path on a later cycle. An inconsistent RPC never triggers a send.
  if(receipt||seen)return false;
  if(!index(latest)||latest!==tx.nonce||pending!==tx.nonce)
   throw Error('UNIFIED_ACCRUAL_PENDING_TRANSACTION_NEEDS_REVIEW');
  return true;
 };
 if(!await observe())return {transactionSent:false};
 const simulation=await simulateUnifiedAccrual({provider,proof,candidate,operator,makeContract});
 const vault=makeContract?makeContract(tx.to,cursorAbi,provider):new Contract(tx.to,cursorAbi,provider);
 const at={blockTag:simulation.block.number};
 const [members,member,positions,balance,block]=await Promise.all([
  vault.memberCount(at),vault.memberAt(record.retryCursor.member,at),
  vault.positionCount(candidate.member,at),provider.getBalance(operator),provider.getBlock('latest')
 ]);
 if(BigInt(record.retryCursor.member)>=BigInt(members)||getAddress(member)!==candidate.member||
    BigInt(candidate.positionId)>=BigInt(positions))throw Error('UNIFIED_REVIEW_CURSOR_MISMATCH');
 if(!block||typeof block.gasLimit!=='bigint'||tx.gasLimit>block.gasLimit||simulation.estimate>tx.gasLimit)
  throw Error('UNIFIED_ACCRUAL_SAVED_GAS_LIMIT_TOO_LOW');
 if(typeof balance!=='bigint'||balance<minimumBalance||balance<tx.gasLimit*tx.gasPrice)
  throw Error('UNIFIED_KEEPER_TEST_BNB_TOO_LOW');
 await recheckUnifiedBlock(provider,simulation.block);
 if(!await observe())return {transactionSent:false};
 const response=await provider.broadcastTransaction(record.rawTransaction);
 if(String(response?.hash).toLowerCase()!==tx.hash.toLowerCase())
  throw Error('UNIFIED_BROADCAST_HASH_MISMATCH_INSPECT_JOURNAL');
 if(record.status==='PREPARED')journal.markBroadcast(record.hash);
 await waitReceipt(provider,tx.hash,{confirmations:3});
 return {transactionSent:true};
}
