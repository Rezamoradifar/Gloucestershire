// Experimental read-only confirmation review. Never clears a journal,
// checkpoints a cursor, broadcasts or authorizes a retry. A trusted deployment
// proof and a single dedicated journal path remain operator responsibilities.
import {Interface,getAddress,isAddress,ZeroAddress} from 'ethers';
import {openUnifiedJournal} from './v3-unified-keeper-journal.mjs';
import {verifyUnifiedDeployment,recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';
import {verifyUnifiedAccrualReceipt} from './execute-v3-unified-keeper.mjs';

const abi=new Interface(['function accrueDaily(address,uint256)',
 'function accrueReinvestmentPage(address,uint256,uint256)']);
const index=n=>Number.isSafeInteger(n)&&n>=0;
const decimal=/^[0-9]+$/;
const cursor=value=>{
 if(!value||!['member','position','lot'].every(key=>index(value[key])))
  throw Error('INVALID_UNIFIED_REVIEW_CURSOR');
 return {member:value.member,position:value.position,lot:value.lot};
};
const safeAddress=value=>{
 if(!isAddress(value)||getAddress(value)===ZeroAddress)throw Error('INVALID_UNIFIED_REVIEW_ADDRESS');
 return getAddress(value);
};

export async function reviewUnifiedConfirmedJournal({provider,proof,operator:expectedOperator,journalDirectory,makeContract}){
 const expected=safeAddress(expectedOperator);
 const journal=openUnifiedJournal(journalDirectory);
 try{
  const record=journal.read();
  if(!record)return {state:'NO_JOURNAL',safeToRetry:false,transactionSent:false,cursorPersisted:false};
  if(!['accrueDaily','accrueReinvestmentPage'].includes(record.method)||
     !index(record.positionId)||typeof record.transactionData!=='string'||
     typeof record.gasLimit!=='string'||!decimal.test(record.gasLimit)||BigInt(record.gasLimit)<=0n||
     typeof record.gasPrice!=='string'||!decimal.test(record.gasPrice)||BigInt(record.gasPrice)<=0n)
   throw Error('INVALID_UNIFIED_REVIEW_TRANSACTION');
  const vault=safeAddress(record.vault),member=safeAddress(record.member),operator=safeAddress(record.operator);
  if(operator!==expected)throw Error('UNIFIED_REVIEW_OPERATOR_MISMATCH');
  const retry=cursor(record.retryCursor);
  if(retry.position!==record.positionId)throw Error('INVALID_UNIFIED_REVIEW_CURSOR');
  let args;
  try{args=abi.decodeFunctionData(record.method,record.transactionData);}catch{throw Error('INVALID_UNIFIED_REVIEW_TRANSACTION');}
  if(abi.encodeFunctionData(record.method,Array.from(args)).toLowerCase()!==record.transactionData.toLowerCase())
   throw Error('INVALID_UNIFIED_REVIEW_TRANSACTION');
  if(getAddress(args[0])!==member)throw Error('INVALID_UNIFIED_REVIEW_TRANSACTION');
  const grouped=record.method==='accrueReinvestmentPage';
  if(grouped){
   if(BigInt(args[1])!==BigInt(retry.lot)||BigInt(args[2])<1n||BigInt(args[2])>8n)
    throw Error('INVALID_UNIFIED_REVIEW_TRANSACTION');
  }else if(retry.lot!==0||BigInt(args[1])!==BigInt(record.positionId))
   throw Error('INVALID_UNIFIED_REVIEW_TRANSACTION');
  const verified=await verifyUnifiedDeployment(provider,proof,makeContract?{makeContract}:{});
  if(verified.proof.vault!==vault)throw Error('UNIFIED_REVIEW_DEPLOYMENT_MISMATCH');
  const receipt=await provider.getTransactionReceipt(record.hash);
  if(!receipt)return {state:'RECEIPT_NOT_OBSERVED',safeToRetry:false,transactionSent:false,cursorPersisted:false};
  if(receipt.blockNumber>verified.block.number)
   return {state:'AWAITING_CONFIRMED_STATE',safeToRetry:false,transactionSent:false,cursorPersisted:false};
  const at={blockTag:verified.block.number};
  const [memberCount,actualMember,positionCount,group]=await Promise.all([
   verified.vault.memberCount(at),verified.vault.memberAt(retry.member,at),
   verified.vault.positionCount(member,at),verified.vault.reinvestmentPositionPlusOne(member,at)
  ]);
  if(BigInt(retry.member)>=BigInt(memberCount)||getAddress(actualMember)!==member||
     BigInt(record.positionId)>=BigInt(positionCount)||BigInt(group)>BigInt(positionCount)||
     grouped!==(BigInt(group)===BigInt(record.positionId)+1n))
   throw Error('UNIFIED_REVIEW_CURSOR_MISMATCH');
  const position=await verified.vault.positionOf(member,record.positionId,at);
  if(typeof position.fromReinvestment!=='boolean'||position.fromReinvestment!==grouped)
   throw Error('UNIFIED_REVIEW_CURSOR_MISMATCH');
  if(grouped){
   const groupPosition=await verified.book.position(member,at);
   if(BigInt(retry.lot)>=BigInt(groupPosition.lots))throw Error('UNIFIED_REVIEW_CURSOR_MISMATCH');
  }
  const simulation={vault,member,positionId:record.positionId,
   gasLimit:BigInt(record.gasLimit),gasPrice:BigInt(record.gasPrice)};
  await verifyUnifiedAccrualReceipt({provider,receipt,hash:record.hash,simulation,operator,
   nonce:record.nonce,data:record.transactionData});
  await recheckUnifiedBlock(provider,verified.block);
  return {state:'CONFIRMED_REQUIRES_RECONCILIATION',chainId:97,hash:record.hash,
   anchor:verified.block,retryCursor:retry,safeToRetry:false,transactionSent:false,cursorPersisted:false};
 }finally{journal.close();}
}
