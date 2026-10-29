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
test('a long index catches up in bounded resumable pages without chasing the moving head or paying early',async()=>{
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(3600);
 for(let i=0;i<4100;i++)await rpc.request({method:'evm_mine',params:[]});
 const first=await plan(q,state);assert.equal(first.status,'indexing');const fixed=state.positionScanTarget.number;
 assert.ok(state.registry.through<=q.deploymentBlock+1999);
 for(let i=0;i<600;i++)await rpc.request({method:'evm_mine',params:[]});
 let result;
 for(let i=0;i<10;i++){
  const before=state.positionIndex?.through;
  result=await plan(q,state);
  if(before!==undefined)assert.ok(state.positionIndex.through-before<=2000);
  if(result.status==='ready')break;
  assert.equal(state.positionScanTarget.number,fixed);assert.deepEqual(state.positionPaid||{},{});
 }
 assert.equal(result.status,'ready');assert.equal(state.positionIndex.through,fixed);assert.equal((await v.accounts(a[1],token.target)).profit,0n);
 await pay(result,state);assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5'));
});
test('planning read budget stops new RPC reads while leaving financial work outside the budget',async()=>{
 const {positionReadBudget}=await import('../scripts/position-profit.mjs');let t=0,reads=0;
 const r=positionReadBudget({getBlock:async n=>{reads++;return {number:n};}},{clock:()=>t,milliseconds:100});
 assert.equal((await r.getBlock(1)).number,1);t=100;
 await assert.rejects(r.getBlock(2),e=>e.code==='TIMEOUT'&&e.message==='POSITION_READ_BUDGET_EXCEEDED');assert.equal(reads,1);
});

test('position and member scans use small requests when opaque server errors reject wider ranges',async()=>{
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(3600);
 for(let i=0;i<600;i++)await rpc.request({method:'evm_mine',params:[]});
 const spans=[];
 const narrow=new Proxy(p,{get(t,k){
  if(k==='getLogs')return async filter=>{const size=filter.toBlock-filter.fromBlock+1;spans.push(size);if(size>10)throw Object.assign(Error('opaque server failure'),{code:'SERVER_ERROR'});return t.getLogs(filter);};
  const value=Reflect.get(t,k);return typeof value==='function'?value.bind(t):value;
 }});
 const result=await planDailyEpoch({provider:narrow,vault:v,policy:q,state,epoch:0,confirmations:0});
 assert.equal(result.status,'ready');assert.ok(spans.length>60);assert.ok(spans.every(n=>n<=10));
 assert.equal(state.positionIndex.through,state.registry.through);assert.deepEqual(state.positionPaid,{});
 await pay(result,state);assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5'));
});

test('due hours drain at the verified target without rescanning a moving head between credits',async()=>{
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(10800);
 const first=await plan(q,state),fixed=state.positionScanTarget.number;await pay(first,state);
 for(let i=0;i<600;i++)await rpc.request({method:'evm_mine',params:[]});await advance(3600);
 let logReads=0;
 const noScan=new Proxy(p,{get(t,k){if(k==='getLogs')return async()=>{logReads++;throw Error('UNEXPECTED_RESCAN');};const x=Reflect.get(t,k);return typeof x==='function'?x.bind(t):x;}});
 const next=()=>planDailyEpoch({provider:noScan,vault:v,policy:q,state,epoch:0,confirmations:0});
 const second=await next();assert.equal(second.status,'ready');assert.equal(state.positionScanTarget.number,fixed);await pay(second,state);
 const third=await next();assert.equal(third.status,'ready');assert.equal(state.positionScanTarget.number,fixed);await pay(third,state);
 assert.equal(logReads,0);assert.equal((await v.accounts(a[1],token.target)).profit,E('1.5'));
 await assert.rejects(next());assert.ok(logReads>0);assert.equal(Object.values(state.positionPaid)[0],3);
});

test('a failed later log page retains completed 100-block position pages and retries without duplicate credit',async()=>{
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(3600);
 for(let i=0;i<250;i++)await rpc.request({method:'evm_mine',params:[]});
 const reinvestTopic=keccak256(toUtf8Bytes('Reinvested(address,address,uint256,uint256)'));
 const failing=new Proxy(p,{get(t,k){if(k==='getLogs')return async filter=>{if(filter.topics[0]===reinvestTopic&&filter.fromBlock>=q.deploymentBlock+100)throw Object.assign(Error('opaque failure'),{code:'SERVER_ERROR'});return t.getLogs(filter);};const x=Reflect.get(t,k);return typeof x==='function'?x.bind(t):x;}});
 await assert.rejects(planDailyEpoch({provider:failing,vault:v,policy:q,state,epoch:0,confirmations:0}));
 assert.equal(state.positionIndex.through,q.deploymentBlock+99);assert.deepEqual(state.positionPaid,{});
 const resumed=await plan(q,state);assert.equal(resumed.status,'ready');await pay(resumed,state);
 assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5'));assert.equal(Object.values(state.positionPaid)[0],1);
});

test('a cooperative scan yield saves only complete registration pages and never fabricates payment',async()=>{
 const {indexMembers}=await import('../scripts/daily-profit.mjs');
 const q=await policy(),state={};let pages=0,saved=0;
 const empty={getBlock:async number=>({number,hash:'0x'+number.toString(16).padStart(64,'0')}),getLogs:async()=>[]};
 const complete=await indexMembers({provider:empty,policy:q,state,through:q.deploymentBlock+500,save:()=>{saved++;},pageSize:100,maxPages:20,logOptions:{maxBlockSpan:10},shouldContinue:()=>pages++<1});
 assert.equal(complete,false);assert.equal(state.registry.through,q.deploymentBlock+99);assert.equal(saved,1);assert.equal(state.positionPaid,undefined);
});

test('read-only live audit proves exact mined credit events and rejects mismatched receipts',async()=>{
 const {auditProfitReceipt,auditPositionWallet,diagnosticPeriodStart,recentJournalProfitCredits}=await import('../scripts/hourly-payment-audit.mjs');
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(3600);
 const first=await plan(q,state),credits=await pay(first,state);
 const evidence=await auditProfitReceipt({provider:p,target:v.target,operator:config.deployer,credit:credits[0],confirmations:1});
 assert.deepEqual(recentJournalProfitCredits({transactions:{['daily-'+credits[0].id]:{hash:credits[0].transactionHash,block:evidence.block},['daily-'+'0x'+'ff'.repeat(32)]:{hash:'0x'+'ab'.repeat(32)}}}),[{id:credits[0].id,transactionHash:credits[0].transactionHash}]);
 assert.equal(evidence.status,'verified');assert.deepEqual(evidence.credits,[{wallet:a[1],asset:token.target,amountUnits:E('0.5').toString()}]);
 const before=JSON.stringify(state),wallet=await auditPositionWallet({vault:v,wallet:a[1],state,block:await p.getBlock('latest')});
 assert.equal(wallet.positionCount,1);assert.equal(wallet.positions[0].completedHours,1);assert.equal(wallet.positions[0].unprocessedFullHours,0);assert.equal(wallet.profitUnits,E('0.5').toString());assert.equal(JSON.stringify(state),before);
 assert.equal(diagnosticPeriodStart(q,20),q.startTimestamp);
 assert.equal(diagnosticPeriodStart({...q,basis:'period-start-active-principal'},20),q.startTimestamp+20*3600);
 for(const override of [r=>({...r,status:0}),r=>({...r,from:a[3]}),r=>({...r,blockHash:'0x'+'ab'.repeat(32)}),r=>({...r,logs:[]})]){
  const bad=new Proxy(p,{get(t,k){if(k==='getTransactionReceipt')return async hash=>override(await t.getTransactionReceipt(hash));const x=Reflect.get(t,k);return typeof x==='function'?x.bind(t):x;}});
  await assert.rejects(auditProfitReceipt({provider:bad,target:v.target,operator:config.deployer,credit:credits[0],confirmations:1}));
 }
 await assert.rejects(auditProfitReceipt({provider:p,target:v.target,operator:config.deployer,credit:{...credits[0],id:'0x'+'cd'.repeat(32)},confirmations:1}),/BATCH_MISMATCH/);
});

test('reloading a saved journal after a completed payment never pays that hour twice',async()=>{
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(3600);
 const first=await plan(q,state);await pay(first,state);
 const restored=JSON.parse(JSON.stringify(state));let duplicateSends=0;
 const replay=await executeDailyPlan({provider:p,vault:v,plan:first,transact:async()=>{duplicateSends++;throw Error('DUPLICATE_PAYMENT');}});
 assert.equal(duplicateSends,0);assert.equal(replay[0].status,'already_credited');
 assert.equal((await plan(q,restored)).status,'not_due');await advance(3600);await pay(await plan(q,restored),restored);
 assert.equal((await v.accounts(a[1],token.target)).profit,E('1'));assert.equal(Object.values(restored.positionPaid)[0],2);
});

test('reloading after only the personal batch confirms resumes referrals exactly once',async()=>{
 await tx(v.connect(s[0]).register(ZeroAddress));await tx(v.connect(owner).setCustomerStatus(a[0],true,false));
 const q=await policy(),state={};await tx(v.connect(s[1]).deposit(token.target,E('100'),a[0]));await advance(3600);
 const first=await plan(q,state);assert.equal(first.batches.length,2);
 await executeDailyPlan({provider:p,vault:v,plan:{...first,batches:first.batches.slice(0,1)},transact:async(_,request)=>tx(op.sendTransaction(request))});
 const restored=JSON.parse(JSON.stringify(state)),retry=await plan(q,restored);assert.deepEqual(retry.batches,first.batches);
 const result=await pay(retry,restored);assert.equal(result[0].status,'already_credited');assert.equal(result[1].status,'credited');
 assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5'));assert.equal((await v.accounts(a[0],token.target)).profit,E('0.04'));
 assert.equal(Object.values(restored.positionPaid)[0],1);
});
