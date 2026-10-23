import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,keccak256,parseEther,toQuantity} from 'ethers';
import {deployZeroStart,verifyZeroStartDeployment,validateZeroStartRelease,zeroStartRelease} from '../scripts/deploy-zero-start.mjs';
import {getZeroStartProfile,parseZeroStartProfileArgs} from '../scripts/zero-start-profile.mjs';

const artifact=name=>JSON.parse(fs.readFileSync(new URL('../artifacts/'+name+'.json',import.meta.url),'utf8'));
const fast=getZeroStartProfile(true),release=validateZeroStartRelease(fast.release),vaultArtifact=artifact('FastTestnetVault');
const startingNonce=48;
const proxy=(target,overrides)=>new Proxy(target,{get(object,name){if(Object.hasOwn(overrides,name))return overrides[name];const value=Reflect.get(object,name);return typeof value==='function'?value.bind(object):value;}});
const creation=()=>new ContractFactory(vaultArtifact.abi,'0x'+vaultArtifact.evm.bytecode.object).getDeployTransaction(release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations);
let rpc,provider,operator,snapshot;

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:1,unlockedAccounts:[release.deployer]},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const signer=await provider.getSigner(0);
 const deploy=async(name,args)=>{const a=artifact(name),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]);
 await rpc.request({method:'evm_setAccountCode',params:[release.token,await provider.getCode(token.target)]});
 for(const address of [release.bnbFeed,release.tokenFeed]){
  await rpc.request({method:'evm_setAccountCode',params:[address,await provider.getCode(feed.target)]});
  const fixedFeed=new Contract(address,artifact('MockFeed').abi,signer),block=await provider.getBlock('latest');
  await (await fixedFeed.set(100000000n,block.timestamp,1,1)).wait();
 }
 await rpc.request({method:'evm_setAccountBalance',params:[release.deployer,toQuantity(parseEther('10'))]});
 // The pinned operator's nonce zero CREATE address is the existing test token.
 await rpc.request({method:'evm_setAccountNonce',params:[release.deployer,toQuantity(startingNonce)]});
 operator=await provider.getSigner(release.deployer);
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('only the explicit fast flag selects the new release and isolated deployment and automation state',()=>{
 const original=structuredClone(zeroStartRelease),old=getZeroStartProfile();
 assert.equal(old.release.releaseId,'global-fresh-zero-v1');assert.equal(old.artifactName,'AutomaticGroupVault');
 assert.equal(fast.release.releaseId,'global-fresh-fast-test-v1');assert.equal(fast.artifactName,'FastTestnetVault');
 assert.ok(fast.artifactUrl instanceof URL);assert.ok(fast.artifactPath.endsWith('/artifacts/FastTestnetVault.json'));
 assert.equal(old.stateDir,'/var/lib/globaldroptrade/fresh-zero-v1');
 assert.equal(fast.stateDir,'/var/lib/globaldroptrade/fresh-fast-testnet-v1');
 assert.equal(fast.deploymentDir,fast.stateDir);
 assert.equal(fast.automationDir,'/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1');
 assert.notEqual(fast.automationDir,old.automationDir);assert.notEqual(fast.connectionLockDir,old.connectionLockDir);
 assert.equal(fast.publicRoot,old.publicRoot);assert.equal(fast.service,old.service);assert.equal(fast.timer,old.timer);
 const parsed=parseZeroStartProfileArgs(['--execute','--fast-testnet','--read-only']);
 assert.equal(parsed.profile.fast,true);assert.deepEqual(parsed.args,['--execute','--read-only']);
 assert.equal(parseZeroStartProfileArgs(['--execute']).profile.fast,false);
 assert.throws(()=>parseZeroStartProfileArgs(['--fast-testnet','--fast-testnet']),/ZERO_START_DUPLICATE_PROFILE_FLAG/);
 assert.throws(()=>getZeroStartProfile('true'),/ZERO_START_EXPLICIT_PROFILE_REQUIRED/);
 assert.deepEqual(validateZeroStartRelease(zeroStartRelease),original);
 assert.deepEqual(zeroStartRelease,original);
});

test('the named fast release requires test flags, exact artifact, chain and fixed owner and operator',()=>{
 assert.equal(release.chainId,97);assert.equal(release.testMode,true);assert.equal(release.initialServerReporter,true);
 assert.equal(keccak256('0x'+vaultArtifact.evm.bytecode.object),release.artifactHash);
 assert.equal(release.owner,zeroStartRelease.owner);assert.equal(release.deployer,zeroStartRelease.deployer);
 for(const fields of [{testMode:false},{initialServerReporter:false},{testMode:undefined}])assert.throws(()=>validateZeroStartRelease({...release,...fields}),/ZERO_START_FAST_TESTNET_FLAGS_REQUIRED/);
 for(const fields of [{chainId:56},{releaseId:'global-other-v1'},{artifact:'AutomaticGroupVault'}])assert.throws(()=>validateZeroStartRelease({...release,...fields}),/ZERO_START_RELEASE_REQUIRED/);
 for(const field of ['owner','deployer'])assert.throws(()=>validateZeroStartRelease({...release,[field]:release.partners[0]}),/ZERO_START_FAST_TESTNET_SIGNERS_REQUIRED/);
 assert.throws(()=>validateZeroStartRelease({...zeroStartRelease,artifact:'FastTestnetVault'}),/ZERO_START_RELEASE_REQUIRED/);
 assert.throws(()=>validateZeroStartRelease({...zeroStartRelease,initialServerReporter:true}),/ZERO_START_RELEASE_REQUIRED/);
 assert.equal(Object.hasOwn(validateZeroStartRelease(zeroStartRelease),'initialServerReporter'),false);
});

test('fast deployment rejects old journals and wrong chain, signer or bytecode before any signature',async()=>{
 let signatures=0;
 const wallet={address:release.deployer,signTransaction:async()=>{signatures++;throw Error('UNEXPECTED_SIGNING');}};
 const options={provider,wallet,artifact:vaultArtifact,release,state:{transactions:{}},save:()=>{},confirmations:1};
 const wrongChain=proxy(provider,{send:async method=>{assert.equal(method,'eth_chainId');return '0x38';}});
 await assert.rejects(deployZeroStart({...options,provider:wrongChain}),/TESTNET_ONLY/);
 await assert.rejects(deployZeroStart({...options,wallet:{...wallet,address:release.owner}}),/EXPECTED_DEPLOYER_KEY_REQUIRED/);
 await assert.rejects(deployZeroStart({...options,artifact:artifact('AutomaticGroupVault')}),/ZERO_START_ARTIFACT_MISMATCH/);
 const oldState={identity:{version:1,kind:'fresh-zero-automatic-groups',release:validateZeroStartRelease(zeroStartRelease),initcodeHash:keccak256((await creation()).data)},transactions:{}};
 const oldCopy=structuredClone(oldState);
 await assert.rejects(deployZeroStart({...options,state:oldState}),/ZERO_START_JOURNAL_IDENTITY_MISMATCH/);
 assert.deepEqual(oldState,oldCopy);
 await assert.rejects(deployZeroStart({...options,state:{transactions:{'zero-start-deploy':{raw:'old'}}}}),/UNBOUND_ZERO_START_JOURNAL/);
 assert.equal(signatures,0);assert.deepEqual(options.state,{transactions:{}});
 assert.equal(await provider.getTransactionCount(release.deployer),startingNonce);
});

const deployPinned=async()=>{
 const transaction=await operator.sendTransaction({...await creation(),gasLimit:15000000});
 await transaction.wait();
 return verifyZeroStartDeployment({provider,artifact:vaultArtifact,release,hash:transaction.hash,confirmations:1});
};

test('the exact fast creation proves zero accounts and approvals, both reporters and a repeatable report without another transaction',async()=>{
 const report=await deployPinned(),vault=new Contract(report.contractAddress,vaultArtifact.abi,provider);
 assert.equal(report.releaseId,'global-fresh-fast-test-v1');assert.equal(report.testMode,true);
 assert.equal(report.initialServerReporter,true);assert.equal(report.fastTestnetVersion,1);
 assert.equal(report.verified,true);assert.equal(report.emptyAtDeployment,true);assert.equal(report.feedReadiness.ready,true);
 assert.equal(report.initcodeHash,keccak256((await creation()).data));
 assert.equal(await vault.owner(),release.owner);assert.equal(await vault.FAST_TESTNET_VERSION(),1n);
 assert.equal(await vault.reporters(release.owner),true);assert.equal(await vault.reporters(release.deployer),true);
 assert.equal((await vault.users(release.owner)).registered,false);assert.equal(await vault.volumeJobCount(),0n);
 const queue=new Contract(report.queue,artifact('ProfitWithdrawalQueue').abi,provider);
 assert.equal(await queue.requestCount(),0n);assert.equal(await queue.pending(ZeroAddress),0n);assert.equal(await queue.pending(release.token),0n);
 for(const field of ['accountsMigrated','siteConnected','automationActive','dailyAutomationActive'])assert.equal(report[field],false);
 const repeated=await verifyZeroStartDeployment({provider,artifact:vaultArtifact,release,hash:report.hash,confirmations:1});
 assert.deepEqual(repeated,report);assert.equal(await provider.getTransactionCount(release.deployer),startingNonce+1);
});

test('fast proof rejects missing owner or server reporter, wrong fast version, altered initcode and a nonempty checkpoint',async()=>{
 const report=await deployPinned(),iface=new Contract(report.contractAddress,vaultArtifact.abi,provider).interface;
 const verify=overrides=>verifyZeroStartDeployment({provider:proxy(provider,overrides),artifact:vaultArtifact,release,hash:report.hash,confirmations:1});
 for(const [method,args,value,error] of [
  ['reporters',[release.owner],false,/ZERO_START_SETTINGS_MISMATCH/],
  ['reporters',[release.deployer],false,/ZERO_START_FAST_TESTNET_REPORTER_REQUIRED/],
  ['FAST_TESTNET_VERSION',[],0n,/ZERO_START_FAST_TESTNET_REPORTER_REQUIRED/]
 ]){
  const data=iface.encodeFunctionData(method,args).toLowerCase();
  await assert.rejects(verify({call:async tx=>tx.to.toLowerCase()===report.contractAddress.toLowerCase()&&tx.data.toLowerCase()===data?iface.encodeFunctionResult(method,[value]):provider.call(tx)}),error);
 }
 await assert.rejects(verify({getTransaction:async hash=>({...await provider.getTransaction(hash),data:(await provider.getTransaction(hash)).data+'00'})}),/ZERO_START_TRANSACTION_MISMATCH/);
 await assert.rejects(verify({getLogs:async()=>[{address:report.contractAddress}]}),/ZERO_START_INITIAL_REGISTRY_NOT_EMPTY/);
 assert.equal(await provider.getTransactionCount(release.deployer),startingNonce+1);
});
