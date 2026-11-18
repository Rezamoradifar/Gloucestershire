// Strict read-only preflight: no signing, transfers, site changes or deployment.
// A future sender must revalidate on the current head, enforce gas/balance limits,
// confirm each exact event and stop on an unresolved transaction hash.
import {verifyUnifiedDeployment,recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';
import {scanUnifiedAccrual} from './scan-v3-unified-accrual.mjs';

export async function checkUnifiedKeeper({provider,proof,cursor,maxWork=20,maxResults=10,lotPageSize=8,makeContract}){
 const verified=await verifyUnifiedDeployment(provider,proof,makeContract?{makeContract}:{});
 const plan=await scanUnifiedAccrual({vault:verified.vault,book:verified.book,
  blockNumber:verified.block.number,blockTimestamp:verified.block.timestamp,
  cursor,maxWork,maxResults,lotPageSize});
 await recheckUnifiedBlock(provider,verified.block);
 return {chainId:97,vault:verified.proof.vault,book:verified.proof.book,
  network:verified.proof.network,block:verified.block,plan,
  transactionSent:false,siteUpdated:false};
}
