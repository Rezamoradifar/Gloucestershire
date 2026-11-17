// Read-only diagnostic for an experimental keeper journal. It never mutates
// the record, releases a stale lock, signs, broadcasts or advances a cursor.
// RPC observations alone are not a deployment proof or permission to retry.
import {getAddress,isAddress,toQuantity} from 'ethers';
import {openUnifiedJournal} from './v3-unified-keeper-journal.mjs';

const hex=/^0x(?:[a-fA-F0-9]{2})*$/;
const hash=/^0x[a-fA-F0-9]{64}$/;
const decimal=/^[0-9]+$/;
const result=(record,state,extra={})=>({chainId:97,hash:record.hash,journalStatus:record.status,
 state,safeToRetry:false,verificationComplete:false,transactionSent:false,...extra});

export async function inspectUnifiedKeeperJournal({provider,journalDirectory}){
 const journal=openUnifiedJournal(journalDirectory);
 try{
  const record=journal.read();
  if(!record)return {chainId:null,state:'NO_RECORD',safeToRetry:false,verificationComplete:false,transactionSent:false};
  if(BigInt(await provider.send('eth_chainId',[]))!==97n)throw Error('UNIFIED_TESTNET_CHAIN_REQUIRED');
  // Older journal records lacked the exact calldata. Never infer it from the
  // cursor or mark such a record safe to retry.
  if(record.transactionData===undefined||record.gasLimit===undefined||record.gasPrice===undefined)
   return result(record,'LEGACY_RECORD_REQUIRES_MANUAL_REVIEW');
  if(!isAddress(record.operator)||!isAddress(record.vault)||
     typeof record.transactionData!=='string'||!hex.test(record.transactionData)||record.transactionData.length<10||
     typeof record.gasLimit!=='string'||!decimal.test(record.gasLimit)||BigInt(record.gasLimit)<=0n||
     typeof record.gasPrice!=='string'||!decimal.test(record.gasPrice)||BigInt(record.gasPrice)<=0n)
   throw Error('UNIFIED_JOURNAL_TRANSACTION_INVALID');
  const [tx,receipt]=await Promise.all([provider.getTransaction(record.hash),provider.getTransactionReceipt(record.hash)]);
  if(!tx&&!receipt)return result(record,'NOT_OBSERVED');
  if(!tx)return result(record,'RECEIPT_WITHOUT_TRANSACTION_REVIEW');
  let matches=false;
  try{matches=String(tx.hash).toLowerCase()===record.hash.toLowerCase()&&
   getAddress(tx.from)===getAddress(record.operator)&&getAddress(tx.to)===getAddress(record.vault)&&
   tx.chainId===97n&&tx.nonce===record.nonce&&tx.value===0n&&
   tx.data.toLowerCase()===record.transactionData.toLowerCase()&&
   tx.gasLimit===BigInt(record.gasLimit)&&tx.gasPrice===BigInt(record.gasPrice);
  }catch{matches=false;}
  if(!matches)return result(record,'TRANSACTION_MISMATCH_REVIEW');
  if(!receipt)return result(record,'TRANSACTION_OBSERVED_NO_RECEIPT');
  if(String(receipt.hash).toLowerCase()!==record.hash.toLowerCase()||
     !Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<1||!hash.test(String(receipt.blockHash)))
   return result(record,'RECEIPT_MISMATCH_REVIEW');
  const [canonical,heightHex,chain]=await Promise.all([
   provider.send('eth_getBlockByNumber',[toQuantity(receipt.blockNumber),false]),
   provider.send('eth_blockNumber',[]),provider.send('eth_chainId',[])
  ]);
  if(BigInt(chain)!==97n)throw Error('UNIFIED_TESTNET_CHAIN_REQUIRED');
  const height=Number(BigInt(heightHex));
  if(!Number.isSafeInteger(height)||height<receipt.blockNumber)throw Error('UNIFIED_RPC_HEIGHT_INVALID');
  const canonicalBlock=Boolean(canonical&&typeof canonical.number==='string'&&/^0x[0-9a-f]+$/i.test(canonical.number)&&
   BigInt(canonical.number)===BigInt(receipt.blockNumber)&&hash.test(String(canonical.hash))&&
   String(canonical.hash).toLowerCase()===receipt.blockHash.toLowerCase());
  return result(record,'RECEIPT_OBSERVED_REVIEW_REQUIRED',{
   receiptStatus:receipt.status===1?'success':receipt.status===0?'reverted':'unknown',
   canonicalBlock,confirmations:height-receipt.blockNumber+1
  });
 }finally{journal.close();}
}
