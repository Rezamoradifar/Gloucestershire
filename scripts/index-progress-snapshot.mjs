// Publish counts and cursors only, never the private members or positions.
import {id} from 'ethers';
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const entries=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).length:null;
const profitTopic=id('ProfitCredited(address,address,uint256,bytes32)').toLowerCase();

export function indexProgressSnapshot(daily){
 const registry=daily?.registry, index=daily?.positionIndex;
 return {
  memberThrough:count(registry?.through),
  positionThrough:count(index?.through),
  target:count(daily?.positionScanTarget?.number),
  memberCount:entries(registry?.members),
  positionCount:entries(index?.positions)
 };
}

// Optional display information only: never let an unavailable RPC change
// scheduling or financial state. Bind the reported time to the same canonical
// block hash and testnet chain as the latest confirmed system credit.
export async function creditBlockTimestamp(provider,lastCredit,target,{timeoutMs=2000}={}){
 const batches=Array.isArray(lastCredit?.batches)?lastCredit.batches:[];
 const valid=batches.filter(row=>Number.isSafeInteger(row?.block)&&row.block>0&&/^0x[0-9a-f]{64}$/i.test(row?.blockHash||'')&&/^0x[0-9a-f]{64}$/i.test(row?.transactionHash||''));
 if(!valid.length||!/^0x[0-9a-f]{40}$/i.test(target||''))return null;
 const latest=valid.reduce((a,b)=>a.block>=b.block?a:b);
 let timer;
 try{
  const lookup=(async()=>{
   const [chain,block,receipt,head]=await Promise.all([provider.send('eth_chainId',[]),provider.getBlock(latest.block),provider.getTransactionReceipt(latest.transactionHash),provider.getBlockNumber()]);
   if(Number(chain)!==97||!block||block.number!==latest.block||block.hash?.toLowerCase()!==latest.blockHash.toLowerCase()||!Number.isSafeInteger(head)||head-latest.block<3||
     !receipt||receipt.hash?.toLowerCase()!==latest.transactionHash.toLowerCase()||receipt.status!==1||receipt.blockNumber!==latest.block||receipt.blockHash?.toLowerCase()!==latest.blockHash.toLowerCase()||
     !Array.isArray(receipt.logs)||!receipt.logs.some(row=>row.address?.toLowerCase()===target.toLowerCase()&&row.topics?.[0]?.toLowerCase()===profitTopic))return null;
   return Number.isSafeInteger(block.timestamp)&&block.timestamp>0?block.timestamp:null;
  })();
  return await Promise.race([lookup,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]);
 }catch{return null;}
 finally{clearTimeout(timer);}
}
