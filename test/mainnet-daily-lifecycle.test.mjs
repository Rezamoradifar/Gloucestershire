import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,keccak256,parseEther as E,toUtf8Bytes} from 'ethers';
import {executeDailyPlan,payApprovedRequests,planDailyEpoch,validateDailyPolicy} from '../scripts/daily-profit.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const tx=async promise=>(await promise).wait();
const sorted=map=>Array.from(map).sort(([a],[b])=>a.localeCompare(b));
const proxy=(target,overrides)=>new Proxy(target,{get(object,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});

test('ordinary chain-56 daily allocations complete a funded referral, reinvestment and approved-withdrawal lifecycle',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:14},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 try{
  const signers=await Promise.all(Array.from({length:14},(_,index)=>provider.getSigner(index))),addresses=await Promise.all(signers.map(signer=>signer.getAddress()));
  const deploy=async(name,args)=>{const a=artifact(name),contract=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await contract.waitForDeployment();return contract;};
  const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]);
  const vault=await deploy('AutomaticGroupVault',[addresses[0],token.target,feed.target,feed.target,604800,addresses.slice(0,7),addresses[13]]),deployment=await vault.deploymentTransaction().wait();
  const queue=new Contract(await vault.withdrawalQueue(),artifact('ProfitWithdrawalQueue').abi,signers[0]);
  assert.equal(Number(await provider.send('eth_chainId',[])),56);assert.equal(await vault.reporters(addresses[0]),true);assert.equal(await vault.AUTO_REWARD_GROUP_VERSION(),1n);assert.equal(vault.interface.hasFunction('FAST_TESTNET_VERSION'),false);

  // Mixed tiers distinguish the earning member's rates from its recipients' tiers.
  const capitals=['50001','100','3000','1000','50001'].map(E),members=addresses.slice(1,6),tiers=[4n,0n,2n,1n,4n];
  for(let index=0;index<members.length;index++){
   const referrer=index===0?ZeroAddress:members[index-1],signer=signers[index+1];
   await tx(vault.connect(signer).register(referrer));await tx(vault.setCustomerStatus(members[index],true,true));
   await tx(token.mint(members[index],capitals[index]));await tx(token.connect(signer).approve(vault.target,capitals[index]));await tx(vault.connect(signer).deposit(token.target,capitals[index],referrer));
   assert.equal(await vault.tierOf(members[index]),tiers[index]);assert.equal((await vault.users(members[index])).active,true);
  }
  const funding=E('100000');await tx(token.mint(addresses[0],funding));await tx(token.approve(vault.target,funding));await tx(vault.fundRewards(token.target,funding));
  const supply=await token.totalSupply(),cash=await token.balanceOf(vault.target),initialPrincipal=capitals.reduce((sum,value)=>sum+value,0n),initialRates=await Promise.all(members.map(member=>vault.dailyTargetBps(member))),configs=await Promise.all(tiers.map(tier=>vault.tierConfig(tier)));
  assert.deepEqual(initialRates,[130n,50n,90n,70n,130n]);assert.deepEqual(Array.from(configs[4].referrals),[1600n,800n,600n,400n]);assert.equal((await vault.ledgers(token.target)).principal,initialPrincipal);assert.equal((await vault.ledgers(token.target)).rewards,funding);
  const policy=validateDailyPolicy({version:1,chainId:56,vaultAddress:vault.target,runtimeHash:keccak256(await provider.getCode(vault.target)),deploymentBlock:deployment.blockNumber,startTimestamp:(await provider.getBlock('latest')).timestamp+30,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true});
  assert.equal(policy.periodSeconds,86400);assert.equal(Object.hasOwn(policy,'testMode'),false);
  const state={epoch:0},plan=epoch=>planDailyEpoch({provider,vault,policy,state,epoch,confirmations:0});
  const advanceTo=async timestamp=>{const latest=await provider.getBlock('latest');assert.ok(timestamp>=latest.timestamp);await rpc.request({method:'evm_increaseTime',params:[timestamp-latest.timestamp]});await rpc.request({method:'evm_mine',params:[]});};
  let dailySends=0,paidSends=0;
  const dailyTransact=async(_label,request)=>{dailySends++;return tx(signers[0].sendTransaction(request));};
  const expected=principal=>{
   const personal=new Map(),referrals=new Map(),sources=new Map();
   for(let index=0;index<members.length;index++){
    const gross=principal[index]*initialRates[index]/10000n;personal.set(members[index],gross);
    for(let level=1;level<=4&&index-level>=0;level++){
     const recipient=members[index-level],amount=gross*configs[index].referrals[level-1]/10000n;
     if(amount===0n)continue;
     referrals.set(recipient,(referrals.get(recipient)??0n)+amount);sources.set(members[index]+':'+recipient+':'+level,{amount,rateBps:configs[index].referrals[level-1],personalProfit:gross});
    }
   }
   return {personal,referrals,sources,total:Array.from(personal.values()).concat(Array.from(referrals.values())).reduce((sum,value)=>sum+value,0n)};
  };
  const assertPlan=(planned,wanted,epoch)=>{
   assert.equal(planned.status,'ready');assert.equal(planned.chainId,56);assert.equal(planned.vaultAddress,vault.target);assert.equal(planned.runtimeHash,policy.runtimeHash);assert.equal(planned.epoch,epoch);assert.equal(planned.end-planned.start,86400);assert.ok(planned.batches.every(batch=>batch.asset===token.target));
   const personal=new Map(planned.batches.filter(batch=>batch.kind!=='profit-referrals').flatMap(batch=>batch.rows).map(row=>[row.recipient,BigInt(row.amount)])),referrals=new Map(),sources=new Map();
   for(const row of planned.batches.filter(batch=>batch.kind==='profit-referrals').flatMap(batch=>batch.rows)){
    referrals.set(row.recipient,BigInt(row.amount));
    for(const source of row.sources)sources.set(source.source+':'+row.recipient+':'+source.level,{amount:BigInt(source.amount),rateBps:BigInt(source.rateBps),personalProfit:BigInt(source.personalProfit)});
   }
   assert.deepEqual(sorted(personal),sorted(wanted.personal));assert.deepEqual(sorted(referrals),sorted(wanted.referrals));assert.deepEqual(sorted(sources),sorted(wanted.sources));
   for(const batch of planned.batches){const domain=batch.kind==='profit-referrals'?'GLOBAL_DAILY_REFERRAL_V1':'GLOBAL_DAILY_V1';assert.equal(batch.id,keccak256(toUtf8Bytes([domain,56,vault.target.toLowerCase(),policy.startTimestamp,epoch,token.target.toLowerCase(),0].join(':'))));}
  };
  const credits=async(planned,wanted)=>{
   const before=await vault.ledgers(token.target),profits=await Promise.all(members.map(member=>vault.accounts(member,token.target).then(account=>account.profit)));
   await executeDailyPlan({provider,vault,plan:planned,transact:dailyTransact});
   const after=await vault.ledgers(token.target);assert.equal(after.rewards,before.rewards-wanted.total);assert.equal(after.profit,before.profit+wanted.total);assert.equal(after.principal,before.principal);
   for(let index=0;index<members.length;index++)assert.equal((await vault.accounts(members[index],token.target)).profit,profits[index]+wanted.personal.get(members[index])+(wanted.referrals.get(members[index])??0n));
   for(const batch of planned.batches)assert.equal(await vault.usedRewardBatch(batch.id),true);
   const sends=dailySends;await executeDailyPlan({provider,vault,plan:planned,transact:dailyTransact});assert.equal(dailySends,sends);assert.deepEqual(Array.from(await vault.ledgers(token.target)),Array.from(after));assert.equal(await token.totalSupply(),supply);
  };

  await advanceTo(policy.startTimestamp+86400-1);assert.equal((await plan(0)).status,'not_due');assert.equal(dailySends,0);assert.equal((await vault.accounts(members[4],token.target)).profit,0n);
  await advanceTo(policy.startTimestamp+86400+1);const day0=await plan(0),day0Expected=expected(capitals);assertPlan(day0,day0Expected,0);
  assert.deepEqual(Array.from(day0Expected.personal.values()),['650.013','0.5','27','7','650.013'].map(E));assert.deepEqual([1,2,3,4].map(level=>day0Expected.sources.get(members[4]+':'+members[4-level]+':'+level).amount),['104.00208','52.00104','39.00078','26.00052'].map(E));
  let rejectedSends=0;const rejectedTransact=async()=>{rejectedSends++;throw Error('IDENTITY_GUARD_MUST_PRECEDE_SEND');};
  await assert.rejects(executeDailyPlan({provider:proxy(provider,{send:async(method,params)=>method==='eth_chainId'?'0x61':provider.send(method,params)}),vault,plan:day0,transact:rejectedTransact}),/DAILY_CHAIN_MISMATCH/);
  await assert.rejects(executeDailyPlan({provider,vault,plan:{...day0,vaultAddress:token.target},transact:rejectedTransact}),/DAILY_VAULT_MISMATCH/);
  await assert.rejects(executeDailyPlan({provider,vault,plan:{...day0,runtimeHash:keccak256('0x')},transact:rejectedTransact}),/DAILY_RUNTIME_MISMATCH/);
  for(const key of ['chainId','vaultAddress','runtimeHash']){const unbound={...day0};delete unbound[key];await assert.rejects(executeDailyPlan({provider,vault,plan:unbound,transact:rejectedTransact}),/DAILY_PLAN_IDENTITY_REQUIRED/);}
  assert.equal(rejectedSends,0);assert.equal((await vault.ledgers(token.target)).rewards,funding);for(const batch of day0.batches)assert.equal(await vault.usedRewardBatch(batch.id),false);
  await credits(day0,day0Expected);state.epoch=1;

  const personalReinvest=day0Expected.personal.get(members[4]),networkReinvest=day0Expected.referrals.get(members[3]),reinvested=personalReinvest+networkReinvest,beforeReinvest=await vault.ledgers(token.target);
  assert.equal(networkReinvest,E('104.00208'));await tx(vault.connect(signers[5]).reinvest(token.target,personalReinvest));await tx(vault.connect(signers[4]).reinvest(token.target,networkReinvest));
  const afterReinvest=await vault.ledgers(token.target);assert.equal(afterReinvest.principal,beforeReinvest.principal+reinvested);assert.equal(afterReinvest.profit,beforeReinvest.profit-reinvested);assert.equal(afterReinvest.rewards,beforeReinvest.rewards);assert.equal(await token.balanceOf(vault.target),cash);
  for(const [index,amount]of [[4,personalReinvest],[3,networkReinvest]]){
   const account=await vault.accounts(members[index],token.target);assert.equal(account.principal,capitals[index]+amount);assert.equal(account.externalDeposited,capitals[index]);assert.equal(await vault.cumulativeReinvested(members[index],token.target),amount);assert.equal(await vault.positionCount(members[index]),2n);assert.equal((await vault.positionOf(members[index],1)).principal,amount);
  }
  assert.equal((await vault.accounts(members[4],token.target)).profit,0n);assert.equal((await vault.accounts(members[3],token.target)).profit,day0Expected.personal.get(members[3]));

  // Credits are available after the next period has already started. Reinvestment
  // first earns at the following snapshot and never rewrites that earlier day.
  await advanceTo(policy.startTimestamp+2*86400+1);const day1=await plan(1);assertPlan(day1,day0Expected,1);await credits(day1,day0Expected);state.epoch=2;
  const increased=[...capitals];increased[4]+=personalReinvest;increased[3]+=networkReinvest;
  await advanceTo(policy.startTimestamp+3*86400+1);const day2=await plan(2),day2Expected=expected(increased);assertPlan(day2,day2Expected,2);
  assert.equal(day2Expected.personal.get(members[4]),E('658.463169'));assert.equal(day2Expected.personal.get(members[3]),E('7.72801456'));assert.equal(day2Expected.sources.get(members[4]+':'+members[3]+':1').amount,E('105.35410704'));assert.equal(day2Expected.sources.get(members[3]+':'+members[2]+':1').amount,E('0.772801456'));
  await credits(day2,day2Expected);state.epoch=3;assert.equal(dailySends,6);assert.equal((await vault.ledgers(token.target)).rewards,funding-day0Expected.total*2n-day2Expected.total);

  const member=members[3],gross=E('10'),fee=gross*await vault.profitFeeBps()/10000n,net=gross-fee,feeWallet=await vault.WITHDRAWAL_FEE_WALLET(),beforeBalance=await token.balanceOf(member),beforeFee=await token.balanceOf(feeWallet),beforeCash=await token.balanceOf(vault.target),beforeRequest=await vault.ledgers(token.target),beforeProfit=(await vault.accounts(member,token.target)).profit;
  await tx(vault.connect(signers[4]).withdrawProfit(token.target,gross));
  const request=await queue.requests(0);assert.equal(request.user,member);assert.equal(request.asset,token.target);assert.equal(request.gross,gross);assert.equal(request.fee,fee);assert.equal(request.status,0n);assert.equal(await queue.pending(token.target),gross);assert.equal((await vault.accounts(member,token.target)).profit,beforeProfit-gross);assert.equal((await vault.ledgers(token.target)).profit,beforeRequest.profit-gross);assert.equal(await token.balanceOf(member),beforeBalance);
  const payout=async(_label,populated)=>{paidSends++;return tx(signers[7].sendTransaction(populated));},payoutState={};
  assert.deepEqual((await payApprovedRequests({vault,queue:queue.connect(signers[7]),state:payoutState,transact:payout})).paid,[]);assert.equal(paidSends,0);assert.equal(await token.balanceOf(member),beforeBalance);
  await tx(queue.approve(0));assert.equal((await queue.requests(0)).status,3n);
  assert.equal((await payApprovedRequests({vault,queue:queue.connect(signers[7]),state:payoutState,transact:payout})).paid.length,1);assert.equal(paidSends,1);assert.equal((await queue.requests(0)).status,1n);assert.equal(await queue.pending(token.target),0n);assert.equal(await token.balanceOf(member),beforeBalance+net);assert.equal(await token.balanceOf(feeWallet),beforeFee+fee);assert.equal(await token.balanceOf(vault.target),beforeCash-gross);
  assert.deepEqual((await payApprovedRequests({vault,queue:queue.connect(signers[7]),state:payoutState,transact:payout})).paid,[]);assert.equal(paidSends,1);assert.equal(await token.balanceOf(member),beforeBalance+E('9.5'));assert.equal(await token.totalSupply(),supply);assert.equal(state.epoch,3);assert.equal(policy.startTimestamp,day0.start);
 }finally{await provider.destroy();await rpc.disconnect();}
},120000);
