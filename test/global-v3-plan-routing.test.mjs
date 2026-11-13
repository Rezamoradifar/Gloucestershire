import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,parseEther} from 'ethers';

const to=amount=>parseEther(String(amount));
const done=async promise=>{const receipt=await(await promise).wait();assert.equal(receipt.status,1);return receipt;};
const fail=async promise=>{await assert.rejects(promise);};

test('V3 routes original fee shares and enforces qualification, milestone and funded payout',async()=>{
 execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 execFileSync(process.execPath,['scripts/compile-global-v3.mjs'],{stdio:'pipe'});
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:8,defaultBalance:100}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=25;
 try{
  const s=await Promise.all(Array.from({length:8},(_,i)=>provider.getSigner(i)));
  const a=await Promise.all(s.map(x=>x.getAddress()));
  const deploy=async(name,args)=>{
   const artifact=JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
   const contract=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,s[0]).deploy(...args);
   await contract.waitForDeployment();return contract;
  };
  const token=await deploy('MockToken',[18]);
  const vault=await deploy('GlobalV3DeferredTestnet',[a[0],token.target,a[7]]);
  const targets=[2500,10000,50000,250000,1000000];
  const directs=[4,6,8,10,12],maxRates=[100,120,150,180,200];
  for(let tier=0;tier<5;tier++){
   const terms=await vault.upgradeTerms(tier);
   assert.equal(terms.target,to(targets[tier]));
   assert.equal(terms.directs,BigInt(directs[tier]));
   assert.equal(terms.maximumBps,BigInt(maxRates[tier]));
  }
  const volumes=[500,1000,3000,5000,10000,30000,50000,100000,300000,500000,1000000,3000000,5000000,10000000];
  for(let stage=0;stage<volumes.length;stage++){
   const row=await vault.rewardStage(stage),rate=stage<5?7:stage<8?6:stage<11?5:3;
   assert.equal(row.volumeUsd,to(volumes[stage]));
   assert.equal(row.rewardUsd,to(volumes[stage]*rate/100));
  }
  const deposit=async(index,value,parent)=>{
   await done(token.mint(a[index],value));
   await done(token.connect(s[index]).approve(vault.target,value));
   return done(vault.connect(s[index]).deposit(value,parent));
  };
  const rootDeposit=to(100)+1n;
  const receipt=await deposit(1,rootDeposit,ZeroAddress);
  const event=receipt.logs.map(log=>{try{return vault.interface.parseLog(log);}catch{return null;}}).find(x=>x?.name==='DepositRouted');
  assert.ok(event);
  assert.equal(event.args.fee1,to(10));assert.equal(event.args.fee2,to(10));
  assert.equal(event.args.operations,to(80)+1n);
  for(const [index,amount] of [[2,1500],[3,400],[4,300]])await deposit(index,to(amount),a[1]);
  assert.equal(await vault.qualifiedDirects(a[1]),3n);
  assert.equal(await vault.effectiveDailyBps(a[1]),50n);
  await deposit(5,to(300),a[1]);
  assert.equal(await vault.qualifiedDirects(a[1]),4n);
  assert.equal(await vault.qualifiedVolume(a[1],0),to(2500));
  assert.equal(await vault.effectiveDailyBps(a[1]),100n);
  assert.equal(await token.balanceOf(await vault.FEE_WALLET_1()),to(260));
  assert.equal(await token.balanceOf(await vault.FEE_WALLET_2()),to(260));
  assert.equal(await token.balanceOf(await vault.OPERATIONS_WALLET()),to(2080)+1n);
  assert.equal(await token.balanceOf(vault.target),0n);
  assert.equal(await vault.principalLiability(),to(2600)+1n);

  await done(vault.connect(s[1]).checkIn());
  await done(vault.connect(s[1]).createRewardGroup([a[2],a[3],a[4],a[5]]));
  await fail(vault.connect(s[1]).createRewardGroup.staticCall([a[2]]));
  await done(vault.connect(s[1]).prepareNetworkReward(0,0,64));
  assert.equal((await vault.rewardProgress(a[1],0)).preparedUsd,to(500));
  await done(vault.connect(s[1]).claimNetworkRewards(0,0,1));
  assert.equal(await vault.networkAvailable(a[1]),to(35));
  await done(vault.connect(s[1]).claimNetworkRewards(0,1,1));
  assert.equal(await vault.networkAvailable(a[1]),to(105));
  assert.equal(await vault.profitLiability(),to(105));
  await fail(vault.connect(s[1]).claimNetworkRewards.staticCall(0,1,1));
  await fail(vault.connect(s[1]).claimNetworkRewards.staticCall(0,2,1));
  assert.equal(await vault.networkAvailable(a[1]),to(105));

  await done(vault.connect(s[1]).requestNetworkReward(to(10)));
  await fail(vault.connect(s[2]).approveWithdrawal.staticCall(0));
  await fail(vault.payWithdrawal.staticCall(0));
  await done(vault.approveWithdrawal(0));
  await fail(vault.reserveExistingCash.staticCall(0));
  await done(token.mint(a[0],to(10)));
  await done(token.approve(vault.target,to(10)));
  await done(vault.fundWithdrawal(0));
  const userBefore=await token.balanceOf(a[1]),feeBefore=await token.balanceOf(a[7]);
  await done(vault.connect(s[3]).payWithdrawal(0));
  assert.equal((await token.balanceOf(a[1]))-userBefore,to('9.7'));
  assert.equal((await token.balanceOf(a[7]))-feeBefore,to('0.3'));
  assert.equal(await vault.networkAvailable(a[1]),to(95));
  assert.equal(await vault.networkReserved(a[1]),0n);
  assert.equal(await vault.profitLiability(),to(95));
  await fail(vault.payWithdrawal.staticCall(0));

  // Qualified direct counts fall when paid principal falls below 100, while
  // the documented historical branch volume remains available for rank.
  await rpc.request({method:'evm_increaseTime',params:[90*86400+60]});
  await rpc.request({method:'evm_mine',params:[]});
  await done(vault.connect(s[5]).requestPrincipal(0,to(300)));
  await done(vault.approveWithdrawal(1));
  await done(token.mint(a[0],to(300)));
  await done(token.approve(vault.target,to(300)));
  await done(vault.fundWithdrawal(1));
  await done(vault.payWithdrawal(1));
  assert.equal(await vault.qualifiedDirects(a[1]),3n);
  assert.equal(await vault.qualifiedVolume(a[1],0),to(2500));
  assert.equal(await vault.effectiveDailyBps(a[1]),50n);
 }finally{provider.destroy();}
});
