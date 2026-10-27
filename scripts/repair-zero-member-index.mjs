// Rebuild a verified registration cache without changing an unpaid period.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual,parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Contract,FetchRequest,JsonRpcProvider,ZeroAddress,getAddress,keccak256,toUtf8Bytes} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {parseZeroStartProfileArgs} from './zero-start-profile.mjs';
import {createZeroStartProofProviders} from './connect-zero-start.mjs';
import {prepareZeroArchiveRpc,zeroArchiveReadinessSummary} from './prepare-zero-archive-rpc.mjs';
import {readZeroArchiveCandidate} from './zero-archive-candidate.mjs';
import {blockAtTime,indexMembers,planDailyEpoch,validateDailyPolicy,isHourlyTestPolicy,sanitizeDailyMemberIndexDiagnostic} from './daily-profit.mjs';
import {sanitizeCompleteLogDiagnostic,isCompleteLogTransportTimeout,installHistoricalCallRetry} from './complete-rpc-logs.mjs';
import {zeroStartWorkerDiagnostic} from './zero-start-automation.mjs';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const inputNames=['original','deploymentText','connectionText','policyText','journalText'];
const repairPhases=new Set(['ORIGINAL_PERIOD_PROOF','MEMBER_INDEX_REBUILD_SNAPSHOT','MEMBER_INDEX_REBUILD','MEMBER_INDEX_REBUILT_PERIOD_PROOF','MEMBER_INDEX_REPAIR_COMMIT']);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const blockDiagnostic=value=>({operation:'getBlock',blockNumber:integer(value?.blockNumber)?value.blockNumber:null,attempts:Number.isSafeInteger(value?.attempts)&&value.attempts>=1&&value.attempts<=3?value.attempts:null,errorCode:value?.errorCode==='TIMEOUT'?'TIMEOUT':null,rpcCode:null,httpStatus:null,reason:value?.reason==='TIMEOUT'?'TIMEOUT':'UNKNOWN'});

function validateProgress(progress,binding,policy){
 if(!progress||progress.version!==1||progress.kind!=='fresh-zero-member-index-rebuild'||!isDeepStrictEqual(progress.binding,binding))throw Error('MEMBER_INDEX_REBUILD_BINDING_MISMATCH');
 const registry=progress.registry;
 if(!registry||!integer(registry.through)||registry.through<policy.deploymentBlock-1||registry.through>binding.snapshot.block||!registry.members||typeof registry.members!=='object'||Array.isArray(registry.members))throw Error('MEMBER_INDEX_REBUILD_PROGRESS_INVALID');
 if(registry.through===policy.deploymentBlock-1?registry.hash!==null:!hash(registry.hash))throw Error('MEMBER_INDEX_REBUILD_PROGRESS_INVALID');
 for(const [member,block]of Object.entries(registry.members)){
  let canonical;try{canonical=getAddress(member);}catch{}
  if(canonical!==member||!integer(block)||block<policy.deploymentBlock||block>registry.through)throw Error('MEMBER_INDEX_REBUILD_PROGRESS_INVALID');
 }
 return progress;
}

// The injected persistence functions let tests verify every write boundary.
// Only commitJournal may replace the financial journal; progress is auxiliary.
export async function repairZeroMemberIndex(options){
 const {loadProgress,saveProgress,commitJournal,maxPages=100,maxMilliseconds=240000,now=Date.now,assertCurrent=async()=>{},onPhase=()=>{},waitForBlockRetry=wait}=options;
 if(typeof loadProgress!=='function'||typeof saveProgress!=='function'||typeof commitJournal!=='function'||typeof now!=='function'||typeof waitForBlockRetry!=='function'||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>100||!Number.isSafeInteger(maxMilliseconds)||maxMilliseconds<1||maxMilliseconds>240000)throw Error('MEMBER_INDEX_REPAIR_PERSISTENCE_REQUIRED');
 let phase='ORIGINAL_PERIOD_PROOF',mismatch=false,mismatchDiagnostic;
 const during=value=>{phase=value;onPhase(value);};
 const proofOptions={...options,assertCurrent,onPhase:during};
 try{
  await prepareZeroArchiveRpc(proofOptions);
  return {version:1,kind:'fresh-zero-member-index-repair',status:'not-required',transactionsSent:0,signerOpened:false};
 }catch(error){
  if(error?.message!=='INCOMPLETE_DAILY_MEMBER_INDEX'||phase!=='DAILY_PERIOD_PLAN')throw error;
  mismatch=true;mismatchDiagnostic=sanitizeDailyMemberIndexDiagnostic(error.memberIndexDiagnostic);
 }
 if(!mismatch)throw Error('MEMBER_INDEX_REPAIR_MISMATCH_REQUIRED');
 const policy=validateDailyPolicy(JSON.parse(options.policyText)),originalState=JSON.parse(options.journalText),epoch=originalState.daily.epoch;
 if(originalState.daily.lastCredit?.epoch===epoch&&Array.isArray(originalState.daily.lastCredit.credited)&&originalState.daily.lastCredit.credited.length)throw Error('MEMBER_INDEX_REPAIR_REQUIRES_BATCH_RECONCILIATION');
 const blockTimeouts=new WeakSet();let exhaustedBlock;
 const getBlock=async(...args)=>{
  if(!integer(args[0]))return options.candidate.getBlock(...args);
  for(let attempt=1;attempt<=3;attempt++){
   try{const block=await options.candidate.getBlock(...args);if(!block||block.number!==args[0]||!hash(block.hash)||!integer(block.timestamp))throw Error('MEMBER_INDEX_BLOCK_HEADER_INVALID');return block;}
   catch(error){
    if(!isCompleteLogTransportTimeout(error))throw error;
    if(attempt<3){await waitForBlockRetry(attempt===1?500:1500);continue;}
    exhaustedBlock=blockDiagnostic({blockNumber:args[0],attempts:attempt,errorCode:'TIMEOUT',reason:'TIMEOUT'});
    const failure=Error('MEMBER_INDEX_BLOCK_RPC_TIMEOUT');failure.code='TIMEOUT';failure.blockReadDiagnostic=exhaustedBlock;blockTimeouts.add(failure);throw failure;
   }
  }
 };
 const candidate=new Proxy(options.candidate,{get(target,key){if(key==='getBlock')return getBlock;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}),vault=new Contract(policy.vaultAddress,options.artifact.abi,candidate),confirmations=options.confirmations??3;
 during('MEMBER_INDEX_REBUILD_SNAPSHOT');
 await assertCurrent();
 const head=await candidate.getBlockNumber(),final=await candidate.getBlock(Math.max(0,head-confirmations)),start=policy.startTimestamp+epoch*policy.periodSeconds;
 if(!integer(start)||!final||final.timestamp<start+policy.periodSeconds)throw Error('MEMBER_INDEX_REPAIR_UNPAID_PERIOD_REQUIRED');
 const snapshot=await blockAtTime(candidate,start,policy.deploymentBlock,final.number);
 if(!integer(snapshot?.number)||!hash(snapshot.hash))throw Error('MEMBER_INDEX_REBUILD_SNAPSHOT_INVALID');
 if(mismatchDiagnostic.epoch!==epoch||mismatchDiagnostic.snapshot.block!==snapshot.number||mismatchDiagnostic.snapshot.hash!==snapshot.hash||mismatchDiagnostic.snapshot.timestamp!==snapshot.timestamp)throw Error('MEMBER_INDEX_REBUILD_SNAPSHOT_REORG');
 const selected=options.candidateProof??readZeroArchiveCandidate().proof;
 const binding={chainId:97,target:policy.vaultAddress,runtimeHash:policy.runtimeHash,epoch,inputs:Object.fromEntries(inputNames.map(name=>[name,sha256(options[name])])),candidate:structuredClone(selected),snapshot:{block:snapshot.number,hash:snapshot.hash,timestamp:snapshot.timestamp}};
 let progress=await loadProgress();
 if(progress===null||progress===undefined)progress={version:1,kind:'fresh-zero-member-index-rebuild',binding,registry:{through:policy.deploymentBlock-1,hash:null,members:{}}};
 progress=structuredClone(validateProgress(progress,binding,policy));
 const canonical=async(registry=progress.registry)=>{
  await assertCurrent();
  const block=await candidate.getBlock(snapshot.number);
  if(block?.hash!==snapshot.hash||block.timestamp!==snapshot.timestamp)throw Error('MEMBER_INDEX_REBUILD_SNAPSHOT_REORG');
  if(registry.hash&&(await candidate.getBlock(registry.through))?.hash!==registry.hash)throw Error('MEMBER_INDEX_REBUILD_CHECKPOINT_REORG');
 };
 let pages=0;
 const progressReport=()=>({version:1,kind:'fresh-zero-member-index-repair',chainId:97,target:policy.vaultAddress,epoch,snapshot:binding.snapshot,through:progress.registry.through,members:Object.keys(progress.registry.members).length,pages,transactionsSent:0,signerOpened:false});
 try{
 await canonical();
 during('MEMBER_INDEX_REBUILD');
 const began=now();
 while(progress.registry.through<snapshot.number&&pages<maxPages&&now()-began<maxMilliseconds){
  await canonical();
  const daily={registry:structuredClone(progress.registry)},previous=daily.registry;let saved=false;
  try{await indexMembers({provider:candidate,policy,state:daily,through:snapshot.number,maxPages:1,pageSize:500,logOptions:{maxTimeoutRetries:2,maxConcurrency:2},save:()=>{saved=true;}});}
  catch(error){
   if(daily.registry!==previous||saved)throw Error('MEMBER_INDEX_REBUILD_CHECKPOINT_REORG');
   const raw=error?.logProbeDiagnostic,diagnostic=sanitizeCompleteLogDiagnostic(raw),fromBlock=progress.registry.through+1,toBlock=Math.min(fromBlock+499,snapshot.number);
   const typedTimeout=error?.message==='COMPLETE_LOG_QUERY_FAILED'&&error.code==='TIMEOUT'&&raw?.operation==='eth_getLogs'&&raw.reason==='TIMEOUT'&&raw.errorCode==='TIMEOUT'&&raw.rpcCode===null&&raw.httpStatus===null&&integer(raw.fromBlock)&&integer(raw.toBlock)&&raw.fromBlock>=fromBlock&&raw.toBlock>=raw.fromBlock&&raw.toBlock<=toBlock&&Number.isSafeInteger(raw.requests)&&raw.requests>=1&&raw.requests<=1024&&daily.registry===previous&&!saved;
   if(!typedTimeout)throw error;
   await assertCurrent();
   return {...progressReport(),status:'in-progress',waitingFor:'RPC_TIMEOUT',logProbeDiagnostic:diagnostic};
  }
  if(!saved||daily.registry!==previous||daily.registry.through<=progress.registry.through)throw Error('MEMBER_INDEX_REBUILD_CHECKPOINT_REORG');
  const next={...progress,registry:daily.registry};
  validateProgress(next,binding,policy);
  await canonical(next.registry);
  await saveProgress(structuredClone(next));progress=next;pages++;
 }
 const report=progressReport();
 if(progress.registry.through<snapshot.number)return {...report,status:'in-progress'};
 during('MEMBER_INDEX_REBUILT_PERIOD_PROOF');
 await canonical();
 const replacement=structuredClone(originalState);replacement.daily.registry=structuredClone(progress.registry);
 const withoutRegistry=value=>{const copy=structuredClone(value);delete copy.daily.registry;return copy;};
 if(!isDeepStrictEqual(withoutRegistry(originalState),withoutRegistry(replacement)))throw Error('MEMBER_INDEX_REPAIR_JOURNAL_PRESERVATION_FAILED');
 const plan=await planDailyEpoch({provider:candidate,vault,policy,state:structuredClone(replacement.daily),epoch,confirmations,maxRegistryPages:1,save:()=>{throw Error('MEMBER_INDEX_REPAIR_COMPLETE_REGISTRY_REQUIRED');}});
 if(plan.status!=='ready'||plan.epoch!==epoch||plan.snapshotBlock!==snapshot.number||plan.snapshotHash!==snapshot.hash)throw Error('MEMBER_INDEX_REPAIR_SAME_PERIOD_PROOF_REQUIRED');
 const ids=new Set(plan.batches.map(batch=>batch.id)),memberCount=Math.max(Object.keys(originalState.daily.registry?.members||{}).length,Object.keys(progress.registry.members).length),offsets=Math.max(1,Math.ceil(memberCount/100));
 const assets=[ZeroAddress,await vault.usdt({blockTag:snapshot.number})],domains=isHourlyTestPolicy(policy)?['GLOBAL_HOURLY_TEST_V1','GLOBAL_HOURLY_TEST_REFERRAL_V1']:['GLOBAL_DAILY_V1','GLOBAL_DAILY_REFERRAL_V1'];
 for(const asset of assets)for(const domain of domains)for(let offset=0;offset<offsets;offset++)ids.add(keccak256(toUtf8Bytes([domain,policy.chainId,policy.vaultAddress.toLowerCase(),policy.startTimestamp,epoch,asset.toLowerCase(),offset].join(':'))));
 const assertUnusedBatches=async()=>{for(const id of ids)if(await vault.usedRewardBatch(id)!==false)throw Error('MEMBER_INDEX_REPAIR_REQUIRES_BATCH_RECONCILIATION');};
 await assertUnusedBatches();
 const replacementText=json(replacement);
 const verified=await prepareZeroArchiveRpc({...proofOptions,journalText:replacementText});
 if(verified.stage.period.epoch!==epoch||verified.stage.period.startTimestamp!==start||verified.stage.period.registryStatus!=='ready'||verified.stage.period.registryThrough!==snapshot.number)throw Error('MEMBER_INDEX_REPAIR_SAME_PERIOD_PROOF_REQUIRED');
 await canonical();
 await assertUnusedBatches();
 during('MEMBER_INDEX_REPAIR_COMMIT');
 await commitJournal(replacementText);
 return {...report,status:'repaired',originalJournalSha256:sha256(options.journalText),journalSha256:sha256(replacementText)};
 }catch(error){
  const diagnostic=error?.logProbeDiagnostic;
  const wrappedBlockTimeout=exhaustedBlock&&error?.message==='COMPLETE_LOG_CANONICAL_READ_FAILED'&&isCompleteLogTransportTimeout(error)&&diagnostic?.operation==='getBlock'&&diagnostic.reason==='TIMEOUT'&&diagnostic.errorCode==='TIMEOUT'&&diagnostic.rpcCode===null&&diagnostic.httpStatus===null&&integer(diagnostic.fromBlock)&&integer(diagnostic.toBlock)&&exhaustedBlock.blockNumber>=diagnostic.fromBlock&&exhaustedBlock.blockNumber<=diagnostic.toBlock;
  if(!blockTimeouts.has(error)&&!wrappedBlockTimeout)throw error;
  await assertCurrent();
  return {...progressReport(),status:'in-progress',waitingFor:'RPC_TIMEOUT',blockReadDiagnostic:blockDiagnostic(exhaustedBlock)};
 }
}

export function assertZeroMemberIndexRunLock(file,fd=6){
 try{
  if(fd!==6)throw Error();
  const directory=fs.lstatSync(path.dirname(file));
  if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==0||(directory.mode&0o777)!==0o700)throw Error();
  const selected=fs.lstatSync(file),held=fs.fstatSync(fd);
  if(!selected.isFile()||selected.isSymbolicLink()||selected.uid!==0||(selected.mode&0o077)!==0||!held.isFile()||selected.dev!==held.dev||selected.ino!==held.ino)throw Error();
  execFileSync('flock',['-n','6'],{stdio:['ignore','ignore','ignore','ignore','ignore','ignore',fd]});
 }catch{throw Error('MEMBER_INDEX_REPAIR_HELD_RUN_LOCK_REQUIRED');}
}

function readPrivate(file,optional=false){
 let fd;
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}catch(error){if(optional&&error.code==='ENOENT')return null;throw Error('MEMBER_INDEX_REPAIR_PRIVATE_INPUT_REQUIRED');}
 try{
  const s=fs.fstatSync(fd);
  if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0||s.size>16*1024*1024)throw Error('MEMBER_INDEX_REPAIR_PRIVATE_INPUT_REQUIRED');
  const bytes=fs.readFileSync(fd),text=bytes.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(bytes))throw Error('MEMBER_INDEX_REPAIR_UTF8_REQUIRED');
  return text;
 }finally{fs.closeSync(fd);}
}

function syncDirectory(directory){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function writeExclusive(file,text){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function atomicPrivate(file,text){
 const temp=file+'.'+randomUUID()+'.tmp';
 try{writeExclusive(temp,text);fs.renameSync(temp,file);syncDirectory(path.dirname(file));}finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
}

async function main(){
 let primary,candidate,proofProviders=[],phase='ARGUMENT_VALIDATION';
 try{
  const {profile,args}=parseZeroStartProfileArgs();let candidateFile,held,execute=false;
  for(let i=0;i<args.length;i++){
   if(args[i]==='--execute'&&!execute){execute=true;continue;}
   if(args[i]==='--candidate-file'&&candidateFile===undefined&&args[i+1]&&path.isAbsolute(args[i+1])){candidateFile=args[++i];continue;}
   if(args[i]==='--held-run-lock'&&held===undefined&&args[i+1]==='6'){held=6;i++;continue;}
   throw Error('USAGE_ROOT_FAST_MEMBER_INDEX_REPAIR_HELD_LOCK_REQUIRED');
  }
  if(process.getuid?.()!==0||!profile.fast||!execute||held!==6)throw Error('USAGE_ROOT_FAST_MEMBER_INDEX_REPAIR_HELD_LOCK_REQUIRED');
  const lockFile=profile.automationDir+'/run.lock';assertZeroMemberIndexRunLock(lockFile,held);
  phase='LOCAL_CONFIGURATION';
  const selected=readZeroArchiveCandidate(candidateFile),paths={original:'/etc/globaldroptrade/trades.env',deploymentText:profile.stateDir+'/deployment-public.json',connectionText:profile.stateDir+'/connection-public.json',policyText:profile.automationDir+'/daily-policy.json',journalText:profile.automationDir+'/journal.json'};
  const inputs=Object.fromEntries(Object.entries(paths).map(([key,file])=>[key,readPrivate(file)])),config=readConfig(parseEnv(inputs.original));
  const assertCurrent=async()=>{assertZeroMemberIndexRunLock(lockFile,held);selected.assertCurrent();for(const[key,file]of Object.entries(paths))if(readPrivate(file)!==inputs[key])throw Error('MEMBER_INDEX_REPAIR_PRIVATE_INPUT_CHANGED');};
  const transport=url=>{const request=new FetchRequest(url);request.timeout=15000;return installHistoricalCallRetry(new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1}));};
  primary=transport(config.rpcUrl);candidate=transport(selected.url);proofProviders=createZeroStartProofProviders();
  const progressFile=profile.automationDir+'/member-index-rebuild.json';
  let progressReports=0;
  const result=await repairZeroMemberIndex({...inputs,primary,candidate,proofProviders,artifact:JSON.parse(fs.readFileSync(profile.artifactUrl,'utf8')),release:profile.release,confirmations:Math.max(3,config.confirmations),candidateUrl:selected.url,candidateProof:selected.proof,assertCurrent,onPhase:value=>{phase=value;},loadProgress:async()=>{const text=readPrivate(progressFile,true);return text===null?null:JSON.parse(text);},saveProgress:async value=>{await assertCurrent();atomicPrivate(progressFile,json(value));progressReports++;if(progressReports===1||progressReports%5===0)console.log('ZERO_MEMBER_INDEX_REBUILD_PROGRESS '+JSON.stringify({through:value.registry.through,snapshotBlock:value.binding.snapshot.block,members:Object.keys(value.registry.members).length,transactionsSent:0,signerOpened:false}));},commitJournal:async text=>{
   await assertCurrent();
   const old=JSON.parse(inputs.journalText),replacement=JSON.parse(text);delete old.daily.registry;delete replacement.daily.registry;
   if(!isDeepStrictEqual(old,replacement))throw Error('MEMBER_INDEX_REPAIR_JOURNAL_PRESERVATION_FAILED');
   const backup=profile.automationDir+'/journal.member-index-before-'+sha256(inputs.journalText)+'.json',existing=readPrivate(backup,true);
   if(existing!==null&&existing!==inputs.journalText)throw Error('MEMBER_INDEX_REPAIR_BACKUP_MISMATCH');
   if(existing===null){writeExclusive(backup,inputs.journalText);syncDirectory(profile.automationDir);}
   await assertCurrent();atomicPrivate(paths.journalText,text);
  }});
  console.log(result.waitingFor==='RPC_TIMEOUT'?'ZERO_MEMBER_INDEX_REBUILD_WAITING':result.status==='in-progress'?'ZERO_MEMBER_INDEX_REBUILD_IN_PROGRESS':result.status==='repaired'?'ZERO_MEMBER_INDEX_REPAIRED':'ZERO_MEMBER_INDEX_REPAIR_NOT_REQUIRED');console.log(JSON.stringify(result));if(result.status==='in-progress')process.exitCode=result.waitingFor==='RPC_TIMEOUT'?76:75;
 }catch(error){
  const blocker=/^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message||'')?error.message:'MEMBER_INDEX_REPAIR_FAILED';
  const detail={...(error?.archiveReadiness?{readinessSummary:zeroArchiveReadinessSummary(error.archiveReadiness)}:{}),...(error?.memberIndexDiagnostic?{memberIndexDiagnostic:sanitizeDailyMemberIndexDiagnostic(error.memberIndexDiagnostic)}:{}),...(error?.blockReadDiagnostic?{blockReadDiagnostic:blockDiagnostic(error.blockReadDiagnostic)}:{})};
  const diagnostic=zeroStartWorkerDiagnostic(error,{phase});if(repairPhases.has(phase))diagnostic.phase=phase;
  console.log('ZERO_MEMBER_INDEX_REPAIR_FAILED');console.log(JSON.stringify({version:1,kind:'fresh-zero-member-index-repair-error',blocker,diagnostic,...detail,...(error?.logProbeDiagnostic?{logProbeDiagnostic:sanitizeCompleteLogDiagnostic(error.logProbeDiagnostic)}:{}),transactionsSent:0,signerOpened:false}));process.exitCode=1;
 }finally{primary?.destroy();candidate?.destroy();for(const provider of proofProviders)provider.destroy();}
}
let invoked;try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;}catch{}
if(import.meta.url===invoked)await main();
