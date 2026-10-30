import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Wallet,Contract,ContractFactory,Transaction,ZeroAddress,keccak256,parseEther as E} from 'ethers';
import {runProductionAutomation,rewardFunding,productionGuard} from '../scripts/production-automation.mjs';
import {journalMainnetTransaction,validateMainnetJournal,validateMainnetWorkerRequest} from '../scripts/mainnet-automation-journal.mjs';
let rpc,p,s,a,token,v,queue,wallet,policy,snapshot;
const artifact=n=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json'));
const tx=async x=>(await x).wait();
const deploy=async(n,args)=>{const f=artifact(n),c=await new ContractFactory(f.abi,'0x'+f.evm.bytecode.object,s[0]).deploy(...args);await c.waitForDeployment();return c;};
const advance=async x=>{await rpc.request({method:'evm_increaseTime',params:[x]});await rpc.request({method:'evm_mine',params:[]});};
const proxy=(provider,overrides)=>new Proxy(provider,{get(t,k){if(k in overrides)return overrides[k];const value=Reflect.get(t,k);return typeof value==='function'?value.bind(t):value;}});
const fresh=()=>({transactions:{},daily:{epoch:0}});
function sender(state,provider=p,save=()=>{}){
 return (label,request)=>journalMainnetTransaction({provider,wallet,state,save,label,request,guard:()=>productionGuard({provider,vault:v,queue,policy,expectedOwner:a[0]}),target:v.target,queue:queue.target,token:token.target,maxTotalFee:E('0.1'),confirmations:1});
}
const run=(state,extra={})=>runProductionAutomation({provider:p,vault:v,queue,policy,expectedOwner:a[0],operator:a[0],state,execute:true,role:'primary',confirmations:0,assertLease:async()=>{},transact:sender(state),...extra});
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:10},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 p=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});p.pollingInterval=10;s=await Promise.all(Array.from({length:10},(_,i)=>p.getSigner(i)));a=await Promise.all(s.map(x=>x.getAddress()));
 wallet=new Wallet(rpc.getInitialAccounts()[a[0].toLowerCase()].secretKey,p);
 token=await deploy('MockToken',[18]);const feed=await deploy('MockFeed',[100000000n]);
 v=await deploy('AutomaticGroupVault',[a[0],token.target,feed.target,feed.target,604800,a.slice(0,7),a[9]]);const deployment=await v.deploymentTransaction().wait();
 queue=new Contract(await v.withdrawalQueue(),artifact('ProfitWithdrawalQueue').abi,s[0]);
 for(const [i,amount,parent]of [[1,'100',ZeroAddress],[2,'1000',a[1]]]){
  await tx(token.mint(a[i],E(amount)));await tx(token.connect(s[i]).approve(v.target,E(amount)));await tx(v.connect(s[i]).deposit(token.target,E(amount),parent));await tx(v.setCustomerStatus(a[i],true,false));
 }
 await tx(token.mint(a[0],E('10000')));await tx(token.approve(v.target,E('10000')));await tx(v.fundRewards(token.target,E('500')));
 policy={version:1,chainId:56,vaultAddress:v.target,runtimeHash:keccak256(await p.getCode(v.target)),deploymentBlock:deployment.blockNumber,startTimestamp:(await p.getBlock('latest')).timestamp+1,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true};
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await p.destroy();await rpc.disconnect();});
test('production credits personal and source-tier referral profit without daily owner confirmation or automatic reinvestment',async()=>{
 const state=fresh();await advance(86401);const r=await run(state);
 assert.equal(r.status,'credited');assert.equal(state.daily.epoch,1);
 assert.equal((await v.accounts(a[2],token.target)).profit,E('7'));assert.equal((await v.accounts(a[1],token.target)).profit,E('1.2'));
 assert.equal(await v.positionCount(a[2]),1n);const clone=JSON.parse(JSON.stringify(state));let sends=0;
 await run(clone,{transact:async()=>{sends++;throw Error('UNEXPECTED_SEND');}});assert.equal(sends,0);
});
test('standby and check mode never mutate the journal or use a sender',async()=>{
 const state=fresh(),before=JSON.stringify(state);let saves=0,sends=0;await advance(86401);
 for(const extra of [{role:'standby'},{execute:false}]){
  const r=await run(state,{...extra,save:()=>saves++,transact:()=>sends++});assert.equal(r.dryRun,true);
 }
 assert.equal(sends,0);assert.equal(saves,0);assert.equal(JSON.stringify(state),before);
});
test('owner can still deploy all treasury cash while underfunded new credits wait and later resume',async()=>{
 const state=fresh();await tx(v.ownerWithdrawCapital(token.target,a[8],await v.assetBalance(token.target)));
 assert.equal(await v.assetBalance(token.target),0n);assert.equal((await v.ledgers(token.target)).rewards,E('500'));
 await advance(86401);const waiting=await run(state);assert.equal(waiting.status,'reward-funding-required');assert.equal(state.daily.epoch,0);
 await tx(v.returnCapital(token.target,E('500')));await run(state);assert.equal(state.daily.epoch,1);
 const cash=await v.assetBalance(token.target);await tx(v.ownerWithdrawCapital(token.target,a[8],cash));assert.equal(await v.assetBalance(token.target),0n);
});
test('only owner approval unlocks an automated withdrawal payment',async()=>{
 const state=fresh();await advance(86401);await run(state);await tx(v.connect(s[2]).withdrawProfit(token.target,E('2')));
 await run(state);assert.equal((await queue.requests(0)).status,0n);
 await assert.rejects(queue.connect(s[3]).approve(0));await tx(queue.approve(0));const before=await token.balanceOf(a[2]);
 const r=await run(state);assert.equal((await queue.requests(0)).status,1n);assert.equal(r.withdrawals.paid.length,1);assert.equal(await token.balanceOf(a[2])-before,E('1.9'));
});
test('a lost pre-broadcast response resumes the saved signed bytes and completes referral batches once',async()=>{
 const state=fresh();await advance(86401);let durable;
 const bad=proxy(p,{broadcastTransaction:async()=>{throw Error('transport');}});
 await assert.rejects(run(state,{save:()=>{durable=JSON.parse(JSON.stringify(state));},transact:sender(state,bad,()=>{durable=JSON.parse(JSON.stringify(state));})}),/BROADCAST_UNCERTAIN/);
 assert.equal(state.daily.epoch,0);const restored=durable,checked=validateMainnetJournal({state:restored,operator:a[0],target:v.target,queue:queue.target,token:token.target,maxTotalFee:E('0.1')});
 assert.equal(checked.pending.length,1);const raw=restored.transactions[checked.pending[0].label].raw;
 await sender(restored)(checked.pending[0].label,checked.pending[0].request);assert.equal(restored.transactions[checked.pending[0].label].raw,raw);
 await run(restored);assert.equal(restored.daily.epoch,1);assert.equal((await v.accounts(a[2],token.target)).profit,E('7'));assert.equal((await v.accounts(a[1],token.target)).profit,E('1.2'));
});
test('late executions drain only bounded overdue daily periods and reloading preserves the cursor',async()=>{
 const state=fresh();await advance(3*86400+1);await run(state);assert.equal(state.daily.epoch,2);
 const restored=JSON.parse(JSON.stringify(state));await run(restored);assert.equal(restored.daily.epoch,3);assert.equal((await v.accounts(a[2],token.target)).profit,E('21'));
});
test('sender refuses owner transfers, automatic approvals, reinvestment and testnet saved transactions',async()=>{
 const cases=[['withdrawal-0',await queue.approve.populateTransaction(0)],['daily-'+'0x'+'11'.repeat(32),await v.ownerWithdrawCapital.populateTransaction(token.target,a[8],1n)],['daily-'+'0x'+'11'.repeat(32),await v.reinvest.populateTransaction(token.target,1n)]];
 for(const [label,request]of cases)assert.throws(()=>validateMainnetWorkerRequest({label,request,target:v.target,queue:queue.target,token:token.target}),/SCOPE/);
 const raw=await wallet.signTransaction({chainId:97,type:0,nonce:0,to:v.target,data:'0x',value:0n,gasLimit:21000,gasPrice:1});
 assert.throws(()=>validateMainnetJournal({state:{transactions:{invalid:{raw,hash:keccak256(raw),maxFee:'21000'}}},operator:a[0],target:v.target,queue:queue.target,token:token.target,maxTotalFee:E('0.1')}),/SAVED_TRANSACTION_INVALID/);
});
test('funding warnings do not treat principal claims as locked owner cash or double-count old profits',()=>{
 const r=rewardFunding({rewards:100n,cash:90n,profit:50n,feeReserve:10n,pending:20n});
 assert.equal(r.availableForNewProfitUnits,'10');assert.equal(r.rewardCashShortfallUnits,'90');assert.equal(r.ownerCapitalDeploymentRestricted,false);assert.equal(r.principalCashProtected,false);
});
test('voluntary reinvestment increases the next production snapshot principal without changing its tier rate',async()=>{
 const state=fresh(),id='0x'+'ab'.repeat(32);
 await tx(v.batchProfit(id,token.target,[a[1]],[E('50')]));
 await tx(v.connect(s[1]).reinvest(token.target,E('50')));
 const q={...policy,startTimestamp:(await p.getBlock('latest')).timestamp+1};
 await advance(86401);await run(state,{policy:q});
 // 150 * 0.5% personal + 10% of the child's 7-unit personal profit.
 assert.equal((await v.accounts(a[1],token.target)).profit,E('1.45'));
 assert.equal((await v.accounts(a[1],token.target)).principal,E('150'));
});
