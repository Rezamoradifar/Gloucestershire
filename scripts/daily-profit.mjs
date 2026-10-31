// Funded, idempotent daily allocations using the deployed plan at a fixed period-start block.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,Interface,JsonRpcProvider,Wallet,ZeroAddress,getAddress,isAddress,keccak256,toUtf8Bytes,parseEther} from 'ethers';
import {writePrivateJson,journalTransaction} from './migration-journal.mjs';
import {readPrivateKey} from './migration-signers.mjs';
import {planPositionHour,isPositionPolicy} from './position-profit.mjs';
import {getCompleteLogs} from './complete-rpc-logs.mjs';

const registry=new Interface(['event Registered(address indexed user,address indexed referrer)']);
export const hourlyTestPolicyFields=Object.freeze({testMode:true,releaseId:'global-fresh-fast-test-v1',testInterval:'hourly',fastTestnetVersion:1});
const hourlyTestOwner='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const hourlyTestOperator='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2';
export const dailyAbi=[
 'function owner() view returns(address)','function reporters(address) view returns(bool)',
 'function FAST_TESTNET_VERSION() view returns(uint256)',
 'function usdt() view returns(address)','function dailyTargetBps(address) view returns(uint16)',
 'function users(address) view returns(address referrer,bool registered,bool active,bool vipKyc,uint32 activeDirect,uint256 capitalUsd,uint256 salesUsd)',
 'function tierOf(address) view returns(uint8)',
 'function tierConfig(uint256) view returns((uint256 minUsd,uint16 baseDailyBps,uint16 maxDailyBps,uint32 requiredDirect,uint256 requiredSalesUsd,uint16[4] referrals))',
 'function qualifiedDirects(address) view returns(uint256)','function networkBranchCount(address) view returns(uint256)',
 'function rankVolumePage(address,uint256,uint256,uint256) view returns(uint256 eligibleUsd,uint256 next)',
 'function positionCount(address) view returns(uint256)','function positionOf(address,uint256) view returns((address asset,uint256 principal,uint256 capitalUsd,uint256 unlockAt,uint16 penaltyBps))',
 'function accounts(address,address) view returns(uint256 principal,uint256 profit,uint256 externalDeposited,uint256 nextWithdrawal)',
 'function ledgers(address) view returns(uint256 principal,uint256 profit,uint256 feeReserve,uint256 rewards)',
 'function usedRewardBatch(bytes32) view returns(bool)','function assetBalance(address) view returns(uint256)',
 'function batchProfit(bytes32,address,address[],uint256[])','function withdrawalQueue() view returns(address)'
];
export const approvedQueueAbi=[
 'function APPROVAL_VERSION() view returns(uint256)','function vault() view returns(address)','function pending(address) view returns(uint256)',
 'function requestCount() view returns(uint256)',
 'function requests(uint256) view returns(address user,address asset,uint256 gross,uint256 fee,uint256 dueAt,uint8 status)',
 'function pay(uint256)'
];
// Publish aggregate index reconciliation only; never include customer addresses.
export function sanitizeDailyMemberIndexDiagnostic(value){
 const count=number=>Number.isSafeInteger(number)&&number>=0?number:null;
 const hash=text=>typeof text==='string'&&/^0x[0-9a-f]{64}$/i.test(text)?text:null;
 const units=text=>typeof text==='string'&&/^(?:0|[1-9][0-9]{0,95})$/.test(text)?text:null;
 const difference=text=>typeof text==='string'&&/^(?:0|-?[1-9][0-9]{0,95})$/.test(text)?text:null;
 const asset=text=>{try{return typeof text==='string'?getAddress(text):null;}catch{return null;}};
 return {
  snapshot:{block:count(value?.snapshot?.block),hash:hash(value?.snapshot?.hash),timestamp:count(value?.snapshot?.timestamp)},
  epoch:count(value?.epoch),
  registry:{through:count(value?.registry?.through),hash:hash(value?.registry?.hash),totalMembers:count(value?.registry?.totalMembers),includedMembers:count(value?.registry?.includedMembers),futureMembers:count(value?.registry?.futureMembers)},
  assets:Array.isArray(value?.assets)?value.assets.slice(0,2).map(row=>({asset:asset(row?.asset),indexedPrincipal:units(row?.indexedPrincipal),ledgerPrincipal:units(row?.ledgerPrincipal),difference:difference(row?.difference)})):[]
 };
}
export function validateDailyPolicy(p){
 if(p?.version!==1||![56,97].includes(p.chainId)||!isAddress(p.vaultAddress)||getAddress(p.vaultAddress)===ZeroAddress)throw Error('INVALID_DAILY_POLICY');
 if(p.chainId===56&&(p.periodSeconds!==86400||['testMode','initialServerReporter','fastTestnetVersion','testInterval'].some(key=>Object.hasOwn(p,key))||p.releaseId===hourlyTestPolicyFields.releaseId))throw Error('MAINNET_DAILY_POLICY_REQUIRED');
 if((p.basis!=='period-start-active-principal'&&!isPositionPolicy(p))||![86400,3600].includes(p.periodSeconds)||p.includeReinvestment!==true)throw Error('UNSUPPORTED_DAILY_BASIS');
 if(isPositionPolicy(p)&&(p.chainId!==97||p.periodSeconds!==3600))throw Error('POSITION_HOURLY_TEST_ONLY');
 if((p.periodSeconds===3600&&!isHourlyTestPolicy(p))||(p.periodSeconds!==3600&&p.testInterval==='hourly'))throw Error('HOURLY_TEST_POLICY_MARKERS_REQUIRED');
 if(!Number.isSafeInteger(p.startTimestamp)||p.startTimestamp<=0||!Number.isSafeInteger(p.deploymentBlock)||p.deploymentBlock<1)throw Error('INVALID_DAILY_START');
 if(!/^0x[0-9a-f]{64}$/i.test(p.runtimeHash||''))throw Error('DAILY_RUNTIME_HASH_REQUIRED');
 return {...p,vaultAddress:getAddress(p.vaultAddress)};
}
export function isHourlyTestPolicy(p){
 return p?.chainId===97&&p.periodSeconds===3600&&Object.entries(hourlyTestPolicyFields).every(([key,value])=>p[key]===value);
}
async function assertDailyIdentity({provider,vault,chainId,vaultAddress,runtimeHash}){
 if(![56,97].includes(chainId)||!isAddress(vaultAddress)||getAddress(vaultAddress)===ZeroAddress||!/^0x[0-9a-f]{64}$/i.test(runtimeHash||''))throw Error('DAILY_PLAN_IDENTITY_REQUIRED');
 if(Number(await provider.send('eth_chainId',[]))!==chainId)throw Error('DAILY_CHAIN_MISMATCH');
 if(getAddress(await vault.getAddress())!==getAddress(vaultAddress))throw Error('DAILY_VAULT_MISMATCH');
 if(keccak256(await provider.getCode(vaultAddress)).toLowerCase()!==runtimeHash.toLowerCase())throw Error('DAILY_RUNTIME_MISMATCH');
}
export async function assertDailyTarget({provider,vault,policy}){
 const validated=validateDailyPolicy(policy);
 await assertDailyIdentity({...validated,provider,vault});
 return validated;
}
// Reproduce the deployed rate using bounded historical reads, including every
// branch when an account remains below its tier's qualification target.
export async function readDailyTargetBpsAtSnapshot({vault,member,blockTag,pageSize=64}){
 if(!Number.isSafeInteger(blockTag)||blockTag<0||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>64)throw Error('DAILY_RANK_SNAPSHOT_REQUIRED');
 member=getAddress(member);
 const options={blockTag},unsigned=value=>typeof value==='bigint'&&value>=0n;
 const [user,first]=await Promise.all([vault.users(member,options),vault.tierConfig(0,options)]);
 if(!unsigned(user?.capitalUsd)||!unsigned(first?.minUsd)||first.minUsd===0n)throw Error('INVALID_DAILY_RANK_STATE');
 if(user.capitalUsd<first.minUsd)return 0n;
 const tier=await vault.tierOf(member,options);
 if(!unsigned(tier)||tier>4n)throw Error('INVALID_DAILY_REFERRAL_TIER');
 const config=tier===0n?first:await vault.tierConfig(tier,options);
 if(!unsigned(config?.baseDailyBps)||!unsigned(config?.maxDailyBps)||config.baseDailyBps>config.maxDailyBps||config.maxDailyBps>1000n||!unsigned(config?.requiredDirect)||config.requiredDirect>4294967295n||!unsigned(config?.requiredSalesUsd))throw Error('INVALID_DAILY_RANK_STATE');
 const target=config.requiredSalesUsd;
 if(target===0n)return config.baseDailyBps;
 const directs=await vault.qualifiedDirects(member,options);
 if(!unsigned(directs))throw Error('INVALID_DAILY_RANK_STATE');
 if(directs<config.requiredDirect)return config.baseDailyBps;
 const count=await vault.networkBranchCount(member,options);
 if(!unsigned(count))throw Error('INVALID_DAILY_RANK_STATE');
 const usd=10n**18n,capBps=target<=10000n*usd?6000n:target<=100000n*usd?4500n:3500n,cap=target*capBps/10000n;
 let cursor=0n,total=0n;
 while(cursor<count){
  const expected=cursor+BigInt(pageSize)<count?cursor+BigInt(pageSize):count;
  const page=await vault.rankVolumePage(member,target,cursor,pageSize,options),amount=page?.eligibleUsd,next=page?.next,maximum=(expected-cursor)*cap;
  if(!unsigned(amount)||!unsigned(next)||next!==expected||next<=cursor||amount>target||amount>maximum)throw Error('INVALID_DAILY_RANK_PAGE');
  total+=amount;if(total>=target)return config.maxDailyBps;
  cursor=next;
 }
 return config.baseDailyBps;
}
// A short interval is available only for the explicit, deployed fast test profile.
export async function assertHourlyTestTarget({provider,vault,policy}){
 policy=validateDailyPolicy(policy);
 if(!isHourlyTestPolicy(policy))throw Error('HOURLY_TEST_POLICY_REQUIRED');
 if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
 const address=getAddress(await vault.getAddress());
 if(address!==policy.vaultAddress||keccak256(await provider.getCode(address))!==policy.runtimeHash)throw Error('HOURLY_TEST_TARGET_MISMATCH');
 const target=new Contract(address,['function FAST_TESTNET_VERSION() view returns(uint256)','function owner() view returns(address)','function reporters(address) view returns(bool)'],provider);
 let version,owner,reporter;
 try{[version,owner,reporter]=await Promise.all([target.FAST_TESTNET_VERSION(),target.owner(),target.reporters(hourlyTestOperator)]);}catch{throw Error('HOURLY_TEST_FAST_TARGET_REQUIRED');}
 if(version!==1n||getAddress(owner)!==hourlyTestOwner||reporter!==true)throw Error('HOURLY_TEST_FAST_TARGET_REQUIRED');
 return true;
}
export async function blockAtTime(provider,timestamp,first,last){
 const initial=await provider.getBlock(first);if(!initial||initial.timestamp>timestamp)throw Error('PERIOD_PRECEDES_DEPLOYMENT');
 let low=first,high=last;
 while(low<high){const mid=Math.ceil((low+high)/2),b=await provider.getBlock(mid);if(!b)throw Error('HISTORICAL_BLOCK_UNAVAILABLE');if(b.timestamp<=timestamp)low=mid;else high=mid-1;}
 const block=await provider.getBlock(low);if(!block)throw Error('HISTORICAL_BLOCK_UNAVAILABLE');return block;
}
export async function indexMembers({provider,policy,state,through,save,maxPages=100,pageSize=500,logOptions={},shouldContinue=()=>true}){
 state.registry??={through:policy.deploymentBlock-1,hash:null,members:{}};
 const index=state.registry;
 if(index.hash&&(await provider.getBlock(index.through))?.hash!==index.hash){state.registry={through:policy.deploymentBlock-1,hash:null,members:{}};save();return indexMembers({provider,policy,state,through,save,maxPages,pageSize,logOptions,shouldContinue});}
 let pages=0;
 for(let start=index.through+1;start<=through&&pages<maxPages;pages++){
  if(!shouldContinue())return false;
  const end=Math.min(start+pageSize-1,through);
  const logs=await getCompleteLogs({...logOptions,provider,filter:{address:policy.vaultAddress,topics:[registry.getEvent('Registered').topicHash],fromBlock:start,toBlock:end}});
  for(const log of logs){
   if(log.removed||log.address.toLowerCase()!==policy.vaultAddress.toLowerCase()||log.blockNumber<start||log.blockNumber>end)throw Error('INVALID_REGISTRATION_LOG');
   const member=getAddress(registry.parseLog(log).args.user);
   index.members[member]=Math.min(index.members[member]??log.blockNumber,log.blockNumber);
  }
  const block=await provider.getBlock(end);if(!block)throw Error('HISTORICAL_BLOCK_UNAVAILABLE');
  index.through=end;index.hash=block.hash;save();start=end+1;
 }
 return index.through>=through;
}
export async function planDailyEpoch({provider,vault,policy,state,epoch,save=()=>{},confirmations=3,maxRegistryPages=100,registryPageSize=500,registryLogOptions={}}){
 if(!Number.isSafeInteger(maxRegistryPages)||maxRegistryPages<1||maxRegistryPages>100||!Number.isSafeInteger(registryPageSize)||registryPageSize<1||registryPageSize>500)throw Error('DAILY_MEMBER_INDEX_LIMIT_INVALID');
 policy=validateDailyPolicy(policy);
 if(isHourlyTestPolicy(policy))await assertHourlyTestTarget({provider,vault,policy});
 else await assertDailyTarget({provider,vault,policy});
 if(isPositionPolicy(policy))return planPositionHour({provider,vault,policy,state,save,confirmations,maxRegistryPages});
 if(!Number.isSafeInteger(epoch)||epoch<0)throw Error('INVALID_DAILY_EPOCH');
 const head=await provider.getBlockNumber(),final=await provider.getBlock(Math.max(0,head-confirmations));
 const start=policy.startTimestamp+epoch*policy.periodSeconds,end=start+policy.periodSeconds;
 if(!final||final.timestamp<end)return {status:'not_due',epoch};
 const snapshot=await blockAtTime(provider,start,policy.deploymentBlock,final.number);
 if(!await indexMembers({provider,policy,state,through:snapshot.number,save,maxPages:maxRegistryPages,pageSize:registryPageSize,logOptions:registryLogOptions}))return {status:'indexing',epoch};
 const options={blockTag:snapshot.number},token=await vault.usdt(options);
 const members=Object.entries(state.registry.members).filter(([,block])=>block<=snapshot.number).map(([address])=>address).sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
 const assets=[ZeroAddress,token],entries=[[],[]],principal=[0n,0n];
 for(const member of members){
  const rate=policy.chainId===56?await readDailyTargetBpsAtSnapshot({vault,member,blockTag:snapshot.number}):await vault.dailyTargetBps(member,options);if(rate<0n||rate>1000n)throw Error('INVALID_PLAN_RATE');
  for(let i=0;i<2;i++){
   const account=await vault.accounts(member,assets[i],options);principal[i]+=account.principal;
   const amount=account.principal*rate/10000n;
   if(amount>0n)entries[i].push({recipient:member,amount:amount.toString(),principal:account.principal.toString(),rateBps:rate.toString()});
  }
 }
 const ledgerPrincipal=await Promise.all(assets.map(async asset=>(await vault.ledgers(asset,options)).principal));
 if(ledgerPrincipal.some((value,i)=>value!==principal[i])){
  const error=Error('INCOMPLETE_DAILY_MEMBER_INDEX'),cached=Object.entries(state.registry.members);
  error.memberIndexDiagnostic=sanitizeDailyMemberIndexDiagnostic({
   snapshot:{block:snapshot.number,hash:snapshot.hash,timestamp:snapshot.timestamp},epoch,
   registry:{through:state.registry.through,hash:state.registry.hash,totalMembers:cached.length,includedMembers:members.length,futureMembers:cached.filter(([,block])=>block>snapshot.number).length},
   assets:assets.map((asset,i)=>({asset,indexedPrincipal:principal[i].toString(),ledgerPrincipal:ledgerPrincipal[i].toString(),difference:(ledgerPrincipal[i]-principal[i]).toString()}))
  });
  throw error;
 }
 const batches=[];
 for(let i=0;i<2;i++){
  for(let offset=0;offset<entries[i].length;offset+=100){
   const rows=entries[i].slice(offset,offset+100);
   const domain=isHourlyTestPolicy(policy)?'GLOBAL_HOURLY_TEST_V1':'GLOBAL_DAILY_V1';
   const id=keccak256(toUtf8Bytes([domain,policy.chainId,policy.vaultAddress.toLowerCase(),policy.startTimestamp,epoch,assets[i].toLowerCase(),offset/100].join(':')));
   batches.push({id,asset:assets[i],recipients:rows.map(r=>r.recipient),amounts:rows.map(r=>r.amount),rows});
  }
 }
 // Match settleSalesProfit's seller-tier rates and recipient eligibility at
 // this period's immutable start. Only personal earnings generate commissions.
 const users=new Map(),tiers=new Map(),configs=new Map();
 const user=async address=>{
  address=getAddress(address);
  if(!users.has(address)){
   const value=await vault.users(address,options);
   if(!value.registered)throw Error('INVALID_DAILY_REFERRAL_USER');
   users.set(address,value);
  }
  return users.get(address);
 };
 const tier=async address=>{
  address=getAddress(address);
  if(!tiers.has(address)){
   const value=await vault.tierOf(address,options);
   if(value<0n||value>4n)throw Error('INVALID_DAILY_REFERRAL_TIER');
   tiers.set(address,value);
  }
  return tiers.get(address);
 };
 const rates=async address=>{
  const index=await tier(address);
  if(!configs.has(index)){
   const config=await vault.tierConfig(index,options),values=Array.from(config.referrals);
   if(values.length!==4||values.some(value=>value<0n||value>3400n)||values.reduce((sum,value)=>sum+value,0n)>3400n||values.some((value,i)=>i>0&&value>values[i-1])||(index!==4n&&values[3]!==0n))throw Error('INVALID_DAILY_REFERRAL_RATES');
   configs.set(index,values);
  }
  return configs.get(index);
 };
 for(let i=0;i<2;i++){
  const commissions=new Map();
  for(const earning of entries[i]){
   const source=getAddress(earning.recipient),percentages=await rates(source);
   let parent=getAddress((await user(source)).referrer);
   for(let level=0;level<4&&parent!==ZeroAddress;level++){
    const recipient=await user(parent),recipientTier=await tier(parent);
    if(recipient.active&&(recipientTier!==4n||recipient.vipKyc)&&(level!==3||recipientTier===4n)){
     const amount=BigInt(earning.amount)*percentages[level]/10000n;
     if(amount>0n){
      const row=commissions.get(parent)||{recipient:parent,amount:0n,sources:[]};
      row.amount+=amount;row.sources.push({source,level:level+1,amount:amount.toString(),rateBps:percentages[level].toString(),personalProfit:earning.amount});commissions.set(parent,row);
     }
    }
    parent=getAddress(recipient.referrer);
   }
  }
  const rows=Array.from(commissions.values()).sort((a,b)=>a.recipient.toLowerCase().localeCompare(b.recipient.toLowerCase())).map(row=>({...row,amount:row.amount.toString()}));
  for(let offset=0;offset<rows.length;offset+=100){
   const group=rows.slice(offset,offset+100),domain=isHourlyTestPolicy(policy)?'GLOBAL_HOURLY_TEST_REFERRAL_V1':'GLOBAL_DAILY_REFERRAL_V1';
   const id=keccak256(toUtf8Bytes([domain,policy.chainId,policy.vaultAddress.toLowerCase(),policy.startTimestamp,epoch,assets[i].toLowerCase(),offset/100].join(':')));
   batches.push({id,kind:'profit-referrals',asset:assets[i],recipients:group.map(row=>row.recipient),amounts:group.map(row=>row.amount),rows:group});
  }
 }
 return {status:'ready',chainId:policy.chainId,vaultAddress:policy.vaultAddress,runtimeHash:policy.runtimeHash,epoch,start,end,snapshotBlock:snapshot.number,snapshotHash:snapshot.hash,batches};
}
const unsigned=v=>typeof v==='bigint'&&v>=0n;
export function rewardFunding({rewards,cash,profit,feeReserve,pending}){
 if(![rewards,cash,profit,feeReserve,pending].every(unsigned))throw Error('PRODUCTION_FUNDING_STATE_INVALID');
 const priorClaims=profit+feeReserve+pending,available=cash>priorClaims?cash-priorClaims:0n,covered=available<rewards?available:rewards;
 return {rewardBudgetUnits:rewards.toString(),treasuryCashUnits:cash.toString(),recordedProfitAndReserveUnits:priorClaims.toString(),availableForNewProfitUnits:available.toString(),cashCoveredRewardUnits:covered.toString(),rewardCashShortfallUnits:(rewards-covered).toString(),warnings:[...(rewards===0n?['REWARD_BUDGET_EMPTY']:[]),...(covered<rewards?['REWARD_CASH_SHORTFALL']:[]),...(cash<priorClaims?['EXISTING_PROFIT_CASH_SHORTFALL']:[])],principalCashProtected:false,ownerCapitalDeploymentRestricted:false};
}
export async function inspectDailyCashCoverage({vault,queue,asset}){
 const [ledger,cash,pending]=await Promise.all([vault.ledgers(asset),vault.assetBalance(asset),queue.pending(asset)]);
 return {asset,...rewardFunding({rewards:ledger.rewards,cash,profit:ledger.profit,feeReserve:ledger.feeReserve,pending})};
}
export async function executeDailyPlan({provider,vault,queue,plan,transact}){
 if(plan.status!=='ready')return [];
 if((await provider.getBlock(plan.snapshotBlock))?.hash!==plan.snapshotHash)throw Error('DAILY_SNAPSHOT_REORG');
 await assertDailyIdentity({...plan,provider,vault});
 // Require enough cash and reward budget for every remaining personal and
 // commission batch before crediting the first one. Confirmed batches are
 // excluded so an interrupted period can finish without replaying its base.
 const remaining=new Map();
 for(const batch of plan.batches)if(!await vault.usedRewardBatch(batch.id))remaining.set(batch.asset,(remaining.get(batch.asset)||0n)+batch.amounts.reduce((sum,value)=>sum+BigInt(value),0n));
 for(const[asset,total]of remaining){
  if((await vault.ledgers(asset)).rewards<total||await vault.assetBalance(asset)<total)throw Error('DAILY_PROFIT_FUNDING_REQUIRED');
  if(queue&&BigInt((await inspectDailyCashCoverage({vault,queue,asset})).availableForNewProfitUnits)<total)throw Error('DAILY_PROFIT_CASH_COVERAGE_REQUIRED');
 }
 const completed=[];
 for(const batch of plan.batches){
  if(await vault.usedRewardBatch(batch.id)){completed.push({id:batch.id,status:'already_credited'});continue;}
  const amounts=batch.amounts.map(BigInt),total=amounts.reduce((a,b)=>a+b,0n);
  if((await vault.ledgers(batch.asset)).rewards<total||await vault.assetBalance(batch.asset)<total)throw Error('DAILY_PROFIT_FUNDING_REQUIRED');
  if(queue&&BigInt((await inspectDailyCashCoverage({vault,queue,asset:batch.asset})).availableForNewProfitUnits)<total)throw Error('DAILY_PROFIT_CASH_COVERAGE_REQUIRED');
  if((await provider.getBlock(plan.snapshotBlock))?.hash!==plan.snapshotHash)throw Error('DAILY_SNAPSHOT_REORG');
  await assertDailyIdentity({...plan,provider,vault});
  await vault.batchProfit.staticCall(batch.id,batch.asset,batch.recipients,amounts);
  const receipt=await transact('daily-'+batch.id,await vault.batchProfit.populateTransaction(batch.id,batch.asset,batch.recipients,amounts));
  if(receipt.status!==1||!await vault.usedRewardBatch(batch.id))throw Error('DAILY_CREDIT_NOT_CONFIRMED');
  completed.push({id:batch.id,status:'credited',transactionHash:receipt.hash});
 }
 return completed;
}
export async function payApprovedRequests({vault,queue,state,save=()=>{},transact,maxScan=100}){
 try{if(await queue.APPROVAL_VERSION()!==1n)throw Error('UNSUPPORTED_APPROVAL_QUEUE');}
 catch(e){if(e.code==='CALL_EXCEPTION')return {status:'legacy_queue',paid:[]};throw e;}
 if((await queue.vault()).toLowerCase()!==String(vault.target).toLowerCase())throw Error('UNEXPECTED_WITHDRAWAL_QUEUE');
 const count=Number(await queue.requestCount());if(!Number.isSafeInteger(count))throw Error('WITHDRAWAL_INDEX_TOO_LARGE');
 state.queue??={cursor:0,pending:[]};
 const start=state.queue.cursor<count?state.queue.cursor:0;
 const next=Math.min(count,start+maxScan),pending=[],paid=[];
 for(let id=start;id<next;id++){
  const row=await queue.requests(id);
  if(row.status===0n){pending.push(id);continue;}
  if(row.status!==3n)continue;
  if(await vault.assetBalance(row.asset)<row.gross){pending.push(id);continue;}
  try{await queue.pay.staticCall(id);}catch(e){if(e.code==='CALL_EXCEPTION'){pending.push(id);continue;}throw e;}
  const receipt=await transact('withdrawal-'+id,await queue.pay.populateTransaction(id));
  if(receipt.status!==1||(await queue.requests(id)).status!==1n)throw Error('WITHDRAWAL_NOT_CONFIRMED');
  paid.push({id,transactionHash:receipt.hash});
 }
 state.queue={cursor:next>=count?0:next,pending};save();return {status:'checked',paid};
}
async function main(){
 let provider,lock;
 try{
  if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
  const root=process.env.GLOBAL_AUTOMATION_STATE||'/var/lib/globaldroptrade/automation-v1';
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(root);if(!stat.isDirectory()||stat.uid!==0||(stat.mode&0o077)!==0)throw Error('PRIVATE_STATE_DIRECTORY_REQUIRED');
  const lockPath=path.join(root,'run.lock');
  if(fs.existsSync(lockPath)){const pid=Number(fs.readFileSync(lockPath,'utf8'));if(!Number.isSafeInteger(pid)||pid<1)throw Error('INVALID_AUTOMATION_LOCK');try{process.kill(pid,0);throw Error('AUTOMATION_ALREADY_RUNNING');}catch(e){if(e.code!=='ESRCH')throw e;fs.unlinkSync(lockPath);}}
  const fd=fs.openSync(lockPath,'wx',0o600);lock=lockPath;fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);
  const policy=validateDailyPolicy(JSON.parse(fs.readFileSync(process.env.GLOBAL_DAILY_POLICY||'/etc/globaldroptrade/daily-policy.json','utf8')));
  if(isHourlyTestPolicy(policy))throw Error('HOURLY_TEST_REQUIRES_ZERO_START_WORKER');
  if(policy.chainId!==97||process.env.TRADES_CHAIN_ID!=='97'||process.env.TRADES_VAULT_ADDRESS?.toLowerCase()!==policy.vaultAddress.toLowerCase()||!process.env.TRADES_RPC_URL)throw Error('AUTOMATION_TARGET_MISMATCH');
  const request=new FetchRequest(process.env.TRADES_RPC_URL);request.timeout=15000;
  provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=2000;
  const guard=async()=>{if(Number(await provider.send('eth_chainId',[]))!==97||keccak256(await provider.getCode(policy.vaultAddress))!==policy.runtimeHash)throw Error('AUTOMATION_CHAIN_OR_RUNTIME_CHANGED');};
  await guard();
  const file=path.join(root,'journal.json'),state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
  const identity=JSON.stringify(policy);if(state.identity&&state.identity!==identity)throw Error('AUTOMATION_POLICY_CHANGED');state.identity=identity;state.transactions??={};state.epoch??=0;
  const save=()=>writePrivateJson(file,state);save();
  const vault=new Contract(policy.vaultAddress,dailyAbi,provider);
  const dry=!process.argv.includes('--execute');
  let wallet,send;
  if(!dry){
   const key=readPrivateKey('/etc/globaldroptrade/automation.key');if(!key)throw Error('AUTOMATION_SIGNER_REQUIRED');wallet=new Wallet(key,provider);
   send=(label,request)=>journalTransaction({provider,wallet,state,save,label,request,guard,timeout:45000,confirmations:3,maxTotalFee:parseEther('0.1')});
   // Resume any interrupted signed transaction before allocating another nonce.
   for(const [label,entry] of Object.entries(state.transactions))if(!entry.block){const {Transaction}=await import('ethers');const tx=Transaction.from(entry.raw);await send(label,{to:tx.to,data:tx.data});}
  }
  let withdrawals={status:'dry_run'};
  if(!dry){const queue=new Contract(await vault.withdrawalQueue(),approvedQueueAbi,wallet);withdrawals=await payApprovedRequests({vault,queue,state,save,transact:send});}
  const plan=await planDailyEpoch({provider,vault,policy,state,epoch:state.epoch,save});
  writePrivateJson(path.join(root,'daily-plan.json'),plan);
  let dailyError;
  if(plan.status==='ready'&&!dry){
   try{if(!await vault.reporters(wallet.address))throw Error('AUTOMATION_SIGNER_IS_NOT_REPORTER');
    const credited=await executeDailyPlan({provider,vault:vault.connect(wallet),plan,transact:send});state.epoch++;state.lastCredit={epoch:plan.epoch,credited};save();
   }catch(e){dailyError=/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message||'')?e.message:'DAILY_EXECUTION_FAILED';}
  }
  writePrivateJson(path.join(root,'status.json'),{checkedAt:new Date().toISOString(),dryRun:dry,nextEpoch:state.epoch,dailyStatus:plan.status,dailyError,withdrawals});
  if(dailyError){console.error('GLOBAL_DAILY_WAITING '+dailyError);process.exitCode=1;}
  console.log('GLOBAL_AUTOMATION_OK daily='+plan.status+' mode='+(dry?'dry-run':'execute'));
 }catch(e){console.error('GLOBAL_AUTOMATION_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message||'')?e.message:'RPC_OR_VALIDATION_FAILED'));process.exitCode=1;}
 finally{if(lock)fs.rmSync(lock,{force:true});provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
