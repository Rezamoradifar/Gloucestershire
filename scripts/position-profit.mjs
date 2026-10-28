// Testnet-only anniversary allocations, one complete position-hour at a time.
import {Interface,ZeroAddress,getAddress,keccak256,toUtf8Bytes} from 'ethers';
import {getCompleteLogs} from './complete-rpc-logs.mjs';
import {blockAtTime,indexMembers} from './daily-profit.mjs';
const events=new Interface([
 'event Deposited(address indexed user,address indexed asset,uint256 indexed position,uint256 amount,uint256 usd,uint256 feeEach)',
 'event Reinvested(address indexed user,address indexed asset,uint256 amount,uint256 position)'
]);
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
const safe=x=>Number.isSafeInteger(x)&&x>=0;
export const positionBasis='position-anniversary-principal';
export function isPositionPolicy(p){return p?.basis===positionBasis&&p.positionScheduleVersion===1;}

export async function planPositionHour({provider,vault,policy,state,save=()=>{},confirmations=3,maxRegistryPages=100}){
 if(policy.chainId!==97||policy.periodSeconds!==3600||!isPositionPolicy(policy))throw Error('POSITION_HOURLY_TEST_ONLY');
 const final=await provider.getBlock(Math.max(0,(await provider.getBlockNumber())-confirmations));
 if(!final)throw Error('POSITION_FINAL_BLOCK_REQUIRED');
 if(!await indexMembers({provider,policy,state,through:final.number,save,maxPages:maxRegistryPages,logOptions:{maxTimeoutRetries:2}}))return {status:'indexing'};
 state.positionIndex??={through:policy.deploymentBlock-1,hash:null,positions:{}};
 state.positionPaid??={};state.positionClosed??={};
 const index=state.positionIndex;
 if(!safe(index.through)||!index.positions||index.through>final.number)throw Error('POSITION_INDEX_INVALID');
 if(index.hash&&(await provider.getBlock(index.through))?.hash!==index.hash)throw Error('POSITION_INDEX_REORG');
 let pages=0;
 for(let start=index.through+1;start<=final.number&&pages<maxRegistryPages;pages++){
  const end=Math.min(start+499,final.number),discovered={};
  for(const name of ['Deposited','Reinvested']){
   const logs=await getCompleteLogs({provider,filter:{address:policy.vaultAddress,topics:[events.getEvent(name).topicHash],fromBlock:start,toBlock:end},maxTimeoutRetries:2});
   for(const log of logs){
    const args=events.parseLog(log).args,member=getAddress(args.user),asset=getAddress(args.asset),id=args.position.toString(),key=member.toLowerCase()+':'+id;
    if(index.positions[key]||discovered[key]||args.amount<=0n)throw Error('POSITION_DUPLICATE_OPEN_EVENT');
    const block=await provider.getBlock(log.blockNumber);
    if(!block||block.hash!==log.blockHash)throw Error('POSITION_OPEN_REORG');
    discovered[key]={member,asset,id,openedAt:block.timestamp,openedBlock:block.number,openedHash:block.hash};
   }
  }
  const block=await provider.getBlock(end);if(!block)throw Error('POSITION_INDEX_BLOCK_REQUIRED');
  Object.assign(index.positions,discovered);index.through=end;index.hash=block.hash;save();start=end+1;
 }
 if(index.through<final.number)return {status:'indexing'};
 const options={blockTag:final.number},token=getAddress(await vault.usdt(options)),assets=[ZeroAddress,token],principal=[0n,0n],counts=new Map();
 for(const [key,row]of Object.entries(index.positions)){
  if(key!==row.member.toLowerCase()+':'+row.id||!safe(row.openedAt)||!safe(row.openedBlock)||!hash(row.openedHash)||!/^(0|[1-9][0-9]*)$/.test(row.id))throw Error('POSITION_INDEX_INVALID');
  const p=await vault.positionOf(row.member,BigInt(row.id),options),asset=getAddress(p.asset),i=assets.indexOf(asset);
  if(i<0||asset!==row.asset)throw Error('POSITION_ASSET_MISMATCH');
  principal[i]+=p.principal;counts.set(row.member,(counts.get(row.member)||0n)+1n);
 }
 for(const member of Object.keys(state.registry.members))if(await vault.positionCount(member,options)!==(counts.get(getAddress(member))||0n))throw Error('POSITION_INDEX_INCOMPLETE');
 for(let i=0;i<assets.length;i++)if((await vault.ledgers(assets[i],options)).principal!==principal[i])throw Error('POSITION_PRINCIPAL_INDEX_INCOMPLETE');
 const candidates=Object.entries(index.positions).map(([key,row])=>{
  const paid=state.positionPaid[key]??0;if(!safe(paid))throw Error('POSITION_PAYMENT_CURSOR_INVALID');
  const start=row.openedAt+paid*3600;if(!safe(start+3600))throw Error('POSITION_PAYMENT_CURSOR_INVALID');
  return {key,row,paid,start,end:start+3600};
 }).filter(x=>!state.positionClosed[x.key]&&x.end<=final.timestamp).sort((a,b)=>a.end-b.end||a.key.localeCompare(b.key));
 if(!candidates.length){const next=Object.entries(index.positions).filter(([key])=>!state.positionClosed[key]).map(([key,row])=>row.openedAt+((state.positionPaid[key]??0)+1)*3600);return {status:'not_due',nextDueAt:next.length?Math.min(...next):null};}
 const {key,row,paid,start,end}=candidates[0],snapshot=await blockAtTime(provider,start,policy.deploymentBlock,final.number),o={blockTag:snapshot.number};
 const position=await vault.positionOf(row.member,BigInt(row.id),o);
 if(getAddress(position.asset)!==row.asset)throw Error('POSITION_ASSET_MISMATCH');
 const rate=await vault.dailyTargetBps(row.member,o);if(rate<0n||rate>1000n)throw Error('INVALID_PLAN_RATE');
 const amount=position.principal*rate/10000n,domain=['GLOBAL_POSITION_HOURLY_TEST_V1',policy.chainId,policy.vaultAddress.toLowerCase(),row.member.toLowerCase(),row.id,paid,row.asset.toLowerCase()].join(':'),batches=[];
 if(amount>0n){
  const ownId=keccak256(toUtf8Bytes(domain+':personal'));
  batches.push({id:ownId,asset:row.asset,recipients:[row.member],amounts:[amount.toString()]});
  const source=await vault.users(row.member,o),config=await vault.tierConfig(await vault.tierOf(row.member,o),o);
  const percentages=Array.from(config.referrals);
  if(percentages.length!==4||percentages.some(x=>x<0n||x>3400n)||percentages.reduce((a,b)=>a+b,0n)>3400n)throw Error('INVALID_DAILY_REFERRAL_RATES');
  let parent=getAddress(source.referrer);const recipients=[],amounts=[];
  for(let level=0;level<4&&parent!==ZeroAddress;level++){
   const u=await vault.users(parent,o),tier=await vault.tierOf(parent,o);
   if(!u.registered)throw Error('INVALID_DAILY_REFERRAL_USER');
   const reward=amount*percentages[level]/10000n;
   if(u.active&&(tier!==4n||u.vipKyc)&&(level!==3||tier===4n)&&reward>0n){recipients.push(parent);amounts.push(reward.toString());}
   parent=getAddress(u.referrer);
  }
  if(recipients.length)batches.push({id:keccak256(toUtf8Bytes(domain+':referrals')),kind:'profit-referrals',asset:row.asset,recipients,amounts});
 }
 return {status:'ready',chainId:97,vaultAddress:policy.vaultAddress,runtimeHash:policy.runtimeHash,snapshotBlock:snapshot.number,snapshotHash:snapshot.hash,start,end,batches,positionCursor:{key,paid,next:paid+1,closed:position.principal===0n},nextDueAt:end};
}

export function completePositionHour(state,plan){
 const c=plan.positionCursor;
 if(!c||state.positionPaid?.[c.key]!==undefined&&state.positionPaid[c.key]!==c.paid||c.next!==c.paid+1)throw Error('POSITION_PAYMENT_CURSOR_CHANGED');
 state.positionPaid??={};state.positionPaid[c.key]=c.next;
 if(c.closed){state.positionClosed??={};state.positionClosed[c.key]=true;}
}
