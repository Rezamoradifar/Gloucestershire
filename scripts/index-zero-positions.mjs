// Signer-free hourly history indexer. The payment worker owns all paid cursors.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {parseZeroStartProfileArgs} from './zero-start-profile.mjs';
import {verifyZeroStartTarget} from './zero-start-readiness.mjs';
import {createZeroStartProofProviders} from './connect-zero-start.mjs';
import {validateDailyPolicy} from './daily-profit.mjs';
import {scanPositionHistory,isPositionPolicy} from './position-profit.mjs';
import {writePrivateJson} from './migration-journal.mjs';
function read(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077)||s.size>16*1024*1024)throw Error('POSITION_INDEXER_PRIVATE_FILE_REQUIRED');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
}
export function assertIndexerBinding({state,policy,target}){
 if(!isPositionPolicy(policy)||policy.chainId!==97||![3600,900].includes(policy.periodSeconds)||policy.vaultAddress!==target.target||policy.runtimeHash!==target.runtimeHash||policy.deploymentBlock!==target.block)throw Error('POSITION_INDEXER_POLICY_MISMATCH');
 const identity={version:1,chainId:97,target:target.target,owner:target.owner,operator:target.operator,queue:target.queue,hash:target.hash,runtimeHash:target.runtimeHash};
 if(!state.identity||Object.entries(identity).some(([k,v])=>state.identity[k]!==v)||!state.daily)throw Error('POSITION_INDEXER_JOURNAL_MISMATCH');
 if(state.pending||state.oracle?.pending||Object.values(state.transactions||{}).some(t=>!t||!Number.isSafeInteger(t.block)||t.block<1))throw Error('POSITION_INDEXER_PENDING_RECONCILIATION_REQUIRED');
}
async function main(){
 let provider,proof=[],fd,saves=0;
 try{
  const {profile,args}=parseZeroStartProfileArgs();
  if(process.getuid?.()!==0||!profile.fast||args.length!==1||args[0]!=='--execute')throw Error('POSITION_INDEXER_EXPLICIT_FAST_EXECUTE_REQUIRED');
  const metadata=fs.lstatSync(profile.automationDir);if(!metadata.isDirectory()||metadata.uid!==0||(metadata.mode&0o077))throw Error('POSITION_INDEXER_PRIVATE_DIRECTORY_REQUIRED');
  fd=fs.openSync(profile.automationDir+'/run.lock',fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
  const lock=fs.fstatSync(fd);if(!lock.isFile()||lock.uid!==0||(lock.mode&0o077))throw Error('POSITION_INDEXER_PRIVATE_LOCK_REQUIRED');
  try{execFileSync('python3',['-c','import fcntl;fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)'],{stdio:['ignore','ignore','pipe',fd]});}catch{console.log('POSITION_INDEXER_BUSY transactionsSent=0 signerOpened=false');return;}
  const original=read('/etc/globaldroptrade/trades.env'),config=readConfig(parseEnv(original));
  if(config.chainId!==97)throw Error('POSITION_INDEXER_TESTNET_ONLY');
  const request=new FetchRequest(config.rpcUrl);request.timeout=15000;
  provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});proof=createZeroStartProofProviders();
  const target=await verifyZeroStartTarget({provider,artifact:JSON.parse(fs.readFileSync(profile.artifactUrl)),deploymentReport:JSON.parse(read(profile.stateDir+'/deployment-public.json')),connectionReport:JSON.parse(read(profile.stateDir+'/connection-public.json')),original,release:profile.release,confirmations:Math.max(3,config.confirmations),proofProviders:proof,inspectSettlementLogs:false});
  const file=profile.automationDir+'/journal.json',state=JSON.parse(read(file)),policy=validateDailyPolicy(JSON.parse(read(profile.automationDir+'/daily-policy.json')));
  assertIndexerBinding({state,policy,target});
  const save=()=>{if(read('/etc/globaldroptrade/trades.env')!==original)throw Error('POSITION_INDEXER_CONFIGURATION_CHANGED');writePrivateJson(file,state);saves++;};
  const before=state.daily.positionIndex?.through??null;
  const scan=await scanPositionHistory({provider,policy,state:state.daily,save,confirmations:Math.max(3,config.confirmations),advanceCompletedTarget:true,milliseconds:45000,reserveMilliseconds:7500});
  const report={version:1,chainId:97,target:target.target,status:scan.status,checkedAt:new Date().toISOString(),before,through:state.daily.positionIndex?.through??null,memberThrough:state.daily.registry?.through??null,scanTarget:state.daily.positionScanTarget?.number??null,positions:Object.keys(state.daily.positionIndex?.positions||{}).length,transactionsSent:0,signerOpened:false};
  writePrivateJson(profile.automationDir+'/indexer-status.json',report);console.log('POSITION_INDEXER_PROGRESS '+JSON.stringify(report));
 }catch(e){console.log('POSITION_INDEXER_WAITING '+JSON.stringify({blocker:/^(?:POSITION|ZERO_START|TESTNET|COMPLETE_LOG)_[A-Z0-9_]+$/.test(e.message||'')?e.message:'POSITION_INDEXER_RPC_OR_STATE_UNAVAILABLE',progressSaves:saves,transactionsSent:0,signerOpened:false}));process.exitCode=1;}
 finally{await provider?.destroy();for(const p of proof)await p.destroy();if(fd!==undefined)fs.closeSync(fd);}
}
let invokedUrl;
try{
 if(process.argv[1])invokedUrl=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;
}catch{}
if(import.meta.url===invokedUrl)await main();
