import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,parseEther as E,ZeroAddress} from 'ethers';
let rpc,p,s,a,v,t,q,feed,snapshot;
const art=n=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json'));
const tx=async promise=>(await promise).wait();
async function deploy(n,args=[]){const x=art(n);const c=await new ContractFactory(x.abi,x.evm.bytecode.object,s[0]).deploy(...args);await c.waitForDeployment();return c;}
const rejected=async(promise,name)=>assert.rejects(promise,e=>{let actual=e.revert?.name;try{actual??=v.interface.parseError(e.data)?.name;}catch{}return actual===name;});
before(async()=>{
 assert.ok(art('DeferredRewardsVault').evm.deployedBytecode.object.length/2<=24576,'new vault must fit EIP-170');
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 p=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});p.pollingInterval=10;s=await Promise.all(Array.from({length:12},(_,i)=>p.getSigner(i)));a=await Promise.all(s.map(x=>x.getAddress()));
 t=await deploy('MockToken',[18]);feed=await deploy('MockFeed',[100000000n]);
 v=await deploy('DeferredRewardsVault',[a[0],t.target,feed.target,feed.target,86400,a.slice(0,7),a[11]]);q=new Contract(await v.withdrawalQueue(),art('ProfitWithdrawalQueue').abi,s[0]);
 for(let i=0;i<4;i++){await tx(t.mint(a[i],E('10000')));await tx(t.connect(s[i]).approve(v.target,E('10000')));}
 await tx(v.connect(s[1]).deposit(t.target,E('1000'),ZeroAddress));
 for(let i=2;i<=3;i++)await tx(v.connect(s[i]).deposit(t.target,E('3000'),a[1]));
 await tx(v.connect(s[1]).createRewardGroup([a[2],a[3]]));snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await p?.destroy();await rpc?.disconnect();});
test('zero cash and zero reward budget allow two earned stages; only 1500 volume is consumed',async()=>{
 assert.equal(await v.assetBalance(t.target),0n);const debt=await v.accounted(t.target);
 await tx(v.connect(s[1]).claimNetworkRewards(0,0,2));
 assert.equal((await v.accounts(a[1],t.target)).profit,E('105'));
 const g=await v.rewardGroup(a[1],0);assert.equal(g.stage,2n);assert.equal(g.consumedUsd.reduce((a,b)=>a+b,0n),E('1500'));
 assert.equal(await v.accounted(t.target),debt+E('105'));assert.equal(await v.liquidityShortfall(t.target),debt+E('105'));
 await rejected(v.connect(s[1]).claimNetworkRewards.staticCall(0,0,2),'NetworkStageChanged');
});
test('unfunded earned rewards can reinvest; no cash or new fee is required',async()=>{
 await tx(v.connect(s[1]).claimNetworkRewards(0,0,2));const debt=await v.accounted(t.target);
 await tx(v.connect(s[1]).reinvest(t.target,E('105')));
 const account=await v.accounts(a[1],t.target);assert.equal(account.profit,0n);assert.equal(account.principal,E('1105'));
 assert.equal(await v.accounted(t.target),debt);assert.equal(await v.assetBalance(t.target),0n);
});
test('request reserves profit without cash; funded payment is exact and cannot replay',async()=>{
 await tx(v.connect(s[1]).claimNetworkRewards(0,0,2));const debt=await v.accounted(t.target);
 await tx(v.connect(s[1]).withdrawProfit(t.target,E('100')));const r=await q.requests(0);
 const block=await p.getBlock('latest');assert.equal(r.dueAt,BigInt(block.timestamp)+259200n);assert.equal(r.fee,E('5'));
 assert.equal(await q.pending(t.target),E('100'));assert.equal((await v.accounts(a[1],t.target)).profit,E('5'));assert.equal(await v.accounted(t.target),debt);
 await rejected(q.connect(s[4]).pay.staticCall(0),'InvalidRequest');
 await rejected(q.connect(s[4]).approve.staticCall(0),'InvalidRequest');
 await tx(q.approve(0));
 await rejected(q.pay.staticCall(0),'InsufficientLiquidity');assert.equal((await q.requests(0)).status,3n);
 await rejected(v.connect(s[1]).reinvest.staticCall(t.target,E('6')),'Insufficient');
 await tx(v.returnCapital(t.target,E('100')));const before=await t.balanceOf(a[1]);
 await tx(q.connect(s[4]).pay(0));assert.equal(await t.balanceOf(a[1])-before,E('95'));assert.equal(await q.pending(t.target),0n);assert.equal(await v.accounted(t.target),debt-E('100'));
 await rejected(q.pay.staticCall(0),'InvalidRequest');
});
test('overdue request stays owed; only user may cancel after 72 hours and restore full credit',async()=>{
 await tx(v.connect(s[1]).claimNetworkRewards(0,0,2));await tx(v.connect(s[1]).withdrawProfit(t.target,E('100')));
 await rejected(q.connect(s[1]).cancel.staticCall(0),'InvalidRequest');
 await rpc.request({method:'evm_increaseTime',params:[259200]});await rpc.request({method:'evm_mine',params:[]});
 await rejected(q.connect(s[4]).cancel.staticCall(0),'InvalidRequest');const debt=await v.accounted(t.target);
 await tx(q.connect(s[1]).cancel(0));assert.equal((await v.accounts(a[1],t.target)).profit,E('105'));assert.equal(await v.accounted(t.target),debt);assert.equal(await q.pending(t.target),0n);
 await rejected(q.pay.staticCall(0),'InvalidRequest');
});
test('partial funded budget is consumed once; shortfall becomes a recorded liability',async()=>{
 await tx(v.fundRewards(t.target,E('10')));const debt=await v.accounted(t.target);
 await tx(v.connect(s[1]).claimNetworkRewards(0,0,2));assert.equal((await v.ledgers(t.target)).rewards,0n);assert.equal(await v.accounted(t.target),debt+E('95'));
});
test('unqualified batch is atomic and queue settlement cannot be forged',async()=>{
 await rejected(v.connect(s[1]).claimNetworkRewards.staticCall(0,0,4),'NetworkInsufficient');assert.equal((await v.rewardGroup(a[1],0)).stage,0n);
 await rejected(v.settleQueuedWithdrawal.staticCall(a[1],t.target,E('100'),0,0,false,true),'Unauthorized');
 await rejected(q.record.staticCall(a[1],t.target,E('100'),0,0,false),'InvalidRequest');
});

test('principal requests reserve the original position and cannot bypass administrator approval',async()=>{
 await rpc.request({method:'evm_increaseTime',params:[90*86400]});await rpc.request({method:'evm_mine',params:[]});
 const original=await v.positionOf(a[1],0),debt=await v.accounted(t.target);
 await tx(v.connect(s[1]).withdrawPrincipal(0,E('200')));
 assert.equal((await v.accounts(a[1],t.target)).principal,E('1000'));
 assert.equal((await q.principalRequests(0)).exists,true);assert.equal(await v.accounted(t.target),debt);
 await rejected(q.connect(s[1]).pay.staticCall(0),'InvalidRequest');
 await tx(q.approve(0));await rejected(q.pay.staticCall(0),'InsufficientLiquidity');
 await rpc.request({method:'evm_increaseTime',params:[259200]});await rpc.request({method:'evm_mine',params:[]});
 await tx(q.connect(s[1]).cancel(0));
 const restored=await v.positionOf(a[1],0);
 assert.equal(restored.principal,original.principal);assert.equal(restored.capitalUsd,original.capitalUsd);assert.equal(restored.unlockAt,original.unlockAt);
 assert.equal((await v.accounts(a[1],t.target)).principal,E('1000'));assert.equal(await v.accounted(t.target),debt);
 assert.equal(await v.retainedPrincipalPenalties(t.target),0n);
});
test('principal payment retains the snapshotted penalty and only pays the recorded user once',async()=>{
 await rpc.request({method:'evm_increaseTime',params:[90*86400]});await rpc.request({method:'evm_mine',params:[]});
 await tx(v.connect(s[1]).withdrawPrincipal(0,E('200')));await tx(v.returnCapital(t.target,E('200')));
 const before=await t.balanceOf(a[1]),debt=await v.accounted(t.target);
 await tx(q.approveAndPay(0));assert.equal(await t.balanceOf(a[1])-before,E('140'));
 assert.equal(await v.assetBalance(t.target),E('60'));assert.equal(await v.retainedPrincipalPenalties(t.target),E('60'));
 assert.equal(await v.accounted(t.target),debt-E('200'));await rejected(q.pay.staticCall(0),'InvalidRequest');
});
test('withdrawal approval follows two-step ownership changes and preserves the request fee',async()=>{
 await tx(v.connect(s[1]).claimNetworkRewards(0,0,2));await tx(v.connect(s[1]).withdrawProfit(t.target,E('100')));
 await tx(v.transferOwnership(a[4]));await tx(v.connect(s[4]).acceptOwnership());
 await rejected(q.approve.staticCall(0),'InvalidRequest');await tx(q.connect(s[4]).approve(0));
 assert.equal((await q.requests(0)).fee,E('5'));await rejected(q.connect(s[4]).approve.staticCall(0),'InvalidRequest');
});
