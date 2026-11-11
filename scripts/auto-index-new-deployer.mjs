// Speculative read-only scan; the shared worker lock is held only for a
// bounded, revalidated compare-and-swap of index fields. Never opens a signer.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {FetchRequest,JsonRpcProvider,keccak256} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {validateDailyPolicy} from './daily-profit.mjs';
import {writePrivateJson} from './migration-journal.mjs';
import {assertZeroStartJournalCanonical} from './zero-start-automation.mjs';
import {assertImmutableV1Archive,readImmutableV1Archive,readNewDeployerPrivateText} from './connect-new-deployer-testnet.mjs';
import {loadNewDeployerRelease,NEW_DEPLOYER_ARTIFACT_FILE,NEW_DEPLOYER_STATE_DIR} from './new-deployer-testnet-profile.mjs';
import {NEW_DEPLOYER_AUTOMATION_DIR,NEW_DEPLOYER_DAILY_POLICY_FILE,verifyNewDeployerAutomationReadiness} from './new-deployer-testnet-automation.mjs';
import {assertNewDeployerIndexBinding,catchUpNewDeployerIndex,acquireCatchupLock,releaseCatchupLock} from './index-new-deployer-catchup.mjs';

const fields=['registry','positionIndex','positionScanTarget'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const selected=state=>Object.fromEntries(fields.map(key=>[key,state.daily?.[key]]));
const financial=state=>{const {registry,positionIndex,positionScanTarget,...daily}=state.daily;return {...state,daily};};
function assertIndexProgress(before,after){
 const target=before.daily.positionScanTarget?.number;
 if(!Number.isSafeInteger(target)||target<0)throw Error('INDEX_AUTO_TARGET_INVALID');
 for(const [key,items] of [['registry','members'],['positionIndex','positions']]){
  const old=before.daily[key],next=after.daily[key];
  if(!old&&!next)continue;
  if(!next||!Number.isSafeInteger(next.through)||next.through<0||next.through>target||
     (old&&(!Number.isSafeInteger(old.through)||next.through<old.through))||
     !next[items]||typeof next[items]!=='object'||Array.isArray(next[items]))throw Error('INDEX_AUTO_PREFIX_REGRESSION');
  for(const [id,value] of Object.entries(old?.[items]||{}))if(!Object.hasOwn(next[items],id)||!same(next[items][id],value))throw Error('INDEX_AUTO_PREFIX_REGRESSION');
 }
}

export function pendingFixedTarget(state){
 const daily=state?.daily,target=daily?.positionScanTarget;
 if(!target)return false; // the worker creates the next target itself
 if(!Number.isSafeInteger(target.number)||target.number<0||!/^0x[0-9a-f]{64}$/i.test(target.hash||''))throw Error('INDEX_AUTO_TARGET_INVALID');
 const m=daily.registry?.through,p=daily.positionIndex?.through;
 if(m!==undefined&&(!Number.isSafeInteger(m)||m<0||m>target.number)||p!==undefined&&(!Number.isSafeInteger(p)||p<0||p>target.number))throw Error('INDEX_AUTO_PREFIX_INVALID');
 return m!==target.number||p!==target.number;
}

export async function verifyIndexCommit({candidate,policy,target,provider,confirmations,canonical=assertZeroStartJournalCanonical}){
 assertNewDeployerIndexBinding({state:candidate,policy,target});
 const items=[candidate.daily.positionScanTarget,candidate.daily.registry,candidate.daily.positionIndex].filter(Boolean);
 if(!items.length||!candidate.daily.positionScanTarget)throw Error('INDEX_AUTO_PREFIX_REQUIRED');
 const [chain,head,runtime,blocks]=await Promise.all([
  provider.send('eth_chainId',[]),provider.getBlockNumber(),provider.getCode(target.target),
  Promise.all(items.map(item=>provider.getBlock(item.number??item.through))),
  canonical(provider,candidate)
 ]);
 if(Number(chain)!==97||runtime==='0x'||keccak256(runtime)!==target.runtimeHash)throw Error('INDEX_AUTO_IDENTITY_CHANGED');
 if(head<candidate.daily.positionScanTarget.number+confirmations)throw Error('INDEX_AUTO_CONFIRMATIONS_REQUIRED');
 if(items.some((item,i)=>!blocks[i]||blocks[i].hash!==item.hash))throw Error('INDEX_AUTO_PREFIX_REORG');
}

export function installSignalCleanup({getLock,release,exit=code=>process.exit(code),emitter=process}){
 const stop=()=>{try{const lock=getLock();if(lock)release(lock);}finally{exit(143);}};
 emitter.once('SIGTERM',stop);emitter.once('SIGINT',stop);
 return ()=>{emitter.removeListener('SIGTERM',stop);emitter.removeListener('SIGINT',stop);};
}

// verify is read-only and bounded. If it times out, no mutation may occur,
// even if its RPC promises later resolve. A busy worker is never interrupted.
export async function optimisticIndexCommit({beforeText,proposedState,readJournal,writeJournal,acquire,release,verify,guardSync=()=>{},deadlineMs=5000}){
 const before=JSON.parse(beforeText);
 if(!before.daily||!proposedState?.daily||!same(before.daily.positionScanTarget,proposedState.daily.positionScanTarget))throw Error('INDEX_AUTO_TARGET_CHANGED');
 if(!same(financial(before),financial(proposedState)))throw Error('INDEX_AUTO_FINANCIAL_STATE_CHANGED');
 assertIndexProgress(before,proposedState);
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>5000)throw Error('INDEX_AUTO_VERIFY_DEADLINE_REQUIRED');
 if(same(selected(before),selected(proposedState)))return 'no_progress';
 let lock,timer;
 try{
  try{lock=await acquire();}catch(error){if(error?.message==='INDEX_CATCHUP_WORKER_BUSY')return 'busy';throw error;}
  if(readJournal()!==beforeText)return 'changed';
  guardSync();
  await Promise.race([
   Promise.resolve().then(()=>verify(proposedState)),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('INDEX_AUTO_VERIFY_TIMEOUT')),deadlineMs);})
  ]);
  if(readJournal()!==beforeText)return 'changed';
  guardSync();
  const next=JSON.parse(beforeText);
  for(const key of fields){
   if(Object.hasOwn(proposedState.daily,key))next.daily[key]=structuredClone(proposedState.daily[key]);
   else delete next.daily[key];
  }
  writeJournal(next); // fsync+atomic rename via writePrivateJson
  return 'committed';
 }finally{if(timer)clearTimeout(timer);if(lock)release(lock);}
}

async function main(){
 let provider,heldLock;
 const removeSignals=installSignalCleanup({getLock:()=>heldLock,release:releaseCatchupLock});
 try{
  if(process.getuid?.()!==0||process.argv.length!==3||process.argv[2]!=='--execute')throw Error('INDEX_AUTO_EXPLICIT_ROOT_EXECUTE_REQUIRED');
  const envFile='/etc/globaldroptrade/trades.env',journalFile=NEW_DEPLOYER_AUTOMATION_DIR+'/journal.json';
  const original=readNewDeployerPrivateText(envFile),config=readConfig(parseEnv(original));
  const policyText=readNewDeployerPrivateText(NEW_DEPLOYER_DAILY_POLICY_FILE),policy=validateDailyPolicy(JSON.parse(policyText));
  const deploymentFile=NEW_DEPLOYER_STATE_DIR+'/deployment-public.json',connectionFile=NEW_DEPLOYER_STATE_DIR+'/connection-public.json';
  const deploymentText=readNewDeployerPrivateText(deploymentFile),connectionText=readNewDeployerPrivateText(connectionFile);
  const release=loadNewDeployerRelease(),artifact=JSON.parse(fs.readFileSync(NEW_DEPLOYER_ARTIFACT_FILE,'utf8')),archive=readImmutableV1Archive();
  const request=new FetchRequest(config.rpcUrl);request.timeout=15000;
  provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  const confirmations=Math.max(3,config.confirmations);
  const readiness=()=>verifyNewDeployerAutomationReadiness({provider,artifact,release,deploymentReport:JSON.parse(deploymentText),connectionReport:JSON.parse(connectionText),archive,original,confirmations});
  const target=await readiness();
  if(target.target!=='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14')throw Error('INDEX_AUTO_TARGET_MISMATCH');
  const beforeText=readNewDeployerPrivateText(journalFile),state=JSON.parse(beforeText);
  assertNewDeployerIndexBinding({state,policy,target});
  if(!pendingFixedTarget(state)){console.log('INDEX_AUTO_IDLE');return;}
  const staticGuard=()=>{
   for(const [file,text] of [[envFile,original],[NEW_DEPLOYER_DAILY_POLICY_FILE,policyText],[deploymentFile,deploymentText],[connectionFile,connectionText]])if(readNewDeployerPrivateText(file)!==text)throw Error('INDEX_AUTO_INPUT_CHANGED');
   assertImmutableV1Archive(archive);
  };
  const guard=async()=>{staticGuard();if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('INDEX_AUTO_TESTNET_REQUIRED');};
  await assertZeroStartJournalCanonical(provider,state);
  const result=await catchUpNewDeployerIndex({provider,policy,state,save:()=>{},guard,confirmations,maxPasses:2,milliseconds:30000,fixedTargetOnly:true});
  await guard();
  // Expensive creation, archive and configuration verification runs off-lock.
  const current=await readiness();
  for(const key of ['target','owner','operator','queue','hash','runtimeHash'])if(current[key]!==target[key])throw Error('INDEX_AUTO_IDENTITY_CHANGED');
  const committed=await optimisticIndexCommit({beforeText,proposedState:state,
   readJournal:()=>readNewDeployerPrivateText(journalFile),writeJournal:next=>writePrivateJson(journalFile,next),
   acquire:()=>acquireCatchupLock(NEW_DEPLOYER_AUTOMATION_DIR,{waitMilliseconds:0,onAcquire:lock=>{heldLock=lock;}}),
   release:lock=>{releaseCatchupLock(lock);heldLock=null;},guardSync:staticGuard,
   verify:candidate=>verifyIndexCommit({candidate,policy,target,provider,confirmations})});
  console.log('INDEX_AUTO_RESULT '+JSON.stringify({status:committed,indexStatus:result.status,memberThrough:result.memberThrough,indexThrough:result.indexThrough,indexTarget:result.indexTarget,transactionsSent:0,signerOpened:false}));
 }catch(error){console.error('INDEX_AUTO_STOPPED '+(/^[A-Z][A-Z0-9_]+$/.test(error?.message||'')?error.message:'RPC_OR_STATE_REVIEW_REQUIRED'));process.exitCode=1;}
 finally{removeSignals();if(heldLock){try{releaseCatchupLock(heldLock);}catch{console.error('INDEX_AUTO_LOCK_REVIEW_REQUIRED');process.exitCode=1;}}provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
