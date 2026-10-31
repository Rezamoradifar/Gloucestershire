import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,parseEther as E,keccak256,toUtf8Bytes} from 'ethers';
import {planDailyEpoch,executeDailyPlan,validateDailyPolicy,hourlyTestPolicyFields} from '../scripts/daily-profit.mjs';
import {assertIndexerBinding} from '../scripts/index-zero-positions.mjs';
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
const noLogs=()=>new Proxy(p,{get(t,k){if(k==='getLogs')return async()=>{throw Error('PAYMENT_MUST_NOT_SCAN');};const x=Reflect.get(t,k);return typeof x==='function'?x.bind(t):x;}});
const indexed=(q,state)=>planDailyEpoch({provider:noLogs(),vault:v,policy:q,state,epoch:0,confirmations:0,indexedOnly:true});
const scan=(q,state,extra={})=>scanPositionHistory({provider:p,policy:q,state,confirmations:0,advanceCompletedTarget:true,...extra});
test('payments consume a complete prefix while a separate scanner is still catching up, without log reads or replay',async()=>{
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(3600);
 assert.equal((await scan(q,state)).status,'indexed');const prefix=state.positionIndex.through;
 await tx(v.connect(s[2]).deposit(token.target,E('1000'),ZeroAddress));await advance(3600);
 for(let i=0;i<2200;i++)await rpc.request({method:'evm_mine',params:[]});
 assert.equal((await scan(q,state,{maxRegistryPages:1})).status,'indexing');assert.equal(state.positionIndex.through,prefix);assert.ok(state.positionScanTarget.number>prefix);
 const first=await indexed(q,state);assert.equal(first.status,'ready');assert.deepEqual(first.batches[0].amounts,[E('0.5').toString()]);await pay(first,state);
 assert.equal((await indexed(q,state)).status,'not_due');
 for(let i=0;i<12&&state.positionIndex.through<state.positionScanTarget.number;i++)await scan(q,state,{maxRegistryPages:1});
 for(let i=0;i<5;i++){const next=await indexed(q,state);if(next.status!=='ready')break;await pay(next,state);}
 assert.equal((await v.accounts(a[1],token.target)).profit,E('1'));assert.equal((await v.accounts(a[2],token.target)).profit,E('7'));
 const before=structuredClone(state.positionPaid);assert.equal((await indexed(q,state)).status,'not_due');assert.deepEqual(state.positionPaid,before);
});
test('an interrupted later scan preserves its complete pages and does not prevent paying an already verified hour',async()=>{
 const q=await policy(),state={positionPaid:{},positionClosed:{}};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(3600);await scan(q,state);
 const prefix=state.positionIndex.through;await advance(3600);for(let i=0;i<250;i++)await rpc.request({method:'evm_mine',params:[]});
 const bad=new Proxy(p,{get(t,k){if(k==='getLogs')return async filter=>{if(filter.topics[0]===keccak256(toUtf8Bytes('Reinvested(address,address,uint256,uint256)'))&&filter.fromBlock>prefix+100)throw Object.assign(Error('failure'),{code:'SERVER_ERROR'});return t.getLogs(filter);};const x=Reflect.get(t,k);return typeof x==='function'?x.bind(t):x;}});
 await assert.rejects(scan(q,state,{provider:bad}));assert.ok(state.positionIndex.through>=prefix+100);assert.deepEqual(state.positionPaid,{});
 await pay(await indexed(q,state),state);assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5'));
 await scan(q,state);await pay(await indexed(q,state),state);assert.equal((await v.accounts(a[1],token.target)).profit,E('1'));
});
test('the signer-free scanner preserves financial cursors and payments reject a reorg or an incomplete indexed principal',async()=>{
 const q=await policy(),state={positionPaid:{keep:3},positionClosed:{keep:true}};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(3600);await scan(q,state);
 assert.deepEqual(state.positionPaid,{keep:3});assert.deepEqual(state.positionClosed,{keep:true});
 const corrupt=structuredClone(state);corrupt.positionIndex.hash='0x'+'ab'.repeat(32);await assert.rejects(indexed(q,corrupt),/REORG/);
 const missing=structuredClone(state);missing.positionIndex.positions={};await assert.rejects(indexed(q,missing),/INDEX_INCOMPLETE/);
});
test('an indexer cannot write across target bindings or resume a pending signed financial transaction',async()=>{
 const q=await policy();const target={target:v.target,owner:config.owner,operator:config.deployer,queue:await v.withdrawalQueue(),hash:'0x'+'ab'.repeat(32),runtimeHash:q.runtimeHash,block:deployBlock};
 const identity={version:1,chainId:97,target:v.target,owner:config.owner,operator:config.deployer,queue:target.queue,hash:target.hash,runtimeHash:q.runtimeHash};
 const state={identity,daily:{},transactions:{}};assert.doesNotThrow(()=>assertIndexerBinding({state,policy:q,target}));
 for(const patch of [{pending:{raw:'saved'}},{oracle:{pending:{}}},{transactions:{a:{raw:'saved'}}},{identity:{...identity,hash:'0x'+'cd'.repeat(32)}}])assert.throws(()=>assertIndexerBinding({state:{...state,...patch},policy:q,target}));
 assert.throws(()=>assertIndexerBinding({state,policy:{...q,chainId:56},target}));
});
