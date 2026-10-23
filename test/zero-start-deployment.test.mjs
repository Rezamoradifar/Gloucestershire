import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,Wallet,ZeroAddress,getAddress,getCreateAddress,keccak256} from 'ethers';
import {deployZeroStart,verifyZeroStartDeployment,validateZeroStartRelease,zeroStartRelease} from '../scripts/deploy-zero-start.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
const proxy=(target,overrides)=>new Proxy(target,{get(object,name){if(Object.hasOwn(overrides,name))return overrides[name];const value=Reflect.get(object,name);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,signers,addresses,token,feed,wallet,release,snapshot;
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const deploy=async(a,args)=>{const c=await new ContractFactory(a.abi,a.bytecode||'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;};
 token=await deploy(artifact('MockToken'),[18]);feed=await deploy(artifact('MockFeed'),[100000000n]);
 wallet=new Wallet(rpc.getInitialAccounts()[addresses[8].toLowerCase()].secretKey,provider);
 release={...zeroStartRelease,owner:addresses[0],deployer:wallet.address,token:token.target,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});
const options=(extra={})=>({provider,wallet,artifact:artifact('AutomaticGroupVault'),release,state:{transactions:{}},save:()=>{},confirmations:1,...extra});

test('release pins the reviewed testnet settings and automatic-group creation artifact',()=>{
 const pinned=validateZeroStartRelease(zeroStartRelease);
 assert.equal(pinned.chainId,97);assert.equal(pinned.owner,'0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');
 assert.equal(pinned.deployer,'0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2');
 assert.equal(pinned.token,'0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
 assert.equal(pinned.bnbFeed,'0xDA264c16Ec8832748a1A5A31b963deD9E48e337a');
 assert.equal(pinned.tokenFeed,'0xE7D68dF5e1e9B0F5BeB3201b4Ab1d64aC7761454');
 assert.equal(pinned.age,'86400');assert.equal(pinned.operations,'0x8c4AC9b009808a0B49Ba77b58e3871e7cDba463c');
 assert.deepEqual(pinned.partners,[
  '0xA7705F5c98263Caae042626a5d49528Dd982Af5F','0x2F980aC9ae92DB23cA2AEAd1CE8188A5764a7Bfa',
  '0x730C4664C58aE506C05b50e06c1CE73f71D82b87','0xa63AD5EEe7907D76B22eb140cC4009fDc3a6c977',
  '0xba869ec421be39c5F5410033Cf7Ec203298B151a','0x4274d411FF49Cfd2FCf1eC97Fb05f51099d5E0A3',
  '0x63c5B98AEfd69658B652d5F35FFda3C6c06847E3'
 ]);
 assert.equal(pinned.artifactHash,'0x64f24990045d9ef3d268e97657ed6e6af013cb73fc8ec39b9a862929c069e8cf');
 assert.equal(keccak256('0x'+artifact('AutomaticGroupVault').evm.bytecode.object),pinned.artifactHash);
 assert.equal(Object.hasOwn(pinned,'source'),false);
});

test('deploys once from literal settings, proves an empty approval queue and resumes a lost broadcast response',async()=>{
 const state={transactions:{}};let broadcasts=0,savedSigned=false;
 const expectedVault=getCreateAddress({from:wallet.address,nonce:0}),expectedQueue=getCreateAddress({from:expectedVault,nonce:1});
 const allowedCalls=new Set([expectedVault,expectedQueue,feed.target]),calls=[];
 const observed=proxy(provider,{
  call:async tx=>{const target=getAddress(tx.to);assert.ok(allowedCalls.has(target),'Unexpected contract read: '+target);calls.push(target);return provider.call(tx);},
  broadcastTransaction:async raw=>{assert.equal(savedSigned,true);broadcasts++;await provider.broadcastTransaction(raw);throw Error('response lost after broadcast');}
 });
 const args=options({provider:observed,state,save:()=>{savedSigned=Boolean(state.transactions['zero-start-deploy']?.raw);}});
 const report=await deployZeroStart(args);
 assert.equal(report.contractAddress,expectedVault);assert.equal(report.queue,expectedQueue);assert.equal(report.owner,addresses[0]);
 assert.equal(report.kind,'fresh-zero-automatic-groups');assert.equal(report.verified,true);assert.equal(report.emptyAtDeployment,true);
 assert.equal(report.approvalVersion,1);assert.equal(report.automaticGroupVersion,1);assert.equal(report.feedReadiness.ready,true);
 for(const key of ['accountsMigrated','siteConnected','automationActive','dailyAutomationActive'])assert.equal(report[key],false);
 assert.deepEqual(report.emptyStateCheckpoint,{block:report.block,blockHash:report.blockHash});
 const vault=new Contract(report.contractAddress,artifact('AutomaticGroupVault').abi,provider);
 assert.equal((await vault.users(addresses[1])).registered,false);assert.equal((await vault.accounts(addresses[1],token.target)).principal,0n);
 const queue=new Contract(report.queue,artifact('ProfitWithdrawalQueue').abi,provider);
 assert.equal(await queue.requestCount(),0n);assert.equal(await queue.vault(),report.contractAddress);assert.equal(await queue.APPROVAL_VERSION(),1n);
 const tx=await provider.getTransaction(report.hash),expected=await new ContractFactory(artifact('AutomaticGroupVault').abi,'0x'+artifact('AutomaticGroupVault').evm.bytecode.object).getDeployTransaction(release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations);
 assert.equal(tx.data,expected.data);assert.equal(report.initcodeHash,keccak256(expected.data));
 assert.equal((await deployZeroStart(args)).hash,report.hash);assert.equal(broadcasts,1);assert.equal(await provider.getTransactionCount(wallet.address),1);
 assert.ok(calls.includes(expectedVault));assert.ok(calls.includes(expectedQueue));
 await assert.rejects(deployZeroStart({...args,release:{...release,owner:addresses[2]}}),/ZERO_START_JOURNAL_IDENTITY_MISMATCH/);
 assert.equal(await provider.getTransactionCount(wallet.address),1);
});

test('rejects wrong chain, signer, changed artifact and an unbound old journal before signing',async()=>{
 const state={transactions:{}};
 const wrongChain=proxy(provider,{send:async method=>{assert.equal(method,'eth_chainId');return '0x38';}});
 await assert.rejects(deployZeroStart(options({state,provider:wrongChain})),/TESTNET_ONLY/);
 await assert.rejects(deployZeroStart(options({state,release:{...release,deployer:addresses[9]}})),/EXPECTED_DEPLOYER_KEY_REQUIRED/);
 await assert.rejects(deployZeroStart(options({state,artifact:artifact('DeferredRewardsVault')})),/ZERO_START_ARTIFACT_MISMATCH/);
 const unsupportedLogs=proxy(provider,{getLogs:async()=>{throw Error('query unsupported');}});
 await assert.rejects(deployZeroStart(options({state,provider:unsupportedLogs})),/ZERO_START_REGISTRATION_LOG_RPC_REQUIRED/);
 await assert.rejects(deployZeroStart(options({state:{transactions:{'fresh-deploy':{}}}})),/UNBOUND_ZERO_START_JOURNAL/);
 await assert.rejects(deployZeroStart(options({state,confirmations:0})),/ZERO_START_CONFIRMATIONS_REQUIRED/);
 await assert.rejects(deployZeroStart(options({state,release:{...release,partners:Array(7).fill(addresses[1])}})),/ZERO_START_PARTNERS_REQUIRED/);
 assert.deepEqual(state,{transactions:{}});assert.equal(await provider.getTransactionCount(wallet.address),0);
});

test('independent verification rejects forged initcode, noncanonical receipt and nonempty registration checkpoint',async()=>{
 const report=await deployZeroStart(options());
 const altered=proxy(provider,{getTransaction:async hash=>{const tx=await provider.getTransaction(hash);return {...tx,data:tx.data+'00'};}});
 await assert.rejects(verifyZeroStartDeployment({...options({provider:altered}),hash:report.hash}),/ZERO_START_TRANSACTION_MISMATCH/);
 const changedReceipt=proxy(provider,{getTransactionReceipt:async hash=>({...await provider.getTransactionReceipt(hash),blockHash:'0x'+'00'.repeat(32)})});
 await assert.rejects(verifyZeroStartDeployment({...options({provider:changedReceipt}),hash:report.hash}),/ZERO_START_RECEIPT_NOT_FINAL/);
 const registered=proxy(provider,{getLogs:async()=>[{address:report.contractAddress}]});
 await assert.rejects(verifyZeroStartDeployment({...options({provider:registered}),hash:report.hash}),/ZERO_START_INITIAL_REGISTRY_NOT_EMPTY/);
 assert.equal(await provider.getTransactionCount(wallet.address),1);
});

test('observes stale price feeds without refreshing them or claiming daily automation is active',async()=>{
 const block=await provider.getBlock('latest'),oldTimestamp=block.timestamp-86401;
 await (await feed.set(100000000n,oldTimestamp,12,12)).wait();
 const report=await deployZeroStart(options());
 assert.equal(report.feedReadiness.ready,false);assert.equal(report.dailyAutomationActive,false);
 assert.ok(report.feedReadiness.feeds.every(row=>row.updatedAt===String(oldTimestamp)&&row.roundId==='12'));
 const round=await feed.latestRoundData();assert.equal(round[3],BigInt(oldTimestamp));assert.equal(round[0],12n);
 assert.equal(report.config.bnbFeed,feed.target);assert.equal(report.config.tokenFeed,feed.target);
 assert.equal(await provider.getTransactionCount(wallet.address),1);
});
