// Read confirmed BNB TESTNET receipts without leaving ethers wait listeners.
export async function waitV3DeploymentReceipt(
 provider,txHash,{confirmations=3,timeoutMs=180000,pollMs=2500,now=()=>Date.now(),
 delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms))}={}
){
 if(typeof txHash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(txHash)||
  !Number.isSafeInteger(confirmations)||confirmations<1||confirmations>20||
  !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600000||
  !Number.isSafeInteger(pollMs)||pollMs<0||pollMs>10000)
  throw Error('V3_DEPLOY_RECEIPT_POLL_PARAMETERS_INVALID');
 const expiresAt=now()+timeoutMs;
 let recent=null;
 do{
  const receipt=await provider.getTransactionReceipt(txHash);
  if(receipt){
   if(receipt.hash.toLowerCase()!==txHash.toLowerCase()||
      receipt.status!==1||!receipt.contractAddress||receipt.blockNumber<=0)
    throw Error('V3_DEPLOY_RECEIPT_REVERTED_OR_INVALID');
   recent=receipt;
   const latest=await provider.getBlockNumber();
   if(latest>=receipt.blockNumber+confirmations-1)return receipt;
  }
  if(now()>=expiresAt)break;
  await delay(pollMs);
 }while(now()<=expiresAt);
 throw Error(recent?'V3_DEPLOY_RECEIPT_CONFIRMATIONS_TIMEOUT_INSPECT_CHAIN':
  'V3_DEPLOY_RECEIPT_NOT_FOUND_INSPECT_TX_HASH');
}
