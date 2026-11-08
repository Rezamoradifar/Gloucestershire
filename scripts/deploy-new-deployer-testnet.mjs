import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {
    Contract,ContractFactory,FetchRequest,JsonRpcProvider,Wallet,ZeroAddress,
    getAddress,getCreateAddress,keccak256,parseEther
} from 'ethers';
import {journalTransaction,writePrivateJson} from './migration-journal.mjs';
import {readPrivateKey} from './migration-signers.mjs';
import {
    LEGACY_ARCHIVE_SESSION,NEW_DEPLOYER_ARTIFACT_FILE,NEW_DEPLOYER_KEY_FILE,
    NEW_DEPLOYER_STATE_DIR,loadNewDeployerRelease,validateNewDeployerRelease
} from './new-deployer-testnet-profile.mjs';

const queueAbi=[
    'function vault() view returns(address)',
    'function APPROVAL_VERSION() view returns(uint256)',
    'function requestCount() view returns(uint256)',
    'function pending(address) view returns(uint256)'
];
const feedAbi=[
    'function decimals() view returns(uint8)',
    'function latestRoundData() view returns(uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)'
];
const addressPattern=/^0x[0-9a-f]{40}$/i;
const hashPattern=/^0x[0-9a-f]{64}$/i;
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
export const legacyJournalFiles=[
    '/var/lib/globaldroptrade/fresh-fast-testnet-v1/journal.json',
    '/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/journal.json',
    '/var/lib/globaldroptrade/automation-v1/journal.json',
    '/var/lib/globaldroptrade/oracle-maintenance-v1/journal.json',
    '/var/lib/globaldroptrade/fresh-zero-automation-v1/journal.json',
    '/var/lib/globaldroptrade/zero-oracle-repair-v1/journal.json',
    '/var/lib/globaldroptrade/fresh-rewards-v1/journal.json',
    '/var/lib/globaldroptrade/approved-rewards-v1/journal.json',
    '/var/lib/globaldroptrade/test-token-grants/owner-10m-20261019/journal.json'
];
const archivedStateNames=new Set(['fresh-fast-testnet-v1','fresh-fast-testnet-automation-v1']);
const archivedExternalJournalNames=new Set([
    'automation-v1/journal.json','oracle-maintenance-v1/journal.json',
    'fresh-zero-automation-v1/journal.json','zero-oracle-repair-v1/journal.json'
]);
const legacyArchiveRevision='fb4156453a046ba55a99dbbcf276be5019ba7f9b';
const legacyArchiveTarget='0xB5c3C0f8fc30b2FDB8b16d2325127dAe7C8DCD5B';

function fail(code) { throw Error(code); }

function newDeployerWallet(key,provider) {
    try { return new Wallet(key,provider); }
    catch { fail('NEW_DEPLOYER_KEY_INVALID'); }
}

export function parseNewDeployerRpc(environment) {
    let values;
    try { values=parseEnv(environment); } catch { fail('NEW_DEPLOYER_ENV_REQUIRED'); }
    const rpc=values.TRADES_RPC_URL;
    if(typeof rpc!=='string'||!rpc.trim()||/[\r\n]/.test(rpc)) fail('NEW_DEPLOYER_ENV_REQUIRED');
    try {
        const url=new URL(rpc);
        if(!['http:','https:'].includes(url.protocol)||!url.hostname) fail('NEW_DEPLOYER_ENV_REQUIRED');
    } catch { fail('NEW_DEPLOYER_ENV_REQUIRED'); }
    return rpc;
}

function privateStat(file,{directory=false,allowMissing=false}={}) {
    let stat;
    try { stat=fs.lstatSync(file); } catch {
        if(allowMissing) return null;
        fail('NEW_DEPLOYER_PRIVATE_FILE_REQUIRED');
    }
    if((directory?!stat.isDirectory():!stat.isFile())||stat.uid!==0||(stat.mode&0o077)!==0) {
        fail('NEW_DEPLOYER_PRIVATE_FILE_REQUIRED');
    }
    return stat;
}

function readPrivateBytes(file,code='NEW_DEPLOYER_PRIVATE_FILE_REQUIRED') {
    let descriptor;
    try { descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW); } catch { fail(code); }
    try {
        const stat=fs.fstatSync(descriptor);
        if(!stat.isFile()||stat.uid!==0||(stat.mode&0o077)!==0||stat.size>4*1024*1024) fail(code);
        return fs.readFileSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}

function readPrivateJsonWithBytes(file,code) {
    try {
        const bytes=readPrivateBytes(file,code),value=JSON.parse(bytes.toString('utf8'));
        if(!value||typeof value!=='object'||Array.isArray(value)) fail(code);
        return {value,bytes};
    } catch(error) {
        if(error?.message===code) throw error;
        fail(code);
    }
}

function readPrivateJson(file,code) { return readPrivateJsonWithBytes(file,code).value; }

function ensurePrivateDirectory(directory) {
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    privateStat(directory,{directory:true});
}

function archiveRows(value,key,validPath) {
    if(!Array.isArray(value[key])) fail('NEW_DEPLOYER_ARCHIVE_REQUIRED');
    const seen=new Set();
    for(const row of value[key]) {
        if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.path!=='string'||!validPath(row.path)||
            !/^[0-9a-f]{64}$/.test(row.sha256||'')||seen.has(row.path)) fail('NEW_DEPLOYER_ARCHIVE_REQUIRED');
        seen.add(row.path);
    }
    return value[key];
}

function archivedStatePath(value) {
    const parts=value.split('/');
    return parts.length===2&&archivedStateNames.has(parts[0])&&!parts[1].endsWith('.lock')&&!parts.includes('.')&&!parts.includes('..');
}

function archivedExternalPath(value) { return archivedExternalJournalNames.has(value); }

function readArchivedManifestFile(root,relative) {
    const previous=path.join(root,'previous-state');
    privateStat(previous,{directory:true});
    const parts=relative.split('/');
    let directory=previous;
    for(const component of parts.slice(0,-1)) {
        directory=path.join(directory,component);
        privateStat(directory,{directory:true});
    }
    return readPrivateBytes(path.join(directory,parts.at(-1)),'NEW_DEPLOYER_ARCHIVE_REQUIRED');
}

export function validateArchivedLegacySession(value) {
    if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==5||
        value.kind!=='fresh-fast-testnet-reset'||value.profile!=='global-fresh-fast-test-v1'||
        value.chainId!==97||value.phase!=='archived'||!addressPattern.test(value.oldTarget||'')||
        value.sourceRevision!==legacyArchiveRevision||!/^[0-9a-f]{64}$/.test(value.environmentSha256||'')) {
        fail('NEW_DEPLOYER_ARCHIVE_REQUIRED');
    }
    const files=archiveRows(value,'files',archivedStatePath);
    if(!files.length) fail('NEW_DEPLOYER_ARCHIVE_REQUIRED');
    const externalSettledJournals=archiveRows(value,'externalSettledJournals',archivedExternalPath);
    const oldTarget=getAddress(value.oldTarget);
    if(oldTarget!==legacyArchiveTarget) fail('NEW_DEPLOYER_ARCHIVE_REQUIRED');
    return {oldTarget,sourceRevision:legacyArchiveRevision,files,externalSettledJournals};
}

export function loadArchivedLegacySession(file=LEGACY_ARCHIVE_SESSION) {
    const root=path.dirname(file);
    privateStat(root,{directory:true});
    const bytes=readPrivateBytes(file,'NEW_DEPLOYER_ARCHIVE_REQUIRED');
    let session;
    try { session=JSON.parse(bytes.toString('utf8')); } catch { fail('NEW_DEPLOYER_ARCHIVE_REQUIRED'); }
    const archive=validateArchivedLegacySession(session);
    for(const row of [...archive.files,...archive.externalSettledJournals]) {
        if(sha256(readArchivedManifestFile(root,row.path))!==row.sha256) fail('NEW_DEPLOYER_ARCHIVE_REQUIRED');
    }
    return {...archive,sha256:sha256(bytes)};
}

export function inspectLegacyJournals(files=legacyJournalFiles) {
    if(!Array.isArray(files)||files.some(file=>typeof file!=='string'||!path.isAbsolute(file))) fail('NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED');
    const rows=[];
    for(const file of files) {
        let stat;
        try { stat=fs.lstatSync(file); } catch(error) {
            if(error?.code==='ENOENT') continue;
            fail('NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED');
        }
        if(!stat.isFile()||stat.uid!==0||(stat.mode&0o077)!==0) fail('NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED');
        const {value:journal,bytes}=readPrivateJsonWithBytes(file,'NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED');
        if(!journal.transactions||typeof journal.transactions!=='object'||Array.isArray(journal.transactions)||
            journal.pending||journal.oracle?.pending) fail('NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED');
        const transactions=[];
        for(const [label,entry] of Object.entries(journal.transactions)) {
            if(!entry||typeof entry!=='object'||!Number.isSafeInteger(entry.block)||entry.block<1||
                !hashPattern.test(entry.blockHash||'')||!hashPattern.test(entry.hash||'')||!label) {
                fail('NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED');
            }
            transactions.push({hash:entry.hash.toLowerCase(),block:entry.block,blockHash:entry.blockHash.toLowerCase()});
        }
        rows.push({path:file,sha256:sha256(bytes),transactions});
    }
    const encoded=JSON.stringify(rows);
    return {rows,digest:sha256(encoded)};
}

export async function verifyLegacyJournalReceipts(provider,review) {
    if(!review||!Array.isArray(review.rows)||typeof review.digest!=='string'||sha256(JSON.stringify(review.rows))!==review.digest) {
        fail('NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED');
    }
    for(const row of review.rows) {
        if(!row||typeof row.path!=='string'||!/^[0-9a-f]{64}$/.test(row.sha256||'')||!Array.isArray(row.transactions)) {
            fail('NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED');
        }
        for(const entry of row.transactions) {
            const [receipt,transaction]=await Promise.all([provider.getTransactionReceipt(entry.hash),provider.getTransaction(entry.hash)]);
            if(!receipt||receipt.status!==1||receipt.blockNumber!==entry.block||receipt.blockHash?.toLowerCase()!==entry.blockHash||
                !transaction||transaction.hash.toLowerCase()!==entry.hash||transaction.chainId!==97n) {
                fail('NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED');
            }
        }
    }
}

export function loadNewDeployerArtifact(file=NEW_DEPLOYER_ARTIFACT_FILE) {
    let artifact;
    try { artifact=JSON.parse(fs.readFileSync(file,'utf8')); } catch { fail('NEW_DEPLOYER_ARTIFACT_REQUIRED'); }
    const bytecode=artifact?.bytecode||'0x'+artifact?.evm?.bytecode?.object;
    const runtime=artifact?.evm?.deployedBytecode?.object;
    const immutableReferences=artifact?.evm?.deployedBytecode?.immutableReferences;
    if(!Array.isArray(artifact?.abi)||!/^0x(?:[0-9a-f]{2})+$/i.test(bytecode||'')||
        !/^(?:[0-9a-f]{2})+$/i.test(runtime||'')||!immutableReferences||typeof immutableReferences!=='object'||
        runtime.length/2>24576||bytecode.length/2-1>49152) {
        fail('NEW_DEPLOYER_ARTIFACT_REQUIRED');
    }
    const ranges=[];
    for(const references of Object.values(immutableReferences)) {
        if(!Array.isArray(references)) fail('NEW_DEPLOYER_ARTIFACT_REQUIRED');
        for(const reference of references) {
            if(!Number.isSafeInteger(reference?.start)||!Number.isSafeInteger(reference?.length)||reference.start<0||reference.length<1||
                reference.start+reference.length>runtime.length/2) fail('NEW_DEPLOYER_ARTIFACT_REQUIRED');
            ranges.push({start:reference.start,length:reference.length});
        }
    }
    ranges.sort((left,right)=>left.start-right.start);
    if(!ranges.length||ranges.some((range,index)=>index>0&&range.start<ranges[index-1].start+ranges[index-1].length)) fail('NEW_DEPLOYER_ARTIFACT_REQUIRED');
    const runtimeTemplate='0x'+runtime.toLowerCase();
    return {...artifact,bytecode,runtimeTemplate,immutableRanges:ranges,runtimeTemplateHash:keccak256(runtimeTemplate)};
}

export function normalizeNewDeployerRuntime(artifact,code) {
    if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||typeof artifact?.runtimeTemplate!=='string'||
        !Array.isArray(artifact.immutableRanges)||code.length!==artifact.runtimeTemplate.length) {
        fail('NEW_DEPLOYER_DEPLOYMENT_PROOF_REQUIRED');
    }
    let normalized=code.slice(2).toLowerCase();
    const template=artifact.runtimeTemplate.slice(2);
    for(const {start,length} of artifact.immutableRanges) {
        const from=start*2,to=(start+length)*2;
        normalized=normalized.slice(0,from)+template.slice(from,to)+normalized.slice(to);
    }
    return '0x'+normalized;
}

export async function newDeployerRequest({artifact,release}) {
    release=validateNewDeployerRelease(release);
    if(keccak256(artifact.bytecode).toLowerCase()!==release.artifactHash) fail('NEW_DEPLOYER_ARTIFACT_MISMATCH');
    return new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(
        release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations
    );
}

function identity({release,request,archive,legacyJournalDigest}) {
    return {
        version:1,kind:'new-deployer-testnet-deployment',
        releaseId:release.releaseId,chainId:97,artifactHash:release.artifactHash,deployer:release.deployer,
        initcodeHash:keccak256(request.data),archiveSessionSha256:archive.sha256,
        legacyTarget:getAddress(archive.oldTarget),legacyJournalDigest
    };
}

function validateState(state,expected) {
    if(!state||typeof state!=='object'||Array.isArray(state)||!state.transactions||
        typeof state.transactions!=='object'||Array.isArray(state.transactions)) fail('NEW_DEPLOYER_JOURNAL_REQUIRED');
    if(state.identity&&!same(state.identity,expected)) fail('NEW_DEPLOYER_JOURNAL_IDENTITY_CHANGED');
    if(!state.identity&&Object.keys(state.transactions).length) fail('NEW_DEPLOYER_UNBOUND_JOURNAL');
    if(Object.keys(state.transactions).some(label=>label!=='new-deployer-vault')) fail('NEW_DEPLOYER_UNEXPECTED_TRANSACTION');
}

async function verifyFeed(provider,address,block,age) {
    const feed=new Contract(address,feedAbi,provider);
    let decimals,round;
    try { [decimals,round]=await Promise.all([feed.decimals({blockTag:block.number}),feed.latestRoundData({blockTag:block.number})]); }
    catch { fail('NEW_DEPLOYER_ORACLE_PREFLIGHT_REQUIRED'); }
    if(decimals>18n||round.roundId===0n||round.answer<=0n||round.updatedAt===0n||
        round.updatedAt>BigInt(block.timestamp)||BigInt(block.timestamp)-round.updatedAt>BigInt(age)||
        round.answeredInRound<round.roundId) {
        fail('NEW_DEPLOYER_ORACLE_PREFLIGHT_REQUIRED');
    }
}

export async function preflightNewDeployer({provider,wallet,artifact,release,archive,legacyJournalDigest,requireFreshDependencies=true}) {
    release=validateNewDeployerRelease(release);
    if(!archive||typeof archive.sha256!=='string'||!/^[0-9a-f]{64}$/.test(archive.sha256)||getAddress(archive.oldTarget)===ZeroAddress) {
        fail('NEW_DEPLOYER_ARCHIVE_REQUIRED');
    }
    if(typeof legacyJournalDigest!=='string'||!/^[0-9a-f]{64}$/.test(legacyJournalDigest)) fail('NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED');
    if(getAddress(wallet.address)!==release.deployer) fail('NEW_DEPLOYER_KEY_ADDRESS_REQUIRED');
    const request=await newDeployerRequest({artifact,release});
    if(Number(await provider.send('eth_chainId',[]))!==97) fail('TESTNET_ONLY');
    const [balance,oldTargetCode]=await Promise.all([provider.getBalance(wallet.address),provider.getCode(archive.oldTarget)]);
    if(oldTargetCode==='0x') fail('NEW_DEPLOYER_ARCHIVE_REQUIRED');
    if(!requireFreshDependencies) return {request,balance,identity:identity({release,request,archive,legacyJournalDigest})};
    const [block,tokenCode,bnbFeedCode,tokenFeedCode]=await Promise.all([
        provider.getBlock('latest'),provider.getCode(release.token),provider.getCode(release.bnbFeed),
        provider.getCode(release.tokenFeed)
    ]);
    if(!block||tokenCode==='0x'||bnbFeedCode==='0x'||tokenFeedCode==='0x') fail('NEW_DEPLOYER_DEPENDENCY_CODE_REQUIRED');
    await Promise.all([verifyFeed(provider,release.bnbFeed,block,release.age),verifyFeed(provider,release.tokenFeed,block,release.age)]);
    return {request,block,balance,identity:identity({release,request,archive,legacyJournalDigest})};
}

export async function verifyNewDeployerDeployment({provider,artifact,release,archive,hash,confirmations=3}) {
    release=validateNewDeployerRelease(release);
    if(!hashPattern.test(hash||'')) fail('NEW_DEPLOYER_TRANSACTION_REQUIRED');
    if(!Number.isSafeInteger(confirmations)||confirmations<1) fail('NEW_DEPLOYER_CONFIRMATIONS_REQUIRED');
    if(Number(await provider.send('eth_chainId',[]))!==97) fail('TESTNET_ONLY');
    const request=await newDeployerRequest({artifact,release});
    const [receipt,transaction]=await Promise.all([provider.getTransactionReceipt(hash),provider.getTransaction(hash)]);
    if(!receipt||receipt.status!==1||!receipt.contractAddress||!transaction||transaction.to!==null||
        transaction.hash.toLowerCase()!==hash.toLowerCase()||getAddress(transaction.from)!==release.deployer||
        transaction.chainId!==97n||transaction.value!==0n||transaction.data.toLowerCase()!==request.data.toLowerCase()||
        getAddress(receipt.contractAddress)!==getCreateAddress({from:release.deployer,nonce:transaction.nonce})) {
        fail('NEW_DEPLOYER_DEPLOYMENT_PROOF_REQUIRED');
    }
    const [deploymentBlock,head,code]=await Promise.all([
        provider.getBlock(receipt.blockNumber),provider.getBlockNumber(),provider.getCode(receipt.contractAddress,receipt.blockNumber)
    ]);
    if(!deploymentBlock||deploymentBlock.hash!==receipt.blockHash||head-receipt.blockNumber+1<confirmations||
        code==='0x'||keccak256(normalizeNewDeployerRuntime(artifact,code))!==artifact.runtimeTemplateHash) {
        fail('NEW_DEPLOYER_DEPLOYMENT_PROOF_REQUIRED');
    }
    const target=getAddress(receipt.contractAddress);
    if(target===getAddress(archive.oldTarget)) fail('NEW_DEPLOYER_LEGACY_TARGET_REUSE');
    const vault=new Contract(target,artifact.abi,provider);
    const queueAddress=getAddress(await vault.withdrawalQueue({blockTag:receipt.blockNumber}));
    const queue=new Contract(queueAddress,queueAbi,provider);
    const options={blockTag:receipt.blockNumber};
    const [
        owner,paused,fastVersion,ownerReporter,deployerReporter,volumeCount,token,bnbFeed,tokenFeed,operations,oracleAge,tokenDecimals,
        partnerVotes,minDeposit,profitFee,principalPenalty,lockDuration,cooldown,
        queueVault,queueVersion,queueCount
    ]=await Promise.all([
        vault.owner(options),vault.paused(options),vault.FAST_TESTNET_VERSION(options),
        vault.reporters(release.owner,options),vault.reporters(release.deployer,options),
        vault.volumeJobCount(options),vault.usdt(options),vault.bnbUsdFeed(options),vault.usdtUsdFeed(options),
        vault.dropshippingWallet(options),vault.maxOracleAge(options),vault.tokenDecimals(options),
        vault.partnerVotesRequired(options),vault.minDepositUsd(options),vault.profitFeeBps(options),vault.principalPenaltyBps(options),
        vault.lockDuration(options),vault.withdrawalCooldown(options),
        queue.vault(options),queue.APPROVAL_VERSION(options),queue.requestCount(options)
    ]);
    if(getAddress(owner)!==release.owner||paused||fastVersion!==1n||!ownerReporter||!deployerReporter||
        volumeCount!==0n||getAddress(token)!==release.token||getAddress(bnbFeed)!==release.bnbFeed||
        getAddress(tokenFeed)!==release.tokenFeed||getAddress(operations)!==release.operations||oracleAge!==BigInt(release.age)||tokenDecimals>18n||
        partnerVotes!==2n||minDeposit!==10n**19n||profitFee!==500n||principalPenalty!==3000n||lockDuration!==7776000n||cooldown!==259200n||
        getAddress(queueVault)!==target||
        queueVersion!==1n||queueCount!==0n||(await provider.getCode(queueAddress,receipt.blockNumber))==='0x') {
        fail('NEW_DEPLOYER_GENESIS_REQUIRED');
    }
    for(let index=0;index<7;index++) if(getAddress(await vault.partnerWallets(index,options))!==release.partners[index]) fail('NEW_DEPLOYER_SETTINGS_REQUIRED');
    for(const asset of [ZeroAddress,release.token]) {
        const [ledger,balance,pending]=await Promise.all([vault.ledgers(asset,options),vault.assetBalance(asset,options),queue.pending(asset,options)]);
        if(ledger.some(value=>value!==0n)||balance!==0n||pending!==0n) fail('NEW_DEPLOYER_GENESIS_REQUIRED');
    }
    const [ownerUser,ownerPositions,ownerGroups]=await Promise.all([
        vault.users(release.owner,options),vault.positionCount(release.owner,options),vault.rewardGroupCount(release.owner,options)
    ]);
    if(ownerUser.registered||ownerPositions!==0n||ownerGroups!==0n) fail('NEW_DEPLOYER_GENESIS_REQUIRED');
    return {
        version:1,kind:'new-deployer-testnet-deployment',releaseId:release.releaseId,artifact:release.artifact,chainId:97,
        contractAddress:target,queue:queueAddress,owner:release.owner,deployer:release.deployer,
        token:release.token,bnbFeed:release.bnbFeed,tokenFeed:release.tokenFeed,partners:release.partners,
        operations:release.operations,hash,block:receipt.blockNumber,blockHash:receipt.blockHash,
        artifactHash:release.artifactHash,initcodeHash:keccak256(request.data),runtimeHash:keccak256(code),
        deploymentTimestamp:deploymentBlock.timestamp,testMode:true,initialServerReporter:true,
        fastTestnetVersion:1,newDeployerTestnetVersion:1,fastNewDeployerTestnetVersion:1,transactionCount:1,
        verified:true,emptyAtDeployment:true,accountsMigrated:false,siteConnected:false,automationActive:false,
        dailyAutomationActive:false,archiveSessionSha256:archive.sha256
    };
}

function sameArchive(left,right) {
    return left&&right&&left.sha256===right.sha256&&getAddress(left.oldTarget)===getAddress(right.oldTarget);
}

export async function deployNewDeployerTestnet({provider,wallet,artifact,release,archive,legacyJournals,state,save,confirmations=3,log=()=>{},inspectLegacy=inspectLegacyJournals,loadArchive=loadArchivedLegacySession,journal=journalTransaction}) {
    const currentArchive=loadArchive(),currentJournals=inspectLegacy();
    if(!sameArchive(archive,currentArchive)) fail('NEW_DEPLOYER_ARCHIVE_CHANGED');
    if(legacyJournals?.digest!==currentJournals.digest) fail('NEW_DEPLOYER_LEGACY_JOURNAL_CHANGED');
    await verifyLegacyJournalReceipts(provider,currentJournals);
    const legacyJournalDigest=currentJournals.digest;
    const request=await newDeployerRequest({artifact,release});
    const expected=identity({release:validateNewDeployerRelease(release),request,archive:currentArchive,legacyJournalDigest});
    validateState(state,expected);
    const existing=Boolean(state.transactions['new-deployer-vault']);
    const ready=await preflightNewDeployer({provider,wallet,artifact,release,archive:currentArchive,legacyJournalDigest,requireFreshDependencies:!existing});
    if(!state.identity) { state.identity=ready.identity; save(); }
    const guard=async()=>{
        if(Number(await provider.send('eth_chainId',[]))!==97) fail('TESTNET_ONLY');
        if(getAddress(wallet.address)!==ready.identity.deployer) fail('NEW_DEPLOYER_KEY_ADDRESS_REQUIRED');
        const current=loadArchive();
        if(current.sha256!==ready.identity.archiveSessionSha256||getAddress(current.oldTarget)!==ready.identity.legacyTarget) fail('NEW_DEPLOYER_ARCHIVE_CHANGED');
        const journals=inspectLegacy();
        if(journals.digest!==ready.identity.legacyJournalDigest) fail('NEW_DEPLOYER_LEGACY_JOURNAL_CHANGED');
        await verifyLegacyJournalReceipts(provider,journals);
        if(!state.transactions['new-deployer-vault']) {
            const [latest,pending]=await Promise.all([provider.getTransactionCount(wallet.address,'latest'),provider.getTransactionCount(wallet.address,'pending')]);
            if(latest!==pending) fail('OWNER_HAS_PENDING_TRANSACTIONS');
            if((await provider.getCode(getCreateAddress({from:wallet.address,nonce:pending})))!=='0x') fail('NEW_DEPLOYER_CREATE_ADDRESS_IN_USE');
        }
    };
    const receipt=await journal({
        provider,wallet,state,save,label:'new-deployer-vault',request:ready.request,guard,log,
        confirmations,maxTotalFee:parseEther('0.1')
    });
    return verifyNewDeployerDeployment({provider,artifact,release,archive:currentArchive,hash:receipt.hash,confirmations});
}

function outputError(error) {
    const code=/^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message||'')?error.message:'NEW_DEPLOYER_RPC_OR_VERIFICATION_FAILED';
    console.error('NEW_DEPLOYER_TESTNET_STOPPED '+code);
    process.exitCode=1;
}

function saveVerifiedDeploymentReport(file,report) {
    if(fs.existsSync(file)) {
        const existing=readPrivateJson(file,'NEW_DEPLOYER_REPORT_CONFLICT');
        if(!same(existing,report)) fail('NEW_DEPLOYER_REPORT_CONFLICT');
        return;
    }
    writePrivateJson(file,report);
}

async function main() {
    let provider;
    try {
        const [mode,...extra]=process.argv.slice(2);
        if(!['--check','--execute'].includes(mode)||extra.length) fail('NEW_DEPLOYER_EXPLICIT_CHECK_OR_EXECUTE_REQUIRED');
        if(process.getuid?.()!==0) fail('ROOT_REQUIRED');
        const release=loadNewDeployerRelease(),artifact=loadNewDeployerArtifact(),archive=loadArchivedLegacySession(),legacyJournals=inspectLegacyJournals();
        privateStat(path.dirname(NEW_DEPLOYER_KEY_FILE),{directory:true});
        const key=readPrivateKey(NEW_DEPLOYER_KEY_FILE);
        if(!key) fail('NEW_DEPLOYER_KEY_FILE_REQUIRED');
        const env=readPrivateBytes('/etc/globaldroptrade/trades.env','NEW_DEPLOYER_ENV_REQUIRED').toString('utf8');
        const rpc=parseNewDeployerRpc(env);
        const request=new FetchRequest(rpc); request.timeout=20000;
        provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
        const wallet=newDeployerWallet(key,provider);
        if(mode==='--check') {
            await verifyLegacyJournalReceipts(provider,legacyJournals);
            const ready=await preflightNewDeployer({provider,wallet,artifact,release,archive,legacyJournalDigest:legacyJournals.digest});
            console.log('NEW_DEPLOYER_TESTNET_PREFLIGHT_VALID');
            console.log(JSON.stringify({chainId:97,deployer:wallet.address,balance:ready.balance.toString(),oldTarget:archive.oldTarget,transactionsSent:0}));
            return;
        }
        ensurePrivateDirectory(NEW_DEPLOYER_STATE_DIR);
        const journalFile=path.join(NEW_DEPLOYER_STATE_DIR,'journal.json');
        const state=fs.existsSync(journalFile)?readPrivateJson(journalFile,'NEW_DEPLOYER_JOURNAL_REQUIRED'):{transactions:{}};
        const save=()=>writePrivateJson(journalFile,state);
        save();
        const report=await deployNewDeployerTestnet({provider,wallet,artifact,release,archive,legacyJournals,state,save,log:message=>console.log(message)});
        saveVerifiedDeploymentReport(path.join(NEW_DEPLOYER_STATE_DIR,'deployment-public.json'),report);
        console.log('NEW_DEPLOYER_TESTNET_CONTRACT_DEPLOYED_AND_VERIFIED');
        console.log('NEW_CONTRACT='+report.contractAddress);
        console.log('WITHDRAWAL_QUEUE='+report.queue);
        console.log('TX_HASH='+report.hash);
        console.log('REPORT='+path.join(NEW_DEPLOYER_STATE_DIR,'deployment-public.json'));
        console.log('OLD_ACCOUNTS_MIGRATED=false SITE_CONNECTED=false AUTOMATION_ACTIVE=false');
    } catch(error) {
        outputError(error);
    } finally {
        provider?.destroy();
    }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) await main();
