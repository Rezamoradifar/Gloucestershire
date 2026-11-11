import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,keccak256,parseEther,toQuantity} from 'ethers';
import {
    deployNewDeployerTestnet,loadNewDeployerArtifact,normalizeNewDeployerRuntime,
    parseNewDeployerRpc,preflightNewDeployer,validateArchivedLegacySession,verifyLegacyJournalReceipts,verifyNewDeployerDeployment
} from '../scripts/deploy-new-deployer-testnet.mjs';
import {loadNewDeployerRelease,validateNewDeployerRelease} from '../scripts/new-deployer-testnet-profile.mjs';

const artifact=name=>JSON.parse(fs.readFileSync(new URL('../artifacts/'+name+'.json',import.meta.url),'utf8'));
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const release=loadNewDeployerRelease(),vaultArtifact=loadNewDeployerArtifact();
const archive={oldTarget:'0x000000000000000000000000000000000000cafe',sha256:'a'.repeat(64)};
const emptyReview=()=>({rows:[],digest:sha256('[]')});

let rpc,provider,operator,snapshot;

async function deploy(name,args,signer) {
    const item=artifact(name),instance=await new ContractFactory(item.abi,'0x'+item.evm.bytecode.object,signer).deploy(...args);
    await instance.waitForDeployment();
    return instance;
}

async function installPinnedDependencies() {
    const token=await deploy('MockToken',[18],operator),feed=await deploy('MockFeed',[100000000n],operator);
    const tokenCode=await provider.getCode(token.target),feedCode=await provider.getCode(feed.target);
    await rpc.request({method:'evm_setAccountCode',params:[release.token,tokenCode]});
    await rpc.request({method:'evm_setAccountCode',params:[archive.oldTarget,tokenCode]});
    for(const address of [release.bnbFeed,release.tokenFeed]) {
        await rpc.request({method:'evm_setAccountCode',params:[address,feedCode]});
        const fixed=new Contract(address,artifact('MockFeed').abi,operator),block=await provider.getBlock('latest');
        await (await fixed.set(100000000n,block.timestamp,1,1)).wait();
    }
}

async function journalThroughUnlockedSigner({state,save,guard,request}) {
    await guard();
    let entry=state.transactions['new-deployer-vault'];
    if(!entry) {
        const transaction=await operator.sendTransaction({...request,gasLimit:15000000n});
        const receipt=await transaction.wait();
        entry={hash:transaction.hash,block:receipt.blockNumber,blockHash:receipt.blockHash,maxFee:'0'};
        state.transactions['new-deployer-vault']=entry;
        save();
        return receipt;
    }
    const receipt=await provider.getTransactionReceipt(entry.hash);
    assert.ok(receipt);
    return receipt;
}

before(async()=>{
    rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:1,unlockedAccounts:[release.deployer]},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
    provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});
    provider.pollingInterval=10;
    operator=await provider.getSigner(release.deployer);
    await rpc.request({method:'evm_setAccountBalance',params:[release.deployer,toQuantity(parseEther('10'))]});
    await installPinnedDependencies();
    snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});

beforeEach(async()=>{
    await rpc.request({method:'evm_revert',params:[snapshot]});
    snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});

after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('release profile, artifact, and archive identity are pinned before any deployment',async()=>{
    assert.equal(release.chainId,97);
    assert.equal(release.deployer,'0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d');
    assert.equal(keccak256(vaultArtifact.bytecode),release.artifactHash);
    assert.ok(vaultArtifact.immutableRanges.length>0);
    assert.equal(release.newDeployerTestnetVersion,1);
    assert.equal(release.fastNewDeployerTestnetVersion,1);
    assert.throws(()=>validateNewDeployerRelease({...release,token:release.bnbFeed}),/NEW_DEPLOYER_ORIGINAL_SETTINGS_REQUIRED|NEW_DEPLOYER_ROLE_COLLISION/);
    assert.throws(()=>validateArchivedLegacySession({version:5,kind:'fresh-fast-testnet-reset',profile:'global-fresh-fast-test-v1',chainId:97,phase:'archived',oldTarget:archive.oldTarget,files:[]}),/NEW_DEPLOYER_ARCHIVE_REQUIRED/);
    const badWallet={address:release.owner};
    await assert.rejects(preflightNewDeployer({provider,wallet:badWallet,artifact:vaultArtifact,release,archive,legacyJournalDigest:emptyReview().digest}),/NEW_DEPLOYER_KEY_ADDRESS_REQUIRED/);
});

test('legacy journal review accepts only canonical chain-97 receipts',async()=>{
    const hash='0x'+'11'.repeat(32),blockHash='0x'+'22'.repeat(32);
    const rows=[{path:'/var/lib/globaldroptrade/fresh-fast-testnet-v1/journal.json',sha256:'a'.repeat(64),transactions:[{hash,block:7,blockHash}]}];
    const review={rows,digest:sha256(JSON.stringify(rows))};
    const provider={
        getTransactionReceipt:async()=>({status:1,blockNumber:7,blockHash}),
        getTransaction:async()=>({hash,chainId:97n})
    };
    await verifyLegacyJournalReceipts(provider,review);
    await assert.rejects(verifyLegacyJournalReceipts({...provider,getTransaction:async()=>({hash,chainId:56n})},review),/NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED/);
});

test('deployment uses the last dotenv RPC value and rejects multiline values',()=>{
    assert.equal(parseNewDeployerRpc('TRADES_RPC_URL=https://first.example\nTRADES_RPC_URL="https://last.example/path"\n'),'https://last.example/path');
    assert.equal(parseNewDeployerRpc('export TRADES_RPC_URL=https://quoted.example\n'),'https://quoted.example');
    assert.throws(()=>parseNewDeployerRpc('TRADES_RPC_URL="https://first.example\nsecond"\n'),/NEW_DEPLOYER_ENV_REQUIRED/);
    assert.throws(()=>parseNewDeployerRpc('TRADES_RPC_URL=ws://rpc.example\n'),/NEW_DEPLOYER_ENV_REQUIRED/);
});

test('fresh deployment verifies genesis, immutable-normalized runtime, and a crash-safe repeat',async()=>{
    const review=emptyReview(),state={transactions:{}};
    let saves=0;
    const beforeNonce=await provider.getTransactionCount(release.deployer);
    const report=await deployNewDeployerTestnet({
        provider,wallet:operator,artifact:vaultArtifact,release,archive,legacyJournals:review,state,
        save:()=>{saves++;},confirmations:1,loadArchive:()=>archive,inspectLegacy:()=>review,journal:journalThroughUnlockedSigner
    });
    assert.equal(report.kind,'new-deployer-testnet-deployment');
    assert.equal(report.artifact,'FastNewDeployerTestnetVault');
    assert.equal(report.verified,true);
    assert.equal(report.emptyAtDeployment,true);
    assert.equal(report.accountsMigrated,false);
    assert.equal(report.newDeployerTestnetVersion,1);
    assert.equal(report.fastNewDeployerTestnetVersion,1);
    assert.equal(state.identity.deployer,release.deployer);
    assert.ok(state.transactions['new-deployer-vault'].hash);
    assert.ok(saves>=2);
    const runtime=await provider.getCode(report.contractAddress);
    assert.notEqual(keccak256(runtime),vaultArtifact.runtimeTemplateHash);
    assert.equal(keccak256(normalizeNewDeployerRuntime(vaultArtifact,runtime)),vaultArtifact.runtimeTemplateHash);
    const repeat=await deployNewDeployerTestnet({
        provider,wallet:operator,artifact:vaultArtifact,release,archive,legacyJournals:review,state,
        save:()=>{saves++;},confirmations:1,loadArchive:()=>archive,inspectLegacy:()=>review,journal:journalThroughUnlockedSigner
    });
    assert.deepEqual(repeat,report);
    assert.equal(await provider.getTransactionCount(release.deployer),beforeNonce+1);
    assert.deepEqual(await verifyNewDeployerDeployment({provider,artifact:vaultArtifact,release,archive,hash:report.hash,confirmations:1}),report);
});

test('a changed archive or unresolved review blocks before a signature',async()=>{
    const review=emptyReview();
    let signed=0;
    const wallet=new Proxy(operator,{get(target,name,receiver) {
        if(name==='signTransaction') return async transaction=>{signed++;return target.signTransaction(transaction);};
        const value=Reflect.get(target,name,receiver);
        return typeof value==='function'?value.bind(target):value;
    }});
    await assert.rejects(deployNewDeployerTestnet({
        provider,wallet,artifact:vaultArtifact,release,archive,legacyJournals:review,state:{transactions:{}},save:()=>{},
        loadArchive:()=>({...archive,sha256:'b'.repeat(64)}),inspectLegacy:()=>review
    }),/NEW_DEPLOYER_ARCHIVE_CHANGED/);
    assert.equal(signed,0);
    const malformed={rows:[],digest:'0'.repeat(64)};
    await assert.rejects(deployNewDeployerTestnet({
        provider,wallet,artifact:vaultArtifact,release,archive,legacyJournals:malformed,state:{transactions:{}},save:()=>{},
        loadArchive:()=>archive,inspectLegacy:()=>malformed
    }),/NEW_DEPLOYER_LEGACY_JOURNAL_REVIEW_REQUIRED/);
    assert.equal(signed,0);
});

test('a previously signed deployment resumes despite a later stale oracle, without a new transaction',async()=>{
    const review=emptyReview(),state={transactions:{}};
    const report=await deployNewDeployerTestnet({
        provider,wallet:operator,artifact:vaultArtifact,release,archive,legacyJournals:review,state,save:()=>{},
        confirmations:1,loadArchive:()=>archive,inspectLegacy:()=>review,journal:journalThroughUnlockedSigner
    });
    const fixedFeed=new Contract(release.bnbFeed,artifact('MockFeed').abi,operator);
    const block=await provider.getBlock('latest');
    await (await fixedFeed.set(100000000n,BigInt(block.timestamp)-BigInt(release.age)-1n,2,2)).wait();
    const beforeResume=await provider.getTransactionCount(release.deployer);
    const resumed=await deployNewDeployerTestnet({
        provider,wallet:operator,artifact:vaultArtifact,release,archive,legacyJournals:review,state,save:()=>{},
        confirmations:1,loadArchive:()=>archive,inspectLegacy:()=>review,journal:journalThroughUnlockedSigner
    });
    assert.deepEqual(resumed,report);
    assert.equal(await provider.getTransactionCount(release.deployer),beforeResume);
});
