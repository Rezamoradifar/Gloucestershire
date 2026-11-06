// Read-only proof and private configuration staging for the existing testnet release.
// This module never opens a signer, submits a transaction or changes live files.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';

export const reliabilityTarget='0xB5c3C0f8fc30b2FDB8b16d2325127dAe7C8DCD5B';
export const activityHistory='/var/lib/globaldroptrade-api/daily-activity.json';
export const activityPolicyFile='/etc/globaldroptrade/daily-activity-policy.json';
const origin='https://globaldroptrade.com';
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';

export function privateText(file,{optional=false,max=16777216}={}){
 let fd;
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}
 catch(e){if(optional&&e.code==='ENOENT')return null;throw Error('RELIABILITY_PRIVATE_INPUT_REQUIRED');}
 try{
  const s=fs.fstatSync(fd);
  if(!s.isFile()||s.uid!==0||(s.mode&0o077)||s.size>max)throw Error('RELIABILITY_PRIVATE_INPUT_REQUIRED');
  return fs.readFileSync(fd,'utf8');
 }finally{fs.closeSync(fd);}
}

function rpcUrl(value){
 if(typeof value!=='string'||value.length>16384||/[\s\p{Cc}"'\\]/u.test(value))throw Error('RELIABILITY_RPC_URL_INVALID');
 let u;try{u=new URL(value);}catch{throw Error('RELIABILITY_RPC_URL_INVALID');}
 if(!['http:','https:'].includes(u.protocol)||!u.hostname||u.username||u.password||u.hash)throw Error('RELIABILITY_RPC_URL_INVALID');
 return value;
}

export function verifyActivityPolicy(value){
 if(!value||value.version!==1||value.chainId!==97||String(value.vaultAddress).toLowerCase()!==reliabilityTarget.toLowerCase()||value.origin!==origin||value.windowSeconds!==86400||!Number.isSafeInteger(value.activationTimestamp)||value.activationTimestamp<1||value.historyFile!==activityHistory)throw Error('RELIABILITY_ACTIVITY_POLICY_MISMATCH');
 return value;
}

export function renderReliabilityEnv(original,urls,policy){
 policy=verifyActivityPolicy(policy);
 if(!Array.isArray(urls)||urls.length<1||urls.length>4||new Set(urls).size!==urls.length)throw Error('RELIABILITY_RPC_CANDIDATES_REQUIRED');
 urls.forEach(rpcUrl);
 const before=parseEnv(original),updates={
  TRADES_RPC_URL:urls[0],TRADES_RPC_URLS:JSON.stringify(urls.slice(1)),
  DAILY_ACTIVITY_FILE:activityHistory,DAILY_ACTIVITY_ORIGIN:origin,
  DAILY_ACTIVITY_ACTIVATION_TIMESTAMP:String(policy.activationTimestamp),
  GLOBAL_AUTOMATION_PUBLIC_STATUS:'/var/www/globaldroptrade/automation-data/activation.json'
 };
 // Append checked assignments instead of rewriting multiline values or credentials.
 const next=original+(original.endsWith('\n')?'':'\n')+Object.entries(updates).map(([key,value])=>`${key}='${value}'`).join('\n')+'\n';
 const after=parseEnv(next);
 const retained=value=>JSON.stringify(Object.fromEntries(
  Object.entries(value).filter(([key])=>!Object.hasOwn(updates,key)).sort(([a],[b])=>a.localeCompare(b))
 ));
 if(retained(before)!==retained(after)||Object.entries(updates).some(([key,value])=>after[key]!==value))throw Error('RELIABILITY_ENV_PRESERVATION_FAILED');
 return next;
}

// Match the worker's cumulative fee reservation without exposing signed bytes,
// transaction labels or private RPC settings. Confirmed entries still reserve
// their original maximum fee; the release never resets this budget.
export function journalFeeBudget(state,identity,operatorBalance){
 const limit=100000000000000000n,transactions=state?.transactions;
 if(!state||typeof state!=='object'||Array.isArray(state)||!transactions||typeof transactions!=='object'||Array.isArray(transactions))throw Error('RELIABILITY_FINANCIAL_JOURNAL_INVALID');
 const entries=Object.values(transactions);
 if((entries.length&&!state.identity)||state.identity&&Object.entries(identity).some(([key,value])=>state.identity[key]!==value))throw Error('RELIABILITY_JOURNAL_IDENTITY_MISMATCH');
 let reserved=0n,pending=0;
 for(const entry of entries){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.maxFee!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(entry.maxFee)||typeof entry.raw!=='string'||!/^0x[0-9a-f]+$/i.test(entry.raw)||!/^0x[0-9a-f]{64}$/i.test(entry.hash||''))throw Error('RELIABILITY_FINANCIAL_JOURNAL_INVALID');
  if(entry.block!==undefined&&(!Number.isSafeInteger(entry.block)||entry.block<1||!/^0x[0-9a-f]{64}$/i.test(entry.blockHash||'')))throw Error('RELIABILITY_FINANCIAL_JOURNAL_INVALID');
  reserved+=BigInt(entry.maxFee);
  if(!entry.block)pending++;
 }
 if(typeof operatorBalance!=='bigint'||operatorBalance<0n)throw Error('RELIABILITY_OPERATOR_BALANCE_REQUIRED');
 return {feeBudgetLimitWei:String(limit),maxFeesReservedWei:String(reserved),feeBudgetRemainingWei:String(reserved<limit?limit-reserved:0n),operatorBalanceWei:String(operatorBalance),pendingSignedCount:pending,
  waitingFor:[...(reserved>=limit?['TOTAL_TEST_BNB_FEE_LIMIT_0_1']:[]),...(operatorBalance===0n?['INSUFFICIENT_TEST_BNB']:[])]};
}

function writeStage(directory,name,text){
 const s=fs.lstatSync(directory);
 if(!s.isDirectory()||s.uid!==0||(s.mode&0o077))throw Error('RELIABILITY_PRIVATE_STAGE_REQUIRED');
 const fd=fs.openSync(path.join(directory,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}

export async function prepareDailyReliability({runtime,stage,rpcFile,envFile='/etc/globaldroptrade/trades.env',policyFile='/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/daily-policy.json',activityFile=activityPolicyFile}){
 const root=fs.realpathSync(runtime),require=createRequire(path.join(root,'package.json'));
 const {Contract,FetchRequest,JsonRpcProvider,Interface,ZeroAddress,keccak256}=require('ethers');
 const load=name=>import(pathToFileURL(path.join(root,'scripts',name)).href);
 const [{getZeroStartProfile},{verifyZeroStartTarget},{createZeroStartProofProviders},{validateDailyPolicy,blockAtTime},{readConfig}]=await Promise.all([
  load('zero-start-profile.mjs'),load('zero-start-readiness.mjs'),load('connect-zero-start.mjs'),load('daily-profit.mjs'),import(pathToFileURL(path.join(root,'server/trades-api.mjs')).href)
 ]);
 const profile=getZeroStartProfile(true),original=privateText(envFile),settings=parseEnv(original),cfg=readConfig(settings);
 if(cfg.chainId!==97||cfg.port!==3115||cfg.address.toLowerCase()!==reliabilityTarget.toLowerCase()||settings.TRADES_ZERO_START_PROFILE!==profile.release.releaseId||settings.GLOBAL_MIGRATION_ENABLED!=='false')throw Error('RELIABILITY_CURRENT_TESTNET_REQUIRED');
 const policyText=privateText(policyFile),policy=validateDailyPolicy(JSON.parse(policyText));
 if(policy.chainId!==97||policy.vaultAddress.toLowerCase()!==reliabilityTarget.toLowerCase()||policy.basis!=='position-anniversary-principal'||![3600,900].includes(policy.periodSeconds))throw Error('RELIABILITY_EXISTING_POSITION_POLICY_REQUIRED');
 const activityText=privateText(activityFile,{optional:true,max:16384}),existing=activityText===null?null:verifyActivityPolicy(JSON.parse(activityText));
 const journalText=privateText(profile.automationDir+'/journal.json'),journal=JSON.parse(journalText);
 let fallback=[];try{fallback=settings.TRADES_RPC_URLS?JSON.parse(settings.TRADES_RPC_URLS):[];}catch{throw Error('RELIABILITY_RPC_CANDIDATES_REQUIRED');}
 if(!Array.isArray(fallback))throw Error('RELIABILITY_RPC_CANDIDATES_REQUIRED');
 const supplied=rpcFile?[privateText(rpcFile,{max:16384}).trim()]:[];
 const candidates=[...new Set([cfg.rpcUrl,...fallback,...supplied].map(rpcUrl))];
 if(candidates.length<1||candidates.length>4)throw Error('RELIABILITY_RPC_CANDIDATES_REQUIRED');
 const deployment=JSON.parse(privateText(profile.stateDir+'/deployment-public.json'));
 const connection=JSON.parse(privateText(profile.stateDir+'/connection-public.json'));
 const artifact=JSON.parse(fs.readFileSync(profile.artifactPath,'utf8'));
 const proofProviders=createZeroStartProofProviders(),approved=[],attempts=[];
 const topic=new Interface(['event SaleSettled(bytes32 indexed id,address indexed seller,address indexed asset,uint256 grossProfit,uint256 salesUsd,bytes32 evidenceHash)']).getEvent('SaleSettled').topicHash;
 try{
  for(let index=0;index<candidates.length;index++){
   const request=new FetchRequest(candidates[index]);request.timeout=10000;
   const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
   try{
    const candidateOriginal=original+(original.endsWith('\n')?'':'\n')+`TRADES_RPC_URL='${candidates[index]}'\n`;
    const verified=await verifyZeroStartTarget({provider,artifact,deploymentReport:deployment,connectionReport:connection,original:candidateOriginal,release:profile.release,confirmations:Math.max(3,cfg.confirmations),proofProviders,inspectSettlementLogs:false});
    if(verified.target.toLowerCase()!==reliabilityTarget.toLowerCase()||verified.runtimeHash.toLowerCase()!==policy.runtimeHash.toLowerCase()||verified.block!==policy.deploymentBlock)throw Error('RELIABILITY_RUNTIME_IDENTITY_MISMATCH');
    const head=await provider.getBlockNumber(),block=await provider.getBlock(Math.max(policy.deploymentBlock,head-Math.max(3,cfg.confirmations)));
    if(!block||Math.abs(Math.floor(Date.now()/1000)-block.timestamp)>600)throw Error('RELIABILITY_FRESH_CHAIN_CHECKPOINT_REQUIRED');
    const vault=new Contract(reliabilityTarget,artifact.abi,provider);
    // Prove the historical basis needed to recover an existing unpaid backlog.
    // A current getCode success alone does not establish archive support.
    const historical=await blockAtTime(provider,policy.startTimestamp,policy.deploymentBlock,block.number);
    await Promise.all([
     vault.accounts(profile.release.owner,ZeroAddress,{blockTag:historical.number}),
     vault.ledgers(profile.release.token,{blockTag:historical.number}),
     vault.dailyTargetBps(profile.release.owner,{blockTag:historical.number}),
     provider.getLogs({address:reliabilityTarget,topics:[topic],fromBlock:Math.max(policy.deploymentBlock,block.number-8),toBlock:block.number})
    ]);
    if((await provider.getBlock(block.number))?.hash!==block.hash||(await provider.getBlock(historical.number))?.hash!==historical.hash||keccak256(await provider.getCode(reliabilityTarget)).toLowerCase()!==policy.runtimeHash.toLowerCase())throw Error('RELIABILITY_RPC_ANCHOR_CHANGED');
    const reporter=await vault.reporters(profile.release.deployer,{blockTag:block.number}),paused=await vault.paused({blockTag:block.number});
    const identity={version:1,chainId:97,target:verified.target,owner:verified.owner,operator:verified.operator,queue:verified.queue,hash:verified.hash,runtimeHash:verified.runtimeHash};
    const feeBudget=journalFeeBudget(journal,identity,await provider.getBalance(profile.release.deployer,block.number));
    const funding=[],queue=new Contract(verified.queue,['function pending(address) view returns(uint256)'],provider);
    for(const asset of [ZeroAddress,profile.release.token]){
     const [ledger,cash,pending]=await Promise.all([vault.ledgers(asset,{blockTag:block.number}),vault.assetBalance(asset,{blockTag:block.number}),queue.pending(asset,{blockTag:block.number})]);
     const priorClaims=ledger.profit+ledger.feeReserve+pending,obligations=priorClaims+ledger.rewards;
     funding.push({asset,principalUnits:String(ledger.principal),profitUnits:String(ledger.profit),feeReserveUnits:String(ledger.feeReserve),pendingWithdrawalUnits:String(pending),rewardBudgetUnits:String(ledger.rewards),cashUnits:String(cash),availableForNewProfitUnits:String(cash>priorClaims?cash-priorClaims:0n),cashShortfallUnits:String(obligations>cash?obligations-cash:0n)});
    }
    if((await provider.getBlock(block.number))?.hash!==block.hash)throw Error('RELIABILITY_RPC_ANCHOR_CHANGED');
    approved.push({url:candidates[index],checkpoint:{number:block.number,hash:block.hash,timestamp:block.timestamp},reporterAuthorized:reporter,paused,queue:verified.queue,funding,feeBudget});
    attempts.push({candidate:index,verified:true});
   }catch(error){
    if(/^RELIABILITY_(JOURNAL_IDENTITY_MISMATCH|FINANCIAL_JOURNAL_INVALID)$/.test(error?.message||''))throw error;
    // Provider messages may embed credentials. Expose only a fixed diagnostic.
    attempts.push({candidate:index,verified:false,reason:'CHAIN_IDENTITY_LOG_OR_ARCHIVE_READ_FAILED'});
   }finally{provider.destroy();}
  }
 }finally{for(const provider of proofProviders)provider.destroy();}
 if(!approved.length){const e=Error('RELIABILITY_VERIFIED_RPC_REQUIRED');e.safeReport={attempts,transactionsSent:0,signerOpened:false};throw e;}
 const first=approved[0],activity=existing||verifyActivityPolicy({version:1,chainId:97,vaultAddress:reliabilityTarget,origin,windowSeconds:86400,activationTimestamp:first.checkpoint.timestamp+86400,historyFile:activityHistory});
 const next=renderReliabilityEnv(original,approved.map(row=>row.url),activity);
 const waitingFor=[...(!first.reporterAuthorized?['REPORTER_AUTHORIZATION_REQUIRED']:[]),...(first.paused?['CONTRACT_PAUSED']:[]),...(first.funding.every(row=>row.rewardBudgetUnits==='0')?['REWARD_BUDGET_EMPTY']:[]),...(first.funding.some(row=>row.cashShortfallUnits!=='0')?['VAULT_CASH_SHORTFALL']:[]),...first.feeBudget.waitingFor];
 const report={version:1,kind:'global-daily-reliability-preflight',chainId:97,target:reliabilityTarget,runtimeHash:policy.runtimeHash,periodSeconds:policy.periodSeconds,acceleratedTestSchedule:true,checkpoint:first.checkpoint,reporterAuthorized:first.reporterAuthorized,paused:first.paused,queue:first.queue,funding:first.funding,feeBudget:first.feeBudget,waitingFor,verifiedRpcCount:approved.length,attempts,activityPolicy:activity,activityPolicyAlreadyPresent:existing!==null,originalEnvSha256:sha(original),stagedEnvSha256:sha(next),dailyPolicySha256:sha(policyText),originalJournalSha256:sha(journalText),originalActivityPolicySha256:activityText===null?null:sha(activityText),transactionsSent:0,signerOpened:false};
 if(stage){
  writeStage(stage,'trades.env',next);
  // Preserve the exact existing policy text and activation on every reinstall.
  writeStage(stage,'daily-activity-policy.json',activityText===null?json(activity):activityText);
  writeStage(stage,'preflight.json',json(report));
 }
 return report;
}

let invoked;
try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(process.argv[1])).href;}catch{}
if(import.meta.url===invoked){
 try{
  if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
  let runtime,stage,rpcFile;const args=process.argv.slice(2);
  for(let i=0;i<args.length;i++){
   const name=args[i];
   if(name==='--check')continue;
   if(!['--runtime','--stage','--rpc-file'].includes(name)||!args[i+1]||!path.isAbsolute(args[i+1]))throw Error('RELIABILITY_PREFLIGHT_ARGUMENTS_REQUIRED');
   const value=args[++i];if(name==='--runtime')runtime=value;else if(name==='--stage')stage=value;else rpcFile=value;
  }
  if(!runtime)throw Error('RELIABILITY_RUNTIME_REQUIRED');
  console.log(JSON.stringify(await prepareDailyReliability({runtime,stage,rpcFile})));
 }catch(e){console.log(JSON.stringify({status:'blocked',error:/^[A-Z][A-Z0-9_]+$/.test(e.message||'')?e.message:'RELIABILITY_PREFLIGHT_FAILED',...(e.safeReport||{}),transactionsSent:0,signerOpened:false}));process.exitCode=1;}
}
