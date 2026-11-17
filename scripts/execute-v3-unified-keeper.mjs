// Experimental single-candidate testnet sender. No CLI or installation path.
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

export async function executeUnifiedAccrual({provider,signer,proof,candidate,journalDirectory,waitReceipt=waitV3KeeperReceipt}){
 if(!(signer instanceof Wallet)||signer.provider!==provider)throw Error('UNIFIED_LOCAL_GAS_WALLET_REQUIRED');
 const retryCursor=cursor(candidate?.retryCursor),nextCursor=cursor(candidate?.nextCursor);
 const journal=openUnifiedJournal(journalDirectory);
 try{
  const previous=journal.read();
  if(previous&&previous.status!=='CONFIRMED')throw Error('UNIFIED_PREVIOUS_TRANSACTION_NEEDS_REVIEW');
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
  const receipt=await waitReceipt(provider,hash,{confirmations:2});
  if(!receipt||receipt.status!==1||String(receipt.hash).toLowerCase()!==hash.toLowerCase()||
     !Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<1||
     typeof receipt.blockHash!=='string')throw Error('UNIFIED_RECEIPT_NOT_VERIFIED');
  const [tx,canonical,again,heightHex,chainHex]=await Promise.all([
   provider.getTransaction(hash),provider.send('eth_getBlockByNumber',[toQuantity(receipt.blockNumber),false]),
   provider.send('eth_getTransactionReceipt',[hash]),provider.send('eth_blockNumber',[]),
   provider.send('eth_chainId',[])
  ]);
  if(!tx||!tx.from||getAddress(tx.from)!==operator||!tx.to||getAddress(tx.to)!==simulation.vault||
     tx.chainId!==97n||tx.nonce!==latest||tx.value!==0n||tx.data.toLowerCase()!==data.toLowerCase()||
     tx.gasLimit!==simulation.gasLimit||tx.gasPrice!==simulation.gasPrice||
     !canonical||String(canonical.hash).toLowerCase()!==receipt.blockHash.toLowerCase()||
     !again||String(again.transactionHash).toLowerCase()!==hash.toLowerCase()||
     String(again.blockHash).toLowerCase()!==receipt.blockHash.toLowerCase()||
     BigInt(again.status)!==1n||BigInt(chainHex)!==97n||BigInt(heightHex)<BigInt(receipt.blockNumber+1))
   throw Error('UNIFIED_TRANSACTION_CANONICALITY_MISMATCH');
  const recorded=receipt.logs.some(log=>{
   if(getAddress(log.address)!==simulation.vault)return false;
   try{
    const event=ABI.parseLog({topics:log.topics,data:log.data});
    return event?.name==='DailyClaimAccrued'&&getAddress(event.args.user)===simulation.member&&
     BigInt(event.args.positionId)===BigInt(simulation.positionId)&&
     BigInt(event.args.total)>0n&&BigInt(event.args.total)===BigInt(event.args.personal)+BigInt(event.args.compounded);
   }catch{return false;}
  });
  if(!recorded)throw Error('UNIFIED_ACCRUAL_EVENT_NOT_VERIFIED');
  journal.markConfirmed(hash);
  return {chainId:97,status:'CONFIRMED',hash,operator,vault:simulation.vault,member:simulation.member,
   positionId:simulation.positionId,nextCursor,transactionSent:true,assetTransfer:false};
 }finally{journal.close();}
}
