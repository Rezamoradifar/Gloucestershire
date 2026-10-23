import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,keccak256,parseEther as E,toUtf8Bytes} from 'ethers';
import {getZeroStartProfile} from '../scripts/zero-start-profile.mjs';
import {prepareZeroStartConnection} from '../scripts/connect-zero-start.mjs';
import {verifyZeroStartReadiness} from '../scripts/zero-start-readiness.mjs';
import {runZeroStartAutomation} from '../scripts/zero-start-automation.mjs';
import {seedFastTestRewards,verifyFastTestSeedPending,isFastTestSeedLabel} from '../scripts/fund-fast-test-rewards.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const fast=getZeroStartProfile(true).release;
const proxy=(target,overrides)=>new Proxy(target,{get(object,name){if(Object.hasOwn(overrides,name))return overrides[name];const value=Reflect.get(object,name);return typeof value==='function'?value.bind(object):value;}});
const tx=async request=>(await request).wait();
let rpc,provider,operator,owner,signers,addresses,token,vault,queue,release,deploymentReport,connectionReport,original,snapshot;
const mine=async()=>{for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});};
const readiness=()=>verifyZeroStartReadiness({provider,artifact:artifact('FastTestnetVault'),deploymentReport,connectionReport,original,release,confirmations:1});
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12,unlockedAccounts:[fast.owner,fast.deployer]},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const who of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[who,'0x'+E('10').toString(16)]});
 owner=await provider.getSigner(fast.owner);operator=await provider.getSigner(fast.deployer);
 await rpc.request({method:'evm_setAccountNonce',params:[fast.deployer,'0x10']});
 signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const deploy=async(name,args,signer=signers[0])=>{const a=artifact(name),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const sourceToken=await deploy('MockToken',[18]);
 await rpc.request({method:'evm_setAccountCode',params:[fast.token,await provider.getCode(sourceToken.target)]});
 // Preserve the reviewed ERC20 constructor's name and symbol storage as well.
 for(const slot of [3,4])await rpc.request({method:'evm_setAccountStorageAt',params:[fast.token,'0x'+slot.toString(16).padStart(64,'0'),await provider.getStorage(sourceToken.target,slot)]});
 token=new Contract(fast.token,artifact('MockToken').abi,signers[0]);
 const feed=await deploy('MockFeed',[100000000n]);
 release={...fast,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
 vault=await deploy('FastTestnetVault',[release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations],operator);
 deploymentReport={hash:vault.deploymentTransaction().hash};queue=new Contract(await vault.withdrawalQueue(),artifact('ProfitWithdrawalQueue').abi,operator);
 await mine();
 const prepared=await prepareZeroStartConnection({provider,artifact:artifact('FastTestnetVault'),deploymentReport,release,confirmations:1,original:'TRADES_CHAIN_ID=97\nTRADES_RPC_URL=https://rpc.example.invalid/private\nTRADES_VAULT_ADDRESS='+vault.target+'\nTRADES_PORT=3115\nTRADES_CONFIRMATIONS=1\nGLOBAL_MIGRATION_ENABLED=false\n'});
 original=prepared.env;connectionReport={...prepared.report,siteConnected:true};
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

async function session(){
 const ready=await readiness(),state={transactions:{},identity:{version:1,chainId:97,target:vault.target,owner:ready.owner,operator:ready.operator,queue:ready.queue,hash:ready.hash,runtimeHash:ready.runtimeHash}};
 const requests=[];let policy,saves=0;
 const save=()=>{saves++;};
 const transact=async(label,request)=>{
  assert.equal(BigInt(request.value??0),0n);assert.ok([vault.target,queue.target,token.target].includes(request.to));
  const existing=state.transactions[label];if(existing?.block)return provider.getTransactionReceipt(existing.hash);
  requests.push({label,request});const receipt=await tx(operator.sendTransaction(request));
  state.transactions[label]={hash:receipt.hash,block:receipt.blockNumber,blockHash:receipt.blockHash,maxFee:'0'};save();return receipt;
 };
 const seed=extra=>seedFastTestRewards({provider,wallet:operator,artifact:artifact('MockToken'),release,readiness:ready,vault,state,save,transact,...extra});
 const run=async()=>runZeroStartAutomation({provider,vault,queue,readiness:await readiness(),state,save,loadPolicy:()=>policy,savePolicy:value=>{policy=structuredClone(value);},transact,refreshReadiness:readiness,maintainOracles:async()=>({status:'TESTNET_ORACLES_VALID'}),processVolume:async()=>({complete:true}),confirmations:1});
 return {seed,run,state,requests,save,transact,ready,get policy(){return policy;},get saves(){return saves;}};
}

test('one ten-token seed uses the pinned free token, exact allowance and no native value, then never refills',async()=>{
 const s=await session();assert.equal(s.ready.ready,false);assert.ok(s.ready.blockers.includes('FUNDED_DAILY_REWARD_BUDGET_REQUIRED'));
 const report=await s.seed();assert.equal(report.amountTestUsdt,'10');assert.equal(report.mintedTestUsdtUnits,E('10').toString());
 assert.equal(await token.balanceOf(fast.deployer),0n);assert.equal(await token.balanceOf(vault.target),E('10'));
 assert.equal((await vault.ledgers(token.target)).rewards,E('10'));assert.equal(await token.allowance(fast.deployer,vault.target),0n);
 assert.deepEqual(s.requests.map(row=>row.label.split('-').at(-1)),['mint','approve','fund']);
 assert.ok(s.requests.every(row=>isFastTestSeedLabel(row.label)));assert.ok(s.saves>=4);
 await tx(vault.connect(signers[1]).register(ZeroAddress));
 await tx(vault.batchProfit(keccak256(toUtf8Bytes('spend-fixed-test-seed')),token.target,[addresses[1]],[E('10')]));
 await s.seed();assert.equal(s.requests.length,3);assert.equal((await vault.ledgers(token.target)).rewards,0n);
 await mine();const status=await readiness();assert.equal(status.funding.ready,false);assert.equal(status.ready,false);
});

test('seed mints only the initial shortfall and recovers an interruption after mint without another grant',async()=>{
 await tx(token.mint(fast.deployer,E('9')));const s=await session();let interrupted=false;
 await assert.rejects(s.seed({transact:async(label,request)=>{const receipt=await s.transact(label,request);if(label.endsWith('-mint')&&!interrupted){interrupted=true;throw Error('INTERRUPTED_AFTER_MINT');}return receipt;}}),/INTERRUPTED_AFTER_MINT/);
 assert.equal(await token.balanceOf(fast.deployer),E('10'));assert.equal(s.state.seedTest.completed,false);
 const mint=s.requests[0];
 assert.equal(await verifyFastTestSeedPending({provider,wallet:operator,artifact:artifact('MockToken'),release,readiness:s.ready,vault,state:s.state,label:mint.label,request:mint.request}),true);
 await assert.rejects(verifyFastTestSeedPending({provider,wallet:operator,artifact:artifact('MockToken'),release,readiness:s.ready,vault,state:s.state,label:mint.label,request:{to:token.target,data:token.interface.encodeFunctionData('mint',[fast.deployer,E('10')])}}),/FAST_TEST_SEED_PENDING_TRANSACTION_MISMATCH/);
 const report=await s.seed();assert.equal(report.mintedTestUsdtUnits,E('1').toString());
 assert.equal(s.requests.filter(row=>row.label.endsWith('-mint')).length,1);assert.equal(s.requests.filter(row=>row.label.endsWith('-fund')).length,1);
 assert.equal((await vault.ledgers(token.target)).rewards,E('10'));assert.equal(await token.balanceOf(vault.target),E('10'));
 for(const row of s.requests)assert.equal(await verifyFastTestSeedPending({provider,wallet:operator,artifact:artifact('MockToken'),release,readiness:s.ready,vault,state:s.state,label:row.label,request:row.request}),true);
 const fund=s.requests.find(row=>row.label.endsWith('-fund'));
 for(const request of [{...fund.request,value:1n},{to:vault.target,data:vault.interface.encodeFunctionData('fundRewards',[token.target,E('11')])}]){
  await assert.rejects(verifyFastTestSeedPending({provider,wallet:operator,artifact:artifact('MockToken'),release,readiness:s.ready,vault,state:s.state,label:fund.label,request}),/FAST_TEST_SEED_PENDING_TRANSACTION_MISMATCH/);
 }
 await s.seed();assert.equal(s.requests.length,3);
});

test('seed refuses metadata, chain, token, proof and target changes before any transaction',async()=>{
 const s=await session(),nameSelector=token.interface.getFunction('name').selector;
 const badMetadata=proxy(provider,{call:async request=>request.to===token.target&&request.data?.startsWith(nameSelector)?token.interface.encodeFunctionResult('name',['Real Token']):provider.call(request)});
 await assert.rejects(s.seed({provider:badMetadata}),/TEST_TOKEN_METADATA_MISMATCH/);
 await assert.rejects(s.seed({provider:proxy(provider,{send:async()=> '0x38'})}),/TESTNET_ONLY/);
 await assert.rejects(s.seed({release:{...release,token:addresses[4]}}),/FAST_TEST_SEED_PROFILE_REQUIRED/);
 await assert.rejects(s.seed({readiness:{...s.ready,fastTestnetVersion:0}}),/FAST_TEST_SEED_VERIFIED_TARGET_REQUIRED/);
 await assert.rejects(s.seed({readiness:{...s.ready,target:addresses[4]}}),/FAST_TEST_SEED_VAULT_MISMATCH/);
 assert.equal(s.requests.length,0);assert.equal(s.state.seedTest,undefined);
});

test('seeded young fast profile starts a fresh 24-hour policy and credits one daily percentage only when due',async()=>{
 await tx(token.mint(addresses[1],E('100')));await tx(token.connect(signers[1]).approve(vault.target,E('100')));
 await tx(vault.connect(signers[1]).deposit(token.target,E('100'),ZeroAddress));await mine();
 const s=await session();await s.seed();await mine();
 let status=await s.run();assert.equal(status.status,'scheduled');assert.equal(status.policyCreated,true);
 assert.equal(status.readiness.archive.status,'provisional');assert.equal(status.readiness.archive.fullyVerified,false);assert.equal(status.readiness.archive.provisionalAccepted,true);
 assert.equal(s.policy.periodSeconds,86400);assert.equal(s.state.daily.epoch,0);assert.equal(status.firstPeriodEndsAt,s.policy.startTimestamp+86400);
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,0n);
 await rpc.request({method:'evm_increaseTime',params:[300]});await mine();await s.run();assert.equal((await vault.accounts(addresses[1],token.target)).profit,0n);
 await rpc.request({method:'evm_increaseTime',params:[86101]});await mine();
 const expected=E('100')*await vault.dailyTargetBps(addresses[1])/10000n;
 status=await s.run();assert.equal(status.status,'scheduled');assert.equal(s.state.daily.epoch,1);assert.equal((await vault.accounts(addresses[1],token.target)).profit,expected);
 await s.run();assert.equal((await vault.accounts(addresses[1],token.target)).profit,expected);
 assert.equal(s.requests.filter(row=>row.label.endsWith('-fund')).length,1);assert.equal(s.requests.filter(row=>!isFastTestSeedLabel(row.label)).length,1);
});
