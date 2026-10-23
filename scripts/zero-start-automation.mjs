// Existing-server-key automation. No owner-key loading or interactive wallet prompts.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,Interface,JsonRpcProvider,Transaction,Wallet,getAddress,keccak256,parseEther} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {parseZeroStartProfileArgs} from './zero-start-profile.mjs';
import {verifyZeroStartReadiness} from './zero-start-readiness.mjs';
import {dailyAbi,approvedQueueAbi,validateDailyPolicy,planDailyEpoch,executeDailyPlan,payApprovedRequests} from './daily-profit.mjs';
import {processZeroStartVolume} from './zero-start-volume.mjs';
import {maintainOracles} from './maintain-testnet-oracles.mjs';
import {readPrivateKey} from './migration-signers.mjs';
import {journalTransaction,writePrivateJson} from './migration-journal.mjs';

const publicRoot='/var/www/globaldroptrade/automation-data';
const code=e=>/^[A-Z][A-Z0-9_]{2,100}$/.test(e?.message||'')?e.message:'AUTOMATION_RPC_OR_EXECUTION_FAILED';

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

export async function runZeroStartAutomation({provider,vault,queue,readiness,state,save,loadPolicy,savePolicy,transact,refreshReadiness,maintainOracles:maintain=async()=>({status:'not-configured'}),processVolume=processZeroStartVolume,confirmations=3}){
 const target=getAddress(await vault.getAddress());
 if(readiness?.version!==1||readiness.chainId!==97||getAddress(readiness.target)!==target||getAddress(await queue.vault())!==target)throw Error('ZERO_START_AUTOMATION_TARGET_MISMATCH');
 const identity={version:1,chainId:97,target,owner:readiness.owner,operator:readiness.operator,queue:readiness.queue,hash:readiness.hash,runtimeHash:readiness.runtimeHash};
 if(state.identity&&JSON.stringify(state.identity)!==JSON.stringify(identity))throw Error('ZERO_START_AUTOMATION_IDENTITY_CHANGED');
 if(!state.identity&&Object.keys(state.transactions||{}).length)throw Error('ZERO_START_UNBOUND_AUTOMATION_JOURNAL');
 await assertZeroStartJournalCanonical(provider,state);
 state.identity=identity;state.transactions??={};state.daily??={epoch:0};save();
 const report={version:1,kind:'fresh-zero-server-automation',chainId:97,target,...(readiness.releaseId==='global-fresh-fast-test-v1'?{releaseId:readiness.releaseId,testMode:true,initialServerReporter:true,fastTestnetVersion:1}:{}),checkedAt:new Date().toISOString(),walletPrompts:0,readiness,status:'waiting',policyCreated:false,dailyCredits:[],withdrawals:null,volume:null,oracles:null,errors:[]};
 // Approved withdrawals remain independently payable while daily funding or reporter permission is missing.
 report.withdrawals=await payApprovedRequests({vault,queue,state:state.daily,save,transact});
 try{report.oracles=await maintain();}catch(e){report.errors.push(code(e));}
 report.volume=await processVolume({provider,vault,state,save,transact,maxTransactions:4,maxScans:100,confirmations});
 let policy=await loadPolicy();
 if(policy){
  policy=validateDailyPolicy(policy);if(policy.vaultAddress!==target||policy.runtimeHash!==readiness.runtimeHash||policy.deploymentBlock!==readiness.block)throw Error('ZERO_START_AUTOMATION_POLICY_CHANGED');
  const activation=state.activation||(policy.activationBlockHash?{block:policy.activationBlock,blockHash:policy.activationBlockHash}:null);
  if(activation&&(await provider.getBlock(activation.block))?.hash!==activation.blockHash)throw Error('ZERO_START_ACTIVATION_CHECKPOINT_REORG');
 }
 if(!policy){
  if(state.activation||state.daily.epoch!==0)throw Error('ZERO_START_EXISTING_POLICY_MISSING');
  if(readiness.ready&&report.volume.complete&&refreshReadiness){
   const current=await refreshReadiness();
   for(const key of ['target','owner','operator','queue','hash','runtimeHash'])if(current[key]!==readiness[key])throw Error('ZERO_START_AUTOMATION_IDENTITY_CHANGED');
   readiness=current;report.readiness=current;
  }
  if(!readiness.ready||!report.volume.complete||report.errors.length){report.blockers=[...readiness.blockers,...(!report.volume.complete?['NETWORK_VOLUME_BACKLOG']:[]),...report.errors];return report;}
  const checkpoint=await provider.getBlock(readiness.checkpoint.block);
  if(!checkpoint||checkpoint.hash!==readiness.checkpoint.blockHash)throw Error('ZERO_START_ACTIVATION_CHECKPOINT_REORG');
  policy=validateDailyPolicy({version:1,chainId:97,vaultAddress:target,runtimeHash:readiness.runtimeHash,deploymentBlock:readiness.block,startTimestamp:checkpoint.timestamp,activationBlock:checkpoint.number,activationBlockHash:checkpoint.hash,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true});
  await savePolicy(policy);report.policyCreated=true;
  state.activation={block:checkpoint.number,blockHash:checkpoint.hash,startTimestamp:checkpoint.timestamp};save();
 }
 report.policy=policy;report.nextEpoch=state.daily.epoch;report.firstPeriodEndsAt=policy.startTimestamp+86400;
 const plan=await planDailyEpoch({provider,vault,policy,state:state.daily,epoch:state.daily.epoch,save,confirmations});
 report.dailyStatus=plan.status;
 if(plan.status==='ready'){
  if(!await vault.reporters(readiness.operator)){report.errors.push('AUTOMATION_SIGNER_IS_NOT_REPORTER');report.blockers=['COUNCIL_AUTHORIZED_SERVER_REPORTER_REQUIRED'];return report;}
  try{
   report.dailyCredits=await executeDailyPlan({provider,vault,plan,transact});
   state.daily.epoch++;state.daily.lastCredit={epoch:plan.epoch,credited:report.dailyCredits};save();
   report.nextEpoch=state.daily.epoch;
  }catch(e){report.errors.push(code(e));return report;}
 }
 report.status=readiness.ready&&report.errors.length===0?'scheduled':'waiting';
 report.blockers=readiness.blockers;
 return report;
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

async function main(){
 let provider;
 try{
  const {profile,args}=parseZeroStartProfileArgs(),seedFlags=args.filter(value=>value==='--seed-test-rewards');
  const commands=args.filter(value=>value!=='--seed-test-rewards');
  if(process.getuid?.()!==0||commands.length!==1||!['--check','--execute'].includes(commands[0])||seedFlags.length>1)throw Error('ROOT_EXPLICIT_CHECK_OR_EXECUTE_REQUIRED');
  const execute=commands[0]==='--execute';
  if(seedFlags.length&&(!profile.fast||!execute))throw Error('FAST_TEST_EXPLICIT_SEED_EXECUTION_REQUIRED');
  const privateRoot=profile.automationDir,release=profile.release;
  privateDirectory(privateRoot,{create:execute});
  const envFile='/etc/globaldroptrade/trades.env',original=readPrivate(envFile),settings=parseEnv(original),config=readConfig(settings);
  const directory=profile.stateDir;privateDirectory(directory);
  const deploymentReport=JSON.parse(readPrivate(directory+'/deployment-public.json')),connectionReport=JSON.parse(readPrivate(directory+'/connection-public.json'));
  const artifact=JSON.parse(fs.readFileSync(profile.artifactUrl,'utf8'));
  const mockArtifact=JSON.parse(fs.readFileSync(new URL('../artifacts/MockFeed.json',import.meta.url),'utf8'));
  const policyFile=privateRoot+'/daily-policy.json',stateFile=privateRoot+'/journal.json';
  const policy=fs.existsSync(policyFile)?JSON.parse(readPrivate(policyFile)):undefined;
  const state=fs.existsSync(stateFile)?JSON.parse(readPrivate(stateFile)):{transactions:{}};
  const transport=new FetchRequest(config.rpcUrl);transport.timeout=15000;
  provider=new JsonRpcProvider(transport,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=2000;
  const checkReadiness=()=>verifyZeroStartReadiness({provider,artifact,deploymentReport,connectionReport,original,release,policy,periodStartTimestamp:policy?policy.startTimestamp+(state.daily?.epoch||0)*86400:undefined,confirmations:Math.max(3,config.confirmations)});
  let readiness=await checkReadiness();
  if(!execute){console.log('ZERO_START_AUTOMATION_CHECKED ready='+readiness.ready);console.log('BLOCKERS='+(readiness.blockers.join(',')||'none'));return;}
  const key=readPrivateKey('/etc/globaldroptrade/fresh-zero-automation.key');if(!key)throw Error('EXISTING_SERVER_OPERATOR_KEY_REQUIRED');
  const wallet=new Wallet(key,provider);if(wallet.address!==release.deployer)throw Error('EXPECTED_SERVER_OPERATOR_KEY_REQUIRED');
  const guard=async()=>{
   if(readPrivate(envFile)!==original||Number(await provider.send('eth_chainId',[]))!==97||keccak256(await provider.getCode(readiness.target))!==readiness.runtimeHash)throw Error('ZERO_START_AUTOMATION_TARGET_CHANGED');
   await assertZeroStartJournalCanonical(provider,state);
  };
  // Readiness uses head-confirmations; one extra inclusion confirmation ensures its
  // refreshed checkpoint contains every transaction completed earlier in this run.
  const save=()=>writePrivateJson(stateFile,state),transact=async(label,request)=>{
   const receipt=await journalTransaction({provider,wallet,state,save,label,request,guard,confirmations:Math.max(3,config.confirmations)+1,timeout:45000,maxTotalFee:parseEther('0.1')});
   await assertZeroStartJournalCanonical(provider,state);return receipt;
  };
  const vault=new Contract(readiness.target,artifact.abi,wallet),queue=new Contract(readiness.queue,approvedQueueAbi,wallet);
  await guard();
  const identity={version:1,chainId:97,target:readiness.target,owner:readiness.owner,operator:readiness.operator,queue:readiness.queue,hash:readiness.hash,runtimeHash:readiness.runtimeHash};
  if(state.identity&&JSON.stringify(state.identity)!==JSON.stringify(identity))throw Error('ZERO_START_AUTOMATION_IDENTITY_CHANGED');
  if(!state.identity&&Object.keys(state.transactions||{}).length)throw Error('ZERO_START_UNBOUND_AUTOMATION_JOURNAL');
  state.identity=identity;state.transactions??={};save();
  const allowed=new Map([[readiness.target,new Interface(dailyAbi.concat(['function processNetworkVolume(uint256,uint256)']))],[readiness.queue,new Interface(approvedQueueAbi)],[release.bnbFeed,new Interface(mockArtifact.abi)],[release.tokenFeed,new Interface(mockArtifact.abi)]]);
  const seedModule=profile.fast?await import('./fund-fast-test-rewards.mjs'):null;
  const tokenArtifact=profile.fast?JSON.parse(fs.readFileSync(new URL('../artifacts/MockToken.json',import.meta.url),'utf8')):null;
  let seedResumed=false;
  for(const [label,entry]of Object.entries(state.transactions))if(!entry.block){
   const tx=Transaction.from(entry.raw);
   if(seedModule?.isFastTestSeedLabel(label)){
    await seedModule.verifyFastTestSeedPending({provider,wallet,artifact:tokenArtifact,release,readiness,vault,state,label,request:{to:tx.to,data:tx.data,value:tx.value}});seedResumed=true;
   }else{
    const abi=allowed.get(tx.to),action=abi?.parseTransaction({data:tx.data,value:tx.value});
    if(!action||!['batchProfit','pay','processNetworkVolume','set'].includes(action.name))throw Error('ZERO_START_PENDING_TRANSACTION_TARGET_MISMATCH');
   }
   await transact(label,{to:tx.to,data:tx.data});
  }
  if(seedFlags.length){
   await seedModule.seedFastTestRewards({provider,wallet,artifact:tokenArtifact,release,readiness,vault,state,save,transact});
   readiness=await checkReadiness();
  }else if(seedResumed)readiness=await checkReadiness();
  state.oracle??={};
  Object.defineProperty(state.oracle,'transactions',{get:()=>state.transactions,configurable:true,enumerable:false});
  const result=await runZeroStartAutomation({provider,vault,queue,readiness,state,save,loadPolicy:()=>policy,savePolicy:value=>{if(fs.existsSync(policyFile))throw Error('ZERO_START_POLICY_ALREADY_EXISTS');writePrivateJson(policyFile,value);},transact,confirmations:Math.max(3,config.confirmations),refreshReadiness:checkReadiness,maintainOracles:()=>maintainOracles({provider,wallet,artifact:mockArtifact,vaultAddress:readiness.target,feedAddresses:[release.bnbFeed,release.tokenFeed],state:state.oracle,save,confirmations:Math.max(3,config.confirmations),transact:options=>transact(options.label,options.request)})});
  if(state.seedTest?.report)result.testRewardSeed=state.seedTest.report;
  result.maxFeesReservedWei=Object.values(state.transactions).reduce((sum,t)=>sum+BigInt(t.maxFee),0n).toString();
  writePrivateJson(privateRoot+'/status.json',result);
  let timerActive=false;try{execFileSync('systemctl',['is-active','--quiet',profile.timer],{stdio:'ignore',timeout:5000});timerActive=true;}catch{}
  publishZeroStartStatus({...result.readiness,automationStatus:result.status,dailyAutomationActive:timerActive&&result.status==='scheduled',timerActive,automation:result},profile.publicRoot+'/activation.json');
  console.log('ZERO_START_AUTOMATION_'+result.status.toUpperCase()+' target='+readiness.target);
  if(result.status!=='scheduled')console.log('BLOCKERS='+[...(result.blockers||[]),...result.errors].join(','));
 }catch(e){
  const failure={version:1,kind:'fresh-zero-automation-error',ready:false,automationStatus:'blocked',blockers:[code(e)],checkedAt:new Date().toISOString(),walletPrompts:0};
  try{publishZeroStartStatus(failure);}catch{}
  console.error('ZERO_START_AUTOMATION_STOPPED '+code(e));process.exitCode=1;
 }finally{provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
