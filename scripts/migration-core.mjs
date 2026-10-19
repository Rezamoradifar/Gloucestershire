import {Contract,getAddress} from 'ethers';
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v);
// These helpers make no transactions. CLI pins the production testnet source/owner.
export async function scanInventory(provider,source,out=()=>{}) {
 const SOURCE=await source.getAddress();
 const end=await provider.getBlockNumber(),block=await provider.getBlock(end);let low=0,high=end;
 if(await provider.getCode(SOURCE,end)==='0x')throw Error('Source contract not found.');
 while(low<high){const mid=Math.floor((low+high)/2);if(await provider.getCode(SOURCE,mid)==='0x')low=mid+1;else high=mid;out('Locating the contract creation block… '+low+' / '+high);}
 const members=new Set(),settlements=new Set(),ids=new Set();let start=low,span=2000;
 const topics=['Registered','SaleSettled','ProfitCredited'].map(x=>source.interface.getEvent(x).topicHash);
 while(start<=end){const stop=Math.min(end,start+span-1);let logs;
  try{logs=await provider.getLogs({address:SOURCE,fromBlock:start,toBlock:stop,topics:[topics]});}
  catch(e){if(span<=20)throw Error('Scan incomplete. The RPC must support historical event logs. Try again.');span=Math.max(20,Math.floor(span/2));continue;}
  for(const log of logs){if(log.removed)throw Error('The chain changed. Repeat the scan.');const e=source.interface.parseLog(log);if(e.name==='Registered')members.add(getAddress(e.args.user));if(e.name==='SaleSettled')settlements.add(e.args.id);if(e.name==='ProfitCredited')ids.add(e.args.id);}
  start=stop+1;out(`Scanning ${stop} / ${end} — ${members.size} users`);
 }
 const batches=[];for(const id of ids)if(await source.usedRewardBatch(id,{blockTag:end}))batches.push(id);
 if((await provider.getBlock(end))?.hash!==block.hash)throw Error('The scanned block changed. Try again.');
 const inventory={members:[...members].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1),settlements:[...settlements].sort(),batches:batches.sort(),fromBlock:low,block:end,blockHash:block.hash};
 return inventory;

}
export async function verifyCopy(provider,source,artifact,receipt,inventory,out=()=>{}) {
 const report={inventory};
 const n=new Contract(receipt.contractAddress,artifact.abi,provider),o={blockTag:receipt.blockNumber},token=await source.usdt(o);
 const compare=async(name,args=[])=>{if(json(await n[name](...args,o))!==json(await source[name](...args,o)))throw Error('Mismatch: '+name+' '+args.join(' '));};
 for(const name of ['owner','usdt','bnbUsdFeed','usdtUsdFeed','maxOracleAge','dropshippingWallet','minDepositUsd','profitFeeBps','principalPenaltyBps','lockDuration','withdrawalCooldown','partnerVotesRequired'])await compare(name);
 for(let i=0;i<7;i++)await compare('partnerWallets',[i]);for(let i=0;i<5;i++)await compare('tierConfig',[i]);
 for(const who of report.inventory.members){
  for(const name of ['users','qualifiedDirects','positionCount','networkBranchCount','rewardGroupCount'])await compare(name,[who]);
  for(const asset of ['0x0000000000000000000000000000000000000000',token]){await compare('accounts',[who,asset]);await compare('cumulativeReinvested',[who,asset]);}
  for(let j=0n;j<await source.positionCount(who,o);j++)await compare('positionOf',[who,j]);
  for(let j=0n;j<await source.networkBranchCount(who,o);j++){await compare('networkBranch',[who,j]);const b=await source.networkBranch(who,j,o);await compare('branchVolumeUsd',[who,b]);await compare('groupedBranch',[who,b]);}
  for(let j=0n;j<await source.rewardGroupCount(who,o);j++){await compare('rewardGroup',[who,j]);const g=await source.rewardGroup(who,j,o);for(let k=0;k<g.branches.length;k++)await compare('rewardBranch',[who,j,k]);}
  out('Verifying user '+who);
 }
 await compare('volumeJobCount');for(let j=0n;j<await source.volumeJobCount(o);j++)await compare('volumeJobs',[j]);
 for(const asset of ['0x0000000000000000000000000000000000000000',token])for(const name of ['ledgers','ownerCapitalOutstanding','retainedPrincipalPenalties'])await compare(name,[asset]);
 for(const id of report.inventory.settlements)await compare('usedSettlement',[id]);for(const id of report.inventory.batches)await compare('usedRewardBatch',[id]);
 if(await n.REWARD_ACCRUAL_VERSION()!==1n)throw Error('Incorrect reward version.');

 return {target:receipt.contractAddress,block:receipt.blockNumber,blockHash:receipt.blockHash,queue:await n.withdrawalQueue(),verified:true};
}
