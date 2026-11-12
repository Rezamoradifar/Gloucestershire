import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,MaxUint256,Transaction,ZeroAddress,keccak256,parseEther as E,toQuantity,toUtf8Bytes} from 'ethers';
import {isNewDeployerTestnetPolicy,validateDailyPolicy} from '../scripts/daily-profit.mjs';
import {seedNewDeployerTestRewards,verifyNewDeployerTestSeedPending,isNewDeployerTestSeedLabel} from '../scripts/fund-new-deployer-test-rewards.mjs';
import {makeNewDeployerHourlyTestPolicy} from '../scripts/new-deployer-hourly-test.mjs';
import {loadNewDeployerRelease} from '../scripts/new-deployer-testnet-profile.mjs';
import {NEW_DEPLOYER_DAILY_TIMER,loadRequiredNewDeployerDailyActivity,newDeployerAutomationPublicStatus,readNewDeployerDailyScheduling,reconcileNewDeployerPendingTransactions} from '../scripts/new-deployer-testnet-automation.mjs';
import {runZeroStartAutomation} from '../scripts/zero-start-automation.mjs';
import {maintainOracles} from '../scripts/maintain-testnet-oracles.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const release=loadNewDeployerRelease();
const tx=async request=>(await request).wait();
const id=value=>keccak256(toUtf8Bytes(value));
let rpc,provider,owner,operator,signers,addresses,token,vault,queue,deployment,snapshot;

async function mine(){for(let index=0;index<3;index++)await rpc.request({method:'evm_mine',params:[]});}
async function advance(seconds){await rpc.request({method:'evm_increaseTime',params:[seconds]});await mine();}
async function copyCodeAndStorage(source,target,slots){
 await rpc.request({method:'evm_setAccountCode',params:[target,await provider.getCode(source.target)]});
 for(const slot of slots)await rpc.request({method:'evm_setAccountStorageAt',params:[target,'0x'+slot.toString(16).padStart(64,'0'),await provider.getStorage(source.target,slot)]});
}

async function readiness(){
 const block=await provider.getBlock('latest'),deploymentTransaction=await provider.getTransaction(deployment.hash);
 return {
  version:1,kind:'new-deployer-testnet-readiness',releaseId:release.releaseId,artifact:release.artifact,chainId:97,
  target:vault.target,contractAddress:vault.target,owner:release.owner,operator:release.deployer,token:release.token,queue:queue.target,
  hash:deployment.hash,block:deployment.blockNumber,blockHash:deployment.blockHash,artifactHash:release.artifactHash,initcodeHash:keccak256(deploymentTransaction.data),runtimeHash:keccak256(await provider.getCode(vault.target)),
  testMode:true,initialServerReporter:true,fastTestnetVersion:1,newDeployerTestnetVersion:1,fastNewDeployerTestnetVersion:1,siteConnected:true,reporterAuthorized:true,
  checkpoint:{block:block.number,blockHash:block.hash,timestamp:block.timestamp},funding:{ready:true,assets:[]},operatorGas:{positive:true},archive:{status:'local-test',fullyVerified:false},ready:true,blockers:[]
 };
}

async function session({eligible=async()=>true}={}){
 const ready=await readiness(),state={transactions:{},identity:{version:1,chainId:97,target:vault.target,owner:ready.owner,operator:ready.operator,queue:ready.queue,hash:ready.hash,runtimeHash:ready.runtimeHash}},requests=[];let policy,saves=0;
 const save=()=>{saves++;};
 const transact=async(label,request)=>{
  assert.equal(BigInt(request.value??0),0n);
  assert.ok([vault.target,queue.target,token.target,release.bnbFeed,release.tokenFeed].map(value=>value.toLowerCase()).includes(request.to.toLowerCase()));
  const existing=state.transactions[label];if(existing?.block)return provider.getTransactionReceipt(existing.hash);
  requests.push({label,request});const receipt=await tx(operator.sendTransaction(request));
  state.transactions[label]={hash:receipt.hash,block:receipt.blockNumber,blockHash:receipt.blockHash,maxFee:'0'};save();return receipt;
 };
 const current=async()=>readiness();
 const seed=async extra=>seedNewDeployerTestRewards({provider,wallet:operator,artifact:artifact('MockToken'),release,readiness:await current(),vault,state,save,transact,...extra});
 const defaultLoadActivity=async()=>({binding:id('new-deployer-activity'),activationTimestamp:1,eligible,assertCurrent:()=>{}});
 const run=async({loadActivity=defaultLoadActivity,requireActivityBeforePolicy=false}={})=>{
  const ready=await current();
  return runZeroStartAutomation({provider,vault,queue,readiness:ready,state,save,loadPolicy:()=>policy,savePolicy:value=>{policy=structuredClone(value);},transact,refreshReadiness:current,
   maintainOracles:async()=>{
    state.oracle??={};Object.defineProperty(state.oracle,'transactions',{get:()=>state.transactions,configurable:true,enumerable:false});
    const oracleWallet={address:operator.address,connect:()=>operator};
    return maintainOracles({provider,wallet:oracleWallet,artifact:artifact('MockFeed'),vaultAddress:vault.target,feedAddresses:[release.bnbFeed,release.tokenFeed],state:state.oracle,save,confirmations:1,transact:({label,request})=>transact(label,request)});
   },hourlyTest:true,makeHourlyPolicy:makeNewDeployerHourlyTestPolicy,confirmations:0,
   requireActivityBeforePolicy,loadActivity});
 };
 return {state,requests,save,seed,run,transact,get policy(){return policy;},get saves(){return saves;}};
}

async function runUntil(s,predicate,limit=8){
 let report;
 for(let index=0;index<limit;index++){
  report=await s.run();if(predicate(report))return report;
 }
 return report;
}

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12,unlockedAccounts:[release.owner,release.deployer]},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const account of [release.owner,release.deployer])await rpc.request({method:'evm_setAccountBalance',params:[account,toQuantity(E('10'))]});
 owner=await provider.getSigner(release.owner);operator=await provider.getSigner(release.deployer);
 signers=await Promise.all(Array.from({length:12},(_,index)=>provider.getSigner(index)));addresses=await Promise.all(signers.map(signer=>signer.getAddress()));
 const deploy=async(name,args=[],signer=signers[0])=>{const item=artifact(name),contract=await new ContractFactory(item.abi,'0x'+item.evm.bytecode.object,signer).deploy(...args);await contract.waitForDeployment();return contract;};
 const sourceToken=await deploy('MockToken',[18]);await copyCodeAndStorage(sourceToken,release.token,[3,4]);token=new Contract(release.token,artifact('MockToken').abi,signers[0]);
 const sourceFeed=await deploy('MockFeed',[100000000n]);await copyCodeAndStorage(sourceFeed,release.bnbFeed,[0,1,2,3]);await copyCodeAndStorage(sourceFeed,release.tokenFeed,[0,1,2,3]);
 vault=await deploy('FastNewDeployerTestnetVault',[release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations],operator);
 deployment=await vault.deploymentTransaction().wait();queue=new Contract(await vault.withdrawalQueue(),artifact('ProfitWithdrawalQueue').abi,operator);
 await mine();snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('isolated seed retries an interrupted mint exactly once and never refills its fixed budget',async()=>{
 await tx(token.mint(release.deployer,E('9')));const s=await session();let interrupted=false;
 await assert.rejects(s.seed({transact:async(label,request)=>{const receipt=await s.transact(label,request);if(label.endsWith('-mint')&&!interrupted){interrupted=true;throw Error('INTERRUPTED_AFTER_MINT');}return receipt;}}),/INTERRUPTED_AFTER_MINT/);
 assert.equal(await token.balanceOf(release.deployer),E('10'));assert.equal(s.state.newDeployerSeedTest.completed,false);
 const mint=s.requests[0];assert.equal(await verifyNewDeployerTestSeedPending({provider,wallet:operator,artifact:artifact('MockToken'),release,readiness:await readiness(),vault,state:s.state,label:mint.label,request:mint.request}),true);
 await assert.rejects(verifyNewDeployerTestSeedPending({provider,wallet:operator,artifact:artifact('MockToken'),release,readiness:await readiness(),vault,state:s.state,label:mint.label,request:{to:token.target,data:token.interface.encodeFunctionData('mint',[release.deployer,E('10')])}}),/NEW_DEPLOYER_TEST_SEED_PENDING_TRANSACTION_MISMATCH/);
 const report=await s.seed();assert.equal(report.amountTestUsdt,'10');assert.equal(report.mintedTestUsdtUnits,E('1').toString());
 assert.equal((await vault.ledgers(token.target)).rewards,E('10'));assert.equal(await token.balanceOf(vault.target),E('10'));
 assert.equal(s.requests.filter(row=>row.label.endsWith('-mint')).length,1);assert.equal(s.requests.filter(row=>row.label.endsWith('-fund')).length,1);
 await tx(vault.connect(signers[1]).register(ZeroAddress));await tx(vault.batchProfit(id('spend-fixed-new-seed'),token.target,[addresses[1]],[E('10')]));await s.seed();
 assert.equal(s.requests.filter(row=>isNewDeployerTestSeedLabel(row.label)).length,3);assert.equal((await vault.ledgers(token.target)).rewards,0n);
});

test('hourly worker uses the new target, activity gate, oracle path, volume path, referrals, reinvestment and approved payout idempotently',async()=>{
 const s=await session();await s.seed();
 await tx(vault.connect(signers[0]).register(ZeroAddress));await tx(vault.connect(owner).setCustomerStatus(addresses[0],true,false));
 await tx(token.mint(addresses[1],E('100')));await tx(token.connect(signers[1]).approve(vault.target,MaxUint256));await tx(vault.connect(signers[1]).deposit(token.target,E('100'),addresses[0]));
 let report=await runUntil(s,value=>value.status==='scheduled');assert.equal(report.status,'scheduled',JSON.stringify(report));assert.equal(s.policy.releaseId,release.releaseId);assert.equal(isNewDeployerTestnetPolicy(s.policy),true);assert.equal(s.policy.owner,release.owner);assert.equal(s.policy.operator,release.deployer);
 assert.throws(()=>validateDailyPolicy({...s.policy,owner:release.deployer}),/NEW_DEPLOYER_HOURLY_POLICY_MARKERS_REQUIRED/);
 const rate=await vault.dailyTargetBps(addresses[1]),first=E('100')*rate/10000n,referralRate=(await vault.tierConfig(await vault.tierOf(addresses[1]))).referrals[0],firstReferral=first*referralRate/10000n;
 await advance(3601);report=await runUntil(s,value=>value.dailyCredits.length>0);assert.equal(report.status,'scheduled');assert.equal((await vault.accounts(addresses[1],token.target)).profit,first);assert.equal((await vault.accounts(addresses[0],token.target)).profit,firstReferral);
 const oldDomain=keccak256(toUtf8Bytes('GLOBAL_POSITION_HOURLY_TEST_V1'));
 assert.ok(s.requests.filter(row=>row.label.startsWith('daily-')).every(row=>!row.label.endsWith(oldDomain)));
 await tx(vault.connect(signers[1]).reinvest(token.target,first));await advance(3601);await runUntil(s,value=>value.dailyCredits.length>0);
 const second=(E('100')+first)*rate/10000n;assert.equal((await vault.accounts(addresses[1],token.target)).profit,second);
 await tx(vault.connect(signers[1]).withdrawProfit(token.target,first));const approved=new Contract(queue.target,artifact('ProfitWithdrawalQueue').abi,owner);await tx(approved.approve(0));
 const balance=await token.balanceOf(addresses[1]);await s.run();assert.equal((await queue.requests(0)).status,1n);assert.equal((await token.balanceOf(addresses[1]))-balance,first*95n/100n);
 const sends=s.requests.length;await s.run();assert.equal(s.requests.length,sends,'restart must not replay a completed credit or payout');
});

test('the replacement target requires its own activity policy, pays approved withdrawals first, and never backfills an inactive hour',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'new-deployer-activity-'));
 try{
  await assert.rejects(loadRequiredNewDeployerDailyActivity({provider,vaultAddress:vault.target,state:{},policyFile:path.join(root,'missing-policy.json')}),/NEW_DEPLOYER_DAILY_ACTIVITY_POLICY_REQUIRED/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
 const approved=await session();await approved.seed();await tx(token.mint(addresses[1],E('10')));await tx(token.connect(signers[1]).approve(vault.target,MaxUint256));await tx(vault.connect(signers[1]).deposit(token.target,E('10'),ZeroAddress));await tx(vault.batchProfit(id('activity-policy-withdrawal'),token.target,[addresses[1]],[E('1')]));await tx(vault.connect(signers[1]).withdrawProfit(token.target,E('1')));await tx(new Contract(queue.target,artifact('ProfitWithdrawalQueue').abi,owner).approve(0));
 await assert.rejects(approved.run({loadActivity:async()=>undefined,requireActivityBeforePolicy:true}),/DAILY_ACTIVITY_POLICY_REQUIRED/);
 assert.equal((await queue.requests(0)).status,1n,'an already approved withdrawal is independent from future reward eligibility');assert.equal(approved.policy,undefined);
 let active=false;const s=await session({eligible:async()=>active});await tx(token.mint(addresses[2],E('100')));await tx(token.connect(signers[2]).approve(vault.target,MaxUint256));await tx(vault.connect(signers[2]).deposit(token.target,E('100'),ZeroAddress));await runUntil(s,value=>value.status==='scheduled');
 const rate=await vault.dailyTargetBps(addresses[2]);await advance(3601);await runUntil(s,()=>Object.values(s.state.daily.positionPaid||{}).some(value=>value===1));
 assert.equal((await vault.accounts(addresses[2],token.target)).profit,0n,'inactive users receive no hourly credit');
 active=true;await advance(3601);await runUntil(s,value=>value.dailyCredits.length>0);
 assert.equal((await vault.accounts(addresses[2],token.target)).profit,E('100')*rate/10000n,'a later check-in earns only the later hour');assert.equal(Object.values(s.state.daily.positionPaid||{})[0],2);
});

test('automatic public status requires the isolated timer to be active',()=>{
 const result={readiness:{chainId:97,target:'0x1111111111111111111111111111111111111111'},status:'scheduled'};
 const inactive=readNewDeployerDailyScheduling({},()=>{throw Error('inactive');});
 assert.deepEqual(inactive,{kind:'none',timer:NEW_DEPLOYER_DAILY_TIMER,active:false});assert.equal(newDeployerAutomationPublicStatus(result,inactive).dailyAutomationActive,false);
 const active=readNewDeployerDailyScheduling({},()=>{});
 assert.equal(active.active,true);assert.equal(newDeployerAutomationPublicStatus(result,active).dailyAutomationActive,true);
});

test('liquidity shortfall freezes the due position cursor and resumes only after cash returns',async()=>{
 const s=await session();await s.seed();await tx(token.mint(addresses[1],E('100')));await tx(token.connect(signers[1]).approve(vault.target,MaxUint256));await tx(vault.connect(signers[1]).deposit(token.target,E('100'),ZeroAddress));await runUntil(s,value=>value.status==='scheduled');
 await tx(vault.batchProfit(id('existing-cash-claim'),token.target,[addresses[1]],[E('0.25')]));const cash=await vault.assetBalance(token.target);await tx(vault.connect(owner).ownerWithdrawCapital(token.target,addresses[2],cash-E('0.6')));await advance(3601);
 const waiting=await s.run();assert.equal(waiting.status,'waiting',JSON.stringify(waiting));assert.ok(waiting.errors.includes('DAILY_PROFIT_CASH_COVERAGE_REQUIRED'),JSON.stringify(waiting));assert.deepEqual(s.state.daily.positionPaid||{},{});assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('0.25'));
 await tx(token.mint(release.owner,E('1')));await tx(token.connect(owner).approve(vault.target,E('1')));await tx(vault.connect(owner).returnCapital(token.target,E('1')));
 const resumed=await runUntil(s,value=>value.dailyCredits.length>0);assert.equal(resumed.status,'scheduled');assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('0.75'));assert.equal(Object.values(s.state.daily.positionPaid)[0],1);
});

test('a broadcast approved-payout transaction is reconciled from its exact new-profile journal entry before later work',async()=>{
 const s=await session();await s.seed();await tx(token.mint(addresses[1],E('100')));await tx(token.connect(signers[1]).approve(vault.target,MaxUint256));await tx(vault.connect(signers[1]).deposit(token.target,E('100'),ZeroAddress));await tx(vault.batchProfit(id('pending-payout-profit'),token.target,[addresses[1]],[E('1')]));await tx(vault.connect(signers[1]).withdrawProfit(token.target,E('1')));
 const ownerQueue=new Contract(queue.target,artifact('ProfitWithdrawalQueue').abi,owner);await tx(ownerQueue.approve(0));const request=await queue.pay.populateTransaction(0),journalSigner=signers[2],journalAddress=await journalSigner.getAddress(),nonce=await provider.getTransactionCount(journalAddress,'pending'),gas=await provider.estimateGas({...request,from:journalAddress}),gasPrice=(await provider.getFeeData()).gasPrice;
 const raw=await rpc.request({method:'eth_signTransaction',params:[{from:journalAddress,to:request.to,data:request.data,value:'0x0',nonce:toQuantity(nonce),gas:toQuantity(gas*12n/10n),gasPrice:toQuantity(gasPrice),chainId:'0x61'}]});
 assert.equal(Transaction.from(raw).from,journalAddress);assert.ok(BigInt(await rpc.request({method:'eth_getBalance',params:[journalAddress,'latest']}))>E('1'));
 const pendingState={transactions:{'withdrawal-0':{raw,hash:keccak256(raw),maxFee:(gas*gasPrice).toString()}}};await provider.broadcastTransaction(raw);
 let resumed=0;const result=await reconcileNewDeployerPendingTransactions({provider,wallet:journalSigner,expectedOperator:journalAddress,state:pendingState,policy:{version:1},vault,queue,feedAddresses:[release.bnbFeed,release.tokenFeed],feedArtifact:artifact('MockFeed'),seedOptions:{},activity:async()=>{throw Error('ACTIVITY_MUST_NOT_BE_READ_FOR_WITHDRAWAL');},transact:async(label,value)=>{resumed++;assert.equal(label,'withdrawal-0');assert.deepEqual(value,{...request,value:0n});const receipt=await provider.getTransactionReceipt(keccak256(raw));pendingState.transactions[label]={...pendingState.transactions[label],block:receipt.blockNumber,blockHash:receipt.blockHash};return receipt;}});
 assert.equal(result.length,1);assert.equal(resumed,1);assert.equal((await queue.requests(0)).status,1n);
});


test('new depositor is indexed while older positions still have several overdue hours',async()=>{
 const s=await session();await s.seed();
 await tx(token.mint(addresses[1],E('100')));
 await tx(token.connect(signers[1]).approve(vault.target,MaxUint256));
 await tx(vault.connect(signers[1]).deposit(token.target,E('100'),ZeroAddress));
 await runUntil(s,value=>value.status==='scheduled');
 await advance(3600*9+1);
 const older=await s.run();
 assert.equal(older.status,'scheduled');
 assert.ok(older.dailyCredits.length>0);
 const oldThrough=s.state.daily.positionIndex.through;
 const oldPaid=structuredClone(s.state.daily.positionPaid);
 await tx(token.mint(addresses[2],E('100')));
 await tx(token.connect(signers[2]).approve(vault.target,MaxUint256));
 await tx(vault.connect(signers[2]).deposit(token.target,E('100'),ZeroAddress));
 await advance(3601);
 const refreshed=await s.run();
 assert.equal(refreshed.status,'scheduled',JSON.stringify(refreshed));
 assert.ok(s.state.daily.positionIndex.through>oldThrough,'the scanner must move past the old fully indexed block');
 assert.ok(s.state.daily.registry.members[addresses[2]],'newly registered wallet must be indexed');
 assert.ok(Object.values(s.state.daily.positionIndex.positions).some(row=>row.member===addresses[2]),'new deposit must be indexed');
 assert.ok(Object.keys(oldPaid).every(key=>s.state.daily.positionPaid[key]>=oldPaid[key]),'existing paid cursors may only advance');
 const expected=E('100')*(await vault.dailyTargetBps(addresses[2]))/10000n;
 for(let n=0;n<12&&(await vault.accounts(addresses[2],token.target)).profit===0n;n++)await s.run();
 assert.equal((await vault.accounts(addresses[2],token.target)).profit,expected,'eligible newly deposited user must get one confirmed credit');
 const before=(await vault.accounts(addresses[2],token.target)).profit;
 await s.run();
 assert.equal((await vault.accounts(addresses[2],token.target)).profit,before,'a worker restart cannot replay the new user credit');
});
