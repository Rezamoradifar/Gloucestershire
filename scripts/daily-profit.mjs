// Funded, idempotent daily allocations using the deployed plan at a fixed period-start block.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,Interface,JsonRpcProvider,Wallet,ZeroAddress,getAddress,isAddress,keccak256,toUtf8Bytes,parseEther} from 'ethers';
import {writePrivateJson,journalTransaction} from './migration-journal.mjs';
import {readPrivateKey} from './migration-signers.mjs';

const registry=new Interface(['event Registered(address indexed user,address indexed referrer)']);
export const hourlyTestPolicyFields=Object.freeze({testMode:true,releaseId:'global-fresh-fast-test-v1',testInterval:'hourly',fastTestnetVersion:1});
const hourlyTestOwner='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const hourlyTestOperator='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2';
export const dailyAbi=[
 'function owner() view returns(address)','function reporters(address) view returns(bool)',
 'function FAST_TESTNET_VERSION() view returns(uint256)',
 'function usdt() view returns(address)','function dailyTargetBps(address) view returns(uint16)',
 'function accounts(address,address) view returns(uint256 principal,uint256 profit,uint256 externalDeposited,uint256 nextWithdrawal)',
 'function ledgers(address) view returns(uint256 principal,uint256 profit,uint256 feeReserve,uint256 rewards)',
 'function usedRewardBatch(bytes32) view returns(bool)','function assetBalance(address) view returns(uint256)',
 'function batchProfit(bytes32,address,address[],uint256[])','function withdrawalQueue() view returns(address)'
];
export const approvedQueueAbi=[
 'function APPROVAL_VERSION() view returns(uint256)','function vault() view returns(address)',
 'function requestCount() view returns(uint256)',
 'function requests(uint256) view returns(address user,address asset,uint256 gross,uint256 fee,uint256 dueAt,uint8 status)',
 'function pay(uint256)'
];
export function validateDailyPolicy(p){
 if(p?.version!==1||p.chainId!==97||!isAddress(p.vaultAddress)||getAddress(p.vaultAddress)===ZeroAddress)throw Error('INVALID_DAILY_POLICY');
 if(p.basis!=='period-start-active-principal'||![86400,3600].includes(p.periodSeconds)||p.includeReinvestment!==true)throw Error('UNSUPPORTED_DAILY_BASIS');
 if((p.periodSeconds===3600&&!isHourlyTestPolicy(p))||(p.periodSeconds!==3600&&p.testInterval==='hourly'))throw Error('HOURLY_TEST_POLICY_MARKERS_REQUIRED');
 if(!Number.isSafeInteger(p.startTimestamp)||p.startTimestamp<=0||!Number.isSafeInteger(p.deploymentBlock)||p.deploymentBlock<1)throw Error('INVALID_DAILY_START');
 if(!/^0x[0-9a-f]{64}$/i.test(p.runtimeHash||''))throw Error('DAILY_RUNTIME_HASH_REQUIRED');
 return {...p,vaultAddress:getAddress(p.vaultAddress)};
}
export function isHourlyTestPolicy(p){
 return p?.periodSeconds===3600&&Object.entries(hourlyTestPolicyFields).every(([key,value])=>p[key]===value);
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
export async function indexMembers({provider,policy,state,through,save,maxPages=100,pageSize=500}){
 state.registry??={through:policy.deploymentBlock-1,hash:null,members:{}};
 const index=state.registry;
 if(index.hash&&(await provider.getBlock(index.through))?.hash!==index.hash){state.registry={through:policy.deploymentBlock-1,hash:null,members:{}};save();return indexMembers({provider,policy,state,through,save,maxPages,pageSize});}
 let pages=0;
 for(let start=index.through+1;start<=through&&pages<maxPages;pages++){
  const end=Math.min(start+pageSize-1,through);
  const logs=await provider.getLogs({address:policy.vaultAddress,topics:[registry.getEvent('Registered').topicHash],fromBlock:start,toBlock:end});
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
export async function planDailyEpoch({provider,vault,policy,state,epoch,save=()=>{},confirmations=3}){
 policy=validateDailyPolicy(policy);
 if(isHourlyTestPolicy(policy))await assertHourlyTestTarget({provider,vault,policy});
 if(!Number.isSafeInteger(epoch)||epoch<0)throw Error('INVALID_DAILY_EPOCH');
 const head=await provider.getBlockNumber(),final=await provider.getBlock(Math.max(0,head-confirmations));
 const start=policy.startTimestamp+epoch*policy.periodSeconds,end=start+policy.periodSeconds;
 if(!final||final.timestamp<end)return {status:'not_due',epoch};
 const snapshot=await blockAtTime(provider,start,policy.deploymentBlock,final.number);
 if(!await indexMembers({provider,policy,state,through:snapshot.number,save}))return {status:'indexing',epoch};
 const options={blockTag:snapshot.number},token=await vault.usdt(options);
 const members=Object.entries(state.registry.members).filter(([,block])=>block<=snapshot.number).map(([address])=>address).sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
 const assets=[ZeroAddress,token],entries=[[],[]],principal=[0n,0n];
 for(const member of members){
  const rate=await vault.dailyTargetBps(member,options);if(rate<0n||rate>1000n)throw Error('INVALID_PLAN_RATE');
  for(let i=0;i<2;i++){
   const account=await vault.accounts(member,assets[i],options);principal[i]+=account.principal;
   const amount=account.principal*rate/10000n;
   if(amount>0n)entries[i].push({recipient:member,amount:amount.toString(),principal:account.principal.toString(),rateBps:rate.toString()});
  }
 }
 const batches=[];
 for(let i=0;i<2;i++){
  if((await vault.ledgers(assets[i],options)).principal!==principal[i])throw Error('INCOMPLETE_DAILY_MEMBER_INDEX');
  for(let offset=0;offset<entries[i].length;offset+=100){
   const rows=entries[i].slice(offset,offset+100);
   const domain=isHourlyTestPolicy(policy)?'GLOBAL_HOURLY_TEST_V1':'GLOBAL_DAILY_V1';
   const id=keccak256(toUtf8Bytes([domain,policy.chainId,policy.vaultAddress.toLowerCase(),policy.startTimestamp,epoch,assets[i].toLowerCase(),offset/100].join(':')));
   batches.push({id,asset:assets[i],recipients:rows.map(r=>r.recipient),amounts:rows.map(r=>r.amount),rows});
  }
 }
 return {status:'ready',epoch,start,end,snapshotBlock:snapshot.number,snapshotHash:snapshot.hash,batches};
}
export async function executeDailyPlan({provider,vault,plan,transact}){
 if(plan.status!=='ready')return [];
 if((await provider.getBlock(plan.snapshotBlock))?.hash!==plan.snapshotHash)throw Error('DAILY_SNAPSHOT_REORG');
 const completed=[];
 for(const batch of plan.batches){
  if(await vault.usedRewardBatch(batch.id)){completed.push({id:batch.id,status:'already_credited'});continue;}
  const amounts=batch.amounts.map(BigInt),total=amounts.reduce((a,b)=>a+b,0n);
  if((await vault.ledgers(batch.asset)).rewards<total||await vault.assetBalance(batch.asset)<total)throw Error('DAILY_PROFIT_FUNDING_REQUIRED');
  if((await provider.getBlock(plan.snapshotBlock))?.hash!==plan.snapshotHash)throw Error('DAILY_SNAPSHOT_REORG');
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
  if(process.env.TRADES_CHAIN_ID!=='97'||process.env.TRADES_VAULT_ADDRESS?.toLowerCase()!==policy.vaultAddress.toLowerCase()||!process.env.TRADES_RPC_URL)throw Error('AUTOMATION_TARGET_MISMATCH');
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
