// Read-only transaction confirmation helper. No signer, wallet or transfers.
// Unlike TransactionResponse.wait(), this does not leave a block listener
// behind when a short-lived keeper closes its JSON-RPC provider.
export async function waitV3KeeperReceipt(provider, hash, {
 confirmations=2, timeoutMs=120000, pollMs=2000,
 now=()=>Date.now(), delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
}={}) {
 if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash)||
    !Number.isSafeInteger(confirmations)||confirmations<1||confirmations>12||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600000||
    !Number.isSafeInteger(pollMs)||pollMs<0||pollMs>10000)
  throw Error('V3_KEEPER_RECEIPT_PARAMETERS_INVALID');
 const deadline=now()+timeoutMs;
 do {
  const receipt=await provider.getTransactionReceipt(hash);
  if(receipt) {
   if(typeof receipt.hash!=='string'||receipt.hash.toLowerCase()!==hash.toLowerCase()||
      receipt.status!==1||!Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<1)
    throw Error('V3_KEEPER_TRANSACTION_REVERTED_OR_WRONG_RECEIPT');
   const height=await provider.getBlockNumber();
   if(height>=receipt.blockNumber+confirmations-1)return receipt;
  }
  if(now()>=deadline)break;
  await delay(pollMs);
 } while(now()<=deadline);
 throw Error('V3_KEEPER_RECEIPT_TIMEOUT_REVIEW_BROADCAST_TRANSACTION');
}
