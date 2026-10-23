// Read-only chain verification and private configuration staging. Never loads a signer.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,getAddress,getCreateAddress,keccak256} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {zeroStartRelease,validateZeroStartRelease} from './deploy-zero-start.mjs';
import {writePrivateJson} from './migration-journal.mjs';
import {parseZeroStartProfileArgs} from './zero-start-profile.mjs';

const changedKeys=['TRADES_CHAIN_ID','TRADES_VAULT_ADDRESS','TRADES_START_BLOCK','TRADES_PORT','GLOBAL_MIGRATION_ENABLED'];
const queueAbi=['function vault() view returns(address)','function APPROVAL_VERSION() view returns(uint256)'];
const expectedRuntimeBytes={AutomaticGroupVault:24181,FastTestnetVault:24192};
const digest=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function existingSettings(original){
 let settings,config;
 try{settings=parseEnv(original);config=readConfig(settings);}catch{throw Error('EXISTING_TESTNET_CONFIGURATION_REQUIRED');}
 if(settings.TRADES_CHAIN_ID!=='97'||!config.rpcUrl||!config.address)throw Error('EXISTING_TESTNET_CONFIGURATION_REQUIRED');
 return {settings,config};
}

function renderConnectionSettings(original,report){
 const updates={TRADES_CHAIN_ID:'97',TRADES_VAULT_ADDRESS:report.contractAddress,TRADES_START_BLOCK:String(report.block),TRADES_PORT:'3115',GLOBAL_MIGRATION_ENABLED:'false'};
 const before=parseEnv(original);
 // Record explicit fast selection. If a later explicit default connection replaces it,
 // update the existing marker instead of retaining a stale profile for its worker.
 const keys=[...changedKeys];
 if(report.initialServerReporter||Object.hasOwn(before,'TRADES_ZERO_START_PROFILE')){keys.push('TRADES_ZERO_START_PROFILE');updates.TRADES_ZERO_START_PROFILE=report.releaseId;}
 if(keys.every(key=>before[key]===updates[key]))return original;
 // Last assignments take precedence in both dotenv and systemd EnvironmentFile. Appending
 // preserves quoted multiline secrets verbatim, including text resembling another assignment.
 const env=original+(original.endsWith('\n')?'':'\n')+keys.map(key=>`${key}="${updates[key]}"`).join('\n')+'\n';
 const after=parseEnv(env),retained=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)).sort(([a],[b])=>a.localeCompare(b)));
 if(!same(retained(before),retained(after))||keys.some(key=>after[key]!==updates[key]))throw Error('ZERO_START_ENV_PRESERVATION_FAILED');
 return env;
}

function identityOf(report,queueRuntimeHash){
 return {version:1,releaseId:report.releaseId,chainId:97,target:report.contractAddress,owner:report.owner,queue:report.queue,hash:report.hash,block:report.block,blockHash:report.blockHash,artifactHash:report.artifactHash,initcodeHash:report.initcodeHash,runtimeHash:report.runtimeHash,queueRuntimeHash,...fastReportFields(report)};
}

const fastReportFields=report=>report.initialServerReporter?{testMode:true,initialServerReporter:true,fastTestnetVersion:1}:{};

export async function verifyZeroStartCreation({provider,artifact,release=zeroStartRelease,hash,confirmations=3}){
 const c=validateZeroStartRelease(release),bytecode=artifact.bytecode||'0x'+artifact.evm?.bytecode?.object;
 if(!/^0x(?:[0-9a-f]{2})+$/i.test(bytecode)||keccak256(bytecode)!==c.artifactHash)throw Error('ZERO_START_ARTIFACT_MISMATCH');
 if(!Number.isSafeInteger(confirmations)||confirmations<1)throw Error('ZERO_START_CONFIRMATIONS_REQUIRED');
 if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
 if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw Error('ZERO_START_TRANSACTION_REQUIRED');
 const expected=await new ContractFactory(artifact.abi,bytecode).getDeployTransaction(c.owner,c.token,c.bnbFeed,c.tokenFeed,c.age,c.partners,c.operations);
 const [receipt,transaction]=await Promise.all([provider.getTransactionReceipt(hash),provider.getTransaction(hash)]);
 if(!receipt||receipt.status!==1||!receipt.contractAddress)throw Error('ZERO_START_RECEIPT_REQUIRED');
 if(!transaction||transaction.hash.toLowerCase()!==hash.toLowerCase()||transaction.to!==null||getAddress(transaction.from)!==c.deployer||transaction.chainId!==97n||transaction.value!==0n||transaction.data.toLowerCase()!==expected.data.toLowerCase())throw Error('ZERO_START_TRANSACTION_MISMATCH');
 const target=getAddress(receipt.contractAddress);
 if(target!==getCreateAddress({from:c.deployer,nonce:transaction.nonce}))throw Error('ZERO_START_CREATE_ADDRESS_MISMATCH');
 const block=await provider.getBlock(receipt.blockNumber);
 if(block?.hash!==receipt.blockHash||(await provider.getBlockNumber())-receipt.blockNumber+1<confirmations)throw Error('ZERO_START_RECEIPT_NOT_FINAL');
 // This pinned, non-upgradeable constructor creates empty user mappings and a new queue. It
 // contains no import path. This proves initialization without requiring retained archive state.
 return {version:1,releaseId:c.releaseId,chainId:97,contractAddress:target,owner:c.owner,deployer:c.deployer,hash,block:receipt.blockNumber,blockHash:receipt.blockHash,queue:getCreateAddress({from:target,nonce:1}),artifactHash:c.artifactHash,initcodeHash:keccak256(expected.data),approvalVersion:1,automaticGroupVersion:1,...fastReportFields(c),proofMethod:'canonical-creation-and-current-state',emptyAtInitialization:true,initialStateProof:{method:'verified-constructor-initialization',transactionHash:hash,block:receipt.blockNumber,blockHash:receipt.blockHash,importsUserData:false},historicalStateVerified:false,accountsMigrated:false,siteConnected:false,automationActive:false,dailyAutomationActive:false};
}

async function verifyConnectionTarget({provider,artifact,deploymentReport,config,release,confirmations}){
 // The saved report supplies only a transaction hash. Derive every trusted field independently.
 const report=await verifyZeroStartCreation({provider,artifact,release,hash:deploymentReport?.hash,confirmations});
 const c=validateZeroStartRelease(release),block=await provider.getBlock('latest');
 if(!block)throw Error('ZERO_START_CURRENT_BLOCK_REQUIRED');
 const o={blockTag:block.number},vault=new Contract(report.contractAddress,artifact.abi,provider),queue=new Contract(report.queue,queueAbi,provider);
 const [code,queueCode]=await Promise.all([provider.getCode(report.contractAddress,block.number),provider.getCode(report.queue,block.number)]);
 const runtime=artifact.evm?.deployedBytecode?.object;
 const runtimeBytes=expectedRuntimeBytes[c.artifact];
 if(code==='0x'||!runtime||!Number.isSafeInteger(runtimeBytes)||runtimeBytes<1||runtimeBytes>24576||runtime.length!==runtimeBytes*2||code.length!==runtimeBytes*2+2)throw Error('ZERO_START_CURRENT_RUNTIME_MISMATCH');
 if(queueCode==='0x')throw Error('ZERO_START_CURRENT_QUEUE_RUNTIME_MISMATCH');
 // Exact canonical initcode fixes the runtime of this non-upgradeable implementation. Derive
 // hashes from current chain code, rather than accepting hashes claimed by the saved report.
 report.runtimeHash=keccak256(code);
 if(getAddress(await vault.owner(o))!==c.owner)throw Error('ZERO_START_CURRENT_OWNER_MISMATCH');
 if(getAddress(await vault.withdrawalQueue(o))!==report.queue||await vault.REWARD_ACCRUAL_VERSION(o)!==1n||await vault.AUTO_REWARD_GROUP_VERSION(o)!==1n||await queue.APPROVAL_VERSION(o)!==1n||getAddress(await queue.vault(o))!==report.contractAddress)throw Error('ZERO_START_CURRENT_CAPABILITY_MISMATCH');
 if(c.initialServerReporter&&(await vault.FAST_TESTNET_VERSION(o)!==1n||!await vault.reporters(c.deployer,o)))throw Error('ZERO_START_CURRENT_FAST_TESTNET_CAPABILITY_MISMATCH');
 for(const [method,expected] of [['usdt',c.token],['bnbUsdFeed',c.bnbFeed],['usdtUsdFeed',c.tokenFeed],['dropshippingWallet',c.operations]])if(getAddress(await vault[method](o))!==expected)throw Error('ZERO_START_CURRENT_SETTINGS_MISMATCH');
 if(await vault.maxOracleAge(o)!==BigInt(c.age))throw Error('ZERO_START_CURRENT_SETTINGS_MISMATCH');
 for(let i=0;i<7;i++)if(getAddress(await vault.partnerWallets(i,o))!==c.partners[i])throw Error('ZERO_START_CURRENT_SETTINGS_MISMATCH');
 const paused=await vault.paused(o),partnerVotesRequired=Number(await vault.partnerVotesRequired(o));
 // Probe one configured settlement-log page; never read a previous contract or import its history.
 const toBlock=block.number-config.confirmations;
 let settlementLogProbe={status:'awaiting-confirmations',fromBlock:null,toBlock};
 if(toBlock>=report.block){
  const fromBlock=Math.max(report.block,toBlock-config.pageSize+1);
  try{await provider.getLogs({address:report.contractAddress,topics:[vault.interface.getEvent('SaleSettled').topicHash],fromBlock,toBlock});}
  catch{throw Error('ZERO_START_SETTLEMENT_LOG_RPC_REQUIRED');}
  settlementLogProbe={status:'supported',fromBlock,toBlock};
 }
 if((await provider.getBlock(block.number))?.hash!==block.hash)throw Error('ZERO_START_CURRENT_CHECKPOINT_REORG');
 if((await provider.getBlock(report.block))?.hash!==report.blockHash)throw Error('ZERO_START_RECEIPT_NOT_FINAL');
 return {report,identity:identityOf(report,keccak256(queueCode)),currentState:{block:block.number,blockHash:block.hash,paused,partnerVotesRequired,settlementLogProbe}};
}

export async function prepareZeroStartConnection({provider,artifact,deploymentReport,original,release=zeroStartRelease,confirmations=3}){
 const {config}=existingSettings(original);
 const verified=await verifyConnectionTarget({provider,artifact,deploymentReport,config,release,confirmations});
 const env=renderConnectionSettings(original,verified.report);
 const report={...verified.report,kind:'fresh-zero-site-connection',target:verified.report.contractAddress,identity:verified.identity,originalEnvHash:digest(original),stagedEnvHash:digest(env),currentState:verified.currentState,communityDataPreserved:true,verified:true,siteConnected:false,transactionsSent:0};
 return {env,report};
}

function assertStagedConnection(stage,stagedEnv){
 if(stage?.version!==1||stage.kind!=='fresh-zero-site-connection'||!stage.identity||!/^([0-9a-f]{64})$/.test(stage.originalEnvHash||'')||!/^([0-9a-f]{64})$/.test(stage.stagedEnvHash||''))throw Error('ZERO_START_STAGED_REPORT_REQUIRED');
 if(digest(stagedEnv)!==stage.stagedEnvHash)throw Error('ZERO_START_STAGED_ENV_CHANGED');
}

function assertStagedIdentity(stage,verified){
 if(!same(stage.identity,verified.identity))throw Error('ZERO_START_STAGED_IDENTITY_CHANGED');
 for(const key of ['releaseId','contractAddress','owner','queue','hash','block','blockHash','artifactHash','initcodeHash','runtimeHash','testMode','initialServerReporter','fastTestnetVersion'])if(stage[key]!==verified.report[key])throw Error('ZERO_START_STAGED_IDENTITY_CHANGED');
 if(stage.target!==verified.report.contractAddress)throw Error('ZERO_START_STAGED_IDENTITY_CHANGED');
}

export async function checkZeroStartConnection({provider,artifact,deploymentReport,original,stagedEnv,stage,release=zeroStartRelease,confirmations=3}){
 assertStagedConnection(stage,stagedEnv);
 if(digest(original)!==stage.originalEnvHash)throw Error('ZERO_START_ORIGINAL_ENV_CHANGED');
 const prepared=await prepareZeroStartConnection({provider,artifact,deploymentReport,original,release,confirmations});
 assertStagedIdentity(stage,{identity:prepared.report.identity,report:prepared.report});
 if(prepared.env!==stagedEnv)throw Error('ZERO_START_STAGED_ENV_MISMATCH');
 return prepared.report;
}

function verifySiteEvidence(active,frontend,target){
 let activeTarget,frontendTarget;
 try{activeTarget=getAddress(active?.vaultAddress);frontendTarget=getAddress(frontend?.vaultAddress);}catch{throw Error('ZERO_START_SITE_EVIDENCE_REQUIRED');}
 if(active.version!==1||active.chainId!==97||activeTarget!==target)throw Error('ZERO_START_ACTIVE_CONFIG_MISMATCH');
 if(frontend.version!==1||frontend.chainId!==97||frontendTarget!==target||frontend.verified!==true)throw Error('ZERO_START_FRONTEND_EVIDENCE_REQUIRED');
 const hashes=[frontend.indexSha256,frontend.servedIndexSha256,frontend.expectedIndexSha256];
 if(!hashes.every(value=>/^[0-9a-f]{64}$/.test(value||''))||new Set(hashes).size!==1)throw Error('ZERO_START_FRONTEND_HASH_MISMATCH');
 return hashes[0];
}

export async function publishZeroStartConnection({provider,artifact,deploymentReport,current,stagedEnv,stage,active,frontend,release=zeroStartRelease,confirmations=3}){
 assertStagedConnection(stage,stagedEnv);
 if(current!==stagedEnv)throw Error('ZERO_START_INSTALLED_ENV_MISMATCH');
 const {config,settings}=existingSettings(current);
 if(settings.GLOBAL_MIGRATION_ENABLED!=='false')throw Error('ZERO_START_LEGACY_MIGRATION_MUST_BE_DISABLED');
 const selected=validateZeroStartRelease(release);
 if((selected.initialServerReporter||Object.hasOwn(settings,'TRADES_ZERO_START_PROFILE'))&&settings.TRADES_ZERO_START_PROFILE!==selected.releaseId)throw Error('ZERO_START_INSTALLED_PROFILE_MISMATCH');
 const verified=await verifyConnectionTarget({provider,artifact,deploymentReport,config,release,confirmations});
 assertStagedIdentity(stage,verified);
 if(config.address!==verified.report.contractAddress||config.startBlock!==verified.report.block||config.port!==3115)throw Error('ZERO_START_SITE_TARGET_NOT_INSTALLED');
 const frontendIndexSha256=verifySiteEvidence(active,frontend,verified.report.contractAddress);
 // Deliberate allowlist: no environment contents, RPC URL, API keys or private staging fingerprints.
 return {version:1,kind:'fresh-zero-site-connection',releaseId:verified.report.releaseId,chainId:97,target:verified.report.contractAddress,contractAddress:verified.report.contractAddress,owner:verified.report.owner,queue:verified.report.queue,hash:verified.report.hash,block:verified.report.block,blockHash:verified.report.blockHash,artifactHash:verified.report.artifactHash,initcodeHash:verified.report.initcodeHash,runtimeHash:verified.report.runtimeHash,approvalVersion:1,automaticGroupVersion:1,...fastReportFields(verified.report),proofMethod:verified.report.proofMethod,emptyAtInitialization:true,initialStateProof:verified.report.initialStateProof,historicalStateVerified:false,currentState:verified.currentState,frontendIndexSha256,communityDataPreserved:true,verified:true,siteConnected:true,accountsMigrated:false,automationActive:false,dailyAutomationActive:false,transactionsSent:0};
}

function privateDirectory(directory,{create=false}={}){
 if(create)fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const s=fs.lstatSync(directory);if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_CONNECTION_DIRECTORY_REQUIRED');
}

function readPrivate(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_CONNECTION_FILE_REQUIRED');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
}

function writeNewPrivate(file,value){
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}

async function main(){
 const {profile,args:cliArgs}=parseZeroStartProfileArgs();
 const [mode,directoryArg,...extra]=cliArgs;
 if(!['prepare','check','publish'].includes(mode)||!directoryArg||extra.length)throw Error('USAGE_PREPARE_CHECK_OR_PUBLISH_OUTPUT_DIRECTORY');
 if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
 const directory=path.resolve(directoryArg);privateDirectory(directory,{create:mode==='prepare'});
 const envFile='/etc/globaldroptrade/trades.env',original=readPrivate(envFile),{config}=existingSettings(original);
 const assertOriginalUnchanged=()=>{if(readPrivate(envFile)!==original)throw Error('ZERO_START_ORIGINAL_ENV_CHANGED');};
 const reportDirectory=profile.deploymentDir;privateDirectory(reportDirectory);
 const deploymentReport=JSON.parse(readPrivate(path.join(reportDirectory,'deployment-public.json')));
 const artifact=JSON.parse(fs.readFileSync(profile.artifactUrl,'utf8'));
 const request=new FetchRequest(config.rpcUrl);request.timeout=15000;
 const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 const args={provider,artifact,deploymentReport,release:profile.release,confirmations:Math.max(3,config.confirmations)};
 try{
  if(mode==='prepare'){
   const prepared=await prepareZeroStartConnection({...args,original});
   assertOriginalUnchanged();
   writeNewPrivate(path.join(directory,'trades.env'),prepared.env);
   writeNewPrivate(path.join(directory,'zero-start-connection.json'),JSON.stringify(prepared.report,null,2)+'\n');
   console.log('ZERO_START_CONNECTION_PREFLIGHT_OK '+prepared.report.target);
  }else{
   const stagedEnv=readPrivate(path.join(directory,'trades.env')),stage=JSON.parse(readPrivate(path.join(directory,'zero-start-connection.json')));
   if(mode==='check'){
    const report=await checkZeroStartConnection({...args,original,stagedEnv,stage});
    assertOriginalUnchanged();
    console.log('ZERO_START_STAGED_CONNECTION_RECHECKED '+report.target);
   }else{
    const active=JSON.parse(readPrivate(path.join(directory,'active.json'))),frontend=JSON.parse(readPrivate(path.join(directory,'frontend-check.json')));
    const report=await publishZeroStartConnection({...args,current:original,stagedEnv,stage,active,frontend});
    assertOriginalUnchanged();
    const file=path.join(reportDirectory,'connection-public.json');if(fs.existsSync(file))readPrivate(file);
    writePrivateJson(file,report);
    console.log('ZERO_START_SITE_CONNECTION_PUBLISHED '+report.target);console.log('REPORT='+file);
   }
  }
 }finally{provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
 console.error('ZERO_START_CONNECTION_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message||'')?e.message:'RPC_OR_VERIFICATION_FAILED'));process.exitCode=1;
});
