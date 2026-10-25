// Prepare a verified, private RPC configuration without opening a signer.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,Interface,JsonRpcProvider,getAddress} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {parseZeroStartProfileArgs} from './zero-start-profile.mjs';
import {createZeroStartProofProviders} from './connect-zero-start.mjs';
import {validateZeroStartRelease} from './deploy-zero-start.mjs';
import {verifyZeroStartTarget,verifyZeroStartReadiness,sanitizeZeroStartArchiveProbeDiagnostic} from './zero-start-readiness.mjs';
import {assertZeroStartJournalCanonical,zeroStartWorkerDiagnostic} from './zero-start-automation.mjs';
import {isHourlyTestPolicy,planDailyEpoch,validateDailyPolicy} from './daily-profit.mjs';

export const zeroArchiveRpcUrl='https://bsc-testnet-rpc.publicnode.com';
export const zeroArchiveReadinessMaxAttempts=3;
const sha256=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const retained=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='TRADES_RPC_URL').sort(([a],[b])=>a.localeCompare(b)));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const registry=new Interface(['event Registered(address indexed user,address indexed referrer)']);
const readinessBlockers=new Set(['OWNER_UNPAUSE_REQUIRED','COUNCIL_AUTHORIZED_SERVER_REPORTER_REQUIRED','REPORTER_PROPOSAL_REQUIRED','REPORTER_PARTNER_VOTES_REQUIRED','REPORTER_DELAY_NOT_ELAPSED','REPORTER_ENABLE_EXECUTION_REQUIRED','FUNDED_DAILY_REWARD_BUDGET_REQUIRED','BNB_REWARD_BUDGET_REQUIRED','USDT_REWARD_BUDGET_REQUIRED','SERVER_OPERATOR_TEST_BNB_REQUIRED','ARCHIVE_RPC_REQUIRED_FOR_PERIOD_START_PRINCIPAL','ARCHIVE_RETENTION_NOT_YET_VERIFIABLE']);
const archivePurposes=new Set(['previous-day-retention','previous-hour-retention','deployment-state','requested-period-start']);
const archiveErrors=new Set(['HISTORICAL_CONTRACT_STATE_UNAVAILABLE','ARCHIVE_CHECKPOINT_REORG']);
const positiveInteger=value=>Number.isSafeInteger(value)&&value>0?value:null;
const waitForAvailability=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Explicit fields only: provider messages, URLs, credentials and calldata may
// appear on RPC exceptions and must never become diagnostic report content.
export function zeroArchiveReadinessSummary(readiness){
 const archive=readiness?.archive;
 return {ready:readiness?.ready===true,blockers:Array.isArray(readiness?.blockers)?[...new Set(readiness.blockers.slice(0,32).map(value=>readinessBlockers.has(value)?value:'UNKNOWN_READINESS_BLOCKER'))]:['UNKNOWN_READINESS_BLOCKER'],fundingReady:readiness?.funding?.ready===true,operatorGasPositive:readiness?.operatorGas?.positive===true,archive:{status:['supported','unavailable','provisional'].includes(archive?.status)?archive.status:'unknown',fullyVerified:archive?.fullyVerified===true,requiredRetentionSeconds:[3600,86400].includes(archive?.requiredRetentionSeconds)?archive.requiredRetentionSeconds:null,probes:Array.isArray(archive?.probes)?archive.probes.slice(0,16).map(probe=>({purpose:archivePurposes.has(probe?.purpose)?probe.purpose:'unknown',requestedTimestamp:positiveInteger(probe?.requestedTimestamp),block:positiveInteger(probe?.block),supported:probe?.supported===true,error:archiveErrors.has(probe?.error)?probe.error:null,failure:probe?.supported===false&&probe?.failure?sanitizeZeroStartArchiveProbeDiagnostic(probe.failure):null})):[]}};
}

function archiveAvailabilityOnly(readiness){
 return readiness?.ready===false&&readiness.reporterAuthorized===true&&readiness.paused===false&&readiness.funding?.ready===true&&readiness.operatorGas?.positive===true&&readiness.archive?.status==='unavailable'&&Array.isArray(readiness.blockers)&&readiness.blockers.length>0&&readiness.blockers.every(value=>value==='ARCHIVE_RPC_REQUIRED_FOR_PERIOD_START_PRINCIPAL')&&Array.isArray(readiness.archive.probes)&&readiness.archive.probes.some(probe=>probe.supported===false&&probe.error==='HISTORICAL_CONTRACT_STATE_UNAVAILABLE');
}

function readinessRpcAvailability(error){
 if(['NETWORK_ERROR','SERVER_ERROR','TIMEOUT'].includes(error?.code))return true;
 const rpcCode=error?.info?.error?.code??error?.error?.code;
 const method=error?.info?.payload?.method??error?.payload?.method;
 return ['CALL_EXCEPTION','UNKNOWN_ERROR'].includes(error?.code)&&error?.data==null&&!error?.revert&&!error?.reason&&(error?.action==='call'||method==='eth_call')&&[-32603,-32000,-32002,-32005].includes(rpcCode);
}

function fullReadinessFailure(readiness,attempts){
 const error=Error('ARCHIVE_RPC_FULL_READINESS_REQUIRED');
 Object.defineProperty(error,'archiveReadiness',{value:readiness});
 error.readinessSummary=zeroArchiveReadinessSummary(readiness);error.readinessAttempts=attempts;
 return error;
}

export function renderZeroArchiveRpcEnvironment(original){
 if(typeof original!=='string'||original.includes('\0'))throw Error('ARCHIVE_RPC_ENVIRONMENT_REQUIRED');
 const before=parseEnv(original);
 if(!before.TRADES_RPC_URL)throw Error('ARCHIVE_RPC_ENVIRONMENT_REQUIRED');
 const env=before.TRADES_RPC_URL===zeroArchiveRpcUrl?original:original+(original.endsWith('\n')?'':'\n')+'TRADES_RPC_URL="'+zeroArchiveRpcUrl+'"\n';
 const after=parseEnv(env);
 if(after.TRADES_RPC_URL!==zeroArchiveRpcUrl||!same(retained(before),retained(after)))throw Error('ARCHIVE_RPC_ENVIRONMENT_PRESERVATION_FAILED');
 return env;
}

function requireState(state){
 if(!state||typeof state!=='object'||Array.isArray(state)||!state.transactions||typeof state.transactions!=='object'||Array.isArray(state.transactions)||!Number.isSafeInteger(state.daily?.epoch)||state.daily.epoch<0)throw Error('ARCHIVE_RPC_DAILY_JOURNAL_REQUIRED');
 if(state.pending||state.oracle?.pending||Object.values(state.transactions).some(entry=>!entry||typeof entry!=='object'||!Number.isSafeInteger(entry.block)||entry.block<1))throw Error('ARCHIVE_RPC_PENDING_TRANSACTION_REQUIRES_RECONCILIATION');
}

function requireIdentity(state,target,policy){
 const expected={version:1,chainId:97,target:target.target,owner:target.owner,operator:target.operator,queue:target.queue,hash:target.hash,runtimeHash:target.runtimeHash};
 if(!same(state.identity,expected))throw Error('ARCHIVE_RPC_JOURNAL_IDENTITY_MISMATCH');
 if(policy.vaultAddress!==getAddress(target.target)||policy.runtimeHash!==target.runtimeHash||policy.deploymentBlock!==target.block)throw Error('ARCHIVE_RPC_POLICY_IDENTITY_MISMATCH');
 const activation=state.activation;
 if(!Number.isSafeInteger(activation?.block)||activation.block<target.block||!hash(activation.blockHash)||activation.block!==policy.activationBlock||activation.blockHash!==policy.activationBlockHash||activation.startTimestamp!==policy.startTimestamp)throw Error('ARCHIVE_RPC_POLICY_CHECKPOINT_REQUIRED');
}

// Providers are injected for tests. The CLI constructs only the fixed public
// candidate; all verified history remains a prerequisite, never a substitute.
export async function prepareZeroArchiveRpc({primary,candidate,artifact,release,original,deploymentText,connectionText,policyText,journalText,confirmations=3,proofProviders=[],assertCurrent=async()=>{},onPhase=()=>{},availabilityWait=waitForAvailability}){
 const c=validateZeroStartRelease(release);
 if(c.releaseId!=='global-fresh-fast-test-v1'||!c.testMode||!c.initialServerReporter)throw Error('ARCHIVE_RPC_EXPLICIT_FAST_PROFILE_REQUIRED');
 if(!Number.isSafeInteger(confirmations)||confirmations<3)throw Error('ARCHIVE_RPC_CONFIRMATIONS_REQUIRED');
 for(const value of [original,deploymentText,connectionText,policyText,journalText])if(typeof value!=='string')throw Error('ARCHIVE_RPC_PRIVATE_INPUTS_REQUIRED');
 const settings=parseEnv(original),env=renderZeroArchiveRpcEnvironment(original);readConfig(settings);
 if(settings.TRADES_ZERO_START_PROFILE!==c.releaseId||settings.TRADES_CHAIN_ID!=='97')throw Error('ARCHIVE_RPC_CONNECTED_PROFILE_MISMATCH');
 const deploymentReport=JSON.parse(deploymentText),connectionReport=JSON.parse(connectionText),policy=validateDailyPolicy(JSON.parse(policyText)),state=JSON.parse(journalText);
 if(!isHourlyTestPolicy(policy))throw Error('ARCHIVE_RPC_EXISTING_HOURLY_POLICY_REQUIRED');
 requireState(state);
 const epoch=state.daily.epoch,periodStart=policy.startTimestamp+epoch*policy.periodSeconds;
 if(!Number.isSafeInteger(periodStart))throw Error('INVALID_DAILY_EPOCH');
 onPhase('TARGET_VERIFICATION');
 if(Number(await primary.send('eth_chainId',[]))!==97||Number(await candidate.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
 const options={artifact,deploymentReport,connectionReport,release:c,confirmations,proofProviders};
 const target=await verifyZeroStartTarget({...options,provider:primary,original,inspectSettlementLogs:false});
 requireIdentity(state,target,policy);
 const anchorBlock=Math.max(target.block,target.currentState.block-confirmations),anchor=await primary.getBlock(anchorBlock);
 const peer=await candidate.getBlock(anchorBlock);
 if(!anchor||!peer||anchor.number!==anchorBlock||peer.number!==anchorBlock||!hash(anchor.hash)||anchor.hash!==peer.hash||anchor.timestamp!==peer.timestamp)throw Error('ARCHIVE_RPC_CURRENT_CHAIN_DISAGREEMENT');
 onPhase('DAILY_READINESS');
 let readiness,readinessAttempts=0;
 for(let attempt=1;attempt<=zeroArchiveReadinessMaxAttempts;attempt++){
  readinessAttempts=attempt;
  await assertCurrent();
  if(attempt>1){
   const [primaryAnchor,candidateAnchor]=await Promise.all([primary.getBlock(anchorBlock),candidate.getBlock(anchorBlock)]);
   if(primaryAnchor?.hash!==anchor.hash||candidateAnchor?.hash!==anchor.hash)throw Error('ARCHIVE_RPC_CURRENT_CHECKPOINT_REORG');
  }
  try{
   readiness=await verifyZeroStartReadiness({...options,provider:candidate,original:env,policy,hourlyTest:true,periodStartTimestamp:periodStart});
  }catch(error){
   if(attempt===zeroArchiveReadinessMaxAttempts||!readinessRpcAvailability(error))throw error;
   await availabilityWait(attempt*250);continue;
  }
  for(const key of ['target','owner','operator','queue','hash','block','blockHash','artifactHash','initcodeHash','runtimeHash'])if(readiness[key]!==target[key])throw Error('ARCHIVE_RPC_CANDIDATE_IDENTITY_MISMATCH');
  if(readiness.ready&&readiness.archive?.fullyVerified===true&&readiness.archive.probes.some(probe=>probe.requestedTimestamp===periodStart&&probe.supported))break;
  if(attempt===zeroArchiveReadinessMaxAttempts||!archiveAvailabilityOnly(readiness))throw fullReadinessFailure(readiness,attempt);
  await availabilityWait(attempt*250);
 }
 await assertZeroStartJournalCanonical(candidate,state);
 const activation=await candidate.getBlock(state.activation.block);
 if(activation?.hash!==state.activation.blockHash||activation.timestamp!==policy.startTimestamp)throw Error('ARCHIVE_RPC_POLICY_CHECKPOINT_REORG');
 onPhase('DAILY_PERIOD_PLAN');
 const cursor=state.daily.registry;
 if(cursor&&(!Number.isSafeInteger(cursor.through)||cursor.through<target.block-1||(cursor.hash&&(await candidate.getBlock(cursor.through))?.hash!==cursor.hash)))throw Error('ARCHIVE_RPC_REGISTRY_CHECKPOINT_REORG');
 const snapshot=readiness.archive.probes.find(probe=>probe.requestedTimestamp===periodStart&&probe.supported);
 const logStart=target.block,logEnd=Math.min(logStart+499,snapshot.block);
 const logs=await candidate.getLogs({address:target.target,topics:[registry.getEvent('Registered').topicHash],fromBlock:logStart,toBlock:logEnd});
 for(const log of logs)if(log.removed||getAddress(log.address)!==target.target||log.blockNumber<logStart||log.blockNumber>logEnd||!registry.parseLog(log))throw Error('ARCHIVE_RPC_REGISTRATION_LOG_PROOF_INVALID');
 const vault=new Contract(target.target,artifact.abi,candidate),daily=structuredClone(state.daily);
 // One historical page proves event-query capability without writing a cursor
 // or choosing a different period to escape an unavailable principal snapshot.
 const plan=await planDailyEpoch({provider:candidate,vault,policy,state:daily,epoch,confirmations,maxRegistryPages:1,save:()=>{}});
 const period={epoch,startTimestamp:periodStart,periodSeconds:policy.periodSeconds,registryStatus:plan.status,registryThrough:daily.registry?.through??null,indexedMembers:Object.keys(daily.registry?.members||{}).length,historicalLogProbe:{fromBlock:logStart,toBlock:logEnd,count:logs.length}};
 const [primaryAgain,candidateAgain]=await Promise.all([primary.getBlock(anchorBlock),candidate.getBlock(anchorBlock)]);
 if(primaryAgain?.hash!==anchor.hash||candidateAgain?.hash!==anchor.hash)throw Error('ARCHIVE_RPC_CURRENT_CHECKPOINT_REORG');
 await assertCurrent();
 const readinessText=json(readiness);
 const stage={version:1,kind:'fresh-zero-archive-rpc-stage',chainId:97,releaseId:c.releaseId,target:target.target,owner:target.owner,operator:target.operator,queue:target.queue,hash:target.hash,runtimeHash:target.runtimeHash,artifactHash:target.artifactHash,initcodeHash:target.initcodeHash,candidateRpcUrl:zeroArchiveRpcUrl,originalEnvSha256:sha256(original),stagedEnvSha256:sha256(env),journalSha256:sha256(journalText),policySha256:sha256(policyText),deploymentSha256:sha256(deploymentText),connectionSha256:sha256(connectionText),readinessSha256:sha256(readinessText),anchor:{block:anchorBlock,blockHash:anchor.hash,timestamp:anchor.timestamp},period,readinessAttempts,ready:true,transactionsSent:0,signerOpened:false};
 return {env,stage,readiness,readinessText};
}

function readPrivate(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const s=fs.fstatSync(fd);
  if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0||s.size>16*1024*1024)throw Error('ARCHIVE_RPC_PRIVATE_FILE_REQUIRED');
  const bytes=fs.readFileSync(fd),text=bytes.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(bytes))throw Error('ARCHIVE_RPC_UTF8_FILES_REQUIRED');
  return text;
 }finally{fs.closeSync(fd);}
}
export function writeZeroArchiveRpcStage(directory,result){
 if(result?.stage?.kind!=='fresh-zero-archive-rpc-stage'||result.stage.ready!==true||result.stage.candidateRpcUrl!==zeroArchiveRpcUrl||sha256(result.env)!==result.stage.stagedEnvSha256||sha256(result.readinessText)!==result.stage.readinessSha256)throw Error('ARCHIVE_RPC_VERIFIED_STAGE_REQUIRED');
 const output=path.resolve(directory);
 try{fs.mkdirSync(output,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const s=fs.lstatSync(output);
 if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0||fs.readdirSync(output).length)throw Error('ARCHIVE_RPC_EMPTY_PRIVATE_OUTPUT_REQUIRED');
 for(const [name,value]of [['trades.env',result.env],['readiness.json',result.readinessText],['archive-rpc-stage.json',json(result.stage)]]){
  const fd=fs.openSync(path.join(output,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }
 const fd=fs.openSync(output,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}

async function main(){
 let primary,candidate,proofProviders=[],phase='ARGUMENT_VALIDATION';
 try{
  const {profile,args}=parseZeroStartProfileArgs();
  const [mode,output,...extra]=args;
  if(process.getuid?.()!==0||!profile.fast||extra.length||!['--check','--stage'].includes(mode)||(mode==='--check'&&output!==undefined)||(mode==='--stage'&&!output))throw Error('USAGE_ROOT_FAST_CHECK_OR_STAGE_PRIVATE_OUTPUT_REQUIRED');
  phase='LOCAL_CONFIGURATION';
  const paths={original:'/etc/globaldroptrade/trades.env',deploymentText:profile.stateDir+'/deployment-public.json',connectionText:profile.stateDir+'/connection-public.json',policyText:profile.automationDir+'/daily-policy.json',journalText:profile.automationDir+'/journal.json'};
  const inputs=Object.fromEntries(Object.entries(paths).map(([key,file])=>[key,readPrivate(file)]));
  const config=readConfig(parseEnv(inputs.original)),transport=new FetchRequest(config.rpcUrl);transport.timeout=15000;
  primary=new JsonRpcProvider(transport,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  const publicTransport=new FetchRequest(zeroArchiveRpcUrl);publicTransport.timeout=15000;
  candidate=new JsonRpcProvider(publicTransport,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  proofProviders=createZeroStartProofProviders();
  const result=await prepareZeroArchiveRpc({primary,candidate,artifact:JSON.parse(fs.readFileSync(profile.artifactUrl,'utf8')),release:profile.release,...inputs,confirmations:Math.max(3,config.confirmations),proofProviders,onPhase:value=>{phase=value;},assertCurrent:async()=>{for(const[key,file]of Object.entries(paths))if(readPrivate(file)!==inputs[key])throw Error('ARCHIVE_RPC_PRIVATE_INPUT_CHANGED');}});
  if(mode==='--stage')writeZeroArchiveRpcStage(output,result);
  console.log(mode==='--stage'?'ZERO_ARCHIVE_RPC_STAGED':'ZERO_ARCHIVE_RPC_CHECKED');console.log(JSON.stringify(result.stage));
 }catch(error){
  const blocker=/^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message||'')?error.message:'ARCHIVE_RPC_READ_ONLY_VERIFICATION_FAILED';
  const detail=error?.message==='ARCHIVE_RPC_FULL_READINESS_REQUIRED'&&error.archiveReadiness?{readinessSummary:zeroArchiveReadinessSummary(error.archiveReadiness),readinessAttempts:Number.isSafeInteger(error.readinessAttempts)&&error.readinessAttempts>=1&&error.readinessAttempts<=zeroArchiveReadinessMaxAttempts?error.readinessAttempts:null}:{};
  console.log('ZERO_ARCHIVE_RPC_PREPARATION_FAILED');console.log(JSON.stringify({version:1,kind:'fresh-zero-archive-rpc-stage-error',blocker,diagnostic:zeroStartWorkerDiagnostic(error,{phase}),...detail,transactionsSent:0,signerOpened:false}));process.exitCode=1;
 }finally{primary?.destroy();candidate?.destroy();for(const fallback of proofProviders)fallback.destroy();}
}
let invoked;
try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;}catch{}
if(import.meta.url===invoked)await main();
