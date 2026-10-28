import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,parseEther as E,keccak256,toUtf8Bytes} from 'ethers';
import {planDailyEpoch,executeDailyPlan,validateDailyPolicy,hourlyTestPolicyFields} from '../scripts/daily-profit.mjs';
import {positionBasis,completePositionHour} from '../scripts/position-profit.mjs';
const config=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json'));
let rpc,p,owner,op,s,a,v,token,deployBlock,snapshot;
const tx=async x=>(await x).wait();
const deploy=async(name,args,signer=s[0])=>{const a=JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
const now=async()=>(await p.getBlock('latest')).timestamp;
const advance=async sec=>{await rpc.request({method:'evm_increaseTime',params:[sec]});await rpc.request({method:'evm_mine',params:[]});};
const policy=async()=>validateDailyPolicy({version:1,chainId:97,vaultAddress:v.target,runtimeHash:keccak256(await p.getCode(v.target)),deploymentBlock:deployBlock,startTimestamp:await now(),basis:positionBasis,positionScheduleVersion:1,periodSeconds:3600,includeReinvestment:true,...hourlyTestPolicyFields});
const plan=(policy,state)=>planDailyEpoch({provider:p,vault:v,policy,state,epoch:0,confirmations:0});
const pay=async(q,state)=>{const r=await executeDailyPlan({provider:p,vault:v,plan:q,transact:async(_,req)=>tx(op.sendTransaction(req))});completePositionHour(state,q);return r;};
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:12,unlockedAccounts:[config.owner,config.deployer]},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 p=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 for(const addr of [config.owner,config.deployer])await rpc.request({method:'evm_setAccountBalance',params:[addr,'0x'+E('10').toString(16)]});
 owner=await p.getSigner(config.owner);op=await p.getSigner(config.deployer);s=await Promise.all(Array.from({length:12},(_,i)=>p.getSigner(i)));a=await Promise.all(s.map(x=>x.getAddress()));
 token=await deploy('MockToken',[18]);const feed=await deploy('MockFeed',[100000000n]);
 v=await deploy('FastTestnetVault',[config.owner,token.target,feed.target,feed.target,86400,a.slice(0,7),a[11]],op);deployBlock=(await v.deploymentTransaction().wait()).blockNumber;
 for(let i=0;i<4;i++){await tx(token.mint(a[i],E('10000')));await tx(token.connect(s[i]).approve(v.target,E('10000')));}
 await tx(token.mint(config.owner,E('10000')));await tx(token.connect(owner).approve(v.target,E('10000')));await tx(v.connect(owner).fundRewards(token.target,E('10000')));
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await p?.destroy();await rpc?.disconnect();});
test('a late deposit earns its full first hour exactly at its anniversary, then hourly without replay',async()=>{
 const q=await policy(),state={};await advance(1200);await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));
 await advance(3599);assert.equal((await plan(q,state)).status,'not_due');
 await advance(1);const first=await plan(q,state);assert.equal(first.status,'ready');assert.deepEqual(first.batches[0].amounts,[E('0.5').toString()]);await pay(first,state);
 assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5'));
 let sends=0;await executeDailyPlan({provider:p,vault:v,plan:first,transact:async()=>{sends++;}});assert.equal(sends,0);
 assert.equal((await plan(q,state)).status,'not_due');await advance(3600);const second=await plan(q,state);assert.notEqual(first.batches[0].id,second.batches[0].id);await pay(second,state);
 assert.equal((await v.accounts(a[1],token.target)).profit,E('1'));
});
test('reinvestment has its own full hour, adds the exact profit and referral without re-paying its parent principal',async()=>{
 await tx(v.connect(s[0]).register(ZeroAddress));await tx(v.connect(owner).setCustomerStatus(a[0],true,false));
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),a[0]));
 await advance(3600);await pay(await plan(q,state),state);
 assert.equal((await v.accounts(a[0],token.target)).profit,E('0.04'));
 await advance(600);await tx(v.connect(s[1]).reinvest(token.target,E('0.5')));
 await advance(3000);await pay(await plan(q,state),state); // Original position's second hour.
 assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5'));
 await advance(599);assert.equal((await plan(q,state)).status,'not_due');await advance(1);
 const reinvest=await plan(q,state);assert.equal(reinvest.positionCursor.key.endsWith(':1'),true);assert.deepEqual(reinvest.batches[0].amounts,[E('0.0025').toString()]);await pay(reinvest,state);
 assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5025'));
 assert.equal((await v.accounts(a[0],token.target)).profit,E('0.0802'));
});
test('a second deposit keeps an independent anniversary and a partial payout resumes its existing deterministic batches',async()=>{
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(900);await tx(v.connect(s[2]).deposit(token.target,E('1000'),ZeroAddress));
 await advance(2700);const first=await plan(q,state);await executeDailyPlan({provider:p,vault:v,plan:first,transact:async(_,r)=>tx(op.sendTransaction(r))});
 const retry=await plan(q,state);assert.deepEqual(retry.batches,first.batches);assert.equal((await pay(retry,state))[0].status,'already_credited');
 await advance(899);assert.equal((await plan(q,state)).status,'not_due');await advance(1);const second=await plan(q,state);assert.deepEqual(second.batches[0].amounts,[E('7').toString()]);await pay(second,state);
 assert.equal((await v.accounts(a[2],token.target)).profit,E('7'));
});
test('missing reward budget and incomplete position indexes cannot advance a payment cursor',async()=>{
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(3600);const first=await plan(q,state);
 const blocked=new Proxy(v,{get(t,k){if(k==='assetBalance')return async()=>0n;const x=Reflect.get(t,k);return typeof x==='function'?x.bind(t):x;}});
 await assert.rejects(executeDailyPlan({provider:p,vault:blocked,plan:first,transact:async()=>{throw Error('unexpected send');}}),/FUNDING/);assert.equal(state.positionPaid[first.positionCursor.key],undefined);
 delete state.positionIndex.positions[first.positionCursor.key];await assert.rejects(plan(q,state),/POSITION_INDEX_INCOMPLETE/);
});
test('position anniversary mode rejects mainnet and unsupported intervals',async()=>{
 const q=await policy();assert.throws(()=>validateDailyPolicy({...q,chainId:56}),/MAINNET/);assert.throws(()=>validateDailyPolicy({...q,periodSeconds:86400}),/POSITION_HOURLY_TEST_ONLY/);
});
test('switching timing preserves journal data and refuses any old or pending credit rather than double-paying',async()=>{
 const {positionPolicyTransition}=await import('../scripts/install-position-policy.mjs');
 const newPolicy=await policy(),oldPolicy={...newPolicy,basis:'period-start-active-principal'};delete oldPolicy.positionScheduleVersion;
 const state={transactions:{oracle:{block:1,raw:'keep'}},daily:{epoch:20,registry:{members:{}}}};
 const original=JSON.stringify(state),updated=positionPolicyTransition({policy:oldPolicy,state,expectedTarget:v.target});
 assert.equal(positionPolicyTransition({policy:oldPolicy,state:{...state,daily:{epoch:20,lastCredit:{epoch:19,credited:[]}}},expectedTarget:v.target}).basis,positionBasis);
 assert.equal(updated.basis,positionBasis);assert.equal(JSON.stringify(state),original);
 for(const blocked of [{...state,pending:{signed:true}},{...state,transactions:{'daily-old':{block:1}}},{...state,transactions:{unsigned:{raw:'pending'}}},{...state,daily:{lastCredit:{epoch:1}}}])assert.throws(()=>positionPolicyTransition({policy:oldPolicy,state:blocked,expectedTarget:v.target}),/PREVIOUS_OR_PENDING/);
 assert.throws(()=>positionPolicyTransition({policy:oldPolicy,state,expectedTarget:a[0]}),/EXPECTED_FAST_TARGET/);
});
