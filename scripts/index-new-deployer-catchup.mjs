// Signer-free catch-up of verified history. Financial cursors are never changed.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {isNewDeployerTestnetPolicy,validateDailyPolicy} from './daily-profit.mjs';
import {isPositionPolicy,scanPositionHistory} from './position-profit.mjs';
import {writePrivateJson} from './migration-journal.mjs';
import {assertZeroStartJournalCanonical} from './zero-start-automation.mjs';
import {assertImmutableV1Archive,readImmutableV1Archive,readNewDeployerPrivateText} from './connect-new-deployer-testnet.mjs';
import {loadNewDeployerRelease,NEW_DEPLOYER_ARTIFACT_FILE,NEW_DEPLOYER_STATE_DIR} from './new-deployer-testnet-profile.mjs';
import {NEW_DEPLOYER_AUTOMATION_DIR,NEW_DEPLOYER_DAILY_POLICY_FILE,verifyNewDeployerAutomationReadiness} from './new-deployer-testnet-automation.mjs';

const expectedTarget='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{throw Error(code);};

export function assertNewDeployerIndexBinding({state,policy,target}){
 if(!isNewDeployerTestnetPolicy(policy)||!isPositionPolicy(policy)||policy.periodSeconds!==3600||policy.vaultAddress!==target.target||policy.runtimeHash!==target.runtimeHash||policy.deploymentBlock!==target.block||policy.owner!==target.owner||policy.operator!==target.operator)fail('INDEX_CATCHUP_POLICY_MISMATCH');
 const identity={version:1,chainId:97,target:target.target,owner:target.owner,operator:target.operator,queue:target.queue,hash:target.hash,runtimeHash:target.runtimeHash};
 if(!same(state?.identity,identity)||!state.daily||!state.transactions||typeof state.transactions!=='object'||Array.isArray(state.transactions))fail('INDEX_CATCHUP_JOURNAL_MISMATCH');
 if(state.pending||state.oracle?.pending||Object.values(state.transactions).some(entry=>!Number.isSafeInteger(entry?.block)||entry.block<1||!hash(entry.blockHash)||!hash(entry.hash)))fail('INDEX_CATCHUP_PENDING_RECONCILIATION_REQUIRED');
}

function financialState(state){
 const {registry,positionIndex,positionScanTarget,...daily}=state.daily;
 return JSON.stringify({...state,daily});
}

export async function catchUpNewDeployerIndex({provider,policy,state,save,guard=async()=>{},confirmations=3,maxPasses=50,milliseconds=180000,clock=Date.now,onProgress=()=>{}}){
 if(!isNewDeployerTestnetPolicy(policy)||!isPositionPolicy(policy)||!state.daily||typeof save!=='function'||!Number.isSafeInteger(confirmations)||confirmations<1||!Number.isSafeInteger(maxPasses)||maxPasses<1||maxPasses>50||!Number.isSafeInteger(milliseconds)||milliseconds<10000||milliseconds>180000)fail('INDEX_CATCHUP_LIMIT_REQUIRED');
 const start=clock(),beforeFinancial=financialState(state);
 await guard();
 const head=await provider.getBlockNumber();
 if(!Number.isSafeInteger(head)||head<0)fail('INDEX_CATCHUP_HEAD_REQUIRED');
 // A fixed initial goal makes completion meaningful without chasing a moving chain.
 // Existing partial targets must still finish and be verified before advancing.
 const goal=Math.max(0,head-confirmations);
 let passes=0,last='indexing';
 const checkedSave=()=>{
  if(financialState(state)!==beforeFinancial)fail('INDEX_CATCHUP_FINANCIAL_STATE_CHANGED');
  return save();
 };
 while(passes<maxPasses&&clock()-start<milliseconds-5000){
  await guard();
  for(const index of [state.daily.registry,state.daily.positionIndex]){
   if(index?.hash&&(!hash(index.hash)||(await provider.getBlock(index.through))?.hash!==index.hash))fail('INDEX_CATCHUP_PREFIX_REORG');
  }
  const oldMember=state.daily.registry?.through??policy.deploymentBlock-1;
  const oldPosition=state.daily.positionIndex?.through??policy.deploymentBlock-1;
  const result=await scanPositionHistory({
   provider,policy,state:state.daily,save:checkedSave,confirmations,
   maxRegistryPages:4,pageSize:1000,logBlockSpan:1000,advanceCompletedTarget:true,
   milliseconds:Math.min(90000,milliseconds-(clock()-start)),reserveMilliseconds:5000
  });
  passes++;last=result.status;
  onProgress({passes,memberThrough:state.daily.registry?.through??null,indexThrough:state.daily.positionIndex?.through??null,indexTarget:state.daily.positionScanTarget?.number??null});
  if(last==='indexed'&&(state.daily.positionIndex?.through??-1)>=goal)break;
  if(last==='indexed'){last='indexing';continue;}
  if((state.daily.registry?.through??policy.deploymentBlock-1)===oldMember&&(state.daily.positionIndex?.through??policy.deploymentBlock-1)===oldPosition)break;
 }
 if(financialState(state)!==beforeFinancial)fail('INDEX_CATCHUP_FINANCIAL_STATE_CHANGED');
 await guard();
 return {version:1,chainId:97,target:policy.vaultAddress,status:last,passes,memberThrough:state.daily.registry?.through??null,indexThrough:state.daily.positionIndex?.through??null,indexTarget:state.daily.positionScanTarget?.number??null,initialConfirmedHead:goal,positions:Object.keys(state.daily.positionIndex?.positions||{}).length,transactionsSent:0,signerOpened:false};
}

export async function acquireCatchupLock(directory,{pid=process.pid,expectedUid=0,waitMilliseconds=120000,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),clock=Date.now,onWait=()=>{}}={}){
 const meta=fs.lstatSync(directory);
 if(!meta.isDirectory()||meta.uid!==expectedUid||(meta.mode&0o077)!==0)fail('INDEX_CATCHUP_PRIVATE_DIRECTORY_REQUIRED');
 const file=path.join(directory,'run.lock'),start=clock();let notified=false;
 for(;;){
  let fd;
  try{
   fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
   fs.writeFileSync(fd,String(pid));fs.fsyncSync(fd);return {file,pid,expectedUid};
  }catch(error){
   if(error.code!=='EEXIST')throw error;
   let read;
   try{read=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}
   catch(error){if(error.code==='ENOENT')continue;throw error;}
   let holder;
   try{
    const stat=fs.fstatSync(read);if(!stat.isFile()||stat.uid!==expectedUid||(stat.mode&0o077)!==0||stat.nlink!==1||stat.size>20)fail('INDEX_CATCHUP_LOCK_REVIEW_REQUIRED');
    const raw=fs.readFileSync(read,'utf8');if(!/^[1-9][0-9]*$/.test(raw))fail('INDEX_CATCHUP_LOCK_REVIEW_REQUIRED');holder=Number(raw);
   }finally{fs.closeSync(read);}
   if(!Number.isSafeInteger(holder))fail('INDEX_CATCHUP_LOCK_REVIEW_REQUIRED');
   try{process.kill(holder,0);}catch(error){if(error.code==='ESRCH')fail('INDEX_CATCHUP_STALE_LOCK_REVIEW_REQUIRED');throw error;}
   if(clock()-start>=waitMilliseconds)fail('INDEX_CATCHUP_WORKER_BUSY');
   if(!notified){onWait();notified=true;}
   await pause(1000);
  }finally{if(fd!==undefined)fs.closeSync(fd);}
 }
}

export function releaseCatchupLock(lock){
 if(!lock)return;
 const fd=fs.openSync(lock.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd),current=fs.lstatSync(lock.file);
  if(!stat.isFile()||stat.uid!==lock.expectedUid||(stat.mode&0o077)!==0||stat.nlink!==1||stat.dev!==current.dev||stat.ino!==current.ino||fs.readFileSync(fd,'utf8')!==String(lock.pid))fail('INDEX_CATCHUP_LOCK_CHANGED');
  fs.unlinkSync(lock.file);
 }finally{fs.closeSync(fd);}
}

async function main(){
 let provider,lock;
 try{
  if(process.getuid?.()!==0||process.argv.length!==3||process.argv[2]!=='--execute')fail('INDEX_CATCHUP_EXPLICIT_EXECUTE_REQUIRED');
  lock=await acquireCatchupLock(NEW_DEPLOYER_AUTOMATION_DIR,{onWait:()=>console.log('INDEX_CATCHUP_WAITING_FOR_WORKER')});
  const envFile='/etc/globaldroptrade/trades.env',journalFile=NEW_DEPLOYER_AUTOMATION_DIR+'/journal.json';
  const original=readNewDeployerPrivateText(envFile),config=readConfig(parseEnv(original));
  const policyText=readNewDeployerPrivateText(NEW_DEPLOYER_DAILY_POLICY_FILE),policy=validateDailyPolicy(JSON.parse(policyText));
  const deploymentFile=NEW_DEPLOYER_STATE_DIR+'/deployment-public.json',connectionFile=NEW_DEPLOYER_STATE_DIR+'/connection-public.json';
  const deploymentText=readNewDeployerPrivateText(deploymentFile),connectionText=readNewDeployerPrivateText(connectionFile);
  const release=loadNewDeployerRelease(),artifact=JSON.parse(fs.readFileSync(NEW_DEPLOYER_ARTIFACT_FILE,'utf8')),archive=readImmutableV1Archive();
  const request=new FetchRequest(config.rpcUrl);request.timeout=15000;
  provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  const readiness=()=>verifyNewDeployerAutomationReadiness({provider,artifact,release,deploymentReport:JSON.parse(deploymentText),connectionReport:JSON.parse(connectionText),archive,original,confirmations:Math.max(3,config.confirmations)});
  const target=await readiness();if(target.target!==expectedTarget)fail('INDEX_CATCHUP_TARGET_MISMATCH');
  let journalText=readNewDeployerPrivateText(journalFile);
  const state=JSON.parse(journalText);assertNewDeployerIndexBinding({state,policy,target});await assertZeroStartJournalCanonical(provider,state);
  const unchanged=()=>{
   for(const [file,text] of [[envFile,original],[NEW_DEPLOYER_DAILY_POLICY_FILE,policyText],[deploymentFile,deploymentText],[connectionFile,connectionText],[journalFile,journalText]])if(readNewDeployerPrivateText(file)!==text)fail('INDEX_CATCHUP_INPUT_CHANGED');
   assertImmutableV1Archive(archive);
  };
  const guard=async()=>{unchanged();assertNewDeployerIndexBinding({state,policy,target});if(Number(await provider.send('eth_chainId',[]))!==97)fail('INDEX_CATCHUP_TESTNET_REQUIRED');};
  const save=()=>{unchanged();writePrivateJson(journalFile,state);journalText=readNewDeployerPrivateText(journalFile);};
  const result=await catchUpNewDeployerIndex({provider,policy,state,save,guard,confirmations:Math.max(3,config.confirmations),onProgress:progress=>console.log('INDEX_CATCHUP_PROGRESS '+JSON.stringify(progress))});
  await readiness();
  writePrivateJson(NEW_DEPLOYER_AUTOMATION_DIR+'/index-catchup-status.json',{...result,checkedAt:new Date().toISOString()});
  console.log('NEW_DEPLOYER_INDEX_CATCHUP '+JSON.stringify(result));
 }catch(error){console.error('INDEX_CATCHUP_STOPPED '+(/^[A-Z][A-Z0-9_]+$/.test(error?.message||'')?error.message:'RPC_OR_STATE_REVIEW_REQUIRED'));process.exitCode=1;}
 finally{
  try{releaseCatchupLock(lock);}catch{console.error('INDEX_CATCHUP_LOCK_CLEANUP_REVIEW_REQUIRED');process.exitCode=1;}
  provider?.destroy();
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
