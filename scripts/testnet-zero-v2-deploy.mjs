// Isolated BNB Testnet v2 deployment. Explicit --execute only; never touches V1 journals.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {FetchRequest,JsonRpcProvider,Wallet,keccak256,getAddress,ZeroAddress,parseEther} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {readPrivateKey} from './migration-signers.mjs';
import {writePrivateJson,journalTransaction} from './migration-journal.mjs';
import {loadNewDeployerRelease,NEW_DEPLOYER_KEY_FILE,NEW_DEPLOYER_ARTIFACT_FILE} from './new-deployer-testnet-profile.mjs';
import {loadNewDeployerArtifact,loadArchivedLegacySession,newDeployerRequest,verifyNewDeployerDeployment} from './deploy-new-deployer-testnet.mjs';
import {PREVIOUS_TESTNET_VAULT,ZERO_V2_STATE_DIR,selectBackup,verifyOldReport,preflight} from './preflight-testnet-zero-v2.mjs';

const releaseId='global-testnet-zero-v2';
const oldState='/var/lib/globaldroptrade/new-deployer-testnet-v1';
const oldJournal='/var/lib/globaldroptrade/new-deployer-testnet-automation-v1/journal.json';
const envFile='/etc/globaldroptrade/trades.env';
const reportFile=path.join(ZERO_V2_STATE_DIR,'deployment-public.json');
const journalFile=path.join(ZERO_V2_STATE_DIR,'journal.json');
const configFile=new URL('../config/testnet-zero-v2.json',import.meta.url);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=value=>{throw Error(value);};

function privateFile(file){
 let stat;
 try{stat=fs.lstatSync(file);}catch{fail('ZERO_V2_PRIVATE_FILE_REQUIRED');}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077)!==0)fail('ZERO_V2_PRIVATE_FILE_REQUIRED');
 return fs.readFileSync(file);
}
function privateDirectory(dir,{create=false}={}){
 if(create)fs.mkdirSync(dir,{mode:0o700});
 const stat=fs.lstatSync(dir);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077)!==0)fail('ZERO_V2_PRIVATE_DIRECTORY_REQUIRED');
}
function json(file){
 let result;
 try{result=JSON.parse(privateFile(file).toString('utf8'));}catch{fail('ZERO_V2_PRIVATE_JSON_REQUIRED');}
 if(!result||typeof result!=='object'||Array.isArray(result))fail('ZERO_V2_PRIVATE_JSON_REQUIRED');
 return result;
}
function show(unit,property){
 try{return execFileSync('systemctl',['show','--property='+property,'--value',unit],{encoding:'utf8',timeout:5000}).trim();}
 catch{fail('ZERO_V2_SYSTEMD_INSPECTION_REQUIRED');}
}
export function oldWriterQuiescent(read=show){
 for(const unit of ['globaldroptrade-new-deployer-daily.service','globaldroptrade-new-deployer-daily.timer']){
  const load=read(unit,'LoadState'),active=read(unit,'ActiveState');
  if(!['loaded','not-found'].includes(load))fail('ZERO_V2_WORKER_STATE_REQUIRED');
  if(!['','inactive','failed'].includes(active))return false;
  if(unit.endsWith('.timer')&&load==='loaded'){
   if(!['disabled','static','masked','indirect'].includes(read(unit,'UnitFileState')))return false;
  }
 }
 return true;
}
function requireSettledJournal(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.identity?.chainId!==97||
    getAddress(value.identity.target)!==getAddress(PREVIOUS_TESTNET_VAULT)||
    !value.transactions||typeof value.transactions!=='object'||Array.isArray(value.transactions)||
    value.pending||value.oracle?.pending||
    Object.values(value.transactions).some(row=>!Number.isSafeInteger(row?.block)||row.block<1||
      !/^0x[0-9a-f]{64}$/i.test(row.hash||'')||!/^0x[0-9a-f]{64}$/i.test(row.blockHash||''))){
  fail('ZERO_V2_PREVIOUS_PENDING_TRANSACTION_REVIEW_REQUIRED');
 }
}
export function validateV2Profile(profile,base){
 if(profile?.version!==1||profile.releaseId!==releaseId||profile.chainId!==97||
    profile.artifact!==base.artifact||profile.artifactHash!==base.artifactHash||
    profile.previousVault!==PREVIOUS_TESTNET_VAULT||
    profile.deployer!==base.deployer||profile.owner!==base.owner||
    profile.token!==base.token||profile.bnbFeed!==base.bnbFeed||
    profile.tokenFeed!==base.tokenFeed||profile.operations!==base.operations||
    profile.age!==base.age||!same(profile.partners,base.partners)||
    profile.testMode!==true||profile.migrateAccounts!==false){
   fail('ZERO_V2_RELEASE_PROFILE_REQUIRED');
 }
 return profile;
}
function requireNoExistingReport(){
 if(fs.existsSync(reportFile))fail('ZERO_V2_ALREADY_DEPLOYED_REPORT_PRESENT');
}
export function validateV2Report(verified,previous=PREVIOUS_TESTNET_VAULT){
 const address=getAddress(verified?.contractAddress);
 if(verified?.chainId!==97||verified.verified!==true||verified.emptyAtDeployment!==true||
    verified.accountsMigrated!==false||address===getAddress(previous))fail('ZERO_V2_EMPTY_DEPLOYMENT_REQUIRED');
 return verified;
}
async function review({provider,base,artifact,backupPath,report,env,oldHash}){
 const config=readConfig(parseEnv(env));
 const old=await preflight({provider,config,report,token:base.token,backupPath,
  timerActive:false});
 const request=await newDeployerRequest({artifact,release:base});
 if(Number(await provider.send('eth_chainId',[]))!==97)fail('ZERO_V2_TESTNET_ONLY');
 const [head,tokenCode,bnbFeedCode,tokenFeedCode,balance]=await Promise.all([
  provider.getBlock('latest'),provider.getCode(base.token),provider.getCode(base.bnbFeed),
  provider.getCode(base.tokenFeed),provider.getBalance(base.deployer)
 ]);
 if(!head||tokenCode==='0x'||bnbFeedCode==='0x'||tokenFeedCode==='0x')fail('ZERO_V2_DEPENDENCY_CODE_REQUIRED');
 return {old,request,head,balance:balance.toString(),oldJournalHash:oldHash};
}
function identity({base,request,report,backupPath,oldHash}){
 return {version:1,kind:'testnet-zero-v2-deployment',releaseId,chainId:97,
  previousVault:PREVIOUS_TESTNET_VAULT,previousDeploymentHash:report.hash,
  previousRuntimeHash:report.runtimeHash,backupPath,oldJournalSha256:oldHash,
  artifactHash:base.artifactHash,deployer:base.deployer,initcodeHash:keccak256(request.data)};
}
function validateJournal(state,expected){
 if(!state||!state.transactions||typeof state.transactions!=='object'||Array.isArray(state.transactions)||
   Object.keys(state.transactions).some(key=>key!=='zero-v2-vault')||
   (state.identity&&!same(state.identity,expected))||
   (!state.identity&&Object.keys(state.transactions).length)){
  fail('ZERO_V2_JOURNAL_IDENTITY_REQUIRED');
 }
}
async function main(){
 let provider;
 try{
  const [mode,...extra]=process.argv.slice(2);
  if(process.getuid?.()!==0||!['--plan','--execute'].includes(mode)||extra.length)
   fail('ZERO_V2_EXPLICIT_ROOT_PLAN_OR_EXECUTE_REQUIRED');
  const backupPath=selectBackup();
  const oldReport=verifyOldReport(json(path.join(oldState,'deployment-public.json')),
   json(path.join(backupPath,'new-deployer-testnet-v1','deployment-public.json')));
  const base=loadNewDeployerRelease();
  const v2=validateV2Profile(JSON.parse(fs.readFileSync(configFile,'utf8')),base);
  const artifact=loadNewDeployerArtifact(NEW_DEPLOYER_ARTIFACT_FILE);
  const originalEnv=privateFile(envFile);
  const oldJournalBytes=privateFile(oldJournal),oldHash=hash(oldJournalBytes);
  requireSettledJournal(JSON.parse(oldJournalBytes.toString('utf8')));
  const config=readConfig(parseEnv(originalEnv.toString('utf8')));
  if(config.chainId!==97||getAddress(config.address)!==getAddress(PREVIOUS_TESTNET_VAULT))
   fail('ZERO_V2_ACTIVE_TARGET_REQUIRED');
  const request=new FetchRequest(config.rpcUrl);request.timeout=20000;
  provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  const reviewed=await review({provider,base,artifact,backupPath,report:oldReport,
   env:originalEnv.toString('utf8'),oldHash});
  const stopped=oldWriterQuiescent();
  if(mode==='--plan'){
   console.log('ZERO_V2_DEPLOYMENT_PLAN_CHECKED');
   console.log(JSON.stringify({chainId:97,releaseId:v2.releaseId,
    previousVault:PREVIOUS_TESTNET_VAULT,oldWriterQuiescent:stopped,
    testBnbGasUnits:reviewed.balance,oldQueueRequestCount:reviewed.old.queueRequestCount,
    oldAssets:reviewed.old.assets,
    newVaultDeployed:false,signerOpened:false,transactionsSigned:0,transactionsSent:0},null,2));
   return;
  }
  if(!stopped)fail('ZERO_V2_OLD_WORKER_MUST_BE_STOPPED_AND_TIMER_DISABLED');
  requireNoExistingReport();
  if(fs.existsSync(ZERO_V2_STATE_DIR))privateDirectory(ZERO_V2_STATE_DIR);
  else privateDirectory(ZERO_V2_STATE_DIR,{create:true});
  privateDirectory(path.dirname(NEW_DEPLOYER_KEY_FILE));
  const key=readPrivateKey(NEW_DEPLOYER_KEY_FILE);
  let wallet;
  try{wallet=new Wallet(key,provider);}catch{fail('ZERO_V2_OPERATOR_KEY_INVALID');}
  if(wallet.address!==base.deployer)fail('ZERO_V2_OPERATOR_KEY_MISMATCH');
  const expected=identity({base,request:reviewed.request,report:oldReport,backupPath,oldHash});
  const state=fs.existsSync(journalFile)?json(journalFile):{transactions:{}};
  validateJournal(state,expected);
  if(!state.identity){state.identity=expected;writePrivateJson(journalFile,state);}
  const guard=async()=>{
   if(!oldWriterQuiescent())fail('ZERO_V2_OLD_WORKER_RESTARTED');
   if(!privateFile(envFile).equals(originalEnv)||hash(privateFile(oldJournal))!==oldHash)
    fail('ZERO_V2_PREVIOUS_STATE_CHANGED');
   if(Number(await provider.send('eth_chainId',[]))!==97)fail('ZERO_V2_TESTNET_ONLY');
   if((await provider.getCode(PREVIOUS_TESTNET_VAULT))==='0x')
    fail('ZERO_V2_PREVIOUS_VAULT_MISSING');
  };
  const receipt=await journalTransaction({
   provider,wallet,state,save:()=>writePrivateJson(journalFile,state),
   label:'zero-v2-vault',request:reviewed.request,guard,confirmations:3,
   maxTotalFee:parseEther('0.1'),log:message=>console.log(message)
  });
  const verified=validateV2Report(await verifyNewDeployerDeployment({
   provider,artifact,release:base,archive:loadArchivedLegacySession(),
   hash:receipt.hash,confirmations:3
  }));
  const result={...verified,kind:'testnet-zero-v2-deployment',releaseId:v2.releaseId,
   previousVault:PREVIOUS_TESTNET_VAULT,previousVaultDeploymentHash:oldReport.hash,
   previousWorkerJournalSha256:oldHash,previousBackupPath:backupPath,
   accountsMigrated:false,siteConnected:false,automationActive:false};
  if(fs.existsSync(reportFile)){
   if(!same(json(reportFile),result))fail('ZERO_V2_REPORT_CONFLICT');
  }else writePrivateJson(reportFile,result);
  console.log('ZERO_V2_DEPLOYED_AND_GENESIS_VERIFIED');
  console.log(JSON.stringify({chainId:97,newVault:result.contractAddress,
   newQueue:result.queue,transactionHash:result.hash,genesisBlock:result.block,
   positionsMigrated:0,oldVault:PREVIOUS_TESTNET_VAULT,
   siteConnected:false,automationActive:false},null,2));
 }catch(error){
  console.error('ZERO_V2_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message||'')?error.message:'ZERO_V2_REVIEW_REQUIRED'));
  process.exitCode=1;
 }finally{provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
