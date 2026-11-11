// Isolated signer worker for the replacement-deployer testnet target.
// It never reads a V1 key, V1 policy, or V1 journal.
import fs from 'node:fs';
import {indexProgressSnapshot,creditBlockTimestamp} from './index-progress-snapshot.mjs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,JsonRpcProvider,Transaction,Wallet,ZeroAddress,getAddress,keccak256,parseEther} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {approvedQueueAbi,assertDailyJournalPlan,validateDailyPolicy} from './daily-profit.mjs';
import {loadDailyActivityGate} from './daily-activity-worker.mjs';
import {seedNewDeployerTestRewards,verifyNewDeployerTestSeedPending,isNewDeployerTestSeedLabel} from './fund-new-deployer-test-rewards.mjs';
import {makeNewDeployerHourlyTestPolicy,validateNewDeployerHourlyReadiness} from './new-deployer-hourly-test.mjs';
import {NEW_DEPLOYER_ARTIFACT_FILE,NEW_DEPLOYER_KEY_FILE,NEW_DEPLOYER_RELEASE_ID,NEW_DEPLOYER_STATE_DIR} from './new-deployer-testnet-profile.mjs';
import {assertImmutableV1Archive,readImmutableV1Archive,readNewDeployerPrivateText,validateNewDeployerConnectionRelease,verifyNewDeployerTestnetCreation} from './connect-new-deployer-testnet.mjs';
import {assertZeroStartJournalCanonical,publishZeroStartStatus,runZeroStartAutomation} from './zero-start-automation.mjs';
import {maintainOracles} from './maintain-testnet-oracles.mjs';
import {readPrivateKey} from './migration-signers.mjs';
import {journalTransaction,writePrivateJson} from './migration-journal.mjs';

export const NEW_DEPLOYER_AUTOMATION_DIR='/var/lib/globaldroptrade/new-deployer-testnet-automation-v1';
export const NEW_DEPLOYER_DAILY_POLICY_FILE=NEW_DEPLOYER_AUTOMATION_DIR+'/daily-policy.json';
export const NEW_DEPLOYER_DAILY_ACTIVITY_POLICY_FILE='/etc/globaldroptrade/new-deployer-testnet-v1/daily-activity-policy.json';
export const NEW_DEPLOYER_PUBLIC_STATUS_FILE='/var/www/globaldroptrade/automation-data/new-deployer-activation.json';
export const NEW_DEPLOYER_DAILY_TIMER='globaldroptrade-new-deployer-daily.timer';

const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const code=error=>/^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message||'')?error.message:'NEW_DEPLOYER_AUTOMATION_RPC_OR_EXECUTION_FAILED';
const fail=value=>{throw Error(value);};

export function readNewDeployerDailyScheduling({timer=NEW_DEPLOYER_DAILY_TIMER}={},run=execFileSync){
 if(typeof timer!=='string'||!timer.endsWith('.timer'))fail('NEW_DEPLOYER_TIMER_REQUIRED');
 try{run('systemctl',['is-active','--quiet',timer],{stdio:'ignore',timeout:5000});return {kind:'new-deployer',timer,active:true};}
 catch{return {kind:'none',timer,active:false};}
}

// The connection installer deliberately leaves this financial qualification
// unconfigured.  The worker therefore has an explicit, testable fail-closed
// boundary rather than inheriting any V1 API or worker environment setting.
export async function loadRequiredNewDeployerDailyActivity({provider,vaultAddress,state,save=()=>{},policyFile=NEW_DEPLOYER_DAILY_ACTIVITY_POLICY_FILE}){
 const activity=await loadDailyActivityGate({provider,chainId:97,vaultAddress,state,save,env:{},policyFile});
 if(!activity)fail('NEW_DEPLOYER_DAILY_ACTIVITY_POLICY_REQUIRED');
 return activity;
}

// A successful one-shot is not evidence that systemd will run it again.
// Keep this construction pure so installers and tests cannot accidentally
// advertise automatic payment when the isolated timer is inactive.
export function newDeployerAutomationPublicStatus(result,scheduling=readNewDeployerDailyScheduling()){
 if(!result?.readiness||typeof result.status!=='string'||!scheduling||typeof scheduling.active!=='boolean')fail('NEW_DEPLOYER_PUBLIC_STATUS_REQUIRED');
 return {...result.readiness,automationStatus:result.status,timerActive:scheduling.active,scheduling,dailyAutomationActive:scheduling.active&&result.status==='scheduled',automation:result};
}

function privateDirectory(directory,{create=false}={}){
 if(create)fs.mkdirSync(directory,{recursive:true,mode:0o700});
 let stat;try{stat=fs.lstatSync(directory);}catch{fail('NEW_DEPLOYER_AUTOMATION_DIRECTORY_REQUIRED');}
 if(!stat.isDirectory()||stat.uid!==0||(stat.mode&0o077)!==0)fail('NEW_DEPLOYER_AUTOMATION_DIRECTORY_REQUIRED');
}

function readPrivateJson(file,reason){
 let value;try{value=JSON.parse(readNewDeployerPrivateText(file));}catch{fail(reason);}
 if(!value||typeof value!=='object'||Array.isArray(value))fail(reason);
 return value;
}

function readBundledJson(file,reason){
 let value;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail(reason);}
 if(!value||typeof value!=='object'||Array.isArray(value))fail(reason);
 return value;
}

function reportAddress(value,reason){
 try{const result=getAddress(value);if(result===ZeroAddress)throw Error();return result;}catch{fail(reason);}
}

function identityOf(readiness){return {version:1,chainId:97,target:readiness.target,owner:readiness.owner,operator:readiness.operator,queue:readiness.queue,hash:readiness.hash,runtimeHash:readiness.runtimeHash};}

function connectionIdentity(report,creation){
 if(report?.version!==1||report.kind!=='new-deployer-testnet-site-connection'||report.releaseId!==creation.releaseId||report.artifact!==creation.artifact||report.chainId!==97||report.siteConnected!==true||report.verified!==true||report.testMode!==true||report.initialServerReporter!==true||report.fastTestnetVersion!==1||report.newDeployerTestnetVersion!==1||report.fastNewDeployerTestnetVersion!==1)fail('NEW_DEPLOYER_CONNECTION_IDENTITY_REQUIRED');
 for(const key of ['target','contractAddress','vaultAddress','owner','operator','deployer','queue','hash','block','blockHash','artifactHash','initcodeHash','runtimeHash','archiveSessionSha256'])if(report[key]!==creation[key])fail('NEW_DEPLOYER_CONNECTION_IDENTITY_REQUIRED');
 if(reportAddress(report.target,'NEW_DEPLOYER_CONNECTION_IDENTITY_REQUIRED')!==creation.target)fail('NEW_DEPLOYER_CONNECTION_IDENTITY_REQUIRED');
 return report;
}

function activeConfiguration(original,{release,creation}){
 let settings,config;try{settings=parseEnv(original);config=readConfig(settings);}catch{fail('NEW_DEPLOYER_ACTIVE_API_TARGET_REQUIRED');}
 if(settings.GLOBAL_MIGRATION_ENABLED!=='false'||settings.TRADES_ZERO_START_PROFILE!==release.releaseId||config.chainId!==97||config.address!==creation.target||config.startBlock!==creation.block||!config.rpcUrl)fail('NEW_DEPLOYER_ACTIVE_API_TARGET_REQUIRED');
 return {settings,config};
}

async function fundingSnapshot({vault,queue,release,block}){
 const options={blockTag:block.number},tiers=await Promise.all(Array.from({length:5},(_,index)=>vault.tierConfig(index,options)));
 const maxDailyBps=tiers.reduce((maximum,tier)=>tier.maxDailyBps>maximum?tier.maxDailyBps:maximum,0n);
 const maxReferralBps=tiers.reduce((maximum,tier)=>{
  const values=Array.from(tier.referrals);
  if(values.length!==4||values.some(value=>value<0n||value>3400n))fail('NEW_DEPLOYER_DAILY_PLAN_REQUIRED');
  const total=values.reduce((sum,value)=>sum+value,0n);return total>maximum?total:maximum;
 },0n);
 if(maxDailyBps>1000n||maxReferralBps>3400n)fail('NEW_DEPLOYER_DAILY_PLAN_REQUIRED');
 const tokenDecimals=Number(await vault.tokenDecimals(options)),assets=[];
 for(const [asset,symbol,decimals] of [[ZeroAddress,'BNB',18],[release.token,'USDT',tokenDecimals]]){
  const [ledger,cash,pending]=await Promise.all([vault.ledgers(asset,options),vault.assetBalance(asset,options),queue.pending(asset,options)]);
  const personal=(ledger.principal*maxDailyBps+9999n)/10000n,referral=(personal*maxReferralBps+9999n)/10000n,minimum=personal+referral||1n;
  assets.push({asset,symbol,decimals,principal:ledger.principal.toString(),rewards:ledger.rewards.toString(),cash:cash.toString(),pending:pending.toString(),minimumBudgetRequired:minimum.toString(),ready:ledger.rewards>=minimum&&cash>=minimum,requiredForExistingPrincipal:ledger.principal>0n});
 }
 const required=assets.filter(asset=>asset.requiredForExistingPrincipal);
 return {estimateVersion:2,maxDailyBps:Number(maxDailyBps),maxReferralBps:Number(maxReferralBps),assets,ready:required.length?required.every(asset=>asset.ready):assets.some(asset=>asset.ready)};
}

// Re-check the canonical creation proof, V1 archive digest, current runtime,
// active API target and signer capability before a financial operation.
export async function verifyNewDeployerAutomationReadiness({provider,artifact,release,deploymentReport,connectionReport,archive,original,confirmations=3}){
 if(!Number.isSafeInteger(confirmations)||confirmations<1||confirmations>100)fail('NEW_DEPLOYER_CONFIRMATIONS_REQUIRED');
 const selected=validateNewDeployerConnectionRelease(release),creation=await verifyNewDeployerTestnetCreation({provider,artifact,deploymentReport,release:selected,archive,confirmations});
 assertImmutableV1Archive(archive);connectionIdentity(connectionReport,creation);activeConfiguration(original,{release:selected,creation});
 const head=await provider.getBlockNumber(),checkpoint=await provider.getBlock(Math.max(creation.block,head-confirmations));
 if(!checkpoint||checkpoint.number<creation.block||(await provider.getBlock(checkpoint.number))?.hash!==checkpoint.hash)fail('NEW_DEPLOYER_READINESS_CHECKPOINT_REORG');
 const vault=new Contract(creation.target,artifact.abi,provider),queue=new Contract(creation.queue,approvedQueueAbi,provider),options={blockTag:checkpoint.number};
 const [runtime,owner,reporter,version,queueVault,queueVersion,token,bnbFeed,tokenFeed,paused,gas]=await Promise.all([
  provider.getCode(creation.target,checkpoint.number),vault.owner(options),vault.reporters(selected.deployer,options),vault.FAST_TESTNET_VERSION(options),queue.vault(options),queue.APPROVAL_VERSION(options),vault.usdt(options),vault.bnbUsdFeed(options),vault.usdtUsdFeed(options),vault.paused(options),provider.getBalance(selected.deployer,checkpoint.number)
 ]);
 if(runtime==='0x'||keccak256(runtime)!==creation.runtimeHash||getAddress(owner)!==selected.owner||!reporter||version!==1n||getAddress(queueVault)!==creation.target||queueVersion!==1n||getAddress(token)!==selected.token||getAddress(bnbFeed)!==selected.bnbFeed||getAddress(tokenFeed)!==selected.tokenFeed)fail('NEW_DEPLOYER_CURRENT_CAPABILITY_REQUIRED');
 const funding=await fundingSnapshot({vault,queue,release:selected,block:checkpoint}),blockers=[];
 if(paused)blockers.push('OWNER_UNPAUSE_REQUIRED');
 if(!funding.ready)blockers.push('FUNDED_DAILY_REWARD_BUDGET_REQUIRED');
 if(gas<=0n)blockers.push('SERVER_OPERATOR_TEST_BNB_REQUIRED');
 return validateNewDeployerHourlyReadiness({
  version:1,kind:'new-deployer-testnet-readiness',releaseId:selected.releaseId,artifact:selected.artifact,chainId:97,target:creation.target,contractAddress:creation.target,owner:selected.owner,operator:selected.deployer,token:selected.token,queue:creation.queue,hash:creation.hash,block:creation.block,blockHash:creation.blockHash,artifactHash:creation.artifactHash,initcodeHash:creation.initcodeHash,runtimeHash:creation.runtimeHash,testMode:true,initialServerReporter:true,fastTestnetVersion:1,newDeployerTestnetVersion:1,fastNewDeployerTestnetVersion:1,siteConnected:true,reporterAuthorized:true,checkpoint:{block:checkpoint.number,blockHash:checkpoint.hash,timestamp:checkpoint.timestamp,observedHead:head,confirmations:head-checkpoint.number},paused,funding,operatorGas:{balance:gas.toString(),positive:gas>0n},archive:{status:'connection-and-creation-verified',fullyVerified:false},ready:blockers.length===0,blockers
 });
}

function loadPolicy(file,readiness){
 if(!fs.existsSync(file))return undefined;
 const policy=validateDailyPolicy(readPrivateJson(file,'NEW_DEPLOYER_DAILY_POLICY_REQUIRED'));
 if(policy.releaseId!==NEW_DEPLOYER_RELEASE_ID||policy.vaultAddress!==readiness.target||policy.runtimeHash!==readiness.runtimeHash||policy.deploymentBlock!==readiness.block||policy.owner!==readiness.owner||policy.operator!==readiness.operator)fail('NEW_DEPLOYER_DAILY_POLICY_CHANGED');
 return policy;
}

function pendingTransaction(entry,reason){
 let transaction;try{transaction=Transaction.from(entry?.raw);}catch{fail(reason);}
 if(transaction.chainId!==97n||transaction.value!==0n||!transaction.from||keccak256(entry.raw)!==entry.hash)fail(reason);
 return transaction;
}

// A pending raw transaction is not trusted merely because it sits in the new
// journal.  It must still match an exact current operation before resumption.
async function pendingReceipt(provider,entry){
 const receipt=await provider.getTransactionReceipt(entry.hash);
 if(!receipt)return null;
 if(receipt.status!==1||!Number.isSafeInteger(receipt.blockNumber)||!hash(receipt.blockHash)||(await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)fail('NEW_DEPLOYER_PENDING_RECEIPT_INVALID');
 return receipt;
}

async function validatePending({provider,wallet,expectedOperator,state,policy,vault,queue,feedAddresses,feedArtifact,seedOptions,activity}){
 if(expectedOperator&&getAddress(wallet.address)!==getAddress(expectedOperator))fail('NEW_DEPLOYER_PENDING_OPERATOR_REQUIRED');
 const pending=Object.entries(state.transactions||{}).filter(([,entry])=>!entry?.block);
 if(pending.length>1)fail('NEW_DEPLOYER_MULTIPLE_SIGNED_PENDING_TRANSACTIONS');
 const valid=[];
 for(const [label,entry] of pending){
  const transaction=pendingTransaction(entry,'NEW_DEPLOYER_PENDING_TRANSACTION_INVALID');
  if(getAddress(transaction.from)!==wallet.address)fail('NEW_DEPLOYER_PENDING_TRANSACTION_INVALID');
  const request={to:transaction.to,data:transaction.data,value:transaction.value};
  const receipt=await pendingReceipt(provider,entry);
  if(isNewDeployerTestSeedLabel(label)){
   await verifyNewDeployerTestSeedPending({...seedOptions,label,request});valid.push({label,request});continue;
  }
  if(label.startsWith('daily-')){
   if(!policy)fail('NEW_DEPLOYER_PENDING_DAILY_POLICY_REQUIRED');
   // Activity evidence binds reward batches only.  Do not let a missing
   // future-earning policy strand an already approved queue payout, seed,
   // oracle repair or volume continuation in the same recovery pass.
   const dailyActivity=typeof activity==='function'?await activity():activity;
   await assertDailyJournalPlan({provider,policy,state:state.daily,label,request,activity:dailyActivity});valid.push({label,request});continue;
  }
  if(/^withdrawal-[0-9]+$/.test(label)){
   let action;try{action=queue.interface.parseTransaction(request);}catch{}
   const expected=label.slice('withdrawal-'.length);
   if(action?.name==='pay'&&getAddress(request.to)===getAddress(await queue.getAddress())&&action.args[0]===BigInt(expected)){valid.push({label,request});continue;}
  }
  if(/^volume-[0-9]+-0x[0-9a-f]{40}$/i.test(label)){
   let action;try{action=vault.interface.parseTransaction(request);}catch{}
   const match=/^volume-([0-9]+)-(0x[0-9a-f]{40})$/i.exec(label);
   let volumeTarget;try{volumeTarget=getAddress(state.volume?.target);}catch{}
   const target=getAddress(await vault.getAddress()),steps=action?.args?.[1];
   const checkpoint=state.volume?.checkpoint;
   if(checkpoint&&(!Number.isSafeInteger(checkpoint.block)||!hash(checkpoint.hash)||(await provider.getBlock(checkpoint.block))?.hash!==checkpoint.hash))fail('NEW_DEPLOYER_VOLUME_CHECKPOINT_REORG');
   if(action?.name==='processNetworkVolume'&&getAddress(request.to)===target&&action.args[0]===BigInt(match[1])&&typeof steps==='bigint'&&steps>=1n&&steps<=64n&&volumeTarget===target&&String(state.volume?.nextJob)===match[1]){
    if(!receipt&&getAddress((await vault.volumeJobs(action.args[0])).ancestor)!==getAddress(match[2]))fail('NEW_DEPLOYER_VOLUME_PENDING_ANCESTOR_MISMATCH');
    valid.push({label,request});continue;
   }
  }
  if(/^oracle-refresh-[1-9][0-9]*$/.test(label)&&feedAddresses.some(address=>getAddress(address)===getAddress(request.to))){
   const feed=new Contract(request.to,['function set(int256,uint256,uint80,uint80)'],provider);
   let action;try{action=feed.interface.parseTransaction(request);}catch{}
   const planned=state.oracle?.pending;
   const oracleIdentity={chainId:97,vault:getAddress(await vault.getAddress()),feeds:feedAddresses.map(getAddress),deployer:wallet.address};
   const expectedRuntime='0x'+String(feedArtifact?.evm?.deployedBytecode?.object||'').replace(/^0x/,'');
   if(action?.name==='set'&&planned?.label===label&&getAddress(planned.request?.to)===getAddress(request.to)&&planned.request?.data===request.data&&same(state.oracle?.identity,oracleIdentity)&&expectedRuntime!=='0x'&&(await provider.getCode(request.to)).toLowerCase()===expectedRuntime.toLowerCase()){valid.push({label,request});continue;}
  }
  fail('NEW_DEPLOYER_PENDING_TRANSACTION_SCOPE_MISMATCH');
 }
 return valid;
}

export async function validateNewDeployerPendingTransactions(options){return validatePending(options);}

export async function reconcileNewDeployerPendingTransactions({transact,...options}){
 if(typeof transact!=='function')fail('NEW_DEPLOYER_PENDING_RECONCILIATION_REQUIRED');
 const pending=await validatePending(options);
 for(const entry of pending)await transact(entry.label,entry.request);
 return pending;
}

export async function runNewDeployerAutomation({provider,wallet,artifact,release,deploymentReport,connectionReport,archive,original,state,save,policyFile=NEW_DEPLOYER_DAILY_POLICY_FILE,seed=false,confirmations=3,onPhase=()=>{}}){
 const read=async()=>verifyNewDeployerAutomationReadiness({provider,artifact,release,deploymentReport,connectionReport,archive,original,confirmations});
 let readiness=await read();
 if(getAddress(wallet.address)!==readiness.operator||getAddress(wallet.address)!==release.deployer)fail('NEW_DEPLOYER_SERVER_OPERATOR_KEY_REQUIRED');
 const rootIdentity=identityOf(readiness);
 if(state.identity&&!same(state.identity,rootIdentity))fail('NEW_DEPLOYER_AUTOMATION_IDENTITY_CHANGED');
 if(!state.identity&&Object.keys(state.transactions||{}).length)fail('NEW_DEPLOYER_UNBOUND_AUTOMATION_JOURNAL');
 state.identity??=rootIdentity;state.transactions??={};save();
 const vault=new Contract(readiness.target,artifact.abi,wallet),queue=new Contract(readiness.queue,approvedQueueAbi,wallet);
 const loadActivity=async({state:daily=state.daily,save:saveDaily=save}={})=>loadRequiredNewDeployerDailyActivity({provider,vaultAddress:readiness.target,state:daily,save:saveDaily});
 let activity;
 const activityGate=async options=>{activity??=await loadActivity(options);return activity;};
 const assertCurrent=async()=>{
  if(readNewDeployerPrivateText('/etc/globaldroptrade/trades.env')!==original)fail('NEW_DEPLOYER_ENV_CHANGED');
  const current=await read();
  if(!same(identityOf(current),identityOf(readiness)))fail('NEW_DEPLOYER_TARGET_CHANGED');
  await assertZeroStartJournalCanonical(provider,state);
 };
 const transact=async(label,request)=>journalTransaction({provider,wallet,state,save,label,request,guard:async()=>{
  await assertCurrent();
  if(label.startsWith('daily-'))await assertDailyJournalPlan({provider,policy:loadPolicy(policyFile,readiness),state:state.daily,label,request,activity:await activityGate()});
 },confirmations,timeout:45000,maxTotalFee:parseEther('0.1')});
 let policy=loadPolicy(policyFile,readiness);
 const tokenArtifact=JSON.parse(fs.readFileSync(new URL('../artifacts/MockToken.json',import.meta.url),'utf8'));
 const feedArtifact=JSON.parse(fs.readFileSync(new URL('../artifacts/MockFeed.json',import.meta.url),'utf8'));
 const seedOptions={provider,wallet,artifact:tokenArtifact,release,readiness,vault,state,save,transact};
 // Reconcile exactly the already-signed transaction before generating a seed,
 // oracle refresh, queue payment, volume job, or reward batch.
 await reconcileNewDeployerPendingTransactions({provider,wallet,expectedOperator:readiness.operator,state,policy,vault,queue,feedAddresses:[release.bnbFeed,release.tokenFeed],feedArtifact,seedOptions,activity:policy?activityGate:undefined,transact});
 if(seed){
  await seedNewDeployerTestRewards(seedOptions);
  readiness=await read();
 }
 const maintain=async()=>{
  state.oracle??={};Object.defineProperty(state.oracle,'transactions',{get:()=>state.transactions,configurable:true,enumerable:false});
  return maintainOracles({provider,wallet,artifact:feedArtifact,vaultAddress:readiness.target,feedAddresses:[release.bnbFeed,release.tokenFeed],state:state.oracle,save,confirmations,transact:({label,request})=>transact(label,request)});
 };
 const result=await runZeroStartAutomation({
  provider,vault,queue,readiness,state,save,loadPolicy:()=>policy,
  savePolicy:value=>{if(fs.existsSync(policyFile))fail('NEW_DEPLOYER_DAILY_POLICY_ALREADY_EXISTS');writePrivateJson(policyFile,value);policy=value;},
  transact,refreshReadiness:read,maintainOracles:maintain,hourlyTest:true,makeHourlyPolicy:makeNewDeployerHourlyTestPolicy,requireActivityBeforePolicy:true,confirmations,loadActivity:activityGate,onPhase
 });
 const reserved=Object.values(state.transactions||{}).reduce((sum,row)=>sum+BigInt(row.maxFee||0),0n);
 return {...result,indexProgress:indexProgressSnapshot(state.daily),lastCreditBlockTimestamp:await creditBlockTimestamp(provider,result.lastDailyCredit,readiness.target),kind:'new-deployer-testnet-automation',releaseId:release.releaseId,testMode:true,initialServerReporter:true,newDeployerTestnetVersion:1,fastNewDeployerTestnetVersion:1,feeBudget:{maxWei:parseEther('0.1').toString(),reservedWei:reserved.toString(),renewal:'manual-new-release-required; pending state is never rotated'}};
}

function acquireLock(directory){
 const file=path.join(directory,'run.lock');
 if(fs.existsSync(file)){
  let pid;try{pid=Number(readNewDeployerPrivateText(file));}catch{fail('NEW_DEPLOYER_AUTOMATION_LOCK_REQUIRED');}
  if(!Number.isSafeInteger(pid)||pid<1)fail('NEW_DEPLOYER_AUTOMATION_LOCK_REQUIRED');
  try{process.kill(pid,0);fail('NEW_DEPLOYER_AUTOMATION_ALREADY_RUNNING');}
  catch(error){if(error?.message==='NEW_DEPLOYER_AUTOMATION_ALREADY_RUNNING')throw error;if(error.code!=='ESRCH')throw error;fs.unlinkSync(file);}
 }
 const descriptor=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(descriptor,String(process.pid));fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
 return file;
}

function releaseLock(file){
 if(!file)return;
 try{if(readNewDeployerPrivateText(file)===String(process.pid))fs.unlinkSync(file);}catch{}
}

async function main(){
 let provider,lock;
 try{
  const args=process.argv.slice(2),modes=args.filter(value=>value==='--check'||value==='--execute'),seeds=args.filter(value=>value==='--seed-test-rewards');
  if(process.getuid?.()!==0||modes.length!==1||seeds.length>1||args.length!==modes.length+seeds.length||seeds.length&&modes[0]!=='--execute')fail('NEW_DEPLOYER_EXPLICIT_CHECK_OR_EXECUTE_REQUIRED');
  privateDirectory(NEW_DEPLOYER_AUTOMATION_DIR,{create:modes[0]==='--execute'});lock=acquireLock(NEW_DEPLOYER_AUTOMATION_DIR);
  const release=validateNewDeployerConnectionRelease(readBundledJson(new URL('../config/new-deployer-testnet.json',import.meta.url),'NEW_DEPLOYER_RELEASE_REQUIRED'));
  const artifact=readBundledJson(NEW_DEPLOYER_ARTIFACT_FILE,'NEW_DEPLOYER_ARTIFACT_REQUIRED');
  const original=readNewDeployerPrivateText('/etc/globaldroptrade/trades.env');
  let config;try{config=readConfig(parseEnv(original));}catch{fail('NEW_DEPLOYER_ACTIVE_API_TARGET_REQUIRED');}
  const deploymentReport=readPrivateJson(NEW_DEPLOYER_STATE_DIR+'/deployment-public.json','NEW_DEPLOYER_DEPLOYMENT_REPORT_REQUIRED');
  const connectionReport=readPrivateJson(NEW_DEPLOYER_STATE_DIR+'/connection-public.json','NEW_DEPLOYER_CONNECTION_REPORT_REQUIRED');
  const archive=readImmutableV1Archive(),request=new FetchRequest(config.rpcUrl);request.timeout=15000;
  provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=2000;
  if(modes[0]==='--check'){
   const readiness=await verifyNewDeployerAutomationReadiness({provider,artifact,release,deploymentReport,connectionReport,archive,original,confirmations:Math.max(3,config.confirmations)});
   console.log('NEW_DEPLOYER_AUTOMATION_CHECKED ready='+readiness.ready+' target='+readiness.target);console.log('BLOCKERS='+(readiness.blockers.join(',')||'none'));return;
  }
  const key=readPrivateKey(NEW_DEPLOYER_KEY_FILE);if(!key)fail('NEW_DEPLOYER_KEY_FILE_REQUIRED');
  const wallet=new Wallet(key,provider);if(wallet.address!==release.deployer)fail('NEW_DEPLOYER_SERVER_OPERATOR_KEY_REQUIRED');
  const journal=NEW_DEPLOYER_AUTOMATION_DIR+'/journal.json',state=fs.existsSync(journal)?readPrivateJson(journal,'NEW_DEPLOYER_AUTOMATION_JOURNAL_REQUIRED'):{transactions:{}};
  const save=()=>writePrivateJson(journal,state);save();
  const result=await runNewDeployerAutomation({provider,wallet,artifact,release,deploymentReport,connectionReport,archive,original,state,save,seed:seeds.length===1,confirmations:Math.max(3,config.confirmations)});
  writePrivateJson(NEW_DEPLOYER_AUTOMATION_DIR+'/status.json',result);
  publishZeroStartStatus(newDeployerAutomationPublicStatus(result),NEW_DEPLOYER_PUBLIC_STATUS_FILE);
  console.log('NEW_DEPLOYER_AUTOMATION_'+result.status.toUpperCase()+' target='+result.target);
  if(result.status!=='scheduled')console.log('BLOCKERS='+[...(result.blockers||[]),...(result.errors||[])].join(','));
 }catch(error){console.error('NEW_DEPLOYER_AUTOMATION_STOPPED '+code(error));process.exitCode=1;}
 finally{releaseLock(lock);provider?.destroy();}
}

let invoked;
try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;}catch{}
if(import.meta.url===invoked)await main();
