// Read-only daily automation readiness. Never opens signer files or sends transactions.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,JsonRpcProvider,ZeroAddress,keccak256} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {createZeroStartProofProviders,prepareZeroStartConnection} from './connect-zero-start.mjs';
import {zeroStartRelease,validateZeroStartRelease} from './deploy-zero-start.mjs';
import {parseZeroStartProfileArgs} from './zero-start-profile.mjs';
import {blockAtTime,validateDailyPolicy} from './daily-profit.mjs';
import {writePrivateJson} from './migration-journal.mjs';

const day=86400;
const markerFields=['chainId','target','contractAddress','owner','queue','hash','block','blockHash','artifactHash','initcodeHash','runtimeHash'];
const archiveOperations=new Set(['blockAtTime','owner','accounts-native','accounts-token','dailyTargetBps','ledgers-native','ledgers-token','canonical-check']);
const archiveErrorCodes=new Set(['CALL_EXCEPTION','NETWORK_ERROR','SERVER_ERROR','TIMEOUT','BAD_DATA','UNKNOWN_ERROR','UNSUPPORTED_OPERATION','INVALID_ARGUMENT','NUMERIC_FAULT','BUFFER_OVERRUN','OFFCHAIN_FAULT','CANCELLED']);
const archiveFailureReasons=new Set(['TIMEOUT','HISTORICAL_STATE_UNAVAILABLE','RATE_LIMITED','METHOD_UNAVAILABLE','TRANSPORT_UNAVAILABLE','INVALID_RESPONSE','REVERTED','UNKNOWN']);

export function sanitizeZeroStartArchiveProbeDiagnostic(value){
 return {operation:archiveOperations.has(value?.operation)?value.operation:'unknown',errorCode:archiveErrorCodes.has(value?.errorCode)?value.errorCode:null,rpcCode:typeof value?.rpcCode==='number'&&Number.isSafeInteger(value.rpcCode)&&value.rpcCode>=-2147483648&&value.rpcCode<=2147483647?value.rpcCode:null,httpStatus:Number.isSafeInteger(value?.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599?value.httpStatus:null,reason:archiveFailureReasons.has(value?.reason)?value.reason:'UNKNOWN'};
}

function archiveFailureReason(error,rpcCode,httpStatus){
 const message=[error?.message,error?.info?.error?.message,error?.error?.message].filter(value=>typeof value==='string').join(' ').toLowerCase();
 if(error?.code==='TIMEOUT'||/\btimeout\b|timed out/.test(message))return 'TIMEOUT';
 if(httpStatus===429||rpcCode===-32005||/rate limit|too many requests|limit exceeded/.test(message))return 'RATE_LIMITED';
 if(/missing trie|pruned|historical (?:contract )?state.*(?:unavailable|not available)|state (?:is )?not available|unknown state/.test(message))return 'HISTORICAL_STATE_UNAVAILABLE';
 if([-32601,-32004].includes(rpcCode)||/method.*not found|method.*not supported|unsupported method/.test(message))return 'METHOD_UNAVAILABLE';
 if(error?.revert||(typeof error?.data==='string'&&error.data!=='0x')||/execution reverted|vm exception.*revert/.test(message))return 'REVERTED';
 if(['BAD_DATA','BUFFER_OVERRUN'].includes(error?.code))return 'INVALID_RESPONSE';
 if(['NETWORK_ERROR','SERVER_ERROR'].includes(error?.code)||(httpStatus!==null&&httpStatus>=500))return 'TRANSPORT_UNAVAILABLE';
 return 'UNKNOWN';
}

export function zeroStartArchiveProbeDiagnostic(error,operation){
 const value=error?.info?.error?.code??error?.error?.code;
 const rawStatus=error?.info?.response?.statusCode??error?.info?.responseStatus??error?.response?.statusCode??error?.response?.status??error?.status;
 const status=typeof rawStatus==='string'&&/^[1-5][0-9]{2}(?:\s|$)/.test(rawStatus)?Number(rawStatus.slice(0,3)):rawStatus;
 const httpStatus=Number.isSafeInteger(status)&&status>=100&&status<=599?status:null;
 return sanitizeZeroStartArchiveProbeDiagnostic({operation,errorCode:error?.code,rpcCode:value,httpStatus,reason:archiveFailureReason(error,value,httpStatus)});
}

function verifyMarker(marker,report){
 if(marker?.version!==1||marker.kind!=='fresh-zero-site-connection'||marker.siteConnected!==true||marker.verified!==true)throw Error('ZERO_START_CONNECTED_MARKER_REQUIRED');
 if(markerFields.some(key=>marker[key]!==report[key]))throw Error('ZERO_START_CONNECTED_IDENTITY_MISMATCH');
 if(report.releaseId==='global-fresh-fast-test-v1'&&(marker.releaseId!==report.releaseId||marker.testMode!==true||marker.initialServerReporter!==true||marker.fastTestnetVersion!==1))throw Error('ZERO_START_FAST_CONNECTED_MARKER_REQUIRED');
}

async function archiveReadiness({provider,vault,report,token,checkpoint,policy,periodStartTimestamp,requiredRetentionSeconds=day}){
 const created=await provider.getBlock(report.block);
 if(!created||created.hash!==report.blockHash)throw Error('ZERO_START_RECEIPT_NOT_FINAL');
 let requestedPeriod=periodStartTimestamp;
 if(policy){
  policy=validateDailyPolicy(policy);
  if(policy.chainId!==97||policy.vaultAddress!==report.target||policy.runtimeHash!==report.runtimeHash||policy.deploymentBlock!==report.block||policy.startTimestamp<created.timestamp)throw Error('ZERO_START_DAILY_POLICY_IDENTITY_MISMATCH');
  requestedPeriod??=policy.startTimestamp;
 }
 if(requestedPeriod!==undefined&&(!Number.isSafeInteger(requestedPeriod)||requestedPeriod<created.timestamp||requestedPeriod>checkpoint.timestamp))throw Error('ZERO_START_DAILY_PERIOD_START_INVALID');
 const mature=checkpoint.timestamp-created.timestamp>=requiredRetentionSeconds;
 const requests=[{purpose:mature?(requiredRetentionSeconds===day?'previous-day-retention':'previous-hour-retention'):'deployment-state',timestamp:mature?checkpoint.timestamp-requiredRetentionSeconds:created.timestamp}];
 if(requestedPeriod!==undefined&&!requests.some(row=>row.timestamp===requestedPeriod))requests.push({purpose:'requested-period-start',timestamp:requestedPeriod});
 const probes=[];
 for(const request of requests){
  let block,operation='blockAtTime';
  try{
   block=await blockAtTime(provider,request.timestamp,report.block,checkpoint.number);
   const o={blockTag:block.number};
   operation='owner';await vault.owner(o);
   operation='accounts-native';await vault.accounts(report.owner,ZeroAddress,o);
   operation='accounts-token';await vault.accounts(report.owner,token,o);
   operation='dailyTargetBps';await vault.dailyTargetBps(report.owner,o);
   operation='ledgers-native';await vault.ledgers(ZeroAddress,o);
   operation='ledgers-token';await vault.ledgers(token,o);
   operation='canonical-check';
   if((await provider.getBlock(block.number))?.hash!==block.hash)throw Error('ARCHIVE_CHECKPOINT_REORG');
   probes.push({purpose:request.purpose,requestedTimestamp:request.timestamp,block:block.number,blockHash:block.hash,blockTimestamp:block.timestamp,supported:true});
  }catch(error){
   if(error?.message==='ARCHIVE_CHECKPOINT_REORG')throw error;
   probes.push({purpose:request.purpose,requestedTimestamp:request.timestamp,block:block?.number??null,supported:false,error:'HISTORICAL_CONTRACT_STATE_UNAVAILABLE',failure:zeroStartArchiveProbeDiagnostic(error,operation)});
  }
 }
 const supported=probes.every(probe=>probe.supported);
 return {status:!supported?'unavailable':mature?'supported':'provisional',requiredRetentionSeconds,targetAgeSeconds:checkpoint.timestamp-created.timestamp,probes,fullyVerified:supported&&mature};
}

// Establish the current non-upgradeable target without requiring reward funding,
// a daily policy or historical principal snapshots. Oracle maintenance uses this
// proof so a separate daily-readiness failure cannot prevent feed recovery.
export async function verifyZeroStartTarget({provider,artifact,deploymentReport,connectionReport,original,release=zeroStartRelease,confirmations=3,inspectSettlementLogs=true,proofProviders=[]}){
 const settings=parseEnv(original),c=validateZeroStartRelease(release);
 if(settings.GLOBAL_MIGRATION_ENABLED!=='false')throw Error('ZERO_START_LEGACY_MIGRATION_MUST_BE_DISABLED');
 const config=readConfig(settings);
 const {report}=await prepareZeroStartConnection({provider,artifact,deploymentReport,original,release:c,confirmations,inspectSettlementLogs,proofProviders});
 verifyMarker(connectionReport,report);
 const fast=c.releaseId==='global-fresh-fast-test-v1'&&c.testMode===true&&c.initialServerReporter===true;
 if(fast&&(report.testMode!==true||report.initialServerReporter!==true||report.fastTestnetVersion!==1))throw Error('ZERO_START_FAST_DEPLOYMENT_MARKER_REQUIRED');
 if(config.chainId!==97||config.address!==report.target||config.startBlock!==report.block||config.port!==3115)throw Error('ZERO_START_ACTIVE_API_TARGET_MISMATCH');
 return {version:1,kind:'fresh-zero-verified-target',releaseId:c.releaseId,chainId:97,target:report.target,contractAddress:report.target,owner:c.owner,operator:c.deployer,token:c.token,queue:report.queue,hash:report.hash,block:report.block,blockHash:report.blockHash,artifactHash:report.artifactHash,initcodeHash:report.initcodeHash,runtimeHash:report.runtimeHash,approvalVersion:1,automaticGroupVersion:1,...(fast?{testMode:true,initialServerReporter:true,fastTestnetVersion:1}:{}),currentState:report.currentState,siteConnected:true,transactionsSent:0};
}

export async function verifyZeroStartReadiness({provider,artifact,deploymentReport,connectionReport,original,release=zeroStartRelease,policy,periodStartTimestamp,confirmations=3,hourlyTest=false,proofProviders=[]}){
 const c=validateZeroStartRelease(release),report=await verifyZeroStartTarget({provider,artifact,deploymentReport,connectionReport,original,release:c,confirmations,proofProviders});
 const fast=c.releaseId==='global-fresh-fast-test-v1'&&c.testMode===true&&c.initialServerReporter===true;
 if(typeof hourlyTest!=='boolean'||(hourlyTest&&!fast))throw Error('HOURLY_TEST_FAST_PROFILE_REQUIRED');
 const checkpoint=await provider.getBlock(Math.max(report.block,report.currentState.block-confirmations));
 if(!checkpoint)throw Error('ZERO_START_READINESS_CHECKPOINT_REORG');
 const vault=new Contract(report.target,artifact.abi,provider),o={blockTag:checkpoint.number};
 const calldata=vault.interface.encodeFunctionData('setReporter',[c.deployer,true]),hash=keccak256(calldata);
 const [reporterAuthorized,etaValue,roundValue,votesValue,storedRequiredValue,delayValue,tokenDecimalsValue,quorumValue,pausedConfirmed,confirmedOwner]=await Promise.all([
  vault.reporters(c.deployer,o),vault.queuedConfig(hash,o),vault.configRound(hash,o),vault.configVotes(hash,o),vault.configVotesRequired(hash,o),vault.CONFIG_DELAY(o),vault.tokenDecimals(o),vault.partnerVotesRequired(o),vault.paused(o),vault.owner(o)
 ]);
 if(confirmedOwner!==c.owner)throw Error('ZERO_START_CONFIRMED_OWNER_MISMATCH');
 const eta=Number(etaValue),round=Number(roundValue),votes=Number(votesValue),currentQuorum=Number(quorumValue),paused=pausedConfirmed||report.currentState.paused;
 const queued=etaValue!==0n,requiredVotes=queued?Number(storedRequiredValue):currentQuorum;
 if(![eta,round,votes,requiredVotes,currentQuorum,Number(delayValue),Number(tokenDecimalsValue)].every(Number.isSafeInteger)||requiredVotes<2||requiredVotes>7||currentQuorum<2||currentQuorum>7||votes>7||tokenDecimalsValue>18n)throw Error('ZERO_START_GOVERNANCE_STATE_INVALID');
 const partners=await Promise.all(c.partners.map(async address=>({address,voted:await vault.hasConfigVoted(hash,roundValue,address,o)})));
 const delayElapsed=queued&&checkpoint.timestamp>=eta;
 const reporterProposal={calldata,hash,eta,round,votes,requiredVotes,currentQuorum,queued,delaySeconds:Number(delayValue),delayElapsed,executable:!reporterAuthorized&&queued&&delayElapsed&&votes>=requiredVotes,partners,queueCalldata:vault.interface.encodeFunctionData('queueConfiguration',[hash]),voteCalldata:vault.interface.encodeFunctionData('voteConfiguration',[hash]),cancelCalldata:vault.interface.encodeFunctionData('cancelConfiguration',[hash])};
 const tiers=await Promise.all(Array.from({length:5},(_,i)=>vault.tierConfig(i,o)));
 const maxDailyBps=tiers.reduce((max,tier)=>tier.maxDailyBps>max?tier.maxDailyBps:max,0n);
 const referralTotals=tiers.map(tier=>{const rates=Array.from(tier.referrals);if(rates.length!==4||rates.some(value=>typeof value!=='bigint'||value<0n||value>3400n))throw Error('ZERO_START_DAILY_PLAN_INVALID');return rates.reduce((sum,value)=>sum+value,0n);});
 const maxReferralBps=referralTotals.reduce((max,value)=>value>max?value:max,0n);
 if(maxDailyBps>1000n||maxReferralBps>3400n)throw Error('ZERO_START_DAILY_PLAN_INVALID');
 const assets=[];
 for(const [asset,symbol,decimals] of [[ZeroAddress,'BNB',18],[c.token,'USDT',Number(tokenDecimalsValue)]]){
  const [ledger,cash]=await Promise.all([vault.ledgers(asset,o),vault.assetBalance(asset,o)]);
  const estimate=(ledger.principal*maxDailyBps+9999n)/10000n,referralEstimate=(estimate*maxReferralBps+9999n)/10000n,totalEstimate=estimate+referralEstimate,minimum=totalEstimate>0n?totalEstimate:1n;
  const fullyBackedRewards=ledger.rewards>0n&&cash>=ledger.rewards;
  assets.push({asset,symbol,decimals,principal:ledger.principal.toString(),rewards:ledger.rewards.toString(),cash:cash.toString(),estimatedDailyRequirement:estimate.toString(),estimatedReferralRequirement:referralEstimate.toString(),estimatedTotalDailyRequirement:totalEstimate.toString(),minimumBudgetRequired:minimum.toString(),backed:fullyBackedRewards,fullyBackedRewards,rewardBackingShortfall:(ledger.rewards>cash?ledger.rewards-cash:0n).toString(),ready:ledger.rewards>=minimum&&cash>=minimum,requiredForExistingPrincipal:ledger.principal>0n});
 }
 const requiredAssets=assets.filter(asset=>asset.requiredForExistingPrincipal);
 const funding={estimateVersion:2,maxDailyBps:Number(maxDailyBps),maxReferralBps:Number(maxReferralBps),estimateBasis:'conservative-current-principal-personal-plus-referrals-rounded-up',emptyPrincipalMinimumBasis:'one-smallest-asset-unit-positive-budget-only',assets,ready:requiredAssets.length?requiredAssets.every(asset=>asset.ready):assets.some(asset=>asset.ready)};
 const gas=await provider.getBalance(c.deployer,checkpoint.number),operatorGas={balance:gas.toString(),positive:gas>0n};
 const archive=await archiveReadiness({provider,vault,report,token:c.token,checkpoint,policy,periodStartTimestamp,requiredRetentionSeconds:hourlyTest?3600:day});
 // The separate test profile can establish its first policy while young, after
 // every currently required snapshot succeeds. Retention remains unverified.
 if(fast&&archive.status==='provisional'&&archive.probes.every(probe=>probe.supported))archive.provisionalAccepted=true;
 const blockers=[];
 if(paused)blockers.push('OWNER_UNPAUSE_REQUIRED');
 if(!reporterAuthorized){
  blockers.push('COUNCIL_AUTHORIZED_SERVER_REPORTER_REQUIRED');
  if(!queued)blockers.push('REPORTER_PROPOSAL_REQUIRED');
  else{
   if(votes<requiredVotes)blockers.push('REPORTER_PARTNER_VOTES_REQUIRED');
   if(!delayElapsed)blockers.push('REPORTER_DELAY_NOT_ELAPSED');
   if(reporterProposal.executable)blockers.push('REPORTER_ENABLE_EXECUTION_REQUIRED');
  }
 }
 if(!funding.ready){
  blockers.push('FUNDED_DAILY_REWARD_BUDGET_REQUIRED');
  for(const asset of requiredAssets)if(!asset.ready)blockers.push(asset.symbol+'_REWARD_BUDGET_REQUIRED');
 }
 if(!operatorGas.positive)blockers.push('SERVER_OPERATOR_TEST_BNB_REQUIRED');
 if(archive.status==='unavailable')blockers.push('ARCHIVE_RPC_REQUIRED_FOR_PERIOD_START_PRINCIPAL');
 if(archive.status==='provisional'&&!archive.provisionalAccepted)blockers.push('ARCHIVE_RETENTION_NOT_YET_VERIFIABLE');
 if((await provider.getBlock(checkpoint.number))?.hash!==checkpoint.hash)throw Error('ZERO_START_READINESS_CHECKPOINT_REORG');
 // Explicit public allowlist: no RPC URL, environment strings, credentials or signer material.
 return {version:1,kind:'fresh-zero-daily-readiness',releaseId:c.releaseId,chainId:97,target:report.target,contractAddress:report.target,owner:c.owner,operator:c.deployer,token:c.token,tokenDecimals:Number(tokenDecimalsValue),queue:report.queue,hash:report.hash,block:report.block,blockHash:report.blockHash,artifactHash:report.artifactHash,initcodeHash:report.initcodeHash,runtimeHash:report.runtimeHash,approvalVersion:1,automaticGroupVersion:1,...(fast?{testMode:true,initialServerReporter:true,fastTestnetVersion:1}:{}),...(hourlyTest?{testInterval:'hourly',allocationPeriodSeconds:3600}:{}),checkpoint:{block:checkpoint.number,blockHash:checkpoint.hash,timestamp:checkpoint.timestamp,observedHead:report.currentState.block,confirmations:report.currentState.block-checkpoint.number},paused,pausedConfirmed,reporterAuthorized,reporterProposal,funding,operatorGas,archive,ready:blockers.length===0,blockers,siteConnected:true,automationStatus:'not-inspected',transactionsSent:0};
}

function privateDirectory(directory){
 const s=fs.lstatSync(directory);if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_READINESS_DIRECTORY_REQUIRED');
}

function readPrivate(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_READINESS_FILE_REQUIRED');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
}

async function main(){
 const {profile,args}=parseZeroStartProfileArgs();
 const [mode,outputArg,...extra]=args;
 if(!['status','preflight'].includes(mode)||extra.length)throw Error('USAGE_STATUS_OR_PREFLIGHT_OPTIONAL_OUTPUT_DIRECTORY');
 if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
 const directory=profile.stateDir;privateDirectory(directory);
 const envFile='/etc/globaldroptrade/trades.env',original=readPrivate(envFile),settings=parseEnv(original),config=readConfig(settings);
 const deploymentReport=JSON.parse(readPrivate(path.join(directory,'deployment-public.json'))),connectionReport=JSON.parse(readPrivate(path.join(directory,'connection-public.json')));
 let policy;if(process.env.GLOBAL_DAILY_POLICY)policy=JSON.parse(readPrivate(process.env.GLOBAL_DAILY_POLICY));
 const artifact=JSON.parse(fs.readFileSync(profile.artifactUrl,'utf8'));
 const transport=new FetchRequest(config.rpcUrl);transport.timeout=15000;
 const provider=new JsonRpcProvider(transport,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 const proofProviders=createZeroStartProofProviders();
 try{
  const report=await verifyZeroStartReadiness({provider,artifact,deploymentReport,connectionReport,original,release:profile.release,policy,confirmations:Math.max(3,config.confirmations),proofProviders});
  if(readPrivate(envFile)!==original)throw Error('ZERO_START_ORIGINAL_ENV_CHANGED');
  const statusFile=path.join(directory,'readiness.json');if(fs.existsSync(statusFile))readPrivate(statusFile);writePrivateJson(statusFile,report);
  if(outputArg){
   const output=path.resolve(outputArg);privateDirectory(output);
   const file=path.join(output,'activation.json');if(fs.existsSync(file))readPrivate(file);writePrivateJson(file,report);
  }
  console.log('ZERO_START_DAILY_READINESS target='+report.target+' ready='+report.ready);
  console.log('BLOCKERS='+(report.blockers.join(',')||'none'));console.log('REPORT='+statusFile);
  if(mode==='preflight'&&!report.ready)process.exitCode=1;
 }finally{provider.destroy();for(const fallback of proofProviders)fallback.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
 console.error('ZERO_START_READINESS_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message||'')?e.message:'RPC_OR_VERIFICATION_FAILED'));process.exitCode=1;
});
