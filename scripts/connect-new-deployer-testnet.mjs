// Verify and stage the isolated replacement-deployer testnet connection.
// This module never reads a signing key, retries V1 work, or writes a V1 archive/journal.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Contract,ContractFactory,FetchRequest,Interface,JsonRpcProvider,ZeroAddress,getAddress,getCreateAddress,keccak256} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {writePrivateJson} from './migration-journal.mjs';
import {
    LEGACY_ARCHIVE_SESSION,NEW_DEPLOYER_ADDRESS,NEW_DEPLOYER_ARTIFACT,
    NEW_DEPLOYER_ARTIFACT_FILE,NEW_DEPLOYER_ARTIFACT_HASH,NEW_DEPLOYER_RELEASE_ID,
    NEW_DEPLOYER_STATE_DIR,loadNewDeployerRelease,validateNewDeployerRelease
} from './new-deployer-testnet-profile.mjs';

export const NEW_DEPLOYER_CONNECTION_DIR='/var/lib/globaldroptrade/new-deployer-testnet-connection';
export const NEW_DEPLOYER_CONNECTION_KIND='new-deployer-testnet-site-connection';
export const NEW_DEPLOYER_CONFIG_DIR='/etc/globaldroptrade/new-deployer-testnet-v1';
const LEGACY_ARCHIVE_REVISION='fb4156453a046ba55a99dbbcf276be5019ba7f9b';
const LEGACY_ARCHIVE_TARGET='0xB5c3C0f8fc30b2FDB8b16d2325127dAe7C8DCD5B';
const changedKeys=['TRADES_CHAIN_ID','TRADES_VAULT_ADDRESS','TRADES_START_BLOCK','TRADES_PORT','GLOBAL_MIGRATION_ENABLED','TRADES_ZERO_START_PROFILE','GLOBAL_AUTOMATION_PUBLIC_STATUS'];
const queueAbi=['function vault() view returns(address)','function APPROVAL_VERSION() view returns(uint256)','function requestCount() view returns(uint256)','function pending(address) view returns(uint256)'];
const vaultAbi=[
    'function owner() view returns(address)','function reporters(address) view returns(bool)','function FAST_TESTNET_VERSION() view returns(uint256)',
    'function withdrawalQueue() view returns(address)','function paused() view returns(bool)','function volumeJobCount() view returns(uint256)',
    'function usdt() view returns(address)','function bnbUsdFeed() view returns(address)','function usdtUsdFeed() view returns(address)','function dropshippingWallet() view returns(address)','function tokenDecimals() view returns(uint8)',
    'function maxOracleAge() view returns(uint256)','function partnerVotesRequired() view returns(uint8)','function partnerWallets(uint256) view returns(address)',
    'function ledgers(address) view returns(uint256 principal,uint256 profit,uint256 feeReserve,uint256 rewards)','function assetBalance(address) view returns(uint256)',
    'function users(address) view returns(address referrer,bool registered,bool active,bool vipKyc,uint32 activeDirect,uint256 capitalUsd,uint256 salesUsd)','function positionCount(address) view returns(uint256)','function rewardGroupCount(address) view returns(uint256)',
    'function REWARD_ACCRUAL_VERSION() view returns(uint256)','function AUTO_REWARD_GROUP_VERSION() view returns(uint256)'
];
const registered=new Interface(['event Registered(address indexed user,address indexed referrer)']);
const sha256=value=>createHash('sha256').update(value).digest('hex');
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const hash=/^0x[0-9a-f]{64}$/i;

function privateStat(file,{directory=false,expectedUid=0}={}){
    const stat=fs.lstatSync(file);
    if((directory?!stat.isDirectory():!stat.isFile())||stat.uid!==expectedUid||(stat.mode&0o077)!==0)throw Error(directory?'NEW_DEPLOYER_PRIVATE_DIRECTORY_REQUIRED':'NEW_DEPLOYER_PRIVATE_FILE_REQUIRED');
    return stat;
}

export function readNewDeployerPrivateBytes(file,{expectedUid=0}={}){
    privateStat(path.dirname(file),{directory:true,expectedUid});
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{
        const stat=fs.fstatSync(fd);
        if(!stat.isFile()||stat.uid!==expectedUid||(stat.mode&0o077)!==0)throw Error('NEW_DEPLOYER_PRIVATE_FILE_REQUIRED');
        return fs.readFileSync(fd);
    }finally{fs.closeSync(fd);}
}

export function readNewDeployerPrivateText(file,options={}){return readNewDeployerPrivateBytes(file,options).toString('utf8');}

function address(value,code){
    try{const result=getAddress(value);if(result===ZeroAddress)throw Error();return result;}catch{throw Error(code);}
}

function originalPlan(){
    let value;
    try{value=JSON.parse(fs.readFileSync(new URL('../config/fresh-fast-testnet.json',import.meta.url),'utf8'));}catch{throw Error('NEW_DEPLOYER_ORIGINAL_PLAN_REQUIRED');}
    try{return {owner:address(value.owner,'NEW_DEPLOYER_ORIGINAL_PLAN_REQUIRED'),token:address(value.token,'NEW_DEPLOYER_ORIGINAL_PLAN_REQUIRED'),bnbFeed:address(value.bnbFeed,'NEW_DEPLOYER_ORIGINAL_PLAN_REQUIRED'),tokenFeed:address(value.tokenFeed,'NEW_DEPLOYER_ORIGINAL_PLAN_REQUIRED'),operations:address(value.operations,'NEW_DEPLOYER_ORIGINAL_PLAN_REQUIRED'),age:String(value.age),partners:value.partners.map(entry=>address(entry,'NEW_DEPLOYER_ORIGINAL_PLAN_REQUIRED'))};}
    catch(error){if(error?.message==='NEW_DEPLOYER_ORIGINAL_PLAN_REQUIRED')throw error;throw Error('NEW_DEPLOYER_ORIGINAL_PLAN_REQUIRED');}
}

// The connection repeats the profile pinning so a changed deployment helper cannot alter
// the existing financial plan, owner, partners, oracle addresses, or reviewed bytecode.
export function validateNewDeployerConnectionRelease(value,{plan=originalPlan()}={}){
    const release=validateNewDeployerRelease(value);
    if(release.releaseId!==NEW_DEPLOYER_RELEASE_ID||release.artifact!==NEW_DEPLOYER_ARTIFACT||release.deployer!==NEW_DEPLOYER_ADDRESS||release.artifactHash!==NEW_DEPLOYER_ARTIFACT_HASH||release.owner!==plan.owner||release.token!==plan.token||release.bnbFeed!==plan.bnbFeed||release.tokenFeed!==plan.tokenFeed||release.operations!==plan.operations||release.age!==plan.age||!same(release.partners,plan.partners))throw Error('NEW_DEPLOYER_ORIGINAL_PLAN_MISMATCH');
    return Object.freeze({...release,newDeployerTestnetVersion:1,fastNewDeployerTestnetVersion:1});
}

export function loadNewDeployerConnectionRelease(file){return validateNewDeployerConnectionRelease(loadNewDeployerRelease(file));}

function parseArchivedSession(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==5||value.kind!=='fresh-fast-testnet-reset'||value.profile!=='global-fresh-fast-test-v1'||value.chainId!==97||value.phase!=='archived'||value.sourceRevision!==LEGACY_ARCHIVE_REVISION||!Array.isArray(value.files)||!value.files.length||!Array.isArray(value.externalSettledJournals)||!value.files.every(row=>row&&typeof row.path==='string'&&/^[0-9a-f]{64}$/i.test(row.sha256||''))||!value.externalSettledJournals.every(row=>row&&typeof row.path==='string'&&/^[0-9a-f]{64}$/i.test(row.sha256||''))||!/^[0-9a-f]{64}$/i.test(value.environmentSha256||''))throw Error('NEW_DEPLOYER_LEGACY_ARCHIVE_INVALID');
    const oldTarget=address(value.oldTarget,'NEW_DEPLOYER_LEGACY_ARCHIVE_INVALID');
    if(oldTarget!==LEGACY_ARCHIVE_TARGET)throw Error('NEW_DEPLOYER_LEGACY_ARCHIVE_INVALID');
    const externalNames=new Set(['automation-v1/journal.json','oracle-maintenance-v1/journal.json','fresh-zero-automation-v1/journal.json','zero-oracle-repair-v1/journal.json']);
    const archivedNames=new Set(['fresh-fast-testnet-v1','fresh-fast-testnet-automation-v1']);
    const paths=[...value.files,...value.externalSettledJournals].map(row=>row.path);
    if(new Set(paths).size!==paths.length||value.files.some(row=>{const parts=row.path.split('/');return parts.length!==2||!archivedNames.has(parts[0])||parts[1].endsWith('.lock');})||value.externalSettledJournals.some(row=>!externalNames.has(row.path)))throw Error('NEW_DEPLOYER_LEGACY_ARCHIVE_INVALID');
    return {phase:'archived',oldTarget,sourceRevision:value.sourceRevision.toLowerCase(),files:[...value.files,...value.externalSettledJournals]};
}

function archivedPath(root,relative){
    if(typeof relative!=='string'||relative.length>240)throw Error('NEW_DEPLOYER_LEGACY_ARCHIVE_INVALID');
    const parts=relative.split('/');
    if(parts.length!==2||parts.some(part=>!part||part==='.'||part==='..'||path.sep!== '/'&&part.includes(path.sep)))throw Error('NEW_DEPLOYER_LEGACY_ARCHIVE_INVALID');
    return path.join(root,'previous-state',...parts);
}

function verifyArchivedFiles(root,files,expectedUid){
    privateStat(path.join(root,'previous-state'),{directory:true,expectedUid});
    for(const row of files){
        const target=archivedPath(root,row.path),contents=readNewDeployerPrivateBytes(target,{expectedUid});
        if(sha256(contents)!==row.sha256.toLowerCase())throw Error('NEW_DEPLOYER_LEGACY_ARCHIVE_INVALID');
    }
}

// V1 stays read-only: only this digest and public old target are used by the new profile.
export function readImmutableV1Archive({file=LEGACY_ARCHIVE_SESSION,expectedUid=0}={}){
    const text=readNewDeployerPrivateText(file,{expectedUid});
    let value;try{value=JSON.parse(text);}catch{throw Error('NEW_DEPLOYER_LEGACY_ARCHIVE_INVALID');}
    const parsed=parseArchivedSession(value);verifyArchivedFiles(path.dirname(file),parsed.files,expectedUid);
    return Object.freeze({phase:parsed.phase,oldTarget:parsed.oldTarget,sourceRevision:parsed.sourceRevision,file,digest:sha256(text),files:parsed.files.length});
}

export function assertImmutableV1Archive(archive,{expectedUid=0}={}){
    if(!archive||typeof archive.file!=='string'||!/^[0-9a-f]{64}$/i.test(archive.digest||''))throw Error('NEW_DEPLOYER_LEGACY_ARCHIVE_REQUIRED');
    const current=readImmutableV1Archive({file:archive.file,expectedUid});
    if(current.digest!==archive.digest||current.oldTarget!==archive.oldTarget||current.sourceRevision!==archive.sourceRevision)throw Error('NEW_DEPLOYER_ARCHIVE_CHANGED');
    return current;
}

function existingSettings(original){
    let settings,config;try{settings=parseEnv(original);config=readConfig(settings);}catch{throw Error('NEW_DEPLOYER_EXISTING_TESTNET_CONFIGURATION_REQUIRED');}
    if(settings.TRADES_CHAIN_ID!=='97'||config.chainId!==97||!config.rpcUrl)throw Error('NEW_DEPLOYER_EXISTING_TESTNET_CONFIGURATION_REQUIRED');
    return {settings,config};
}

export function renderNewDeployerConnectionSettings(original,report){
    const before=parseEnv(original),updates={TRADES_CHAIN_ID:'97',TRADES_VAULT_ADDRESS:report.contractAddress,TRADES_START_BLOCK:String(report.block),TRADES_PORT:'3115',GLOBAL_MIGRATION_ENABLED:'false',TRADES_ZERO_START_PROFILE:NEW_DEPLOYER_RELEASE_ID,GLOBAL_AUTOMATION_PUBLIC_STATUS:'/var/www/globaldroptrade/automation-data/new-deployer-activation.json'};
    if(changedKeys.every(key=>before[key]===updates[key]))return original;
    const staged=original+(original.endsWith('\n')?'':'\n')+changedKeys.map(key=>`${key}="${updates[key]}"`).join('\n')+'\n',after=parseEnv(staged);
    const retained=values=>Object.fromEntries(Object.entries(values).filter(([key])=>!changedKeys.includes(key)).sort(([left],[right])=>left.localeCompare(right)));
    if(!same(retained(before),retained(after))||changedKeys.some(key=>after[key]!==updates[key]))throw Error('NEW_DEPLOYER_ENV_PRESERVATION_FAILED');
    return staged;
}

function bytecode(artifact){
    const value=artifact?.bytecode||'0x'+artifact?.evm?.bytecode?.object;
    if(!/^0x(?:[0-9a-f]{2})+$/i.test(value||''))throw Error('NEW_DEPLOYER_ARTIFACT_MISMATCH');
    return value;
}

function requiredReport(report,release,archive){
    if(!report||typeof report!=='object'||Array.isArray(report)||report.version!==1||report.kind!=='new-deployer-testnet-deployment'||report.releaseId!==release.releaseId||report.artifact!==release.artifact||report.chainId!==97||report.verified!==true||report.emptyAtDeployment!==true||report.accountsMigrated!==false||report.testMode!==true||report.initialServerReporter!==true||report.fastTestnetVersion!==1||report.newDeployerTestnetVersion!==1||report.fastNewDeployerTestnetVersion!==1||report.transactionCount!==1||report.archiveSessionSha256!==archive.digest||!hash.test(report.hash||'')||!Number.isSafeInteger(report.block)||report.block<1||![report.blockHash,report.artifactHash,report.initcodeHash,report.runtimeHash].every(value=>hash.test(value||''))||report.artifactHash.toLowerCase()!==release.artifactHash)throw Error('NEW_DEPLOYER_DEPLOYMENT_REPORT_REQUIRED');
    for(const [field,expected] of Object.entries({owner:release.owner,deployer:release.deployer,token:release.token,bnbFeed:release.bnbFeed,tokenFeed:release.tokenFeed,operations:release.operations}))if(address(report[field],'NEW_DEPLOYER_DEPLOYMENT_REPORT_REQUIRED')!==expected)throw Error('NEW_DEPLOYER_DEPLOYMENT_REPORT_REQUIRED');
    address(report.contractAddress,'NEW_DEPLOYER_DEPLOYMENT_REPORT_REQUIRED');address(report.queue,'NEW_DEPLOYER_DEPLOYMENT_REPORT_REQUIRED');
}

function receiptValid(receipt,transaction,release,request,hashValue){
    try{
        return receipt?.status===1&&receipt.contractAddress&&receipt.to===null&&getAddress(receipt.from)===release.deployer&&receipt.hash.toLowerCase()===hashValue.toLowerCase()&&Number.isSafeInteger(receipt.blockNumber)&&hash.test(receipt.blockHash||'')&&transaction?.to===null&&transaction.hash.toLowerCase()===hashValue.toLowerCase()&&getAddress(transaction.from)===release.deployer&&transaction.chainId===97n&&transaction.value===0n&&Number.isSafeInteger(transaction.nonce)&&transaction.data.toLowerCase()===request.data.toLowerCase()&&getAddress(receipt.contractAddress)===getCreateAddress({from:release.deployer,nonce:transaction.nonce});
    }catch{return false;}
}

async function verifyGenesis({provider,artifact,release,receipt,block,archive}){
    const target=getAddress(receipt.contractAddress),options={blockTag:receipt.blockNumber},vault=new Contract(target,[...artifact.abi,...vaultAbi],provider),queueAddress=getAddress(await vault.withdrawalQueue(options)),expectedQueue=getCreateAddress({from:target,nonce:1}),queue=new Contract(queueAddress,queueAbi,provider);
    const [owner,ownerReporter,operatorReporter,version,paused,volume,accrual,groups,queueCode,queueVault,approval,requests]=await Promise.all([vault.owner(options),vault.reporters(release.owner,options),vault.reporters(release.deployer,options),vault.FAST_TESTNET_VERSION(options),vault.paused(options),vault.volumeJobCount(options),vault.REWARD_ACCRUAL_VERSION(options),vault.AUTO_REWARD_GROUP_VERSION(options),provider.getCode(queueAddress,receipt.blockNumber),queue.vault(options),queue.APPROVAL_VERSION(options),queue.requestCount(options)]);
    if(queueAddress!==expectedQueue||queueCode==='0x'||getAddress(owner)!==release.owner||!ownerReporter||!operatorReporter||version!==1n||paused||volume!==0n||accrual!==1n||groups!==1n||getAddress(queueVault)!==target||approval!==1n||requests!==0n||target===archive.oldTarget)throw Error('NEW_DEPLOYER_GENESIS_STATE_MISMATCH');
    for(const [method,expected] of [['usdt',release.token],['bnbUsdFeed',release.bnbFeed],['usdtUsdFeed',release.tokenFeed],['dropshippingWallet',release.operations]])if(getAddress(await vault[method](options))!==expected)throw Error('NEW_DEPLOYER_GENESIS_SETTINGS_MISMATCH');
    if(await vault.maxOracleAge(options)!==BigInt(release.age)||await vault.tokenDecimals(options)!==18n||await vault.partnerVotesRequired(options)!==2n)throw Error('NEW_DEPLOYER_GENESIS_SETTINGS_MISMATCH');
    for(let index=0;index<7;index++)if(getAddress(await vault.partnerWallets(index,options))!==release.partners[index])throw Error('NEW_DEPLOYER_GENESIS_PARTNER_MISMATCH');
    for(const asset of [ZeroAddress,release.token]){
        const [ledger,balance,pending]=await Promise.all([vault.ledgers(asset,options),vault.assetBalance(asset,options),queue.pending(asset,options)]);
        if(ledger.some(value=>value!==0n)||balance!==0n||pending!==0n)throw Error('NEW_DEPLOYER_GENESIS_NOT_EMPTY');
    }
    for(const account of [release.owner,release.deployer]){
        const [user,positions,groupsForUser]=await Promise.all([vault.users(account,options),vault.positionCount(account,options),vault.rewardGroupCount(account,options)]);
        if(getAddress(user.referrer)!==ZeroAddress||user.registered||user.active||user.vipKyc||user.activeDirect!==0n||user.capitalUsd!==0n||user.salesUsd!==0n||positions!==0n||groupsForUser!==0n)throw Error('NEW_DEPLOYER_GENESIS_NOT_EMPTY');
    }
    if((await provider.getLogs({address:target,topics:[registered.getEvent('Registered').topicHash],fromBlock:receipt.blockNumber,toBlock:receipt.blockNumber})).length)throw Error('NEW_DEPLOYER_GENESIS_NOT_EMPTY');
    if((await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('NEW_DEPLOYER_GENESIS_REORG');
    return {target,queue:queueAddress,queueRuntimeHash:keccak256(queueCode),checkpoint:{block:receipt.blockNumber,blockHash:receipt.blockHash,timestamp:Number(block.timestamp)}};
}

// Exact initcode is the immutable-runtime proof. Runtime bytecode is compared to itself at
// deployment and latest blocks because constructor immutables deliberately patch runtime bytes.
export async function verifyNewDeployerTestnetCreation({provider,artifact,deploymentReport,release=loadNewDeployerConnectionRelease(),archive,confirmations=3}){
    if(!Number.isSafeInteger(confirmations)||confirmations<1)throw Error('NEW_DEPLOYER_CONFIRMATIONS_REQUIRED');
    if(!archive||archive.phase!=='archived')throw Error('NEW_DEPLOYER_LEGACY_ARCHIVE_REQUIRED');
    const selected=validateNewDeployerConnectionRelease(release),artifactBytecode=bytecode(artifact);
    if(keccak256(artifactBytecode)!==selected.artifactHash)throw Error('NEW_DEPLOYER_ARTIFACT_MISMATCH');
    requiredReport(deploymentReport,selected,archive);
    if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
    const request=await new ContractFactory(artifact.abi,artifactBytecode).getDeployTransaction(selected.owner,selected.token,selected.bnbFeed,selected.tokenFeed,selected.age,selected.partners,selected.operations);
    const [receipt,transaction]=await Promise.all([provider.getTransactionReceipt(deploymentReport.hash),provider.getTransaction(deploymentReport.hash)]);
    if(!receiptValid(receipt,transaction,selected,request,deploymentReport.hash))throw Error('NEW_DEPLOYER_CREATION_PROOF_REQUIRED');
    const [deploymentBlock,head,historicCode,currentCode]=await Promise.all([provider.getBlock(receipt.blockNumber),provider.getBlockNumber(),provider.getCode(receipt.contractAddress,receipt.blockNumber),provider.getCode(receipt.contractAddress)]);
    if(!deploymentBlock||deploymentBlock.hash!==receipt.blockHash||head-receipt.blockNumber+1<confirmations||historicCode==='0x'||currentCode==='0x'||keccak256(historicCode)!==keccak256(currentCode)||deploymentReport.block!==receipt.blockNumber||deploymentReport.blockHash.toLowerCase()!==receipt.blockHash.toLowerCase()||address(deploymentReport.contractAddress,'NEW_DEPLOYER_DEPLOYMENT_REPORT_MISMATCH')!==getAddress(receipt.contractAddress)||deploymentReport.initcodeHash.toLowerCase()!==keccak256(request.data).toLowerCase()||deploymentReport.runtimeHash.toLowerCase()!==keccak256(currentCode).toLowerCase())throw Error('NEW_DEPLOYER_DEPLOYMENT_REPORT_MISMATCH');
    const genesis=await verifyGenesis({provider,artifact,release:selected,receipt,block:deploymentBlock,archive});
    if(address(deploymentReport.queue,'NEW_DEPLOYER_DEPLOYMENT_REPORT_MISMATCH')!==genesis.queue)throw Error('NEW_DEPLOYER_DEPLOYMENT_REPORT_MISMATCH');
    return Object.freeze({version:1,kind:'new-deployer-testnet-canonical-creation',releaseId:selected.releaseId,profile:selected.releaseId,stateDir:NEW_DEPLOYER_STATE_DIR,connectionDir:NEW_DEPLOYER_CONNECTION_DIR,artifact:selected.artifact,chainId:97,target:genesis.target,contractAddress:genesis.target,vaultAddress:genesis.target,owner:selected.owner,operator:selected.deployer,deployer:selected.deployer,token:selected.token,bnbFeed:selected.bnbFeed,tokenFeed:selected.tokenFeed,operations:selected.operations,partners:selected.partners,age:selected.age,queue:genesis.queue,hash:receipt.hash,block:receipt.blockNumber,deploymentBlock:receipt.blockNumber,blockHash:receipt.blockHash,deploymentTimestamp:Number(deploymentBlock.timestamp),startTimestamp:Number(deploymentBlock.timestamp),artifactHash:selected.artifactHash,initcodeHash:keccak256(request.data),runtimeHash:keccak256(currentCode),queueRuntimeHash:genesis.queueRuntimeHash,checkpoint:genesis.checkpoint,archiveSessionSha256:archive.digest,legacyTarget:archive.oldTarget,proofMethod:'canonical-creation-current-runtime-and-genesis',emptyAtDeployment:true,accountsMigrated:false,testMode:true,initialServerReporter:true,fastTestnetVersion:1,newDeployerTestnetVersion:1,fastNewDeployerTestnetVersion:1,verified:true,transactionsSent:0,signerOpened:false});
}

function identity(report,archive){return {version:1,releaseId:report.releaseId,artifact:report.artifact,chainId:97,target:report.target,owner:report.owner,operator:report.operator,deployer:report.deployer,queue:report.queue,hash:report.hash,block:report.block,blockHash:report.blockHash,artifactHash:report.artifactHash,initcodeHash:report.initcodeHash,runtimeHash:report.runtimeHash,queueRuntimeHash:report.queueRuntimeHash,archiveSessionSha256:archive.digest,testMode:true,initialServerReporter:true,fastTestnetVersion:1,newDeployerTestnetVersion:1,fastNewDeployerTestnetVersion:1};}

async function verifiedTarget(options){
    const report=await verifyNewDeployerTestnetCreation(options),latest=await options.provider.getBlock('latest');
    if(!latest||(await options.provider.getBlock(latest.number))?.hash!==latest.hash||(await options.provider.getBlock(report.block))?.hash!==report.blockHash)throw Error('NEW_DEPLOYER_CURRENT_CHECKPOINT_REORG');
    const [code,queueCode]=await Promise.all([options.provider.getCode(report.target,latest.number),options.provider.getCode(report.queue,latest.number)]);
    if(code==='0x'||queueCode==='0x'||keccak256(code)!==report.runtimeHash)throw Error('NEW_DEPLOYER_CURRENT_RUNTIME_MISMATCH');
    return {report,identity:identity(report,options.archive),currentState:{block:latest.number,blockHash:latest.hash,checkpoint:report.checkpoint}};
}

export async function prepareNewDeployerTestnetConnection({provider,artifact,deploymentReport,original,release=loadNewDeployerConnectionRelease(),archive,confirmations=3}){
    existingSettings(original);
    const verified=await verifiedTarget({provider,artifact,deploymentReport,release,archive,confirmations}),env=renderNewDeployerConnectionSettings(original,verified.report);
    return {env,report:{...verified.report,kind:NEW_DEPLOYER_CONNECTION_KIND,identity:verified.identity,currentState:verified.currentState,originalEnvHash:sha256(original),stagedEnvHash:sha256(env),deploymentReportHash:sha256(JSON.stringify(deploymentReport)),communityDataPreserved:true,siteConnected:false,automationActive:false,dailyAutomationActive:false}};
}

function assertStage(stage,stagedEnv){
    if(!stage||stage.version!==1||stage.kind!==NEW_DEPLOYER_CONNECTION_KIND||!stage.identity||![stage.originalEnvHash,stage.stagedEnvHash,stage.deploymentReportHash,stage.archiveSessionSha256].every(value=>/^[0-9a-f]{64}$/i.test(value||'')))throw Error('NEW_DEPLOYER_STAGED_REPORT_REQUIRED');
    if(sha256(stagedEnv)!==stage.stagedEnvHash)throw Error('NEW_DEPLOYER_STAGED_ENV_CHANGED');
}

function assertIdentity(stage,verified){
    if(!same(stage.identity,verified.identity))throw Error('NEW_DEPLOYER_STAGED_IDENTITY_CHANGED');
    for(const field of ['releaseId','artifact','target','contractAddress','owner','operator','deployer','queue','hash','block','blockHash','artifactHash','initcodeHash','runtimeHash','archiveSessionSha256'])if(stage[field]!==verified.report[field])throw Error('NEW_DEPLOYER_STAGED_IDENTITY_CHANGED');
}

export async function checkNewDeployerTestnetConnection({provider,artifact,deploymentReport,original,stagedEnv,stage,release=loadNewDeployerConnectionRelease(),archive,confirmations=3}){
    assertStage(stage,stagedEnv);
    if(sha256(original)!==stage.originalEnvHash||sha256(JSON.stringify(deploymentReport))!==stage.deploymentReportHash||archive?.digest!==stage.archiveSessionSha256)throw Error('NEW_DEPLOYER_STAGED_INPUT_CHANGED');
    const prepared=await prepareNewDeployerTestnetConnection({provider,artifact,deploymentReport,original,release,archive,confirmations});
    assertIdentity(stage,{identity:prepared.report.identity,report:prepared.report});if(prepared.env!==stagedEnv)throw Error('NEW_DEPLOYER_STAGED_ENV_MISMATCH');
    return prepared.report;
}

function siteEvidence(active,frontend,target){
    try{if(active?.version!==1||active.chainId!==97||getAddress(active.vaultAddress)!==target||frontend?.version!==1||frontend.chainId!==97||frontend.verified!==true||getAddress(frontend.vaultAddress)!==target)throw Error();}catch{throw Error('NEW_DEPLOYER_SITE_EVIDENCE_REQUIRED');}
    const hashes=[frontend.indexSha256,frontend.servedIndexSha256,frontend.expectedIndexSha256];if(!hashes.every(value=>/^[0-9a-f]{64}$/i.test(value||''))||new Set(hashes).size!==1)throw Error('NEW_DEPLOYER_FRONTEND_HASH_MISMATCH');return hashes[0];
}

export async function publishNewDeployerTestnetConnection({provider,artifact,deploymentReport,current,stagedEnv,stage,active,frontend,release=loadNewDeployerConnectionRelease(),archive,confirmations=3}){
    assertStage(stage,stagedEnv);if(current!==stagedEnv)throw Error('NEW_DEPLOYER_INSTALLED_ENV_MISMATCH');
    const {settings,config}=existingSettings(current);if(settings.GLOBAL_MIGRATION_ENABLED!=='false'||settings.TRADES_ZERO_START_PROFILE!==NEW_DEPLOYER_RELEASE_ID||settings.GLOBAL_AUTOMATION_PUBLIC_STATUS!=='/var/www/globaldroptrade/automation-data/new-deployer-activation.json')throw Error('NEW_DEPLOYER_INSTALLED_PROFILE_MISMATCH');
    const verified=await verifiedTarget({provider,artifact,deploymentReport,release,archive,confirmations});assertIdentity(stage,verified);
    if(config.address!==verified.report.target||config.startBlock!==verified.report.block||config.port!==3115)throw Error('NEW_DEPLOYER_SITE_TARGET_NOT_INSTALLED');
    return {...verified.report,kind:NEW_DEPLOYER_CONNECTION_KIND,identity:verified.identity,currentState:verified.currentState,frontendIndexSha256:siteEvidence(active,frontend,verified.report.target),communityDataPreserved:true,siteConnected:true,automationActive:false,dailyAutomationActive:false};
}

function privateDirectory(directory,{create=false,expectedUid=0}={}){if(create)fs.mkdirSync(directory,{recursive:true,mode:0o700});privateStat(directory,{directory:true,expectedUid});}
function writeNewPrivate(file,value){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}

export function connectionTargetMarker(report){
    return {version:1,kind:'new-deployer-testnet-connection-target',releaseId:report.releaseId,artifact:report.artifact,chainId:97,target:report.target,vaultAddress:report.vaultAddress,owner:report.owner,operator:report.operator,queue:report.queue,deploymentBlock:report.deploymentBlock,blockHash:report.blockHash,runtimeHash:report.runtimeHash,archiveSessionSha256:report.archiveSessionSha256,siteConnected:true,automationActive:false,dailyAutomationActive:false};
}

export function writeConnectionTargetMarker(report,{directory=NEW_DEPLOYER_CONFIG_DIR,expectedUid=0}={}){
    privateDirectory(directory,{create:true,expectedUid});
    const marker=connectionTargetMarker(report),file=path.join(directory,'connection-target.json'),serialized=JSON.stringify(marker,null,2)+'\n';
    if(fs.existsSync(file)){
        let existing;try{existing=JSON.parse(readNewDeployerPrivateText(file,{expectedUid}));}catch{throw Error('NEW_DEPLOYER_TARGET_MARKER_CHANGED');}
        if(!same(existing,marker))throw Error('NEW_DEPLOYER_TARGET_MARKER_CHANGED');
        return file;
    }
    writeNewPrivate(file,serialized);return file;
}

async function main(){
    const [mode,directoryArg,...extra]=process.argv.slice(2);if(!['prepare','check','publish'].includes(mode)||!directoryArg||extra.length)throw Error('USAGE_PREPARE_CHECK_OR_PUBLISH_OUTPUT_DIRECTORY');if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
    const directory=path.resolve(directoryArg);privateDirectory(directory,{create:mode==='prepare'});
    const original=readNewDeployerPrivateText('/etc/globaldroptrade/trades.env'),{config}=existingSettings(original),archive=readImmutableV1Archive(),stateDir=NEW_DEPLOYER_STATE_DIR;
    privateDirectory(stateDir);const deploymentText=readNewDeployerPrivateText(path.join(stateDir,'deployment-public.json'));let deploymentReport;try{deploymentReport=JSON.parse(deploymentText);}catch{throw Error('NEW_DEPLOYER_DEPLOYMENT_REPORT_REQUIRED');}
    const release=loadNewDeployerConnectionRelease(),artifact=JSON.parse(fs.readFileSync(NEW_DEPLOYER_ARTIFACT_FILE,'utf8')),request=new FetchRequest(config.rpcUrl);request.timeout=15000;const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
    const unchanged=()=>{if(readNewDeployerPrivateText('/etc/globaldroptrade/trades.env')!==original)throw Error('NEW_DEPLOYER_ORIGINAL_ENV_CHANGED');if(readNewDeployerPrivateText(path.join(stateDir,'deployment-public.json'))!==deploymentText)throw Error('NEW_DEPLOYER_DEPLOYMENT_REPORT_CHANGED');assertImmutableV1Archive(archive);};
    const inputs={provider,artifact,deploymentReport,release,archive,confirmations:Math.max(3,config.confirmations)};
    try{
        if(mode==='prepare'){const prepared=await prepareNewDeployerTestnetConnection({...inputs,original});unchanged();writeNewPrivate(path.join(directory,'trades.env'),prepared.env);writeNewPrivate(path.join(directory,'new-deployer-testnet-connection.json'),JSON.stringify(prepared.report,null,2)+'\n');console.log('NEW_DEPLOYER_CONNECTION_PREFLIGHT_OK '+prepared.report.target);}
        else {const stagedEnv=readNewDeployerPrivateText(path.join(directory,'trades.env')),stage=JSON.parse(readNewDeployerPrivateText(path.join(directory,'new-deployer-testnet-connection.json')));if(mode==='check'){const report=await checkNewDeployerTestnetConnection({...inputs,original,stagedEnv,stage});unchanged();console.log('NEW_DEPLOYER_STAGED_CONNECTION_RECHECKED '+report.target);}else {const active=JSON.parse(readNewDeployerPrivateText(path.join(directory,'active.json'))),frontend=JSON.parse(readNewDeployerPrivateText(path.join(directory,'frontend-check.json')),);const report=await publishNewDeployerTestnetConnection({...inputs,current:original,stagedEnv,stage,active,frontend});unchanged();const marker=writeConnectionTargetMarker(report);writePrivateJson(path.join(stateDir,'connection-public.json'),report);console.log('NEW_DEPLOYER_SITE_CONNECTION_PUBLISHED '+report.target);console.log('REPORT='+path.join(stateDir,'connection-public.json'));console.log('TARGET_MARKER='+marker);}}
    }finally{provider.destroy();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error('NEW_DEPLOYER_CONNECTION_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(error.message||'')?error.message:'RPC_OR_VERIFICATION_FAILED'));process.exitCode=1;});
