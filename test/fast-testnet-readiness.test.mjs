import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,parseEther} from 'ethers';
import {getZeroStartProfile} from '../scripts/zero-start-profile.mjs';
import {prepareZeroStartConnection} from '../scripts/connect-zero-start.mjs';
import {verifyZeroStartReadiness} from '../scripts/zero-start-readiness.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const fast=getZeroStartProfile(true).release;
const proxy=(target,overrides)=>new Proxy(target,{get(object,name){if(Object.hasOwn(overrides,name))return overrides[name];const value=Reflect.get(object,name);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,owner,operator,token,vault,release,deploymentReport,connectionReport,original,snapshot;
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12,unlockedAccounts:[fast.owner,fast.deployer]},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const who of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[who,'0x'+parseEther('10').toString(16)]});
 owner=await provider.getSigner(fast.owner);operator=await provider.getSigner(fast.deployer);
 const signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i))),addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const deploy=async(name,args,signer=signers[0])=>{const a=artifact(name),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 token=await deploy('MockToken',[18]);const feed=await deploy('MockFeed',[100000000n]);
 release={...fast,token:token.target,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
 vault=await deploy('FastTestnetVault',[release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations],operator);
 deploymentReport={hash:vault.deploymentTransaction().hash};
 vault=vault.connect(owner);
 await (await vault.fundRewards(ZeroAddress,1n,{value:1n})).wait();
 for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
 const prepared=await prepareZeroStartConnection({provider,artifact:artifact('FastTestnetVault'),deploymentReport,release,confirmations:1,original:'TRADES_CHAIN_ID=97\nTRADES_RPC_URL=https://rpc.example.invalid/private\nTRADES_VAULT_ADDRESS='+vault.target+'\nTRADES_PORT=3115\nTRADES_CONFIRMATIONS=1\nGLOBAL_MIGRATION_ENABLED=false\n'});
 original=prepared.env;connectionReport={...prepared.report,siteConnected:true};
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});
const checked=extra=>verifyZeroStartReadiness({provider,artifact:artifact('FastTestnetVault'),deploymentReport,connectionReport,original,release,confirmations:1,...extra});

test('verified fast testnet can establish readiness while young after successful snapshot probes',async()=>{
 const nonce=await provider.getTransactionCount(fast.deployer),report=await checked();
 assert.equal(report.releaseId,fast.releaseId);assert.equal(report.testMode,true);assert.equal(report.initialServerReporter,true);assert.equal(report.fastTestnetVersion,1);
 assert.equal(report.reporterAuthorized,true);assert.equal(report.reporterProposal.delaySeconds,172800);
 assert.equal(report.archive.status,'provisional');assert.equal(report.archive.fullyVerified,false);assert.equal(report.archive.provisionalAccepted,true);
 assert.ok(report.archive.targetAgeSeconds<86400);assert.ok(report.archive.probes.every(probe=>probe.supported));
 assert.equal(report.archive.requiredRetentionSeconds,86400);assert.equal(report.ready,true);assert.deepEqual(report.blockers,[]);
 assert.equal(report.transactionsSent,0);assert.equal(await provider.getTransactionCount(fast.deployer),nonce);
});

test('young fast mode still blocks missing historical contract state',async()=>{
 const selector=vault.interface.getFunction('accounts').selector;
 const pruned=proxy(provider,{call:async request=>{if(request.to===vault.target&&request.data.startsWith(selector))throw Error('archive unavailable');return provider.call(request);}});
 const report=await checked({provider:pruned});
 assert.equal(report.archive.status,'unavailable');assert.equal(report.archive.fullyVerified,false);assert.equal(report.archive.provisionalAccepted,undefined);
 assert.equal(report.ready,false);assert.ok(report.blockers.includes('ARCHIVE_RPC_REQUIRED_FOR_PERIOD_START_PRINCIPAL'));
});

test('a due policy still needs its actual period-start snapshot and preserves full 24-hour periods',async()=>{
 await rpc.request({method:'evm_increaseTime',params:[120]});await rpc.request({method:'evm_mine',params:[]});
 const start=await provider.getBlock('latest');
 await rpc.request({method:'evm_increaseTime',params:[86401]});for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
 const policy={version:1,chainId:97,vaultAddress:vault.target,runtimeHash:connectionReport.runtimeHash,deploymentBlock:connectionReport.block,startTimestamp:start.timestamp,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true};
 let report=await checked({policy,periodStartTimestamp:start.timestamp});
 assert.equal(report.archive.status,'supported');assert.equal(report.archive.fullyVerified,true);assert.equal(report.archive.provisionalAccepted,undefined);
 const probe=report.archive.probes.find(row=>row.purpose==='requested-period-start');assert.ok(probe?.supported);assert.equal(probe.requestedTimestamp,start.timestamp);
 const selector=vault.interface.getFunction('accounts').selector;
 const missingPeriod=proxy(provider,{call:async request=>{
  if(request.to===vault.target&&request.data.startsWith(selector)&&Number(request.blockTag)===probe.block)throw Error('period history missing');return provider.call(request);
 }});
 report=await checked({provider:missingPeriod,policy,periodStartTimestamp:start.timestamp});
 assert.equal(report.ready,false);assert.equal(report.archive.status,'unavailable');assert.ok(report.archive.probes.some(row=>row.purpose==='requested-period-start'&&!row.supported));
});

test('provisional acceptance requires matching fast connection proof and the pinned artifact',async()=>{
 for(const key of ['releaseId','testMode','initialServerReporter','fastTestnetVersion']){
  await assert.rejects(checked({connectionReport:{...connectionReport,[key]:key==='releaseId'?'global-fresh-zero-v1':false}}),/ZERO_START_FAST_CONNECTED_MARKER_REQUIRED/);
 }
 await assert.rejects(checked({artifact:artifact('AutomaticGroupVault')}),/ZERO_START_ARTIFACT_MISMATCH/);
 await assert.rejects(checked({release:{...release,testMode:false}}),/ZERO_START_FAST_TESTNET_FLAGS_REQUIRED/);
});
