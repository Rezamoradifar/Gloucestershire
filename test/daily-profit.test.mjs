import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,keccak256,toUtf8Bytes,parseUnits} from 'ethers';
import {validateDailyPolicy,planDailyEpoch,executeDailyPlan,payApprovedRequests,sanitizeDailyMemberIndexDiagnostic} from '../scripts/daily-profit.mjs';
let rpc,provider,s,a,token,vault,queue,snapshot,deploymentBlock;
const amount=v=>parseUnits(v,6),id=v=>keccak256(toUtf8Bytes(v));
const tx=async p=>(await p).wait();
const artifact=n=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json'));
async function deploy(n,args=[]){const art=artifact(n),c=await new ContractFactory(art.abi,art.evm.bytecode.object,s[0]).deploy(...args);await c.waitForDeployment();return c;}
async function advance(seconds){await rpc.request({method:'evm_increaseTime',params:[seconds]});await rpc.request({method:'evm_mine',params:[]});}
async function policy(){const block=await provider.getBlock('latest');return {version:1,chainId:97,vaultAddress:vault.target,runtimeHash:keccak256(await provider.getCode(vault.target)),deploymentBlock,startTimestamp:block.timestamp+30,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true};}
const send=async(_label,request)=>tx(s[0].sendTransaction(request));
const plan=(p,state,epoch=0)=>planDailyEpoch({provider,vault,policy:p,state,epoch,confirmations:0});
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 s=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));a=await Promise.all(s.map(x=>x.getAddress()));
 token=await deploy('MockToken',[6]);const feed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('DeferredRewardsVault',[a[0],token.target,feed.target,feed.target,604800,a.slice(0,7),a[11]]);
 deploymentBlock=(await vault.deploymentTransaction().wait()).blockNumber;
 queue=new Contract(await vault.withdrawalQueue(),artifact('ProfitWithdrawalQueue').abi,s[0]);
 for(let i=0;i<3;i++){await tx(token.mint(a[i],amount('10000')));await tx(token.connect(s[i]).approve(vault.target,amount('10000')));}
 await tx(vault.connect(s[1]).deposit(token.target,amount('1000'),ZeroAddress));await tx(vault.connect(s[2]).register(ZeroAddress));
 await tx(vault.fundRewards(token.target,amount('500')));
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});
test('daily credits use the plan percentage, include completed reinvestment and cannot credit twice',async()=>{
 await tx(vault.batchProfit(id('seed-profit'),token.target,[a[1]],[amount('50')]));await tx(vault.connect(s[1]).reinvest(token.target,amount('50')));
 const p=await policy(),state={};assert.equal((await plan(p,state)).status,'not_due');
 await advance(86431);const daily=await plan(p,state);
 assert.equal(daily.status,'ready');assert.equal(daily.batches.length,1);assert.deepEqual(daily.batches[0].amounts,[amount('7.35').toString()]);
 const supply=await token.totalSupply(),before=(await vault.ledgers(token.target)).rewards;
 await executeDailyPlan({provider,vault,plan:daily,transact:send});
 assert.equal((await vault.accounts(a[1],token.target)).profit,amount('7.35'));
 assert.equal((await vault.ledgers(token.target)).rewards,before-amount('7.35'));assert.equal(await token.totalSupply(),supply);
 let broadcasts=0;await executeDailyPlan({provider,vault,plan:daily,transact:async()=>{broadcasts++;}});assert.equal(broadcasts,0);
});
test('late deposits and reinvestments first earn in the next snapshot; missed days retain their own historical balances',async()=>{
 const p=await policy(),state={};await advance(31);
 await tx(vault.connect(s[2]).deposit(token.target,amount('1000'),ZeroAddress));
 await tx(vault.batchProfit(id('later-profit'),token.target,[a[1]],[amount('50')]));await tx(vault.connect(s[1]).reinvest(token.target,amount('50')));
 await advance(172801);
 const first=await plan(p,state,0);assert.deepEqual(first.batches[0].recipients,[a[1]]);assert.deepEqual(first.batches[0].amounts,[amount('7').toString()]);
 const second=await plan(p,state,1);assert.equal(second.batches[0].recipients.length,2);
 const rewards=new Map(second.batches[0].recipients.map((who,i)=>[who,second.batches[0].amounts[i]]));
 assert.equal(rewards.get(a[1]),amount('7.35').toString());assert.equal(rewards.get(a[2]),amount('7').toString());
});
test('funding shortfall and a changed snapshot never create a daily credit',async()=>{
 const p=await policy(),state={};await advance(86431);const daily=await plan(p,state);
 await tx(vault.batchProfit(id('other-budget-use'),token.target,[a[2]],[amount('499')]));
 await assert.rejects(executeDailyPlan({provider,vault,plan:daily,transact:send}),/FUNDING_REQUIRED/);
 assert.equal(await vault.usedRewardBatch(daily.batches[0].id),false);assert.equal((await vault.accounts(a[1],token.target)).profit,0n);
 await assert.rejects(executeDailyPlan({provider:{getBlock:async()=>({hash:id('reorg')})},vault,plan:daily,transact:send}),/SNAPSHOT_REORG/);
});
test('an incomplete index reports both historical principal mismatches without changing the journal or creating credit',async()=>{
 const native=parseUnits('10',18);
 await tx(vault.connect(s[1]).deposit(ZeroAddress,native,ZeroAddress,{value:native}));
 const p=await policy(),state={};await advance(86431);const daily=await plan(p,state);
 delete state.registry.members[a[1]];
 state.registry.members[a[3]]=daily.snapshotBlock+1;
 const before=structuredClone(state),block=await provider.getBlock(daily.snapshotBlock);
 await assert.rejects(plan(p,state),error=>{
  assert.equal(error.message,'INCOMPLETE_DAILY_MEMBER_INDEX');
  assert.deepEqual(error.memberIndexDiagnostic,{
   snapshot:{block:block.number,hash:block.hash,timestamp:block.timestamp},epoch:0,
   registry:{through:before.registry.through,hash:before.registry.hash,totalMembers:2,includedMembers:1,futureMembers:1},
   assets:[{asset:ZeroAddress,indexedPrincipal:'0',ledgerPrincipal:native.toString(),difference:native.toString()},{asset:token.target,indexedPrincipal:'0',ledgerPrincipal:amount('1000').toString(),difference:amount('1000').toString()}]
  });
  for(const address of a)assert.equal(JSON.stringify(error.memberIndexDiagnostic).includes(address),false);
  return true;
 });
 assert.deepEqual(state,before);
 assert.equal(await vault.usedRewardBatch(daily.batches[0].id),false);
 assert.equal((await vault.accounts(a[1],token.target)).profit,0n);
});
test('member index diagnostic sanitization removes private fields and rejects unsafe counts, hashes and amounts',()=>{
 const privateText='https://private.invalid/credential',safeHash=id('safe-snapshot');
 const value=sanitizeDailyMemberIndexDiagnostic({
  snapshot:{block:'10',hash:privateText,timestamp:-1,url:privateText},epoch:Infinity,
  registry:{through:10,hash:safeHash,totalMembers:NaN,includedMembers:2,futureMembers:'3',members:{[a[1]]:1}},
  assets:[{asset:ZeroAddress,indexedPrincipal:'0',ledgerPrincipal:'140008',difference:'140008',url:privateText},{asset:token.target,indexedPrincipal:'140009',ledgerPrincipal:'140008',difference:'-1'},{asset:a[1],indexedPrincipal:'1',ledgerPrincipal:'1',difference:'0'}],
  error:privateText,customer:a[1]
 });
 assert.deepEqual(value,{
  snapshot:{block:null,hash:null,timestamp:null},epoch:null,
  registry:{through:10,hash:safeHash,totalMembers:null,includedMembers:2,futureMembers:null},
  assets:[{asset:ZeroAddress,indexedPrincipal:'0',ledgerPrincipal:'140008',difference:'140008'},{asset:token.target,indexedPrincipal:'140009',ledgerPrincipal:'140008',difference:'-1'}]
 });
 const malformed=sanitizeDailyMemberIndexDiagnostic({assets:[{asset:privateText,indexedPrincipal:'1e18',ledgerPrincipal:'9'.repeat(97),difference:'-0'}]});
 assert.deepEqual(malformed.assets,[{asset:null,indexedPrincipal:null,ledgerPrincipal:null,difference:null}]);
 assert.doesNotMatch(JSON.stringify([value,malformed]),/private|credential|https:/);
});
test('automatic payouts wait for administrator approval and pay the fixed net amount exactly once',async()=>{
 await tx(vault.batchProfit(id('withdrawal-profit'),token.target,[a[1]],[amount('20')]));
 await tx(vault.connect(s[1]).withdrawProfit(token.target,amount('10')));
 const state={},before=await token.balanceOf(a[1]);let broadcasts=0;
 const transact=async(label,request)=>{broadcasts++;return tx(s[4].sendTransaction(request));};
 assert.deepEqual((await payApprovedRequests({vault,queue,state,transact})).paid,[]);assert.equal(broadcasts,0);
 await tx(queue.approve(0));assert.equal((await payApprovedRequests({vault,queue:queue.connect(s[4]),state,transact})).paid.length,1);
 assert.equal(await token.balanceOf(a[1])-before,amount('9.5'));
 assert.deepEqual((await payApprovedRequests({vault,queue,state,transact})).paid,[]);assert.equal(broadcasts,1);
});
test('the daily policy rejects other networks, ambiguous time rules and invalid starts',()=>{
 const valid={version:1,chainId:97,vaultAddress:'0x1111111111111111111111111111111111111111',runtimeHash:id('runtime'),deploymentBlock:1,startTimestamp:1,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true};
 assert.equal(validateDailyPolicy(valid).chainId,97);
 assert.equal(validateDailyPolicy({...valid,chainId:56}).periodSeconds,86400);
 for(const change of [{chainId:1},{periodSeconds:3600},{startTimestamp:0},{includeReinvestment:false},{runtimeHash:null},{basis:'wallet-balance'}])assert.throws(()=>validateDailyPolicy({...valid,...change}));
 for(const change of [{periodSeconds:3600},{testMode:true},{testMode:false},{initialServerReporter:true},{fastTestnetVersion:1},{testInterval:'hourly'},{releaseId:'global-fresh-fast-test-v1'}])assert.throws(()=>validateDailyPolicy({...valid,chainId:56,...change}),/MAINNET_DAILY_POLICY_REQUIRED/);
});
