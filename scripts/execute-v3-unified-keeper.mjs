// Single-candidate testnet accrual sender used by the keeper cycle.
// A private, gas-only local Wallet and a locked durable journal are mandatory.
// Any uncertain broadcast or receipt leaves a pending record and stops reuse.
import {Interface,Transaction,Wallet,getAddress,keccak256,toQuantity} from 'ethers';
import {simulateUnifiedAccrual} from './simulate-v3-unified-keeper.mjs';
import {openUnifiedJournal} from './v3-unified-keeper-journal.mjs';
import {waitV3KeeperReceipt} from './v3-keeper-receipt-poll.mjs';

const ABI=new Interface([
 'function accrueDaily(address,uint256)',
 'function accrueReinvestmentPage(address,uint256,uint256)',
 'event DailyClaimAccrued(address indexed user,uint256 indexed positionId,uint256 personal,uint256 compounded,uint256 total,uint256 at)'
]);
const cursor=value=>{
 if(!value||!['member','position','lot'].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0))
  throw Error('INVALID_UNIFIED_TRANSACTION_CURSOR');
 return {member:value.member,position:value.position,lot:value.lot};
};
const quantity=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)?BigInt(value):null;
const hashPattern=/^0x[0-9a-fA-F]{64}$/;

// Check the exact transaction, event and canonical block twice. This helper
// cannot send a transaction or update the journal.
export async function verifyUnifiedAccrualReceipt({provider,receipt,hash,simulation,operator,nonce,data}){
 if(!receipt||receipt.status!==1||!hashPattern.test(String(hash))||
    String(receipt.hash).toLowerCase()!==hash.toLowerCase()||
    !Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<1||
    !hashPattern.test(String(receipt.blockHash)))throw Error('UNIFIED_RECEIPT_NOT_VERIFIED');
 const expectedNumber=BigInt(receipt.blockNumber),expectedHash=receipt.blockHash.toLowerCase();
 const canonicalMatches=block=>Boolean(block&&quantity(block.number)===expectedNumber&&
  hashPattern.test(String(block.hash))&&String(block.hash).toLowerCase()===expectedHash);
 const rawReceiptMatches=raw=>Boolean(raw&&String(raw.transactionHash).toLowerCase()===hash.toLowerCase()&&
  quantity(raw.blockNumber)===expectedNumber&&String(raw.blockHash).toLowerCase()===expectedHash&&
  quantity(raw.status)===1n);
 const confirmed=(height,chain)=>quantity(chain)===97n&&quantity(height)!==null&&quantity(height)>=expectedNumber+1n;
 const hasExpectedEvent=logs=>Array.isArray(logs)&&logs.some(log=>{
  try{
   if(getAddress(log.address)!==simulation.vault)return false;
   const event=ABI.parseLog({topics:log.topics,data:log.data});
   return event?.name==='DailyClaimAccrued'&&getAddress(event.args.user)===simulation.member&&
    BigInt(event.args.positionId)===BigInt(simulation.positionId)&&BigInt(event.args.total)>0n&&
    BigInt(event.args.total)===BigInt(event.args.personal)+BigInt(event.args.compounded);
  }catch{return false;}
 });
 const [tx,canonical,again,heightHex,chainHex]=await Promise.all([
  provider.getTransaction(hash),provider.send('eth_getBlockByNumber',[toQuantity(receipt.blockNumber),false]),
  provider.send('eth_getTransactionReceipt',[hash]),provider.send('eth_blockNumber',[]),provider.send('eth_chainId',[])
 ]);
 if(!tx||String(tx.hash).toLowerCase()!==hash.toLowerCase()||!tx.from||getAddress(tx.from)!==operator||!tx.to||getAddress(tx.to)!==simulation.vault||
    tx.chainId!==97n||tx.nonce!==nonce||tx.value!==0n||tx.data.toLowerCase()!==data.toLowerCase()||
    tx.gasLimit!==simulation.gasLimit||tx.gasPrice!==simulation.gasPrice||
    !canonicalMatches(canonical)||!rawReceiptMatches(again)||!confirmed(heightHex,chainHex))
  throw Error('UNIFIED_TRANSACTION_CANONICALITY_MISMATCH');
 if(!hasExpectedEvent(receipt.logs)||!hasExpectedEvent(again.logs))
  throw Error('UNIFIED_ACCRUAL_EVENT_NOT_VERIFIED');
 // Receipt, chain, height and block are all checked again after parsing events;
 // a changed or inconsistent response must never permit a confirmed journal.
 const [finalBlock,finalReceipt,finalHeight,finalChain]=await Promise.all([
  provider.send('eth_getBlockByNumber',[toQuantity(receipt.blockNumber),false]),
  provider.send('eth_getTransactionReceipt',[hash]),provider.send('eth_blockNumber',[]),provider.send('eth_chainId',[])
 ]);
 if(!canonicalMatches(finalBlock)||!rawReceiptMatches(finalReceipt)||!confirmed(finalHeight,finalChain)||
    !hasExpectedEvent(finalReceipt.logs))throw Error('UNIFIED_TRANSACTION_CANONICALITY_MISMATCH');
 return true;
}

export async function executeUnifiedAccrual(options){
 const journal=openUnifiedJournal(options.journalDirectory);
 try{return await executeWithKeeperLock({...options,journal});}finally{journal.close();}
}

// The complete cycle holds the same journal lock through scanning, sending
// and checkpointing. The single-candidate API still acquires its own lock.
export async function executeWithKeeperLock({provider,signer,proof,candidate,journal,waitReceipt=waitV3KeeperReceipt}){
 if(!(signer instanceof Wallet)||signer.provider!==provider)throw Error('UNIFIED_LOCAL_GAS_WALLET_REQUIRED');
 const retryCursor=cursor(candidate?.retryCursor),nextCursor=cursor(candidate?.nextCursor);
 const previous=journal.read();
 // A confirmed receipt alone does not prove the cursor was checkpointed or
 // remains canonical. The cycle must reconcile the prior record first.
 if(previous)throw Error('UNIFIED_PREVIOUS_TRANSACTION_NEEDS_REVIEW');
 const operator=getAddress(await signer.getAddress());
 const simulation=await simulateUnifiedAccrual({provider,proof,candidate,operator});
 const [latest,pending]=await Promise.all([
  provider.getTransactionCount(operator,'latest'),provider.getTransactionCount(operator,'pending')
 ]);
 if(!Number.isSafeInteger(latest)||latest<0||pending!==latest)throw Error('UNIFIED_KEEPER_PENDING_NONCE_NEEDS_REVIEW');
 const data=ABI.encodeFunctionData(simulation.method,simulation.args);
 const raw=await signer.signTransaction({chainId:97,type:0,nonce:latest,to:simulation.vault,
  value:0n,data,gasLimit:simulation.gasLimit,gasPrice:simulation.gasPrice});
 const signed=Transaction.from(raw),hash=keccak256(raw);
 if(signed.chainId!==97n||signed.nonce!==latest||!signed.from||getAddress(signed.from)!==operator||
    !signed.to||getAddress(signed.to)!==simulation.vault||signed.value!==0n||
    signed.data.toLowerCase()!==data.toLowerCase()||signed.gasLimit!==simulation.gasLimit||
    signed.gasPrice!==simulation.gasPrice||signed.hash?.toLowerCase()!==hash.toLowerCase())
  throw Error('UNIFIED_SIGNED_TRANSACTION_MISMATCH');
 journal.prepare({status:'PREPARED',chainId:97,hash,nonce:latest,operator,vault:simulation.vault,
  member:simulation.member,positionId:simulation.positionId,method:simulation.method,
  transactionData:data,gasLimit:simulation.gasLimit.toString(),gasPrice:simulation.gasPrice.toString(),
  retryCursor,nextCursor,createdAt:new Date().toISOString()});
 const broadcast=await provider.broadcastTransaction(raw);
 if(!broadcast||String(broadcast.hash).toLowerCase()!==hash.toLowerCase())
  throw Error('UNIFIED_BROADCAST_HASH_MISMATCH_INSPECT_JOURNAL');
 journal.markBroadcast(hash);
 // Confirmation review reads head minus two. Wait until it includes this receipt.
 const receipt=await waitReceipt(provider,hash,{confirmations:3});
 await verifyUnifiedAccrualReceipt({provider,receipt,hash,simulation,operator,nonce:latest,data});
 journal.markConfirmed(hash);
 return {chainId:97,status:'CONFIRMED',hash,operator,vault:simulation.vault,member:simulation.member,
  positionId:simulation.positionId,nextCursor,transactionSent:true,assetTransfer:false};
}
