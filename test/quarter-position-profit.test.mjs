import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,parseEther as E,keccak256,toUtf8Bytes} from 'ethers';
import {planDailyEpoch,executeDailyPlan,validateDailyPolicy,hourlyTestPolicyFields} from '../scripts/daily-profit.mjs';
import {auditPositionWallet} from '../scripts/hourly-payment-audit.mjs';
import {quarterPolicyTransition} from '../scripts/install-quarter-policy.mjs';
import {positionBasis,completePositionHour,scanPositionHistory} from '../scripts/position-profit.mjs';
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
const quarter=async(q,state)=>quarterPolicyTransition({policy:q,state:{daily:state,transactions:{}},checkpoint:await p.getBlock('latest')});
test('quarter periods start at activation, preserve paid hourly IDs and pay the same plan rate after 900 seconds',async()=>{
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(3600);
 const old=await plan(q,state);await pay(old,state);const before=structuredClone(state.positionPaid),next=await quarter(q,state);
 await advance(899);await scanPositionHistory({provider:p,policy:next,state,confirmations:0,advanceCompletedTarget:true});assert.equal((await plan(next,state)).status,'not_due');
 await advance(1);const first=await plan(next,state);assert.equal(first.status,'ready');assert.equal(first.positionCursor.quarter,true);assert.deepEqual(first.batches[0].amounts,[E('0.5').toString()]);assert.notEqual(first.batches[0].id,old.batches[0].id);await pay(first,state);
 assert.deepEqual(state.positionPaid,before);assert.equal(Object.values(state.positionQuarterPaid)[0],1);assert.equal((await v.accounts(a[1],token.target)).profit,E('1'));
 const audit=await auditPositionWallet({vault:v,wallet:a[1],state,block:await p.getBlock('latest'),policy:next});assert.equal(audit.positions[0].completedQuarters,1);assert.equal(audit.positions[0].unprocessedFullQuarters,0);assert.equal(audit.positions[0].unprocessedFullHours,0);
 const replay=await executeDailyPlan({provider:p,vault:v,plan:first,transact:()=>{throw Error('REPLAY');}});assert.equal(replay[0].status,'already_credited');
});
test('unpaid complete old hours keep the original batch IDs and are settled before new quarters',async()=>{
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(7200);
 const old=await plan(q,structuredClone(state)),next=await quarter(q,state);await advance(900);
 for(let i=0;i<3;i++){const x=await plan(next,state);assert.equal(x.status,'ready');if(i===0)assert.equal(x.batches[0].id,old.batches[0].id);if(i<2)assert.notEqual(x.positionCursor.quarter,true);else assert.equal(x.positionCursor.quarter,true);await pay(x,state);}
 assert.equal((await v.accounts(a[1],token.target)).profit,E('1.5'));assert.equal(Object.values(state.positionPaid)[0],2);assert.equal(Object.values(state.positionQuarterPaid)[0],1);
});
test('reinvested principal earns its additional quarter profit with eligible referrals, never a replay of hourly history',async()=>{
 await tx(v.connect(s[0]).register(ZeroAddress));await tx(v.connect(owner).setCustomerStatus(a[0],true,false));
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),a[0]));const next=await quarter(q,state);
 await advance(900);await pay(await plan(next,state),state);await tx(v.connect(s[1]).reinvest(token.target,E('0.5')));await advance(900);
 await pay(await plan(next,state),state);await pay(await plan(next,state),state);
 assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5025'));assert.equal((await v.accounts(a[0],token.target)).profit,E('0.0802'));assert.deepEqual(state.positionPaid,{});
});
test('quarter activation rejects pending signatures, mainnet, missing markers and changed cutover headers without mutating history',async()=>{
 const q=await policy(),checkpoint=await p.getBlock('latest'),state={daily:{positionPaid:{old:11}},transactions:{}};const before=structuredClone(state);
 const next=quarterPolicyTransition({policy:q,state,checkpoint});assert.deepEqual(state,before);assert.deepEqual(quarterPolicyTransition({policy:next,state,checkpoint}),next);
 assert.throws(()=>quarterPolicyTransition({policy:q,state:{...state,transactions:{pending:{raw:'saved'}}},checkpoint}),/PENDING/);
 for(const patch of [{chainId:56},{testMode:false},{quarterCutover:undefined},{testInterval:'hourly'},{positionScheduleVersion:1}])assert.throws(()=>validateDailyPolicy({...next,...patch}));
 await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(900);
 const bad={...next,quarterCutover:{...next.quarterCutover,hash:'0x'+'ab'.repeat(32)}};await assert.rejects(plan(bad,{}),/REORG/);
});

test('six consecutive quarter periods survive journal reloads and replay without double credit',async()=>{
 const q=await policy();let state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));const next=await quarter(q,state);
 for(let period=1;period<=6;period++){
  await advance(900);
  await scanPositionHistory({provider:p,policy:next,state,confirmations:0,advanceCompletedTarget:true});
  const x=await planDailyEpoch({provider:p,vault:v,policy:next,state,epoch:period-1,confirmations:0,indexedOnly:true});
  assert.equal(x.status,'ready');assert.equal(x.positionCursor.quarter,true);
  await pay(x,state);
  state=JSON.parse(JSON.stringify(state));
  const replay=await executeDailyPlan({provider:p,vault:v,plan:x,transact:()=>{throw Error('DUPLICATE_SEND');}});
  assert.ok(replay.every(b=>b.status==='already_credited'));
  assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5')*BigInt(period));
  assert.equal(Object.values(state.positionQuarterPaid)[0],period);
 }
});

test('500 plus 200 reinvested earns 4.90 per quarter and three referral levels; interrupted credit resumes exactly once',async()=>{
 await tx(v.connect(s[0]).register(ZeroAddress));
 await tx(v.connect(s[1]).register(a[0]));await tx(v.connect(s[2]).register(a[1]));
 for(let i=0;i<3;i++)await tx(v.connect(owner).setCustomerStatus(a[i],true,false));
 await tx(v.connect(s[3]).deposit(token.target,E('500'),a[2]));
 await tx(v.connect(op).batchProfit(keccak256(toUtf8Bytes('verified-test-earned-profit')),token.target,[a[3]],[E('200')]));
 await tx(v.connect(s[3]).reinvest(token.target,E('200')));
 assert.equal((await v.users(a[3])).capitalUsd,E('700'));
 assert.equal(await v.dailyTargetBps(a[3]),70n);
 const q=await policy();let state={};const next=await quarter(q,state);
 await advance(900);
 let interrupted=false;
 for(let i=0;i<2;i++){
  const x=await plan(next,state);assert.equal(x.status,'ready');
  if(!interrupted){
   let calls=0;
   await assert.rejects(executeDailyPlan({provider:p,vault:v,plan:x,transact:async(_,req)=>{if(++calls===2)throw Error('SIMULATED_NETWORK_STOP');return tx(op.sendTransaction(req));}}),/SIMULATED_NETWORK_STOP/);
   state=JSON.parse(JSON.stringify(state));interrupted=true;
  }
  await pay(await plan(next,state),state);
 }
 assert.equal((await v.accounts(a[3],token.target)).profit,E('4.9'));
 assert.equal((await v.accounts(a[2],token.target)).profit,E('0.49'));
 assert.equal((await v.accounts(a[1],token.target)).profit,E('0.245'));
 assert.equal((await v.accounts(a[0],token.target)).profit,E('0.147'));
 await advance(900);await scanPositionHistory({provider:p,policy:next,state,confirmations:0,advanceCompletedTarget:true});
 for(let i=0;i<2;i++)await pay(await plan(next,state),state);
 assert.equal((await v.accounts(a[3],token.target)).profit,E('9.8'));
 assert.equal((await v.accounts(a[2],token.target)).profit,E('0.98'));
 assert.equal((await v.accounts(a[1],token.target)).profit,E('0.49'));
 assert.equal((await v.accounts(a[0],token.target)).profit,E('0.294'));
});
