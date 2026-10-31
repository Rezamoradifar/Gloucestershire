import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,parseEther as E,keccak256,toUtf8Bytes} from 'ethers';
import {validateDailyPolicy,hourlyTestPolicyFields} from '../scripts/daily-profit.mjs';
import {runZeroStartAutomation} from '../scripts/zero-start-automation.mjs';
import {positionBasis} from '../scripts/position-profit.mjs';
const config=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json'));
let rpc,p,owner,op,s,a,v,token,deployBlock,snapshot;
const tx=async x=>(await x).wait();
const deploy=async(name,args,signer=s[0])=>{const a=JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
const now=async()=>(await p.getBlock('latest')).timestamp;
const advance=async sec=>{await rpc.request({method:'evm_increaseTime',params:[sec]});await rpc.request({method:'evm_mine',params:[]});};
const policy=async()=>validateDailyPolicy({version:1,chainId:97,vaultAddress:v.target,runtimeHash:keccak256(await p.getCode(v.target)),deploymentBlock:deployBlock,startTimestamp:await now(),basis:positionBasis,positionScheduleVersion:1,periodSeconds:3600,includeReinvestment:true,...hourlyTestPolicyFields});
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
async function worker(q,state,extra={}){
 const receipt=await v.deploymentTransaction().wait();
 const queue=new Contract(await v.withdrawalQueue(),JSON.parse(fs.readFileSync('artifacts/ProfitWithdrawalQueue.json')).abi,op);
 const readiness={version:1,chainId:97,target:v.target,owner:config.owner,operator:config.deployer,queue:queue.target,hash:receipt.hash,runtimeHash:q.runtimeHash,block:deployBlock,ready:true,blockers:[],releaseId:config.releaseId};
 return runZeroStartAutomation({provider:p,vault:v.connect(op),queue,readiness,state,save:()=>{},loadPolicy:()=>q,savePolicy:()=>{throw Error('POLICY_REWRITE_FORBIDDEN');},hourlyTest:true,confirmations:0,
 maintainOracles:async()=>({status:'TESTNET_ORACLES_VALID'}),transact:async(label,request)=>{
  const parsed=(request.to===v.target?v:queue).interface.parseTransaction(request);assert.notEqual(parsed.name,'approve');assert.notEqual(parsed.name,'reinvest');
  const r=await tx(op.sendTransaction(request));state.transactions[label]={hash:r.hash,block:r.blockNumber,blockHash:r.blockHash};return r;
 },...extra});
}
test('the live testnet worker credits an hour and the reinvestment increment once, preserving restart progress and referrals',async()=>{
 await tx(v.connect(s[0]).register(ZeroAddress));await tx(v.connect(owner).setCustomerStatus(a[0],true,false));
 const q=await policy(),state={transactions:{},daily:{epoch:0}};
 await tx(v.connect(s[1]).deposit(token.target,E('100'),a[0]));await advance(3600);
 const first=await worker(q,state);assert.equal(first.dailyCredits.length,2);assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5'));assert.equal((await v.accounts(a[0],token.target)).profit,E('0.04'));
 await tx(v.connect(s[1]).reinvest(token.target,E('0.5')));await advance(3600);
 const restored=JSON.parse(JSON.stringify(state));await worker(q,restored);
 assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5025'));assert.equal((await v.accounts(a[1],token.target)).principal,E('100.5'));assert.equal((await v.accounts(a[0],token.target)).profit,E('0.0802'));
 const before=JSON.stringify(restored.daily.positionPaid);await worker(q,restored,{transact:()=>{throw Error('DUPLICATE_SEND');}});assert.equal(JSON.stringify(restored.daily.positionPaid),before);
});
test('owner cash deployment pauses new profit without reducing the amount or clearing historical cursors; returned cash resumes it',async()=>{
 const q=await policy(),state={transactions:{},daily:{epoch:0}};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));
 // Already-allocated customer profit must not be reused as funding for new credits.
 await tx(v.connect(s[2]).register(ZeroAddress));
 await tx(v.connect(op).batchProfit(keccak256(toUtf8Bytes('existing-claim')),token.target,[a[2]],[E('1')]));
 await tx(v.connect(owner).ownerWithdrawCapital(token.target,a[3],(await v.assetBalance(token.target))-E('1.25')));await advance(3600);
 const waiting=await worker(q,state);assert.equal(waiting.status,'waiting');assert.ok(waiting.errors.includes('DAILY_PROFIT_CASH_COVERAGE_REQUIRED'));assert.equal(state.daily.epoch,0);assert.equal(Object.keys(state.daily.positionPaid).length,0);
 assert.equal((await v.accounts(a[1],token.target)).profit,0n);
 await tx(token.connect(owner).approve(v.target,E('1')));await tx(v.connect(owner).returnCapital(token.target,E('1')));await worker(q,state);assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5'));assert.equal(state.daily.epoch,1);
});
test('customer requests stay unpaid until owner approval, then the testnet worker pays automatically',async()=>{
 const q=await policy(),state={transactions:{},daily:{epoch:0}};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(3600);await worker(q,state);
 await tx(v.connect(s[1]).withdrawProfit(token.target,E('0.5')));
 const queue=new Contract(await v.withdrawalQueue(),JSON.parse(fs.readFileSync('artifacts/ProfitWithdrawalQueue.json')).abi,owner);
 await worker(q,state);assert.equal((await queue.requests(0)).status,0n);
 await tx(queue.approve(0));const before=await token.balanceOf(a[1]);await worker(q,state);assert.equal((await queue.requests(0)).status,1n);assert.equal(await token.balanceOf(a[1])-before,E('0.475'));
});
test('a planning transport failure never advances paid hours and the same journal catches up after recovery',async()=>{
 const q=await policy(),state={transactions:{},daily:{epoch:0}};await tx(v.connect(s[1]).deposit(token.target,E('100'),ZeroAddress));await advance(3600);
 const bad=new Proxy(p,{get(t,k){if(k==='getLogs')return async()=>{throw Object.assign(Error('network timeout'),{code:'TIMEOUT'});};const x=Reflect.get(t,k);return typeof x==='function'?x.bind(t):x;}});
 const r=await worker(q,state,{provider:bad});assert.equal(r.status,'waiting');assert.equal(state.daily.epoch,0);
 await worker(q,state);assert.equal(state.daily.epoch,1);assert.equal((await v.accounts(a[1],token.target)).profit,E('0.5'));
});
test('personal and referral batches require combined cash coverage before the first credit',async()=>{
 await tx(v.connect(s[0]).register(ZeroAddress));await tx(v.connect(owner).setCustomerStatus(a[0],true,false));
 const q=await policy(),state={transactions:{},daily:{epoch:0}};await tx(v.connect(s[1]).deposit(token.target,E('100'),a[0]));
 await tx(v.connect(s[2]).register(ZeroAddress));await tx(v.connect(op).batchProfit(keccak256(toUtf8Bytes('combined-existing-claim')),token.target,[a[2]],[E('1')]));
 await tx(v.connect(owner).ownerWithdrawCapital(token.target,a[3],(await v.assetBalance(token.target))-E('1.52')));await advance(3600);
 const r=await worker(q,state);assert.ok(r.errors.includes('DAILY_PROFIT_CASH_COVERAGE_REQUIRED'));assert.equal(state.daily.epoch,0);
 assert.equal((await v.accounts(a[1],token.target)).profit,0n);assert.equal((await v.accounts(a[0],token.target)).profit,0n);assert.equal(r.dailyCredits.length,0);
});
