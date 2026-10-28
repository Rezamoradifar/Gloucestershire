// Existing-server-key automation. No owner-key loading or interactive wallet prompts.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,Interface,JsonRpcProvider,Transaction,Wallet,ZeroAddress,getAddress,keccak256,parseEther} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {parseZeroStartProfileArgs} from './zero-start-profile.mjs';
import {verifyZeroStartReadiness,verifyZeroStartTarget} from './zero-start-readiness.mjs';
import {createZeroStartProofProviders} from './connect-zero-start.mjs';
import {dailyAbi,approvedQueueAbi,validateDailyPolicy,planDailyEpoch,executeDailyPlan,payApprovedRequests} from './daily-profit.mjs';
import {installHistoricalCallRetry} from './complete-rpc-logs.mjs';
import {processZeroStartVolume} from './zero-start-volume.mjs';
import {maintainOracles} from './maintain-testnet-oracles.mjs';
import {inspectMockFeeds} from './refresh-testnet-oracles.mjs';
import {readPrivateKey} from './migration-signers.mjs';
import {journalTransaction,writePrivateJson} from './migration-journal.mjs';
import {isPositionPolicy,completePositionHour} from './position-profit.mjs';
import {makeHourlyTestPolicy,transitionHourlyTestPolicy} from './zero-start-hourly-test.mjs';

const publicRoot='/var/www/globaldroptrade/automation-data';
const code=e=>/^[A-Z][A-Z0-9_]{2,100}$/.test(e?.message||'')?e.message:'AUTOMATION_RPC_OR_EXECUTION_FAILED';
const identityOf=readiness=>({version:1,chainId:97,target:readiness.target,owner:readiness.owner,operator:readiness.operator,queue:readiness.queue,hash:readiness.hash,runtimeHash:readiness.runtimeHash});
const workerPhases=new Set(['ARGUMENT_VALIDATION','LOCAL_CONFIGURATION','TARGET_VERIFICATION','PENDING_RECONCILIATION','ORACLE_MAINTENANCE','ORACLE_INSPECTION','TEST_REWARD_SEED','TEST_REWARD_GRANT','POLICY_LOAD','DAILY_READINESS','HOURLY_POLICY_TRANSITION','APPROVED_WITHDRAWALS','NETWORK_VOLUME','POLICY_VERIFICATION','DAILY_PERIOD_PLAN','DAILY_CREDIT_EXECUTION','STATUS_PUBLICATION']);
const ethersErrorCodes=new Set(['CALL_EXCEPTION','NETWORK_ERROR','SERVER_ERROR','TIMEOUT','BAD_DATA','UNKNOWN_ERROR','UNSUPPORTED_OPERATION','INVALID_ARGUMENT','NUMERIC_FAULT','BUFFER_OVERRUN','INSUFFICIENT_FUNDS','NONCE_EXPIRED','REPLACEMENT_UNDERPRICED','TRANSACTION_REPLACED','ACTION_REJECTED','OFFCHAIN_FAULT','CANCELLED']);

// Never publish provider messages, URLs, request bodies, signed data or stacks.
export function zeroStartWorkerDiagnostic(error,{phase,state}={}){
 const pending=Object.entries(state?.transactions||{}).filter(([,entry])=>!entry?.block);
 const rpcValue=error?.info?.error?.code??error?.error?.code;
 const rpcCode=typeof rpcValue==='number'&&Number.isSafeInteger(rpcValue)&&rpcValue>=-2147483648&&rpcValue<=2147483647?rpcValue:null;
 return {phase:workerPhases.has(phase)?phase:'UNKNOWN',errorCode:ethersErrorCodes.has(error?.code)?error.code:null,rpcCode,pendingSignedTransaction:pending.length>0,pendingFinancialTransaction:Boolean(state?.pending)||pending.some(([label])=>!/^oracle-refresh-[1-9][0-9]*$/.test(label))};
}
const readFailureBlocker=phase=>workerPhases.has(phase)?phase+'_RPC_UNAVAILABLE':'DAILY_READINESS_RPC_UNAVAILABLE';

export async function assertZeroStartJournalCanonical(provider,state){
 const blocks=new Map();
 for(const entry of Object.values(state.transactions||{}))if(entry.block!==undefined){
  if(!Number.isSafeInteger(entry.block)||entry.block<1||!/^0x[0-9a-f]{64}$/i.test(entry.blockHash||''))throw Error('ZERO_START_COMPLETED_JOURNAL_INVALID');
  if(blocks.has(entry.block)&&blocks.get(entry.block)!==entry.blockHash)throw Error('ZERO_START_COMPLETED_JOURNAL_NOT_CANONICAL');
  blocks.set(entry.block,entry.blockHash);
 }
 const rows=[...blocks];
 for(let offset=0;offset<rows.length;offset+=4){
  const result=await Promise.all(rows.slice(offset,offset+4).map(async([number,hash])=>(await provider.getBlock(number))?.hash===hash));
  if(result.some(valid=>!valid))throw Error('ZERO_START_COMPLETED_JOURNAL_NOT_CANONICAL');
 }
}

// An oracle-only repair must never resume a financial transaction as a side effect.
// Validate the entire pending set before the first request can be broadcast.
export function assertZeroStartOraclePending({state,release,artifact}){
 const abi=new Interface(artifact.abi),feeds=[release.bnbFeed,release.tokenFeed].map(getAddress);
 const allowed=(label,request)=>{
  let action;
  try{action=abi.parseTransaction(request);}catch{}
  if(!/^oracle-refresh-[1-9][0-9]*$/.test(label||'')||!request?.to||!feeds.includes(getAddress(request.to))||BigInt(request.value??0)!==0n||action?.name!=='set'||action.args[0]<=0n||action.args[1]<=0n||action.args[2]<=0n||action.args[3]!==action.args[2])throw Error('ZERO_START_ORACLE_PENDING_SCOPE_MISMATCH');
 };
 const planned=state.oracle?.pending;
 if(planned)allowed(planned.label,planned.request);
 const pending=Object.entries(state.transactions||{}).filter(([,entry])=>!entry.block);
 if(pending.length>1)throw Error('ZERO_START_NON_ORACLE_PENDING_REQUIRES_FULL_WORKER');
 for(const[label,entry]of pending){
  if(!planned||planned.label!==label)throw Error('ZERO_START_NON_ORACLE_PENDING_REQUIRES_FULL_WORKER');
  const tx=Transaction.from(entry.raw),request={to:tx.to,data:tx.data,value:tx.value};
  allowed(label,request);
  if(getAddress(planned.request.to)!==request.to||planned.request.data!==request.data)throw Error('ZERO_START_ORACLE_PENDING_SCOPE_MISMATCH');
 }
}

// Validate every saved request before resuming any signed nonce. A planned
// oracle refresh may coexist with one signed financial transaction, but two
// unresolved signed transactions require explicit journal reconciliation.
export async function validateZeroStartPendingTransactions({state,wallet,readiness,release,artifact,seed,million}){
 if(!state||typeof state!=='object'||Array.isArray(state)||!state.transactions||typeof state.transactions!=='object'||Array.isArray(state.transactions))throw Error('ZERO_START_PENDING_JOURNAL_REQUIRED');
 if(state.pending)throw Error('ZERO_START_UNSUPPORTED_PENDING_STATE');
 if(state.oracle&&(typeof state.oracle!=='object'||Array.isArray(state.oracle)))throw Error('ZERO_START_PENDING_JOURNAL_REQUIRED');
 const pending=Object.entries(state.transactions).filter(([,entry])=>!entry?.block);
 if(pending.length>1)throw Error('ZERO_START_MULTIPLE_SIGNED_PENDING_TRANSACTIONS');
 const operator=getAddress(wallet.address);
 if(operator!==getAddress(readiness.operator)||operator!==getAddress(release.deployer))throw Error('EXPECTED_SERVER_OPERATOR_KEY_REQUIRED');
 assertZeroStartOraclePending({state:{...state,transactions:{}},release,artifact});
 const feeds=new Interface(artifact.abi);
 const allowed=new Map([[getAddress(readiness.target),{abi:new Interface(dailyAbi.concat(['function processNetworkVolume(uint256,uint256)'])),methods:['batchProfit','processNetworkVolume']}],[getAddress(readiness.queue),{abi:new Interface(approvedQueueAbi),methods:['pay']}],[getAddress(release.bnbFeed),{abi:feeds,methods:['set']}],[getAddress(release.tokenFeed),{abi:feeds,methods:['set']}]]);
 const validated=[];
 for(const[label,entry]of pending){
  let tx;
  try{tx=Transaction.from(entry.raw);}catch{throw Error('ZERO_START_PENDING_TRANSACTION_INVALID');}
  if(tx.from!==operator||tx.chainId!==97n||tx.value!==0n||keccak256(entry.raw)!==entry.hash)throw Error('ZERO_START_PENDING_TRANSACTION_MISMATCH');
  const request={to:tx.to,data:tx.data,value:tx.value};
  if(seed?.isLabel(label))await seed.verify(label,request);
  else if(million?.isLabel(label))await million.verify(label,request);
  else{
   const rule=allowed.get(tx.to);let action;
   try{action=rule?.abi.parseTransaction(request);}catch{}
   if(!action||!rule.methods.includes(action.name))throw Error('ZERO_START_PENDING_TRANSACTION_TARGET_MISMATCH');
   if(action.name==='set')assertZeroStartOraclePending({state,release,artifact});
  }
  validated.push({label,request:{to:tx.to,data:tx.data}});
 }
 return validated;
}

export async function inspectZeroStartOracles({provider,artifact,release,readiness}){
 const {vault,actual,maxAge}=await inspectMockFeeds({provider,artifact,vaultAddress:readiness.target,feedAddresses:[release.bnbFeed,release.tokenFeed]});
 const block=await provider.getBlock('latest'),feeds=[];
 for(const address of actual){
  const feed=new Contract(address,artifact.abi,provider),[round,answer,,updated,answered]=await feed.latestRoundData({blockTag:block.number});
  const ready=round>0n&&answer>0n&&updated>0n&&updated<=BigInt(block.timestamp)&&BigInt(block.timestamp)-updated<=maxAge&&answered>=round;
  feeds.push({address,round:round.toString(),answer:answer.toString(),updatedAt:updated.toString(),answeredInRound:answered.toString(),ageSeconds:(BigInt(block.timestamp)-updated).toString(),ready});
 }
 const ready=feeds.every(feed=>feed.ready);
 if(ready){await vault.quoteUsd(ZeroAddress,parseEther('1'));await vault.quoteUsd(release.token,parseEther('1'));}
 return {version:1,chainId:97,target:readiness.target,status:ready?'TESTNET_ORACLES_VALID':'ORACLE_REFRESH_REQUIRED',ready,block:block.number,blockHash:block.hash,timestamp:block.timestamp,maxOracleAge:maxAge.toString(),feeds,transactionsSent:0};
}

export async function runZeroStartOracleMaintenance({provider,wallet,artifact,release,readiness,state,save,transact,confirmations=3,oraclesOnly=false}){
 const identity=identityOf(readiness);
 if(state.identity&&JSON.stringify(state.identity)!==JSON.stringify(identity))throw Error('ZERO_START_AUTOMATION_IDENTITY_CHANGED');
 if(!state.identity&&Object.keys(state.transactions||{}).length)throw Error('ZERO_START_UNBOUND_AUTOMATION_JOURNAL');
 await assertZeroStartJournalCanonical(provider,state);
 if(oraclesOnly)assertZeroStartOraclePending({state,release,artifact});
 state.identity=identity;state.transactions??={};save();
 if(oraclesOnly)for(const[label,entry]of Object.entries(state.transactions))if(!entry.block){
  const tx=Transaction.from(entry.raw);await transact(label,{to:tx.to,data:tx.data});
 }
 state.oracle??={};
 Object.defineProperty(state.oracle,'transactions',{get:()=>state.transactions,configurable:true,enumerable:false});
 return maintainOracles({provider,wallet,artifact,vaultAddress:readiness.target,feedAddresses:[release.bnbFeed,release.tokenFeed],state:state.oracle,save,confirmations,transact:options=>transact(options.label,options.request)});
}

export function lastConfirmedDailyCredit(state){
 const credit=state?.daily?.lastCredit,epoch=credit?.epoch;
 if(!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(state.daily.epoch)||epoch>=state.daily.epoch||!Array.isArray(credit.credited)||credit.credited.length>10000)return null;
 const batches=[];
 for(const batch of credit.credited){
  if(!/^0x[0-9a-f]{64}$/i.test(batch?.id||''))continue;
  const entry=state.transactions?.['daily-'+batch.id];
  if(!entry||!Number.isSafeInteger(entry.block)||entry.block<1||!/^0x[0-9a-f]{64}$/i.test(entry.blockHash||'')||!/^0x[0-9a-f]{64}$/i.test(entry.hash||''))continue;
  if(batch.status!=='already_credited'&&(batch.status!=='credited'||batch.transactionHash!==entry.hash))continue;
  batches.push({id:batch.id,transactionHash:entry.hash,block:entry.block,blockHash:entry.blockHash});
 }
 return batches.length?{epoch,batches}:null;
}

export async function runZeroStartAutomation({provider,vault,queue,readiness,state,save,loadPolicy,savePolicy,transact,refreshReadiness,maintainOracles:maintain=async()=>({status:'not-configured'}),processVolume=processZeroStartVolume,confirmations=3,hourlyTest=false,onPhase=()=>{}}){
 let phase='TARGET_VERIFICATION';
 const during=async(name,action)=>{phase=name;onPhase(name);return action();};
 const target=getAddress(await vault.getAddress());
 if(readiness?.version!==1||readiness.chainId!==97||getAddress(readiness.target)!==target||getAddress(await queue.vault())!==target)throw Error('ZERO_START_AUTOMATION_TARGET_MISMATCH');
 const identity={version:1,chainId:97,target,owner:readiness.owner,operator:readiness.operator,queue:readiness.queue,hash:readiness.hash,runtimeHash:readiness.runtimeHash};
 if(state.identity&&JSON.stringify(state.identity)!==JSON.stringify(identity))throw Error('ZERO_START_AUTOMATION_IDENTITY_CHANGED');
 if(!state.identity&&Object.keys(state.transactions||{}).length)throw Error('ZERO_START_UNBOUND_AUTOMATION_JOURNAL');
 await assertZeroStartJournalCanonical(provider,state);
 state.identity=identity;state.transactions??={};state.daily??={epoch:0};save();
 const report={version:1,kind:'fresh-zero-server-automation',chainId:97,target,...(readiness.releaseId==='global-fresh-fast-test-v1'?{releaseId:readiness.releaseId,testMode:true,initialServerReporter:true,fastTestnetVersion:1}:{}),checkedAt:new Date().toISOString(),walletPrompts:0,readiness,status:'waiting',policyCreated:false,dailyCredits:[],lastDailyCredit:lastConfirmedDailyCredit(state),withdrawals:null,volume:null,oracles:null,errors:[]};
 try{
 // Approved withdrawals remain independently payable while daily funding or reporter permission is missing.
 report.withdrawals=await during('APPROVED_WITHDRAWALS',()=>payApprovedRequests({vault,queue,state:state.daily,save,transact}));
 try{report.oracles=await during('ORACLE_MAINTENANCE',()=>maintain());}catch(e){if(Object.values(state.transactions||{}).some(entry=>!entry.block))throw e;report.errors.push(code(e));report.diagnostic=zeroStartWorkerDiagnostic(e,{phase,state});}
 report.volume=await during('NETWORK_VOLUME',()=>processVolume({provider,vault,state,save,transact,maxTransactions:4,maxScans:100,confirmations}));
 let policy=await during('POLICY_LOAD',()=>loadPolicy());
 if(policy){
  phase='POLICY_VERIFICATION';onPhase(phase);
  policy=validateDailyPolicy(policy);if(policy.chainId!==97||policy.vaultAddress!==target||policy.runtimeHash!==readiness.runtimeHash||policy.deploymentBlock!==readiness.block)throw Error('ZERO_START_AUTOMATION_POLICY_CHANGED');
  if(policy.periodSeconds===3600&&!hourlyTest)throw Error('HOURLY_TEST_EXPLICIT_MODE_REQUIRED');
  const activation=state.activation||(policy.activationBlockHash?{block:policy.activationBlock,blockHash:policy.activationBlockHash}:null);
  if(activation&&(await provider.getBlock(activation.block))?.hash!==activation.blockHash)throw Error('ZERO_START_ACTIVATION_CHECKPOINT_REORG');
 }
 if(!policy){
  if(state.activation||state.daily.epoch!==0)throw Error('ZERO_START_EXISTING_POLICY_MISSING');
  if(readiness.ready&&report.volume.complete&&refreshReadiness){
   const current=await during('DAILY_READINESS',()=>refreshReadiness());
   for(const key of ['target','owner','operator','queue','hash','runtimeHash'])if(current[key]!==readiness[key])throw Error('ZERO_START_AUTOMATION_IDENTITY_CHANGED');
   readiness=current;report.readiness=current;
  }
  if(!readiness.ready||!report.volume.complete||report.errors.length){report.blockers=[...readiness.blockers,...(!report.volume.complete?['NETWORK_VOLUME_BACKLOG']:[]),...report.errors];return report;}
  const checkpoint=await provider.getBlock(readiness.checkpoint.block);
  if(!checkpoint||checkpoint.hash!==readiness.checkpoint.blockHash)throw Error('ZERO_START_ACTIVATION_CHECKPOINT_REORG');
  policy=hourlyTest?makeHourlyTestPolicy(readiness):validateDailyPolicy({version:1,chainId:97,vaultAddress:target,runtimeHash:readiness.runtimeHash,deploymentBlock:readiness.block,startTimestamp:checkpoint.timestamp,activationBlock:checkpoint.number,activationBlockHash:checkpoint.hash,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true});
  await savePolicy(policy);report.policyCreated=true;
  state.activation={block:checkpoint.number,blockHash:checkpoint.hash,startTimestamp:checkpoint.timestamp};save();
 }
 report.policy=policy;report.nextEpoch=state.daily.epoch;report.firstPeriodEndsAt=policy.startTimestamp+policy.periodSeconds;
 for(let positionPass=0;positionPass<(isPositionPolicy(policy)?2:1);positionPass++){
 const plan=await during('DAILY_PERIOD_PLAN',()=>planDailyEpoch({provider,vault,policy,state:state.daily,epoch:state.daily.epoch,save,confirmations}));
 report.dailyStatus=plan.status;
 if(isPositionPolicy(policy))report.positionSchedule={version:1,intervalSeconds:3600,nextDueAt:plan.nextDueAt??null,indexThrough:plan.indexThrough??null,indexTarget:plan.indexTarget??null};
 if(plan.status==='indexing'){report.blockers=[...new Set([...(readiness.blockers||[]),'DAILY_MEMBER_INDEX_INCOMPLETE'])];return report;}
 if(plan.status==='ready'){
  if(!await vault.reporters(readiness.operator)){report.errors.push('AUTOMATION_SIGNER_IS_NOT_REPORTER');report.blockers=['COUNCIL_AUTHORIZED_SERVER_REPORTER_REQUIRED'];return report;}
  try{
   const credits=await during('DAILY_CREDIT_EXECUTION',()=>executeDailyPlan({provider,vault,plan,transact}));
   report.dailyCredits.push(...credits);
   if(isPositionPolicy(policy))completePositionHour(state.daily,plan);
   const completedEpoch=state.daily.epoch;state.daily.epoch++;state.daily.lastCredit={epoch:completedEpoch,credited:credits};save();
   report.nextEpoch=state.daily.epoch;report.lastDailyCredit=lastConfirmedDailyCredit(state);
  }catch(e){if(Object.values(state.transactions||{}).some(entry=>!entry.block))throw e;report.errors.push(code(e));report.diagnostic=zeroStartWorkerDiagnostic(e,{phase,state});return report;}
 }
 if(plan.status!=='ready')break;
 }
 report.status=readiness.ready&&report.errors.length===0?'scheduled':'waiting';
 report.blockers=readiness.blockers;
 return report;
 }catch(error){
  if(!retryableDailyReadFailure(error,state))throw error;
  const blocker=readFailureBlocker(phase);
  report.status='waiting';report.errors.push(blocker);
  report.blockers=[...new Set([...(readiness.blockers||[]),blocker])];
  report.diagnostic=zeroStartWorkerDiagnostic(error,{phase,state});
  return report;
 }
}

function privateDirectory(directory,{create=false}={}){
 if(create)fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const s=fs.lstatSync(directory);if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_AUTOMATION_DIRECTORY_REQUIRED');
}
function readPrivate(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_AUTOMATION_FILE_REQUIRED');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
}
export function publishZeroStartStatus(value,file=publicRoot+'/activation.json'){
 const directory=path.dirname(file),s=fs.lstatSync(directory);
 if(!s.isDirectory()||s.uid!==0||(s.mode&0o022)!==0)throw Error('SAFE_PUBLIC_STATUS_DIRECTORY_REQUIRED');
 let old;try{old=fs.lstatSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(old&&(!old.isFile()||old.uid!==0||(old.mode&0o022)!==0))throw Error('SAFE_PUBLIC_STATUS_FILE_REQUIRED');
 const temporary=file+'.tmp',fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');fs.fchmodSync(fd,0o644);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temporary,file);
}

function publishOracleOnlyStatus({readiness,oracles,inspection,file}){
 let previous;
 try{
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const st=fs.fstatSync(fd);if(st.isFile()&&st.uid===0&&(st.mode&0o022)===0)previous=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
 }catch{}
 const same=previous?.kind==='fresh-zero-daily-readiness'&&['chainId','target','owner','operator','queue','hash','runtimeHash','artifactHash'].every(key=>previous[key]===readiness[key]);
 const base=same?{...previous}:{...readiness,kind:'fresh-zero-oracle-maintenance'};
 delete base.automation;
 const previousBlockers=(same?base.blockers||[]:[]).filter(item=>!inspection.ready||!/^(ORACLE_|ZERO_START_ORACLE)/.test(item));
 publishZeroStartStatus({...base,ready:false,dailyAutomationActive:false,automationStatus:'not-inspected',blockers:[...new Set([...previousBlockers,'DAILY_AUTOMATION_NOT_INSPECTED_BY_ORACLE_REPAIR'])],oracleMaintenance:oracles,oracleInspection:inspection,oracleCheckedAt:new Date().toISOString(),walletPrompts:0},file);
}

export function retryableDailyReadFailure(error,state){
 if(Object.values(state.transactions||{}).some(entry=>!entry.block))return false;
 if(['REVIEWED_TEST_TOKEN_REQUIRED','TEST_TOKEN_METADATA_MISMATCH','ZERO_START_SETTLEMENT_LOG_RPC_REQUIRED'].includes(error?.message))return true;
 return ['CALL_EXCEPTION','NETWORK_ERROR','SERVER_ERROR','TIMEOUT','BAD_DATA','UNKNOWN_ERROR','UNSUPPORTED_OPERATION'].includes(error?.code);
}

export function partitionZeroStartDailyReadErrors(errors,readiness){
 const warnings=readiness.kind==='fresh-zero-daily-readiness'&&readiness.ready===true&&readiness.funding?.ready===true?errors.filter(item=>item==='TEST_REWARD_SEED_READ_UNAVAILABLE'):[];
 return {warnings,blocking:errors.filter(item=>!warnings.includes(item))};
}

async function main(){
 let provider,readiness,state,completedOracles,completedOracleInspection,executeRequested=false,fundOnlyRequested=false,proofProviders=[],phase='ARGUMENT_VALIDATION';
 try{
  const {profile,args}=parseZeroStartProfileArgs();
  const seedFlags=args.filter(value=>value==='--seed-test-rewards'),oracleFlags=args.filter(value=>value==='--oracles-only'),hourlyFlags=args.filter(value=>value==='--hourly-test'),millionFlags=args.filter(value=>value==='--fund-test-million');
  const commands=args.filter(value=>!['--seed-test-rewards','--oracles-only','--hourly-test','--fund-test-million'].includes(value));
  if(process.getuid?.()!==0||commands.length!==1||!['--check','--execute'].includes(commands[0])||seedFlags.length>1||oracleFlags.length>1||hourlyFlags.length>1||millionFlags.length>1)throw Error('ROOT_EXPLICIT_CHECK_OR_EXECUTE_REQUIRED');
  const execute=commands[0]==='--execute',oraclesOnly=oracleFlags.length===1,hourlyTest=hourlyFlags.length===1,fundOnly=millionFlags.length===1;
  executeRequested=execute;
  fundOnlyRequested=fundOnly;
  if(fundOnly&&(!profile.fast||!execute||seedFlags.length||oraclesOnly||hourlyTest))throw Error('MILLION_TEST_REWARDS_EXPLICIT_FAST_EXECUTION_REQUIRED');
  if(seedFlags.length&&(!profile.fast||!execute||oraclesOnly))throw Error('FAST_TEST_EXPLICIT_SEED_EXECUTION_REQUIRED');
  if(hourlyTest&&(!profile.fast||oraclesOnly))throw Error('HOURLY_TEST_FAST_PROFILE_REQUIRED');
  phase='LOCAL_CONFIGURATION';
  const privateRoot=profile.automationDir,release=profile.release;
  const envFile='/etc/globaldroptrade/trades.env',original=readPrivate(envFile),settings=parseEnv(original),config=readConfig(settings);
  const directory=profile.stateDir;privateDirectory(directory);
  const deploymentReport=JSON.parse(readPrivate(directory+'/deployment-public.json')),connectionReport=JSON.parse(readPrivate(directory+'/connection-public.json'));
  const artifact=JSON.parse(fs.readFileSync(profile.artifactUrl,'utf8'));
  const mockArtifact=JSON.parse(fs.readFileSync(new URL('../artifacts/MockFeed.json',import.meta.url),'utf8'));
  const policyFile=privateRoot+'/daily-policy.json',stateFile=privateRoot+'/journal.json';
  const transport=new FetchRequest(config.rpcUrl);transport.timeout=15000;
  provider=installHistoricalCallRetry(new JsonRpcProvider(transport,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1}));provider.pollingInterval=2000;
  proofProviders=createZeroStartProofProviders();
  const targetOptions={provider,artifact,deploymentReport,connectionReport,original,release,confirmations:Math.max(3,config.confirmations),proofProviders};
  // Verify immutable identity first. Reward funding, archives, seed state and the
  // current daily policy cannot prevent recovery of this target's price feeds.
  phase='TARGET_VERIFICATION';readiness=await verifyZeroStartTarget({...targetOptions,inspectSettlementLogs:false});
  if(oraclesOnly&&!execute){
   phase='ORACLE_INSPECTION';
   const observed=await inspectZeroStartOracles({provider,artifact:mockArtifact,release,readiness});
   console.log('ZERO_START_ORACLES_CHECKED ready='+observed.ready+' target='+readiness.target);
   console.log(JSON.stringify(observed));return;
  }
  phase='LOCAL_CONFIGURATION';privateDirectory(privateRoot,{create:execute});
  state=fs.existsSync(stateFile)?JSON.parse(readPrivate(stateFile)):{transactions:{}};
  let policy;
  const checkReadiness=()=>{
   const current=hourlyTest&&policy?.periodSeconds!==3600?undefined:policy;
   return verifyZeroStartReadiness({...targetOptions,hourlyTest,policy:current,periodStartTimestamp:current?(isPositionPolicy(current)?current.startTimestamp:current.startTimestamp+(state.daily?.epoch||0)*current.periodSeconds):undefined});
  };
  const loadCurrentPolicy=()=>{
   const current=fs.existsSync(policyFile)?validateDailyPolicy(JSON.parse(readPrivate(policyFile))):undefined;
   if(current&&current.chainId!==97)throw Error('ZERO_START_AUTOMATION_POLICY_CHANGED');
   if(current?.periodSeconds===3600&&!hourlyTest)throw Error('HOURLY_TEST_EXPLICIT_MODE_REQUIRED');
   return current;
  };
  if(!execute){
   phase='POLICY_LOAD';policy=loadCurrentPolicy();phase='DAILY_READINESS';readiness=await checkReadiness();
   console.log('ZERO_START_AUTOMATION_CHECKED ready='+readiness.ready);console.log('BLOCKERS='+(readiness.blockers.join(',')||'none'));return;
  }
  const key=readPrivateKey('/etc/globaldroptrade/fresh-zero-automation.key');if(!key)throw Error('EXISTING_SERVER_OPERATOR_KEY_REQUIRED');
  const wallet=new Wallet(key,provider);if(wallet.address!==release.deployer)throw Error('EXPECTED_SERVER_OPERATOR_KEY_REQUIRED');
  const guard=async()=>{
   if(readPrivate(envFile)!==original||Number(await provider.send('eth_chainId',[]))!==97||keccak256(await provider.getCode(readiness.target))!==readiness.runtimeHash)throw Error('ZERO_START_AUTOMATION_TARGET_CHANGED');
   await assertZeroStartJournalCanonical(provider,state);
  };
  const save=()=>writePrivateJson(stateFile,state),transact=async(label,request)=>{
   const receipt=await journalTransaction({provider,wallet,state,save,label,request,guard,confirmations:Math.max(3,config.confirmations)+1,timeout:45000,maxTotalFee:parseEther('0.1')});
   await assertZeroStartJournalCanonical(provider,state);return receipt;
  };
  const vault=new Contract(readiness.target,artifact.abi,wallet),queue=new Contract(readiness.queue,approvedQueueAbi,wallet);
  phase='TARGET_VERIFICATION';await guard();
  const identity=identityOf(readiness);
  if(state.identity&&JSON.stringify(state.identity)!==JSON.stringify(identity))throw Error('ZERO_START_AUTOMATION_IDENTITY_CHANGED');
  if(!state.identity&&Object.keys(state.transactions||{}).length)throw Error('ZERO_START_UNBOUND_AUTOMATION_JOURNAL');
  if(oraclesOnly)assertZeroStartOraclePending({state,release,artifact:mockArtifact});
  state.identity=identity;state.transactions??={};save();
  const seedModule=!oraclesOnly&&!fundOnly&&profile.fast?await import('./fund-fast-test-rewards.mjs'):null;
  const millionModule=!oraclesOnly&&profile.fast?await import('./fund-million-test-rewards.mjs'):null;
  const tokenArtifact=!oraclesOnly&&profile.fast?JSON.parse(fs.readFileSync(new URL('../artifacts/MockToken.json',import.meta.url),'utf8')):null;
  const millionOptions={provider,wallet,artifact:tokenArtifact,release,readiness,vault,state,save,transact};
  if(fundOnly){
   phase='TEST_REWARD_GRANT';
   const report=await millionModule.fundMillionTestRewards(millionOptions);
   const file=privateRoot+'/million-test-rewards.json';writePrivateJson(file,report);
   console.log('MILLION_TEST_REWARDS_CONFIRMED target='+readiness.target);
   console.log('AMOUNT_TEST_USDT='+report.amountTestUsdt);console.log('TX_HASH='+report.transaction);
   console.log('REWARDS_AFTER_UNITS='+report.ledgerProof.rewardsAfterUnits);console.log('REPORT='+file);return;
  }
  if(!oraclesOnly){
   phase='PENDING_RECONCILIATION';
   const pending=await validateZeroStartPendingTransactions({state,wallet,readiness,release,artifact:mockArtifact,
    seed:seedModule?{isLabel:seedModule.isFastTestSeedLabel,verify:(label,request)=>seedModule.verifyFastTestSeedPending({provider,wallet,artifact:tokenArtifact,release,readiness,vault,state,label,request})}:null,
    million:millionModule?{isLabel:millionModule.isMillionTestRewardLabel,verify:(label,request)=>millionModule.verifyMillionTestRewardPending({...millionOptions,label,request})}:null});
   // Resume the same previously signed nonce before any new oracle transaction.
   for(const{label,request}of pending)await transact(label,request);
  }
  phase='ORACLE_MAINTENANCE';completedOracles=await runZeroStartOracleMaintenance({provider,wallet,artifact:mockArtifact,release,readiness,state,save,transact,confirmations:Math.max(3,config.confirmations),oraclesOnly});
  phase='ORACLE_INSPECTION';completedOracleInspection=await inspectZeroStartOracles({provider,artifact:mockArtifact,release,readiness});
  if(!completedOracleInspection.ready)throw Error('ZERO_START_ORACLES_NOT_VALID_AFTER_REFRESH');
  if(oraclesOnly){
   const inspection=completedOracleInspection;
   const report={version:1,kind:'fresh-zero-oracle-maintenance',chainId:97,target:readiness.target,checkedAt:new Date().toISOString(),oracles:completedOracles,inspection,dailyAutomationActive:false,walletPrompts:0};
   writePrivateJson(privateRoot+'/oracle-status.json',report);
   publishOracleOnlyStatus({readiness,oracles:completedOracles,inspection,file:profile.publicRoot+'/activation.json'});
   console.log('ZERO_START_ORACLES_VALID target='+readiness.target);console.log('BLOCKERS=none');return;
  }
  const dailyReadErrors=[],dailyReadDiagnostics=[];
  if(seedFlags.length)try{phase='TEST_REWARD_SEED';await seedModule.seedFastTestRewards({provider,wallet,artifact:tokenArtifact,release,readiness,vault,state,save,transact});}
  catch(error){
   if(!retryableDailyReadFailure(error,state))throw error;
   await assertZeroStartJournalCanonical(provider,state);
   dailyReadErrors.push('TEST_REWARD_SEED_READ_UNAVAILABLE');
   dailyReadDiagnostics.push(zeroStartWorkerDiagnostic(error,{phase,state}));
  }
  phase='POLICY_LOAD';policy=loadCurrentPolicy();
  try{phase='DAILY_READINESS';readiness=await checkReadiness();}
  catch(error){
   if(!retryableDailyReadFailure(error,state))throw error;
   await assertZeroStartJournalCanonical(provider,state);
   dailyReadErrors.push('DAILY_READINESS_RPC_UNAVAILABLE');
   dailyReadDiagnostics.push(zeroStartWorkerDiagnostic(error,{phase,state}));
  }
  // A verified, manually funded reward ledger is sufficient even when the
  // optional test faucet cannot be inspected. Missing full readiness still waits.
  const {warnings:optionalSeedWarnings,blocking:blockingDailyReadErrors}=partitionZeroStartDailyReadErrors(dailyReadErrors,readiness);
  if(blockingDailyReadErrors.length){
   const report={version:1,kind:'fresh-zero-server-automation',chainId:97,target:readiness.target,checkedAt:new Date().toISOString(),status:'waiting',policyCreated:false,dailyCredits:[],lastDailyCredit:lastConfirmedDailyCredit(state),...(policy?{policy,nextEpoch:state.daily?.epoch??0,firstPeriodEndsAt:policy.startTimestamp+policy.periodSeconds}:{}),oracles:completedOracles,errors:blockingDailyReadErrors,blockers:[...new Set([...(readiness.blockers||[]),...blockingDailyReadErrors])],diagnostic:dailyReadDiagnostics.at(-1),walletPrompts:0};
   writePrivateJson(privateRoot+'/status.json',report);
   const publicReport={...readiness,ready:false,dailyAutomationActive:false,automationStatus:'waiting',blockers:report.blockers,oracleMaintenance:completedOracles,oracleInspection:completedOracleInspection,automation:report};
   if(readiness.kind!=='fresh-zero-daily-readiness'){publicReport.kind='fresh-zero-automation-error';publicReport.diagnostic=report.diagnostic;delete publicReport.automation;}
   publishZeroStartStatus(publicReport,profile.publicRoot+'/activation.json');
   console.log('ZERO_START_AUTOMATION_WAITING target='+readiness.target);console.log('BLOCKERS='+report.blockers.join(','));return;
  }
  if(hourlyTest&&policy){
   phase='HOURLY_POLICY_TRANSITION';
   const oldPolicy=policy;
   const transition=await transitionHourlyTestPolicy({provider,vault,readiness,state,policy,save,
    saveArchive:async value=>{const file=privateRoot+'/pre-hourly-policy-v1.json';if(fs.existsSync(file)){if(JSON.stringify(JSON.parse(readPrivate(file)))!==JSON.stringify(value))throw Error('HOURLY_TEST_ARCHIVE_CHANGED');}else writePrivateJson(file,value);},
    savePolicy:async value=>{const current=JSON.parse(readPrivate(policyFile));if(JSON.stringify(current)!==JSON.stringify(oldPolicy)&&JSON.stringify(current)!==JSON.stringify(value))throw Error('HOURLY_TEST_POLICY_CHANGED');writePrivateJson(policyFile,value);}
   });
   policy=transition.policy;
   if(transition.transitioned){phase='DAILY_READINESS';readiness=await checkReadiness();}
  }
  const result=await runZeroStartAutomation({provider,vault,queue,readiness,state,save,loadPolicy:()=>policy,savePolicy:value=>{if(fs.existsSync(policyFile))throw Error('ZERO_START_POLICY_ALREADY_EXISTS');writePrivateJson(policyFile,value);policy=value;},transact,confirmations:Math.max(3,config.confirmations),hourlyTest,refreshReadiness:checkReadiness,maintainOracles:async()=>completedOracles,onPhase:value=>{phase=value;}});
  if(optionalSeedWarnings.length){result.warnings=optionalSeedWarnings;result.testRewardSeedStatus='OPTIONAL_TEST_FAUCET_UNAVAILABLE_VERIFIED_REWARD_BUDGET_USED';}
  if(state.seedTest?.report)result.testRewardSeed=state.seedTest.report;
  result.maxFeesReservedWei=Object.values(state.transactions).reduce((sum,t)=>sum+BigInt(t.maxFee),0n).toString();
  phase='STATUS_PUBLICATION';writePrivateJson(privateRoot+'/status.json',result);
  let timerActive=false;try{execFileSync('systemctl',['is-active','--quiet',profile.timer],{stdio:'ignore',timeout:5000});timerActive=true;}catch{}
  publishZeroStartStatus({...result.readiness,automationStatus:result.status,dailyAutomationActive:timerActive&&result.status==='scheduled',timerActive,oracleMaintenance:completedOracles,oracleInspection:completedOracleInspection,automation:result},profile.publicRoot+'/activation.json');
  console.log('ZERO_START_AUTOMATION_'+result.status.toUpperCase()+' target='+readiness.target);
  if(optionalSeedWarnings.length)console.log('WARNINGS='+optionalSeedWarnings.join(','));
  if(result.status!=='scheduled')console.log('BLOCKERS='+[...(result.blockers||[]),...result.errors].join(','));
 }catch(e){
  const waiting=Boolean(completedOracles&&completedOracleInspection?.ready&&state&&['DAILY_READINESS','HOURLY_POLICY_TRANSITION'].includes(phase)&&retryableDailyReadFailure(e,state));
  const failure={version:1,kind:'fresh-zero-automation-error',ready:false,dailyAutomationActive:false,automationStatus:waiting?'waiting':'blocked',blockers:[waiting?readFailureBlocker(phase):code(e)],diagnostic:zeroStartWorkerDiagnostic(e,{phase,state}),checkedAt:new Date().toISOString(),walletPrompts:0,...(completedOracles?{oracleMaintenance:completedOracles,oracleInspection:completedOracleInspection,oracleTarget:readiness?.target}:{} )};
  if(executeRequested&&!fundOnlyRequested)try{publishZeroStartStatus(failure);}catch{}
  if(waiting){console.log('ZERO_START_AUTOMATION_WAITING target='+readiness.target);console.log('BLOCKERS='+failure.blockers.join(','));return;}
  console.error('ZERO_START_AUTOMATION_STOPPED '+code(e));process.exitCode=1;
 }finally{provider?.destroy();for(const fallback of proofProviders)fallback.destroy();}
}
let invokedUrl;
try{
 // Node resolves the module URL through the current release symlink.
 if(process.argv[1])invokedUrl=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;
}catch{}
if(import.meta.url===invokedUrl)await main();
