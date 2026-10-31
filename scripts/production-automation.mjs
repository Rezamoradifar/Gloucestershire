// Funded production orchestration. Owner liquidity authority stays unchanged.
import {getAddress,ZeroAddress,keccak256,toUtf8Bytes,Interface} from 'ethers';
import {assertDailyTarget,validateDailyPolicy,planDailyEpoch,executeDailyPlan,payApprovedRequests,rewardFunding} from './daily-profit.mjs';
import {processZeroStartVolume} from './zero-start-volume.mjs';
const profitCall=new Interface(['function batchProfit(bytes32,address,address[],uint256[])']);
export function productionBinding({policy,expectedOwner,operator,queue}){return keccak256(toUtf8Bytes(JSON.stringify({policy,owner:getAddress(expectedOwner),operator:getAddress(operator),queue:getAddress(queue.target)})));}
export {rewardFunding} from './daily-profit.mjs';
export async function readProductionFunding({provider,vault,queue,confirmations=3}){
 const block=await provider.getBlock(Math.max(0,(await provider.getBlockNumber())-confirmations));if(!block)throw Error('PRODUCTION_FUNDING_BLOCK_REQUIRED');
 const at={blockTag:block.number},token=getAddress(await vault.usdt(at)),assets=[];
 for(const asset of [ZeroAddress,token]){
  const [ledger,cash,pending]=await Promise.all([vault.ledgers(asset,at),vault.assetBalance(asset,at),queue.pending(asset,at)]);
  assets.push({asset,...rewardFunding({rewards:ledger.rewards,cash,profit:ledger.profit,feeReserve:ledger.feeReserve,pending})});
 }
 return {block:block.number,blockHash:block.hash,assets};
}
export async function verifyProductionJournalAnchor(provider,state){
 let checkpoint=state.confirmedCheckpoint;
 if(checkpoint&&(!Number.isSafeInteger(checkpoint.block)||checkpoint.block<1||!/^0x[0-9a-f]{64}$/i.test(checkpoint.hash||'')))throw Error('PRODUCTION_JOURNAL_REORG');
 for(const entry of Object.values(state.transactions||{}))if(entry.block){
  if(!Number.isSafeInteger(entry.block)||entry.block<1||!/^0x[0-9a-f]{64}$/i.test(entry.blockHash||''))throw Error('PRODUCTION_JOURNAL_REORG');
  if(!checkpoint||entry.block>checkpoint.block)checkpoint={block:entry.block,hash:entry.blockHash};
  else if(entry.block===checkpoint.block&&entry.blockHash!==checkpoint.hash)throw Error('PRODUCTION_JOURNAL_REORG');
 }
 if(checkpoint&&(await provider.getBlock(checkpoint.block))?.hash!==checkpoint.hash)throw Error('PRODUCTION_JOURNAL_REORG');
 return checkpoint;
}
export async function productionGuard({provider,vault,queue,policy,expectedOwner}){
 policy=validateDailyPolicy(policy);if(policy.chainId!==56||policy.periodSeconds!==86400||policy.basis!=='period-start-active-principal')throw Error('PRODUCTION_24H_POLICY_REQUIRED');
 await assertDailyTarget({provider,vault,policy});
 if(getAddress(await vault.owner())!==getAddress(expectedOwner)||getAddress(await queue.vault())!==policy.vaultAddress||await queue.APPROVAL_VERSION()!==1n)throw Error('PRODUCTION_OWNER_OR_QUEUE_CHANGED');
 return policy;
}
export async function runProductionAutomation({provider,vault,queue,policy,expectedOwner,operator,state,save=()=>{},transact,assertLease,role='primary',execute=false,maxPeriods=2,confirmations=3}){
 if(!['primary','standby'].includes(role)||!Number.isSafeInteger(maxPeriods)||maxPeriods<1||maxPeriods>4)throw Error('PRODUCTION_WORKER_OPTIONS_REQUIRED');
 policy=await productionGuard({provider,vault,queue,policy,expectedOwner});operator=getAddress(operator);
 const binding=productionBinding({policy,expectedOwner,operator,queue});
 if(state.binding&&state.binding!==binding||!state.binding&&Object.keys(state.transactions||{}).length)throw Error('PRODUCTION_JOURNAL_BINDING_CHANGED');
 const report={version:1,kind:'production-funded-automation',chainId:56,periodSeconds:86400,role,dryRun:!execute||role==='standby',status:'checking',checkedAt:new Date().toISOString(),transactionsSent:0,credits:[],withdrawals:null,warnings:[]};
 report.funding=await readProductionFunding({provider,vault,queue,confirmations});
 report.reporterAuthorized=await vault.reporters(operator);
 report.operatorGasWei=(await provider.getBalance(operator)).toString();
 if(!execute||role==='standby'){
  report.status=role==='standby'?'standby-read-only':'check-complete';
  report.nextEpoch=state.daily?.epoch??0;report.pendingTransactions=Object.values(state.transactions||{}).filter(x=>!x.block).length;
  return report;
 }
 if(typeof transact!=='function'||typeof assertLease!=='function')throw Error('PRODUCTION_EXECUTION_LEASE_REQUIRED');
 await assertLease();state.binding=binding;state.daily??={epoch:0};state.transactions??={};save();
 if(Object.values(state.transactions).some(x=>!x.block))throw Error('PRODUCTION_PENDING_RECONCILIATION_REQUIRED');
 await verifyProductionJournalAnchor(provider,state);
 const send=async(label,request)=>{
  await assertLease();await productionGuard({provider,vault,queue,policy,expectedOwner});
  if(label.startsWith('daily-')&&!await vault.usedRewardBatch(label.slice(6))){
   const action=profitCall.parseTransaction(request),asset=action.args[1],total=action.args[3].reduce((a,x)=>a+x,0n);
   const [ledger,cash,pending]=await Promise.all([vault.ledgers(asset),vault.assetBalance(asset),queue.pending(asset)]);
   if(ledger.rewards<total||BigInt(rewardFunding({rewards:ledger.rewards,cash,profit:ledger.profit,feeReserve:ledger.feeReserve,pending}).availableForNewProfitUnits)<total)throw Error('PRODUCTION_REWARD_CASH_REQUIRED');
  }
  const receipt=await transact(label,request);if(receipt?.status!==1)throw Error('PRODUCTION_TRANSACTION_NOT_CONFIRMED');report.transactionsSent++;return receipt;
 };
 try{
  // A missing reporter role or reward budget cannot block approved withdrawals.
  report.withdrawals=await payApprovedRequests({vault,queue,state:state.daily,save,transact:send});
  report.volume=await processZeroStartVolume({provider,vault,state,save,transact:send,maxTransactions:4,maxScans:100});
  if(!report.volume.complete){report.status='volume-backlog';return report;}
  if(!await vault.reporters(operator)){report.status='reporter-permission-required';return report;}
  for(let pass=0;pass<maxPeriods;pass++){
   const plan=await planDailyEpoch({provider,vault,policy,state:state.daily,epoch:state.daily.epoch,save,confirmations,maxRegistryPages:20,registryPageSize:100,registryLogOptions:{maxBlockSpan:10}});
   report.dailyStatus=plan.status;if(plan.status!=='ready'){report.status=report.credits.length?'credited':plan.status;break;}
   const required=new Map();
   for(const b of plan.batches)if(!await vault.usedRewardBatch(b.id))required.set(b.asset,(required.get(b.asset)||0n)+b.amounts.reduce((a,x)=>a+BigInt(x),0n));
   for(const [asset,amount]of required){
    const [ledger,cash,pending]=await Promise.all([vault.ledgers(asset),vault.assetBalance(asset),queue.pending(asset)]);
    const funding=rewardFunding({rewards:ledger.rewards,cash,profit:ledger.profit,feeReserve:ledger.feeReserve,pending});
    if(ledger.rewards<amount||BigInt(funding.availableForNewProfitUnits)<amount){report.status='reward-funding-required';report.warnings.push('REWARD_FUNDING_REQUIRED');return report;}
   }
   const credited=await executeDailyPlan({provider,vault,queue,plan,transact:send});
   state.daily.lastCredit={epoch:state.daily.epoch,credited};state.daily.epoch++;save();
   report.credits.push(...credited);report.status='credited';
  }
  report.nextEpoch=state.daily.epoch;report.funding=await readProductionFunding({provider,vault,queue,confirmations});return report;
 }catch(e){
  if(Object.values(state.transactions||{}).some(x=>!x.block))throw e;
  report.status='waiting';report.error=/^(?:PRODUCTION|DAILY|COMPLETE_LOG|ZERO_START)_[A-Z0-9_]+$/.test(e.message||'')?e.message:'PRODUCTION_READ_OR_EXECUTION_FAILED';return report;
 }
}
