import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after,before,test} from 'node:test';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,getAddress,keccak256,toQuantity,parseEther} from 'ethers';
import {
    assertImmutableV1Archive,checkNewDeployerTestnetConnection,prepareNewDeployerTestnetConnection,
    publishNewDeployerTestnetConnection,readImmutableV1Archive,renderNewDeployerConnectionSettings,verifyNewDeployerTestnetCreation,
    writeConnectionTargetMarker
} from '../scripts/connect-new-deployer-testnet.mjs';
import {loadNewDeployerConnectionRelease} from '../scripts/connect-new-deployer-testnet.mjs';

const artifact=JSON.parse(fs.readFileSync('artifacts/FastNewDeployerTestnetVault.json','utf8'));
const tokenArtifact=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
const release=loadNewDeployerConnectionRelease();
const digest=value=>createHash('sha256').update(value).digest('hex');
const artifactBytecode='0x'+artifact.evm.bytecode.object;
const responseCode='0x601260005260206000f3';
let rpc,provider,vault,receipt,archive,report,fixture;

function writePrivate(file,value){fs.writeFileSync(file,value,{mode:0o600});fs.chmodSync(file,0o600);}

function createArchive(){
    fixture=fs.mkdtempSync(path.join(os.tmpdir(),'new-deployer-archive-'));fs.chmodSync(fixture,0o700);
    const archived=path.join(fixture,'previous-state','fresh-fast-testnet-v1');fs.mkdirSync(archived,{recursive:true,mode:0o700});fs.chmodSync(path.join(fixture,'previous-state'),0o700);fs.chmodSync(archived,0o700);
    const journal='{"transactions":{}}\n';writePrivate(path.join(archived,'journal.json'),journal);
    const session={version:5,kind:'fresh-fast-testnet-reset',sourceRevision:'fb4156453a046ba55a99dbbcf276be5019ba7f9b',oldTarget:'0xB5c3C0f8fc30b2FDB8b16d2325127dAe7C8DCD5B',profile:'global-fresh-fast-test-v1',chainId:97,phase:'archived',environmentSha256:'11'.repeat(32),files:[{path:'fresh-fast-testnet-v1/journal.json',sha256:digest(journal)}],externalSettledJournals:[]};
    writePrivate(path.join(fixture,'session.json'),JSON.stringify(session)+'\n');
    return readImmutableV1Archive({file:path.join(fixture,'session.json'),expectedUid:process.getuid()});
}

before(async()=>{
    rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:4,unlockedAccounts:[release.deployer]},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
    provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
    await rpc.request({method:'evm_setAccountBalance',params:[release.deployer,toQuantity(parseEther('10'))]});
    const signer=await provider.getSigner(release.deployer);
    const tokenTemplate=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,signer).deploy(18);
    await tokenTemplate.waitForDeployment();
    await rpc.request({method:'evm_setAccountCode',params:[release.token,await provider.getCode(tokenTemplate.target)]});
    for(const target of [release.bnbFeed,release.tokenFeed])await rpc.request({method:'evm_setAccountCode',params:[target,responseCode]});
    vault=await new ContractFactory(artifact.abi,artifactBytecode,signer).deploy(release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations);
    await vault.waitForDeployment();receipt=await vault.deploymentTransaction().wait();archive=createArchive();
    const block=await provider.getBlock(receipt.blockNumber),code=await provider.getCode(vault.target),queue=await vault.withdrawalQueue();
    report={version:1,kind:'new-deployer-testnet-deployment',releaseId:release.releaseId,artifact:release.artifact,chainId:97,contractAddress:vault.target,queue,owner:release.owner,deployer:release.deployer,token:release.token,bnbFeed:release.bnbFeed,tokenFeed:release.tokenFeed,operations:release.operations,hash:receipt.hash,block:receipt.blockNumber,blockHash:receipt.blockHash,artifactHash:release.artifactHash,initcodeHash:keccak256(vault.deploymentTransaction().data),runtimeHash:keccak256(code),deploymentTimestamp:Number(block.timestamp),testMode:true,initialServerReporter:true,fastTestnetVersion:1,newDeployerTestnetVersion:1,fastNewDeployerTestnetVersion:1,transactionCount:1,verified:true,emptyAtDeployment:true,accountsMigrated:false,siteConnected:false,automationActive:false,dailyAutomationActive:false,archiveSessionSha256:archive.digest};
});

after(async()=>{await provider?.destroy();await rpc?.disconnect();fs.rmSync(fixture,{recursive:true,force:true});});

test('canonical deployment and empty genesis are independently verified',async()=>{
    const verified=await verifyNewDeployerTestnetCreation({provider,artifact,deploymentReport:report,release,archive,confirmations:1});
    assert.equal(verified.target,getAddress(vault.target));assert.equal(verified.queue,getAddress(await vault.withdrawalQueue()));
    assert.equal(verified.operator,release.deployer);assert.equal(verified.emptyAtDeployment,true);assert.equal(verified.legacyTarget,archive.oldTarget);
});

test('connection staging preserves secrets and rechecks the exact deployment',async()=>{
    const original='TRADES_CHAIN_ID="97"\nTRADES_RPC_URL="https://rpc.example.invalid/secret"\nPRIVATE_OTHER="keep-this-exactly"\nTRADES_PORT="3115"\n';
    const prepared=await prepareNewDeployerTestnetConnection({provider,artifact,deploymentReport:report,original,release,archive,confirmations:1});
    assert.match(prepared.env,/PRIVATE_OTHER="keep-this-exactly"/);assert.match(prepared.env,new RegExp('TRADES_VAULT_ADDRESS="'+vault.target+'"'));
    assert.match(prepared.env,/GLOBAL_AUTOMATION_PUBLIC_STATUS="\/var\/www\/globaldroptrade\/automation-data\/new-deployer-activation\.json"/);
    assert.equal(renderNewDeployerConnectionSettings(prepared.env,prepared.report),prepared.env);
    const rechecked=await checkNewDeployerTestnetConnection({provider,artifact,deploymentReport:report,original,stagedEnv:prepared.env,stage:prepared.report,release,archive,confirmations:1});
    assert.equal(rechecked.contractAddress,getAddress(vault.target));
    const frontendHash='ab'.repeat(32);
    const published=await publishNewDeployerTestnetConnection({provider,artifact,deploymentReport:report,current:prepared.env,stagedEnv:prepared.env,stage:prepared.report,active:{version:1,chainId:97,vaultAddress:vault.target},frontend:{version:1,chainId:97,vaultAddress:vault.target,indexSha256:frontendHash,servedIndexSha256:frontendHash,expectedIndexSha256:frontendHash,verified:true},release,archive,confirmations:1});
    assert.equal(published.siteConnected,true);assert.equal(published.automationActive,false);
});

test('archive identity and deployment report changes fail closed',async()=>{
    const original='TRADES_CHAIN_ID="97"\nTRADES_RPC_URL="https://rpc.example.invalid/secret"\n';
    const prepared=await prepareNewDeployerTestnetConnection({provider,artifact,deploymentReport:report,original,release,archive,confirmations:1});
    assert.throws(()=>assertImmutableV1Archive({...archive,digest:'00'.repeat(32)},{expectedUid:process.getuid()}),/NEW_DEPLOYER_ARCHIVE_CHANGED/);
    await assert.rejects(checkNewDeployerTestnetConnection({provider,artifact,deploymentReport:{...report,block:report.block+1},original,stagedEnv:prepared.env,stage:prepared.report,release,archive,confirmations:1}),/NEW_DEPLOYER_STAGED_INPUT_CHANGED/);
});

test('connection target marker is root-only, immutable, and never a daily policy',async()=>{
    const directory=path.join(fixture,'connection-target'),queue=await vault.withdrawalQueue();fs.mkdirSync(directory,{mode:0o700});fs.chmodSync(directory,0o700);
    const marker=writeConnectionTargetMarker({releaseId:release.releaseId,artifact:release.artifact,target:vault.target,vaultAddress:vault.target,owner:release.owner,operator:release.deployer,queue,deploymentBlock:receipt.blockNumber,blockHash:receipt.blockHash,runtimeHash:report.runtimeHash,archiveSessionSha256:archive.digest},{directory,expectedUid:process.getuid()});
    assert.equal(fs.statSync(marker).mode&0o777,0o600);assert.equal(JSON.parse(fs.readFileSync(marker,'utf8')).dailyAutomationActive,false);
    assert.equal(writeConnectionTargetMarker({releaseId:release.releaseId,artifact:release.artifact,target:vault.target,vaultAddress:vault.target,owner:release.owner,operator:release.deployer,queue,deploymentBlock:receipt.blockNumber,blockHash:receipt.blockHash,runtimeHash:report.runtimeHash,archiveSessionSha256:archive.digest},{directory,expectedUid:process.getuid()}),marker);
    assert.throws(()=>writeConnectionTargetMarker({releaseId:release.releaseId,artifact:release.artifact,target:vault.target,vaultAddress:vault.target,owner:release.owner,operator:release.deployer,queue,deploymentBlock:receipt.blockNumber+1,blockHash:receipt.blockHash,runtimeHash:report.runtimeHash,archiveSessionSha256:archive.digest},{directory,expectedUid:process.getuid()}),/NEW_DEPLOYER_TARGET_MARKER_CHANGED/);
});
