// Read-only diagnosis using the connected release and its existing private state.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,JsonRpcProvider} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {parseZeroStartProfileArgs} from './zero-start-profile.mjs';
import {createZeroStartProofProviders} from './connect-zero-start.mjs';
import {verifyZeroStartTarget,verifyZeroStartReadiness} from './zero-start-readiness.mjs';
import {planDailyEpoch,validateDailyPolicy} from './daily-profit.mjs';
import {zeroStartWorkerDiagnostic} from './zero-start-automation.mjs';

function readPrivate(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const s=fs.fstatSync(fd);
  if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0||s.size>16*1024*1024)throw Error('PRIVATE_DIAGNOSTIC_FILE_REQUIRED');
  return fs.readFileSync(fd,'utf8');
 }finally{fs.closeSync(fd);}
}

async function main(){
 let provider,proofProviders=[],phase='ARGUMENT_VALIDATION',state;
 const report={version:1,kind:'fresh-zero-read-only-diagnostic',transactionsSent:0,signerOpened:false};
 try{
  const {profile,args}=parseZeroStartProfileArgs();
  if(process.getuid?.()!==0||args.length)throw Error('ROOT_DIAGNOSTIC_PROFILE_ONLY_REQUIRED');
  phase='LOCAL_CONFIGURATION';
  const original=readPrivate('/etc/globaldroptrade/trades.env'),settings=parseEnv(original),config=readConfig(settings);
  if((settings.TRADES_ZERO_START_PROFILE||'global-fresh-zero-v1')!==profile.release.releaseId)throw Error('DIAGNOSTIC_CONNECTED_PROFILE_MISMATCH');
  const artifact=JSON.parse(fs.readFileSync(profile.artifactUrl,'utf8'));
  const deploymentReport=JSON.parse(readPrivate(profile.stateDir+'/deployment-public.json'));
  const connectionReport=JSON.parse(readPrivate(profile.stateDir+'/connection-public.json'));
  const journalFile=profile.automationDir+'/journal.json',policyFile=profile.automationDir+'/daily-policy.json';
  state=fs.existsSync(journalFile)?JSON.parse(readPrivate(journalFile)):{transactions:{}};
  const policy=fs.existsSync(policyFile)?validateDailyPolicy(JSON.parse(readPrivate(policyFile))):undefined;
  const epoch=state.daily?.epoch??0;
  if(!Number.isSafeInteger(epoch)||epoch<0)throw Error('INVALID_DAILY_EPOCH');
  const request=new FetchRequest(config.rpcUrl);request.timeout=15000;
  provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  proofProviders=createZeroStartProofProviders();
  const targetOptions={provider,artifact,deploymentReport,connectionReport,original,release:profile.release,confirmations:Math.max(3,config.confirmations),proofProviders};
  phase='TARGET_VERIFICATION';
  const target=await verifyZeroStartTarget({...targetOptions,inspectSettlementLogs:false});
  Object.assign(report,{chainId:97,target:target.target,periodSeconds:policy?.periodSeconds??null,nextEpoch:epoch,pending:zeroStartWorkerDiagnostic(null,{phase,state})});
  const vault=new Contract(target.target,artifact.abi,provider);
  phase='DAILY_READINESS';
  const readiness=await verifyZeroStartReadiness({...targetOptions,policy,hourlyTest:policy?.periodSeconds===3600,periodStartTimestamp:policy?policy.startTimestamp+epoch*policy.periodSeconds:undefined});
  report.readiness={ready:readiness.ready,blockers:readiness.blockers,archiveStatus:readiness.archive.status,fundingReady:readiness.funding.ready};
  if(policy){
   phase='DAILY_PERIOD_PLAN';
   // A single registration page is sufficient to diagnose RPC capability. The
   // cloned index is never saved; the installed worker owns durable progress.
   const daily=structuredClone(state.daily??{epoch:0});
   const plan=await planDailyEpoch({provider,vault,policy,state:daily,epoch:daily.epoch??0,confirmations:Math.max(3,config.confirmations),maxRegistryPages:1});
   report.period={status:plan.status,epoch:plan.epoch,registryThrough:daily.registry?.through??null,indexedMembers:Object.keys(daily.registry?.members||{}).length,batches:plan.batches?.length??0};
   if(plan.status==='ready'){
    phase='DAILY_CREDIT_EXECUTION';
    const remaining=new Map();
    for(const batch of plan.batches)if(!await vault.usedRewardBatch(batch.id))remaining.set(batch.asset,(remaining.get(batch.asset)||0n)+batch.amounts.reduce((sum,value)=>sum+BigInt(value),0n));
    report.period.pendingBudget=[];
    for(const [asset,required]of remaining){
     const [ledger,cash]=await Promise.all([vault.ledgers(asset),vault.assetBalance(asset)]);
     report.period.pendingBudget.push({asset,requiredUnits:required.toString(),rewardBudgetUnits:ledger.rewards.toString(),cashUnits:cash.toString()});
     if(ledger.rewards<required||cash<required)throw Error('DAILY_PROFIT_FUNDING_REQUIRED');
    }
    let checked=0;
    for(const batch of plan.batches){
     if(await vault.usedRewardBatch(batch.id))continue;
     await vault.batchProfit.staticCall(batch.id,batch.asset,batch.recipients,batch.amounts.map(BigInt),{from:profile.release.deployer});checked++;
    }
    report.period.simulatedBatches=checked;
   }
  }
  if(readPrivate('/etc/globaldroptrade/trades.env')!==original)throw Error('DIAGNOSTIC_CONFIGURATION_CHANGED');
  console.log('ZERO_PROFIT_DIAGNOSTIC_COMPLETE');console.log(JSON.stringify(report));
 }catch(error){
  const blocker=/^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message||'')?error.message:'READ_ONLY_RPC_OR_VALIDATION_FAILED';
  console.log('ZERO_PROFIT_DIAGNOSTIC_FAILED');
  console.log(JSON.stringify({...report,blocker,diagnostic:zeroStartWorkerDiagnostic(error,{phase,state})}));process.exitCode=1;
 }finally{provider?.destroy();for(const fallback of proofProviders)fallback.destroy();}
}

let invoked;
try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;}catch{}
if(import.meta.url===invoked)await main();
