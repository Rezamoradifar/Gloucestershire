// Read-only evidence; account balances alone cannot prove historical payments.
import {Interface,getAddress} from 'ethers';
import {isPositionPolicy} from './position-profit.mjs';
const abi=new Interface([
 'function batchProfit(bytes32,address,address[],uint256[])',
 'event ProfitCredited(address indexed user,address indexed asset,uint256 amount,bytes32 indexed id)'
]);
export function diagnosticPeriodStart(policy,epoch){
 return policy?policy.startTimestamp+(isPositionPolicy(policy)?0:epoch*policy.periodSeconds):undefined;
}
export function recentJournalProfitCredits(state){
 return Object.entries(state.transactions||{}).filter(([label,x])=>/^daily-0x[0-9a-f]{64}$/i.test(label)&&Number.isSafeInteger(x?.block)&&x.block>0&&/^0x[0-9a-f]{64}$/i.test(x.hash||'')).sort((a,b)=>b[1].block-a[1].block||a[0].localeCompare(b[0])).slice(0,3).map(([label,x])=>({id:label.slice(6),transactionHash:x.hash}));
}
export async function auditProfitReceipt({provider,target,operator,credit,confirmations=3}){
 if(!/^0x[0-9a-f]{64}$/i.test(credit?.transactionHash||''))throw Error('AUDIT_CREDIT_HASH_REQUIRED');
 target=getAddress(target);operator=getAddress(operator);
 const [tx,r,head]=await Promise.all([provider.getTransaction(credit.transactionHash),provider.getTransactionReceipt(credit.transactionHash),provider.getBlockNumber()]);
 if(!tx||!r||r.status!==1||tx.hash.toLowerCase()!==credit.transactionHash.toLowerCase()||r.hash.toLowerCase()!==credit.transactionHash.toLowerCase()||Number(tx.chainId)!==97||BigInt(tx.value)!==0n||getAddress(tx.from)!==operator||getAddress(r.from)!==operator||getAddress(tx.to)!==target||getAddress(r.to)!==target)throw Error('AUDIT_PAYMENT_RECEIPT_MISMATCH');
 const block=await provider.getBlock(r.blockNumber);
 if(!block||block.hash!==r.blockHash||tx.blockHash!==r.blockHash||head-r.blockNumber+1<confirmations)throw Error('AUDIT_PAYMENT_NOT_CANONICAL_OR_CONFIRMED');
 const action=abi.parseTransaction(tx);
 if(action?.name!=='batchProfit'||action.args[0].toLowerCase()!==credit.id.toLowerCase())throw Error('AUDIT_PAYMENT_BATCH_MISMATCH');
 const events=r.logs.filter(x=>getAddress(x.address)===target&&x.topics[0]===abi.getEvent('ProfitCredited').topicHash).map(x=>abi.parseLog(x).args);
 const [id,asset,recipients,amounts]=action.args;
 if(events.length!==recipients.length||recipients.length!==amounts.length)throw Error('AUDIT_PAYMENT_EVENT_MISMATCH');
 const rows=events.map((x,i)=>{
  if(x.id!==id||getAddress(x.asset)!==getAddress(asset)||getAddress(x.user)!==getAddress(recipients[i])||x.amount!==amounts[i])throw Error('AUDIT_PAYMENT_EVENT_MISMATCH');
  return {wallet:getAddress(x.user),asset:getAddress(x.asset),amountUnits:x.amount.toString()};
 });
 return {status:'verified',transactionHash:credit.transactionHash,batchId:id,block:r.blockNumber,credits:rows};
}
export async function auditPositionWallet({vault,wallet,state,block}){
 wallet=getAddress(wallet);const options={blockTag:block.number};
 const token=getAddress(await vault.usdt(options));
 const [count,rate,tier,account]=await Promise.all([vault.positionCount(wallet,options),vault.dailyTargetBps(wallet,options),vault.tierOf(wallet,options),vault.accounts(wallet,token,options)]);
 if(count<0n||count>100n)throw Error('AUDIT_POSITION_LIMIT_REQUIRED');
 const positions=[];
 for(let id=0;id<Number(count);id++){
  const position=await vault.positionOf(wallet,id,options),key=wallet.toLowerCase()+':'+id,index=state.positionIndex?.positions?.[key];
  const paid=state.positionPaid?.[key]??0;
  if(!Number.isSafeInteger(paid)||paid<0)throw Error('AUDIT_PAYMENT_CURSOR_INVALID');
  const known=Number.isSafeInteger(index?.openedAt)&&index.openedAt<=block.timestamp;
  const due=known&&!state.positionClosed?.[key]&&position.principal>0n?Math.max(0,Math.floor((block.timestamp-index.openedAt)/3600)-paid):null;
  positions.push({id,asset:getAddress(position.asset),principalUnits:position.principal.toString(),indexed:known,completedHours:paid,unprocessedFullHours:due});
 }
 return {wallet,block:block.number,rateBps:Number(rate),tier:Number(tier),token,principalUnits:account.principal.toString(),profitUnits:account.profit.toString(),positionCount:Number(count),positions};
}
