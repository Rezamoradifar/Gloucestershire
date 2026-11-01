// Explicit chain-97 timing cutover. No signer, no journal reset, no past repricing.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {parseEnv} from 'node:util';import {execFileSync} from 'node:child_process';
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {getZeroStartProfile} from './zero-start-profile.mjs';
import {validateDailyPolicy,isQuarterTestPolicy} from './daily-profit.mjs';
import {isPositionPolicy} from './position-profit.mjs';
import {assertIndexerBinding} from './index-zero-positions.mjs';
import {verifyZeroStartTarget} from './zero-start-readiness.mjs';
import {createZeroStartProofProviders} from './connect-zero-start.mjs';
import {assertZeroStartJournalCanonical} from './zero-start-automation.mjs';
import {writePrivateJson} from './migration-journal.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function quarterPolicyTransition({policy,state,checkpoint}){
 policy=validateDailyPolicy(policy);
 if(policy.chainId!==97||!isPositionPolicy(policy)||![3600,900].includes(policy.periodSeconds))throw Error('QUARTER_EXISTING_POSITION_TESTNET_REQUIRED');
 if(state.pending||state.oracle?.pending||Object.values(state.transactions||{}).some(t=>!t||!Number.isSafeInteger(t.block)||t.block<1))throw Error('QUARTER_PENDING_RECONCILIATION_REQUIRED');
 if(isQuarterTestPolicy(policy))return policy;
 return validateDailyPolicy({...policy,periodSeconds:900,positionScheduleVersion:2,testInterval:'quarter-hour',quarterCutover:{block:checkpoint.number,hash:checkpoint.hash,timestamp:checkpoint.timestamp}});
}
function read(file){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077))throw Error('QUARTER_PRIVATE_FILE_REQUIRED');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}}
async function main(){
 let p,proof=[];
 try{
  if(process.getuid?.()!==0||process.argv.slice(2).join(' ')!=='--execute --locked-fd 9')throw Error('QUARTER_LOCKED_INSTALLER_REQUIRED');
  const profile=getZeroStartProfile(true),root=profile.automationDir,held=fs.fstatSync(9),live=fs.lstatSync(root+'/run.lock');
  if(!held.isFile()||!live.isFile()||held.ino!==live.ino||held.dev!==live.dev)throw Error('QUARTER_LOCKED_INSTALLER_REQUIRED');
  execFileSync('python3',['-c','import fcntl;fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)'],{stdio:['ignore','ignore','pipe',9]});
  const original=read('/etc/globaldroptrade/trades.env'),config=readConfig(parseEnv(original));
  const r=new FetchRequest(config.rpcUrl);r.timeout=15000;p=new JsonRpcProvider(r,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});proof=createZeroStartProofProviders();
  const target=await verifyZeroStartTarget({provider:p,artifact:JSON.parse(fs.readFileSync(profile.artifactUrl)),deploymentReport:JSON.parse(read(profile.stateDir+'/deployment-public.json')),connectionReport:JSON.parse(read(profile.stateDir+'/connection-public.json')),original,release:profile.release,confirmations:Math.max(3,config.confirmations),proofProviders:proof,inspectSettlementLogs:false});
  const file=root+'/daily-policy.json',intentFile=root+'/quarter-policy-transition-v1.json',policy=validateDailyPolicy(JSON.parse(read(file))),state=JSON.parse(read(root+'/journal.json'));
  assertIndexerBinding({state,policy,target});await assertZeroStartJournalCanonical(p,state);
  let intent;
  if(fs.existsSync(intentFile)){
   intent=JSON.parse(read(intentFile));
   if(intent.version!==1||!same(intent.identity,state.identity)||!same(policy,intent.previous)&&!same(policy,intent.next))throw Error('QUARTER_TRANSITION_CHANGED');
   validateDailyPolicy(intent.next);
  }else{
   if(isQuarterTestPolicy(policy))throw Error('QUARTER_TRANSITION_ARCHIVE_REQUIRED');
   const checkpoint=await p.getBlock(Math.max(policy.deploymentBlock,(await p.getBlockNumber())-Math.max(3,config.confirmations)));
   const next=quarterPolicyTransition({policy,state,checkpoint});intent={version:1,identity:state.identity,previous:policy,next};writePrivateJson(intentFile,intent);
  }
  if(!isQuarterTestPolicy(intent.next))throw Error('QUARTER_TRANSITION_CHANGED');
  const c=intent.next.quarterCutover,block=await p.getBlock(c.block);
  if(block?.hash!==c.hash||block.timestamp!==c.timestamp||read('/etc/globaldroptrade/trades.env')!==original)throw Error('QUARTER_CUTOVER_CHANGED');
  if(!same(policy,intent.next))writePrivateJson(file,intent.next);
  console.log('QUARTER_TEST_POLICY_INSTALLED '+JSON.stringify({chainId:97,target:target.target,periodSeconds:900,effectiveAt:c.timestamp,legacyHoursPreserved:true,transactionsSent:0,signerOpened:false}));
 }finally{await p?.destroy();for(const x of proof)await x.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.log('QUARTER_POLICY_BLOCKED '+(/^(?:QUARTER|POSITION|ZERO_START|TESTNET)_[A-Z0-9_]+$/.test(e.message||'')?e.message:'QUARTER_RPC_OR_STATE_CHECK_FAILED'));process.exitCode=1;});
