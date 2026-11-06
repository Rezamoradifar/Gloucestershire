// Read-only proof and private configuration staging for the existing testnet release.
// This module never opens a signer, submits a transaction or changes live files.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';

export const reliabilityTarget='0xB5c3C0f8fc30b2FDB8b16d2325127dAe7C8DCD5B';
export const activityHistory='/var/lib/globaldroptrade-api/daily-activity.json';
export const activityPolicyFile='/etc/globaldroptrade/daily-activity-policy.json';
const origin='https://globaldroptrade.com';
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';

// Shared with the installer allowlist. Provider errors can contain RPC keys,
// response bodies and calldata; only these fixed values cross the CLI boundary.
export const reliabilityDiagnosticValues=Object.freeze({
 phases:['LOCAL_INPUTS','RPC_VERIFICATION','TARGET_VERIFICATION','CONFIRMED_CHECKPOINT','HISTORICAL_SNAPSHOT','HISTORICAL_STATE','SETTLEMENT_LOGS','CANONICAL_VERIFICATION','CURRENT_PERMISSIONS','JOURNAL_VALIDATION','CURRENT_FUNDING','CONFIGURATION_STAGE'],
 operations:['runtime-import','configuration','financial-policy','activity-policy','financial-journal','rpc-candidates','deployment-proofs','verify-target','block-number','confirmed-block','checkpoint-freshness','block-at-time','accounts-native','ledgers-token','daily-target-bps','settlement-logs','confirmed-block-hash','snapshot-block-hash','runtime-hash','reporter','paused','operator-balance','journal-fees','ledgers-native','asset-balance-native','asset-balance-token','queue-pending-native','queue-pending-token','render-environment','write-stage','unknown'],
 reasons:['UNKNOWN','TIMEOUT','RATE_LIMITED','AUTHENTICATION_REQUIRED','TRANSPORT_UNAVAILABLE','METHOD_UNAVAILABLE','HISTORICAL_STATE_UNAVAILABLE','INVALID_RESPONSE','REVERTED','INVALID_REQUEST','BLOCK_RANGE_LIMIT','RESULT_LIMIT','REQUEST_BUDGET_EXCEEDED','CANONICAL_MISMATCH','CREATION_PROOF_UNAVAILABLE','CREATION_PROOF_INVALID','CHAIN_IDENTITY_MISMATCH','TARGET_IDENTITY_MISMATCH','STALE_CHECKPOINT','INVALID_LOCAL_CONFIGURATION','FINANCIAL_JOURNAL_INVALID','HISTORICAL_PERIOD_INVALID'],
 errorCodes:['CALL_EXCEPTION','NETWORK_ERROR','SERVER_ERROR','TIMEOUT','BAD_DATA','UNKNOWN_ERROR','UNSUPPORTED_OPERATION','INVALID_ARGUMENT','NUMERIC_FAULT','BUFFER_OVERRUN','OFFCHAIN_FAULT','CANCELLED'],
 errors:['ROOT_REQUIRED','RELIABILITY_PRIVATE_INPUT_REQUIRED','RELIABILITY_RPC_URL_INVALID','RELIABILITY_ACTIVITY_POLICY_MISMATCH','RELIABILITY_RPC_CANDIDATES_REQUIRED','RELIABILITY_ENV_PRESERVATION_FAILED','RELIABILITY_FINANCIAL_JOURNAL_INVALID','RELIABILITY_JOURNAL_IDENTITY_MISMATCH','RELIABILITY_OPERATOR_BALANCE_REQUIRED','RELIABILITY_PRIVATE_STAGE_REQUIRED','RELIABILITY_CURRENT_TESTNET_REQUIRED','RELIABILITY_EXISTING_POSITION_POLICY_REQUIRED','RELIABILITY_RUNTIME_IDENTITY_MISMATCH','RELIABILITY_FRESH_CHAIN_CHECKPOINT_REQUIRED','RELIABILITY_RPC_ANCHOR_CHANGED','RELIABILITY_VERIFIED_RPC_REQUIRED','RELIABILITY_PREFLIGHT_ARGUMENTS_REQUIRED','RELIABILITY_RUNTIME_REQUIRED','RELIABILITY_PREFLIGHT_FAILED']
});
for(const values of Object.values(reliabilityDiagnosticValues))Object.freeze(values);
const allowed=(kind,value,fallback=null)=>reliabilityDiagnosticValues[kind].includes(value)?value:fallback;
const safeInteger=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const rpcInteger=value=>Number.isSafeInteger(value)&&value>=-2147483648&&value<=2147483647?value:null;
const statusInteger=value=>Number.isSafeInteger(value)&&value>=100&&value<=599?value:null;

export function sanitizeReliabilityDiagnostic(value){
 return {phase:allowed('phases',value?.phase,'LOCAL_INPUTS'),operation:allowed('operations',value?.operation,'unknown'),reason:allowed('reasons',value?.reason,'UNKNOWN'),errorCode:allowed('errorCodes',value?.errorCode),rpcCode:rpcInteger(value?.rpcCode),httpStatus:statusInteger(value?.httpStatus),block:safeInteger(value?.block),requestedTimestamp:safeInteger(value?.requestedTimestamp)};
}

export function reliabilityFailureDiagnostic(error,context={}){
 const log=error?.logProbeDiagnostic,rawStatus=log?.httpStatus??error?.info?.response?.statusCode??error?.info?.responseStatus??error?.response?.statusCode??error?.response?.status??error?.status;
 const httpStatus=statusInteger(typeof rawStatus==='string'&&/^[1-5][0-9]{2}(?:\s|$)/.test(rawStatus)?Number(rawStatus.slice(0,3)):rawStatus);
 let rpc=error?.info?.error??error?.error;
 // Some RPC gateways put their structured error inside an HTTP error body.
 // Parse only a bounded envelope and never return its message or contents.
 const body=error?.info?.responseBody;
 if(!rpc&&httpStatus!==null&&httpStatus>=400&&typeof body==='string'&&Buffer.byteLength(body,'utf8')<=65536){
  try{const envelope=JSON.parse(body);if(envelope&&!Array.isArray(envelope)&&!Object.hasOwn(envelope,'result')&&(!Object.hasOwn(envelope,'jsonrpc')||envelope.jsonrpc==='2.0'))rpc=envelope.error;}catch{}
 }
 const rpcCode=rpcInteger(log?.rpcCode??rpc?.code),errorCode=allowed('errorCodes',log?.errorCode??error?.code);
 const message=typeof error?.message==='string'?error.message:'';
 const text=[message,error?.info?.error?.message,error?.error?.message,rpc?.message].filter(value=>typeof value==='string').map(value=>value.slice(0,8192)).join(' ').toLowerCase();
 let reason=allowed('reasons',log?.reason,'UNKNOWN');
 if(message==='RELIABILITY_FRESH_CHAIN_CHECKPOINT_REQUIRED')reason='STALE_CHECKPOINT';
 else if(['RELIABILITY_JOURNAL_IDENTITY_MISMATCH','RELIABILITY_FINANCIAL_JOURNAL_INVALID'].includes(message))reason='FINANCIAL_JOURNAL_INVALID';
 else if(message==='PERIOD_PRECEDES_DEPLOYMENT')reason='HISTORICAL_PERIOD_INVALID';
 else if(message==='HISTORICAL_BLOCK_UNAVAILABLE')reason='HISTORICAL_STATE_UNAVAILABLE';
 else if(['ZERO_START_CREATION_PROOF_UNAVAILABLE','ZERO_START_RECEIPT_REQUIRED','ZERO_START_PROOF_READ_TIMEOUT'].includes(message))reason='CREATION_PROOF_UNAVAILABLE';
 else if(['ZERO_START_TRANSACTION_REQUIRED','ZERO_START_TRANSACTION_MISMATCH','ZERO_START_CREATE_ADDRESS_MISMATCH','ZERO_START_PROOF_PRIMARY_CONFLICT'].includes(message))reason='CREATION_PROOF_INVALID';
 else if(['TESTNET_ONLY','ZERO_START_PROOF_FALLBACK_WRONG_CHAIN'].includes(message))reason='CHAIN_IDENTITY_MISMATCH';
 else if(['RELIABILITY_RPC_ANCHOR_CHANGED','ZERO_START_RECEIPT_NOT_FINAL','ZERO_START_PROOF_FALLBACK_HEADER_MISMATCH','ZERO_START_CURRENT_CHECKPOINT_REORG','ARCHIVE_CHECKPOINT_REORG'].includes(message))reason='CANONICAL_MISMATCH';
 else if(['RELIABILITY_RUNTIME_IDENTITY_MISMATCH','ZERO_START_ARTIFACT_MISMATCH','ZERO_START_CONNECTED_MARKER_REQUIRED','ZERO_START_CONNECTED_IDENTITY_MISMATCH','ZERO_START_FAST_CONNECTED_MARKER_REQUIRED','ZERO_START_ACTIVE_API_TARGET_MISMATCH','ZERO_START_FAST_DEPLOYMENT_MARKER_REQUIRED','ZERO_START_CURRENT_RUNTIME_MISMATCH','ZERO_START_CURRENT_QUEUE_RUNTIME_MISMATCH','ZERO_START_CURRENT_OWNER_MISMATCH','ZERO_START_CURRENT_CAPABILITY_MISMATCH','ZERO_START_CURRENT_FAST_TESTNET_CAPABILITY_MISMATCH','ZERO_START_CURRENT_SETTINGS_MISMATCH'].includes(message))reason='TARGET_IDENTITY_MISMATCH';
 else if(reason!=='UNKNOWN'){}
 else if([401,403].includes(httpStatus)||/unauthorized|forbidden|invalid api key/.test(text))reason='AUTHENTICATION_REQUIRED';
 else if(httpStatus===429||rpcCode===429||rpcCode===-32005||/rate limit|too many requests/.test(text))reason='RATE_LIMITED';
 else if(errorCode==='TIMEOUT'||/\btimeout\b|timed out/.test(text))reason='TIMEOUT';
 else if(/missing trie|pruned|historical.*unavailable|state (?:is )?not available|unknown state|header not found/.test(text))reason='HISTORICAL_STATE_UNAVAILABLE';
 else if([-32601,-32004].includes(rpcCode)||/method.*not found|method.*not supported|unsupported method/.test(text))reason='METHOD_UNAVAILABLE';
 else if(error?.revert||(typeof error?.data==='string'&&error.data!=='0x')||/execution reverted|vm exception.*revert/.test(text))reason='REVERTED';
 else if(['BAD_DATA','BUFFER_OVERRUN'].includes(errorCode))reason='INVALID_RESPONSE';
 else if(['NETWORK_ERROR','SERVER_ERROR'].includes(errorCode)||(httpStatus!==null&&httpStatus>=500))reason='TRANSPORT_UNAVAILABLE';
 else if([-32600,-32602].includes(rpcCode))reason='INVALID_REQUEST';
 else if(context.phase==='LOCAL_INPUTS'||context.phase==='CONFIGURATION_STAGE'||['TypeError','ReferenceError','SyntaxError'].includes(error?.name)||allowed('errors',message))reason='INVALID_LOCAL_CONFIGURATION';
 return sanitizeReliabilityDiagnostic({...context,reason,errorCode,rpcCode,httpStatus});
}

export function reliabilityPreflightFailure(error){
 const report=error?.safeReport,diagnostic=sanitizeReliabilityDiagnostic(report?.diagnostic??report);
 const attempts=Array.isArray(report?.attempts)?report.attempts.slice(0,4).filter(row=>Number.isSafeInteger(row?.candidate)&&row.candidate>=0&&row.candidate<4).map(row=>row.verified===true?{candidate:row.candidate,verified:true}:{candidate:row.candidate,verified:false,...sanitizeReliabilityDiagnostic(row)}):[];
 return {version:1,kind:'global-daily-reliability-preflight-failure',status:'blocked',error:allowed('errors',error?.message,'RELIABILITY_PREFLIGHT_FAILED'),...diagnostic,attempts,transactionsSent:0,signerOpened:false};
}

export function privateText(file,{optional=false,max=16777216}={}){
 let fd;
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}
 catch(e){if(optional&&e.code==='ENOENT')return null;throw Error('RELIABILITY_PRIVATE_INPUT_REQUIRED');}
 try{
  const s=fs.fstatSync(fd);
  if(!s.isFile()||s.uid!==0||(s.mode&0o077)||s.size>max)throw Error('RELIABILITY_PRIVATE_INPUT_REQUIRED');
  return fs.readFileSync(fd,'utf8');
 }finally{fs.closeSync(fd);}
}

function rpcUrl(value){
 if(typeof value!=='string'||value.length>16384||/[\s\p{Cc}"'\\]/u.test(value))throw Error('RELIABILITY_RPC_URL_INVALID');
 let u;try{u=new URL(value);}catch{throw Error('RELIABILITY_RPC_URL_INVALID');}
 if(!['http:','https:'].includes(u.protocol)||!u.hostname||u.username||u.password||u.hash)throw Error('RELIABILITY_RPC_URL_INVALID');
 return value;
}

export function verifyActivityPolicy(value){
 if(!value||value.version!==1||value.chainId!==97||String(value.vaultAddress).toLowerCase()!==reliabilityTarget.toLowerCase()||value.origin!==origin||value.windowSeconds!==86400||!Number.isSafeInteger(value.activationTimestamp)||value.activationTimestamp<1||value.historyFile!==activityHistory)throw Error('RELIABILITY_ACTIVITY_POLICY_MISMATCH');
 return value;
}

export function renderReliabilityEnv(original,urls,policy){
 policy=verifyActivityPolicy(policy);
 if(!Array.isArray(urls)||urls.length<1||urls.length>4||new Set(urls).size!==urls.length)throw Error('RELIABILITY_RPC_CANDIDATES_REQUIRED');
 urls.forEach(rpcUrl);
 const before=parseEnv(original),updates={
  TRADES_RPC_URL:urls[0],TRADES_RPC_URLS:JSON.stringify(urls.slice(1)),
  DAILY_ACTIVITY_FILE:activityHistory,DAILY_ACTIVITY_ORIGIN:origin,
  DAILY_ACTIVITY_ACTIVATION_TIMESTAMP:String(policy.activationTimestamp),
  GLOBAL_AUTOMATION_PUBLIC_STATUS:'/var/www/globaldroptrade/automation-data/activation.json'
 };
 // Append checked assignments instead of rewriting multiline values or credentials.
 const next=original+(original.endsWith('\n')?'':'\n')+Object.entries(updates).map(([key,value])=>`${key}='${value}'`).join('\n')+'\n';
 const after=parseEnv(next);
 const retained=value=>JSON.stringify(Object.fromEntries(
  Object.entries(value).filter(([key])=>!Object.hasOwn(updates,key)).sort(([a],[b])=>a.localeCompare(b))
 ));
 if(retained(before)!==retained(after)||Object.entries(updates).some(([key,value])=>after[key]!==value))throw Error('RELIABILITY_ENV_PRESERVATION_FAILED');
 return next;
}

// Match the worker's cumulative fee reservation without exposing signed bytes,
// transaction labels or private RPC settings. Confirmed entries still reserve
// their original maximum fee; the release never resets this budget.
export function journalFeeBudget(state,identity,operatorBalance){
 const limit=100000000000000000n,transactions=state?.transactions;
 if(!state||typeof state!=='object'||Array.isArray(state)||!transactions||typeof transactions!=='object'||Array.isArray(transactions))throw Error('RELIABILITY_FINANCIAL_JOURNAL_INVALID');
 const entries=Object.values(transactions);
 if((entries.length&&!state.identity)||state.identity&&Object.entries(identity).some(([key,value])=>state.identity[key]!==value))throw Error('RELIABILITY_JOURNAL_IDENTITY_MISMATCH');
 let reserved=0n,pending=0;
 for(const entry of entries){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.maxFee!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(entry.maxFee)||typeof entry.raw!=='string'||!/^0x[0-9a-f]+$/i.test(entry.raw)||!/^0x[0-9a-f]{64}$/i.test(entry.hash||''))throw Error('RELIABILITY_FINANCIAL_JOURNAL_INVALID');
  if(entry.block!==undefined&&(!Number.isSafeInteger(entry.block)||entry.block<1||!/^0x[0-9a-f]{64}$/i.test(entry.blockHash||'')))throw Error('RELIABILITY_FINANCIAL_JOURNAL_INVALID');
  reserved+=BigInt(entry.maxFee);
  if(!entry.block)pending++;
 }
 if(typeof operatorBalance!=='bigint'||operatorBalance<0n)throw Error('RELIABILITY_OPERATOR_BALANCE_REQUIRED');
 return {feeBudgetLimitWei:String(limit),maxFeesReservedWei:String(reserved),feeBudgetRemainingWei:String(reserved<limit?limit-reserved:0n),operatorBalanceWei:String(operatorBalance),pendingSignedCount:pending,
  waitingFor:[...(reserved>=limit?['TOTAL_TEST_BNB_FEE_LIMIT_0_1']:[]),...(operatorBalance===0n?['INSUFFICIENT_TEST_BNB']:[])]};
}

function writeStage(directory,name,text){
 const s=fs.lstatSync(directory);
 if(!s.isDirectory()||s.uid!==0||(s.mode&0o077))throw Error('RELIABILITY_PRIVATE_STAGE_REQUIRED');
 const fd=fs.openSync(path.join(directory,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}

// The CLI supplies helpers from the installed runtime. An explicit target and
// clock permit the same read-only proof to run against a local EVM in tests.
export async function inspectReliabilityCandidate({provider,artifact,release,policy,journal,original,deployment,connection,confirmations=3,proofProviders=[],helpers,target=reliabilityTarget,now=Date.now}){
 const {Contract,Interface,ZeroAddress,keccak256,verifyZeroStartTarget,blockAtTime,getCompleteLogs,installHistoricalCallRetry}=helpers;
 let context={phase:'TARGET_VERIFICATION',operation:'verify-target'};
 const read=(phase,operation,action,details={})=>{context={...context,phase,operation,...details};return action();};
 try{
  installHistoricalCallRetry(provider);
  const verified=await verifyZeroStartTarget({provider,artifact,deploymentReport:deployment,connectionReport:connection,original,release,confirmations,proofProviders,inspectSettlementLogs:false});
  if(verified.target.toLowerCase()!==target.toLowerCase()||verified.runtimeHash.toLowerCase()!==policy.runtimeHash.toLowerCase()||verified.block!==policy.deploymentBlock)throw Error('RELIABILITY_RUNTIME_IDENTITY_MISMATCH');
  const head=await read('CONFIRMED_CHECKPOINT','block-number',()=>provider.getBlockNumber());
  const number=Math.max(policy.deploymentBlock,head-confirmations);
  const block=await read('CONFIRMED_CHECKPOINT','confirmed-block',()=>provider.getBlock(number),{block:number});
  read('CONFIRMED_CHECKPOINT','checkpoint-freshness',()=>{if(!block||Math.abs(Math.floor(now()/1000)-block.timestamp)>600)throw Error('RELIABILITY_FRESH_CHAIN_CHECKPOINT_REQUIRED');});
  const vault=new Contract(target,artifact.abi,provider);
  // Keep the original unpaid-policy snapshot. Availability never permits a
  // more recent principal basis, skipped arrears or a changed journal cursor.
  const historical=await read('HISTORICAL_SNAPSHOT','block-at-time',()=>blockAtTime(provider,policy.startTimestamp,policy.deploymentBlock,block.number),{block:null,requestedTimestamp:policy.startTimestamp});
  const historicalOptions={blockTag:historical.number};
  await read('HISTORICAL_STATE','accounts-native',()=>vault.accounts(release.owner,ZeroAddress,historicalOptions),{block:historical.number});
  await read('HISTORICAL_STATE','ledgers-token',()=>vault.ledgers(release.token,historicalOptions));
  await read('HISTORICAL_STATE','daily-target-bps',()=>vault.dailyTargetBps(release.owner,historicalOptions));
  const topic=new Interface(['event SaleSettled(bytes32 indexed id,address indexed seller,address indexed asset,uint256 grossProfit,uint256 salesUsd,bytes32 evidenceHash)']).getEvent('SaleSettled').topicHash;
  await read('SETTLEMENT_LOGS','settlement-logs',()=>getCompleteLogs({provider,filter:{address:target,topics:[topic],fromBlock:Math.max(policy.deploymentBlock,block.number-8),toBlock:block.number},maxRequests:32,maxTimeoutRetries:1,maxConcurrency:2}),{block:block.number,requestedTimestamp:null});
  const canonical=async(operation,number,expected)=>{
   const current=await read('CANONICAL_VERIFICATION',operation,()=>provider.getBlock(number),{block:number});
   if(current?.hash!==expected)throw Error('RELIABILITY_RPC_ANCHOR_CHANGED');
  };
  await canonical('confirmed-block-hash',block.number,block.hash);
  await canonical('snapshot-block-hash',historical.number,historical.hash);
  const code=await read('CANONICAL_VERIFICATION','runtime-hash',()=>provider.getCode(target),{block:null});
  if(keccak256(code).toLowerCase()!==policy.runtimeHash.toLowerCase())throw Error('RELIABILITY_RPC_ANCHOR_CHANGED');
  const options={blockTag:block.number};
  const reporter=await read('CURRENT_PERMISSIONS','reporter',()=>vault.reporters(release.deployer,options),{block:block.number});
  const paused=await read('CURRENT_PERMISSIONS','paused',()=>vault.paused(options));
  const identity={version:1,chainId:97,target:verified.target,owner:verified.owner,operator:verified.operator,queue:verified.queue,hash:verified.hash,runtimeHash:verified.runtimeHash};
  const balance=await read('JOURNAL_VALIDATION','operator-balance',()=>provider.getBalance(release.deployer,block.number));
  const feeBudget=read('JOURNAL_VALIDATION','journal-fees',()=>journalFeeBudget(journal,identity,balance));
  const funding=[],queue=new Contract(verified.queue,['function pending(address) view returns(uint256)'],provider);
  for(const [asset,name]of [[ZeroAddress,'native'],[release.token,'token']]){
   const ledger=await read('CURRENT_FUNDING','ledgers-'+name,()=>vault.ledgers(asset,options));
   const cash=await read('CURRENT_FUNDING','asset-balance-'+name,()=>vault.assetBalance(asset,options));
   const pending=await read('CURRENT_FUNDING','queue-pending-'+name,()=>queue.pending(asset,options));
   const priorClaims=ledger.profit+ledger.feeReserve+pending,obligations=priorClaims+ledger.rewards;
   funding.push({asset,principalUnits:String(ledger.principal),profitUnits:String(ledger.profit),feeReserveUnits:String(ledger.feeReserve),pendingWithdrawalUnits:String(pending),rewardBudgetUnits:String(ledger.rewards),cashUnits:String(cash),availableForNewProfitUnits:String(cash>priorClaims?cash-priorClaims:0n),cashShortfallUnits:String(obligations>cash?obligations-cash:0n)});
  }
  await canonical('confirmed-block-hash',block.number,block.hash);
  return {checkpoint:{number:block.number,hash:block.hash,timestamp:block.timestamp},reporterAuthorized:reporter,paused,queue:verified.queue,funding,feeBudget};
 }catch(error){
  const failure=Error(allowed('errors',error?.message,'RELIABILITY_PREFLIGHT_FAILED'));
  failure.safeReport={diagnostic:reliabilityFailureDiagnostic(error,context)};
  throw failure;
 }
}

export async function prepareDailyReliability({runtime,stage,rpcFile,envFile='/etc/globaldroptrade/trades.env',policyFile='/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/daily-policy.json',activityFile=activityPolicyFile}){
 let context={phase:'LOCAL_INPUTS',operation:'runtime-import'};
 try{
  const root=fs.realpathSync(runtime),require=createRequire(path.join(root,'package.json'));
  const {Contract,FetchRequest,JsonRpcProvider,Interface,ZeroAddress,keccak256}=require('ethers');
  const load=name=>import(pathToFileURL(path.join(root,'scripts',name)).href);
  const [{getZeroStartProfile},{verifyZeroStartTarget},{createZeroStartProofProviders},{validateDailyPolicy,blockAtTime},{readConfig},{getCompleteLogs,installHistoricalCallRetry}]=await Promise.all([
   load('zero-start-profile.mjs'),load('zero-start-readiness.mjs'),load('connect-zero-start.mjs'),load('daily-profit.mjs'),import(pathToFileURL(path.join(root,'server/trades-api.mjs')).href),load('complete-rpc-logs.mjs')
  ]);
  const helpers={Contract,Interface,ZeroAddress,keccak256,verifyZeroStartTarget,blockAtTime,getCompleteLogs,installHistoricalCallRetry};
  context.operation='configuration';
  const profile=getZeroStartProfile(true),original=privateText(envFile),settings=parseEnv(original),cfg=readConfig(settings);
  if(cfg.chainId!==97||cfg.port!==3115||cfg.address.toLowerCase()!==reliabilityTarget.toLowerCase()||settings.TRADES_ZERO_START_PROFILE!==profile.release.releaseId||settings.GLOBAL_MIGRATION_ENABLED!=='false')throw Error('RELIABILITY_CURRENT_TESTNET_REQUIRED');
  context.operation='financial-policy';
  const policyText=privateText(policyFile),policy=validateDailyPolicy(JSON.parse(policyText));
  if(policy.chainId!==97||policy.vaultAddress.toLowerCase()!==reliabilityTarget.toLowerCase()||policy.basis!=='position-anniversary-principal'||![3600,900].includes(policy.periodSeconds))throw Error('RELIABILITY_EXISTING_POSITION_POLICY_REQUIRED');
  context.operation='activity-policy';
  const activityText=privateText(activityFile,{optional:true,max:16384}),existing=activityText===null?null:verifyActivityPolicy(JSON.parse(activityText));
  context.operation='financial-journal';
  const journalText=privateText(profile.automationDir+'/journal.json'),journal=JSON.parse(journalText);
  context.operation='rpc-candidates';
  let fallback=[];try{fallback=settings.TRADES_RPC_URLS?JSON.parse(settings.TRADES_RPC_URLS):[];}catch{throw Error('RELIABILITY_RPC_CANDIDATES_REQUIRED');}
  if(!Array.isArray(fallback))throw Error('RELIABILITY_RPC_CANDIDATES_REQUIRED');
  const supplied=rpcFile?[privateText(rpcFile,{max:16384}).trim()]:[];
  const candidates=[...new Set([cfg.rpcUrl,...fallback,...supplied].map(rpcUrl))];
  if(candidates.length<1||candidates.length>4)throw Error('RELIABILITY_RPC_CANDIDATES_REQUIRED');
  context.operation='deployment-proofs';
  const deployment=JSON.parse(privateText(profile.stateDir+'/deployment-public.json'));
  const connection=JSON.parse(privateText(profile.stateDir+'/connection-public.json'));
  const artifact=JSON.parse(fs.readFileSync(profile.artifactPath,'utf8'));
  const proofProviders=createZeroStartProofProviders(),approved=[],attempts=[];
  context={phase:'RPC_VERIFICATION',operation:'unknown'};
  try{
   for(let index=0;index<candidates.length;index++){
    const request=new FetchRequest(candidates[index]);request.timeout=10000;
    const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
    try{
     const candidateOriginal=original+(original.endsWith('\n')?'':'\n')+`TRADES_RPC_URL='${candidates[index]}'\n`;
     const verified=await inspectReliabilityCandidate({provider,artifact,release:profile.release,policy,journal,original:candidateOriginal,deployment,connection,confirmations:Math.max(3,cfg.confirmations),proofProviders,helpers});
     approved.push({url:candidates[index],...verified});attempts.push({candidate:index,verified:true});
    }catch(error){
     if(['RELIABILITY_JOURNAL_IDENTITY_MISMATCH','RELIABILITY_FINANCIAL_JOURNAL_INVALID'].includes(error?.message))throw error;
     attempts.push({candidate:index,verified:false,...sanitizeReliabilityDiagnostic(error?.safeReport?.diagnostic)});
    }finally{provider.destroy();}
   }
  }finally{for(const provider of proofProviders)provider.destroy();}
  if(!approved.length){const error=Error('RELIABILITY_VERIFIED_RPC_REQUIRED');error.safeReport={...context,attempts};throw error;}
  context={phase:'CONFIGURATION_STAGE',operation:'render-environment'};
  const first=approved[0],activity=existing||verifyActivityPolicy({version:1,chainId:97,vaultAddress:reliabilityTarget,origin,windowSeconds:86400,activationTimestamp:first.checkpoint.timestamp+86400,historyFile:activityHistory});
  const next=renderReliabilityEnv(original,approved.map(row=>row.url),activity);
  const waitingFor=[...(!first.reporterAuthorized?['REPORTER_AUTHORIZATION_REQUIRED']:[]),...(first.paused?['CONTRACT_PAUSED']:[]),...(first.funding.every(row=>row.rewardBudgetUnits==='0')?['REWARD_BUDGET_EMPTY']:[]),...(first.funding.some(row=>row.cashShortfallUnits!=='0')?['VAULT_CASH_SHORTFALL']:[]),...first.feeBudget.waitingFor];
  const report={version:1,kind:'global-daily-reliability-preflight',chainId:97,target:reliabilityTarget,runtimeHash:policy.runtimeHash,periodSeconds:policy.periodSeconds,acceleratedTestSchedule:true,checkpoint:first.checkpoint,reporterAuthorized:first.reporterAuthorized,paused:first.paused,queue:first.queue,funding:first.funding,feeBudget:first.feeBudget,waitingFor,verifiedRpcCount:approved.length,attempts,activityPolicy:activity,activityPolicyAlreadyPresent:existing!==null,originalEnvSha256:sha(original),stagedEnvSha256:sha(next),dailyPolicySha256:sha(policyText),originalJournalSha256:sha(journalText),originalActivityPolicySha256:activityText===null?null:sha(activityText),transactionsSent:0,signerOpened:false};
  if(stage){
   context.operation='write-stage';
   writeStage(stage,'trades.env',next);
   // Preserve the exact existing policy text and activation on every reinstall.
   writeStage(stage,'daily-activity-policy.json',activityText===null?json(activity):activityText);
   writeStage(stage,'preflight.json',json(report));
  }
  return report;
 }catch(error){
  if(error?.safeReport)throw error;
  const failure=Error(allowed('errors',error?.message,'RELIABILITY_PREFLIGHT_FAILED'));
  failure.safeReport={diagnostic:reliabilityFailureDiagnostic(error,context)};
  throw failure;
 }
}

let invoked;
try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(process.argv[1])).href;}catch{}
if(import.meta.url===invoked){
 try{
  if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
  let runtime,stage,rpcFile;const args=process.argv.slice(2);
  for(let i=0;i<args.length;i++){
   const name=args[i];
   if(name==='--check')continue;
   if(!['--runtime','--stage','--rpc-file'].includes(name)||!args[i+1]||!path.isAbsolute(args[i+1]))throw Error('RELIABILITY_PREFLIGHT_ARGUMENTS_REQUIRED');
   const value=args[++i];if(name==='--runtime')runtime=value;else if(name==='--stage')stage=value;else rpcFile=value;
  }
  if(!runtime)throw Error('RELIABILITY_RUNTIME_REQUIRED');
  console.log(JSON.stringify(await prepareDailyReliability({runtime,stage,rpcFile})));
 }catch(e){console.log(JSON.stringify(reliabilityPreflightFailure(e)));process.exitCode=1;}
}
