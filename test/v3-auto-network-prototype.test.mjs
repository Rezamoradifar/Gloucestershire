import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,parseEther} from 'ethers';
import {autoNetworkSource,compileAutoNetworkPrototype} from '../scripts/compile-v3-auto-network-prototype.mjs';
const tokenAddress='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const done=async tx=>{const receipt=await(await tx).wait();assert.equal(receipt.status,1);return receipt;};

test('source transformer refuses changed anchor',()=>{
 const source=fs.readFileSync('contracts/v3/GlobalV3DeferredTestnet.sol','utf8');
 assert.throws(()=>autoNetworkSource(source.replace('function _beginRequest(address who) private {','')));
});
test('registration-ordered triples receive atomic claims with fourteen stages and no replay or token transfer',async()=>{
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const mock=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const artifact=compileAutoNetworkPrototype();
 const eip=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:16,defaultBalance:50}});
 const provider=new BrowserProvider(eip,undefined,{cacheTimeout:-1});provider.pollingInterval=25;
 try{
  const s=await Promise.all(Array.from({length:16},(_,i)=>provider.getSigner(i)));
  const a=await Promise.all(s.map(x=>x.getAddress()));
  const source=await new ContractFactory(mock.abi,'0x'+mock.evm.bytecode.object,s[0]).deploy(18);
  await source.waitForDeployment();
  await eip.request({method:'evm_setAccountCode',params:[tokenAddress,await provider.getCode(source.target)]});
  const token=new Contract(tokenAddress,mock.abi,s[0]);
  const factory=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,s[0]);
  await assert.rejects(factory.deploy(a[0],source.target,a[0]));
  const vault=await factory.deploy(a[0],tokenAddress,a[0]);await vault.waitForDeployment();
  assert.equal(await vault.ACCRUAL_PERIOD(),3600n);
  const deposit=async(i,amount,parent)=>{
   const n=parseEther(String(amount));await done(token.mint(a[i],n));
   await done(token.connect(s[i]).approve(vault.target,n));
   await done(vault.connect(s[i]).deposit(n,parent));
  };
  await deposit(1,100,ZeroAddress);
  await done(vault.connect(s[1]).checkIn());
  assert.equal(await vault.autoNetworkEnabled(a[1]),true);
  const reg=await done(vault.connect(s[2]).register(a[1]));
  const assigned=reg.logs.map(log=>{try{return vault.interface.parseLog(log);}catch{return null;}})
   .find(x=>x?.name==='AutoBranchAssigned');
  assert.equal(assigned.args.parent,a[1]);assert.equal(assigned.args.branch,a[2]);
  assert.equal(assigned.args.group,0n);assert.equal(assigned.args.position,1n);
  assert.equal(await vault.rewardGroupCount(a[1]),1n);
  assert.deepEqual(Array.from((await vault.rewardGroup(a[1],0)).branches),[a[2]]);
  await done(vault.connect(s[3]).register(a[1]));
  assert.deepEqual(Array.from((await vault.rewardGroup(a[1],0)).branches),[a[2],a[3]]);
  await deposit(3,200,a[1]);
  await assert.rejects(async()=>{const tx=await vault.connect(s[4]).claimNetworkRewardsFor(a[1],0,0,1,{gasLimit:1000000});await tx.wait();});
  assert.equal((await vault.rewardProgress(a[1],0)).preparedUsd,0n);
  assert.equal((await vault.rewardBranch(a[1],0,1)).consumedUsd,0n);
  await deposit(2,300,a[1]);
  assert.deepEqual(Array.from((await vault.rewardGroup(a[1],0)).branches),[a[2],a[3]]);
  // Even 500 eligible volume cannot claim until the third direct registers.
  await assert.rejects(async()=>{const tx=await vault.connect(s[4]).claimNetworkRewardsFor(a[1],0,0,1,{gasLimit:1000000});await tx.wait();});
  await assert.rejects(vault.connect(s[1]).claimNetworkRewards.staticCall(0,0,1));
  await assert.rejects(vault.connect(s[1]).prepareNetworkReward.staticCall(0,0,64));
  assert.equal((await vault.rewardProgress(a[1],0)).preparedUsd,0n);
  assert.equal((await vault.rewardBranch(a[1],0,0)).consumedUsd,0n);
  await done(vault.connect(s[1]).setAutoNetworkEnabled(false));
  await assert.rejects(vault.connect(s[1]).createRewardGroup.staticCall([a[2],a[3]]));
  await assert.rejects(vault.connect(s[5]).setAutoNetworkEnabled.staticCall(true));
  await done(vault.connect(s[5]).register(a[1]));
  assert.deepEqual(Array.from((await vault.rewardGroup(a[1],0)).branches),[a[2],a[3],a[5]]);
  await done(vault.connect(s[6]).register(a[1]));
  assert.equal(await vault.rewardGroupCount(a[1]),2n);
  assert.deepEqual(Array.from((await vault.rewardGroup(a[1],1)).branches),[a[6]]);
  await done(vault.connect(s[7]).register(a[1]));
  assert.deepEqual(Array.from((await vault.rewardGroup(a[1],1)).branches),[a[6],a[7]]);
  // Deposit auto-registers the third branch after two explicit registrations.
  await deposit(8,10,a[1]);
  // Three members but insufficient volume: an actual reverted transaction
  // must not leave the 10 units partially reserved or consumed.
  await done(vault.connect(s[1]).setAutoNetworkEnabled(true));
  await assert.rejects(async()=>{const tx=await vault.connect(s[4]).claimNetworkRewardsFor(a[1],1,0,1,{gasLimit:1000000});await tx.wait();});
  assert.equal((await vault.rewardProgress(a[1],1)).preparedUsd,0n);
  assert.equal((await vault.rewardBranch(a[1],1,2)).consumedUsd,0n);
  await done(vault.connect(s[1]).setAutoNetworkEnabled(false));
  await deposit(7,250,a[1]);await deposit(6,250,a[1]);
  assert.deepEqual(Array.from((await vault.rewardGroup(a[1],1)).branches),[a[6],a[7],a[8]]);
  await done(vault.connect(s[9]).register(a[1]));
  await done(vault.connect(s[10]).register(a[1]));
  assert.equal(await vault.rewardGroupCount(a[1]),3n);
  assert.deepEqual(Array.from((await vault.rewardGroup(a[1],2)).branches),[a[9],a[10]]);
  await deposit(11,10,a[1]);
  assert.deepEqual(Array.from((await vault.rewardGroup(a[1],2)).branches),[a[9],a[10],a[11]]);
  assert.equal(await token.balanceOf(await vault.FEE_WALLET_1()),parseEther('112'));
  assert.equal(await token.balanceOf(await vault.FEE_WALLET_2()),parseEther('112'));
  assert.equal(await token.balanceOf(await vault.OPERATIONS_WALLET()),parseEther('896'));
  assert.equal(await vault.autoNetworkEnabled(a[1]),false);
  await assert.rejects(vault.connect(s[4]).claimNetworkRewardsFor.staticCall(a[1],0,0,1));
  await done(vault.connect(s[1]).setAutoNetworkEnabled(true));
  const tracked=[...a,vault.target,await vault.FEE_WALLET_1(),await vault.FEE_WALLET_2(),await vault.OPERATIONS_WALLET()];
  const before=await Promise.all(tracked.map(x=>token.balanceOf(x)));
  assert.equal((await vault.rewardProgress(a[1],0)).preparedUsd,0n);
  const receipt=await done(vault.connect(s[4]).claimNetworkRewardsFor(a[1],0,0,1));
  const event=receipt.logs.map(log=>{try{return vault.interface.parseLog(log);}catch{return null;}})
   .find(x=>x?.name==='NetworkClaimAccrued');
  assert.equal(event.args.user,a[1]);assert.equal(event.args.amount,parseEther('35'));
  assert.equal(await vault.networkAvailable(a[1]),parseEther('35'));
  assert.equal(await vault.networkAvailable(a[4]),0n);
  assert.equal(await vault.profitLiability(),parseEther('35'));
  assert.deepEqual(await Promise.all(tracked.map(x=>token.balanceOf(x))),before);
  await assert.rejects(vault.connect(s[4]).claimNetworkRewardsFor.staticCall(a[1],0,0,1));
  await done(vault.connect(s[4]).claimNetworkRewardsFor(a[1],1,0,1));
  assert.equal(await vault.networkAvailable(a[1]),parseEther('70'));
  assert.equal((await vault.rewardStage(1)).volumeUsd,parseEther('1000'));
  assert.equal((await vault.rewardStage(1)).rewardUsd,parseEther('70'));
  assert.equal(await vault.branchCapBps(parseEther('30000')),4500n);
  assert.equal(await vault.branchCapBps(parseEther('3000000')),3500n);
  await done(vault.connect(s[1]).setAutoNetworkEnabled(false));
  await assert.rejects(vault.connect(s[4]).claimNetworkRewardsFor.staticCall(a[1],0,1,1));
  await done(vault.connect(s[1]).setAutoNetworkEnabled(true));
  // Advance group 0 through every stage, including the 45% and 35% caps.
  for(const i of [2,3,5])await done(vault.setVipKyc(a[i],true));
  for(const i of [2,3,5])await deposit(i,10000000,a[1]);
  assert.equal(await vault.rewardGroupCount(a[1]),3n);
  let expected=parseEther('70');
  for(let stage=1;stage<14;stage++){
   expected+=(await vault.rewardStage(stage)).rewardUsd;
   await done(vault.connect(s[4]).claimNetworkRewardsFor(a[1],0,stage,1,{gasLimit:3000000}));
   assert.equal((await vault.rewardProgress(a[1],0)).stage,BigInt(stage+1));
  }
  assert.equal(await vault.networkAvailable(a[1]),expected);
  await assert.rejects(vault.connect(s[4]).claimNetworkRewardsFor.staticCall(a[1],0,14,1));
  // A complete next stage for group 1 still cannot be claimed after check-in expires.
  await deposit(6,600,a[1]);await deposit(7,400,a[1]);
  await vault.connect(s[4]).claimNetworkRewardsFor.staticCall(a[1],1,1,1);
  await eip.request({method:'evm_increaseTime',params:[86401]});await eip.request({method:'evm_mine',params:[]});
  assert.equal(await vault.isEligible(a[1]),false);
  await assert.rejects(vault.connect(s[4]).claimNetworkRewardsFor.staticCall(a[1],1,1,1));
  assert.equal(await vault.networkAvailable(a[1]),expected);
  // ADVERSARIAL REGRESSION: a new victim registers without authorizing any
  // referrals. Three zero-deposit wallets can nevertheless occupy its first
  // fixed group, pushing the next legitimate wallet into group 1. This test
  // documents a deployment blocker, not acceptable production behavior.
  await done(vault.connect(s[0]).register(ZeroAddress));
  for(const i of [12,13,14]){
   await done(vault.connect(s[i]).register(a[0]));
   assert.equal((await vault.users(a[i])).capital,0n);
  }
  assert.deepEqual(Array.from((await vault.rewardGroup(a[0],0)).branches),[a[12],a[13],a[14]]);
  await done(vault.connect(s[4]).register(a[0]));
  assert.deepEqual(Array.from((await vault.rewardGroup(a[0],1)).branches),[a[4]]);
  assert.equal(vault.interface.hasFunction('removeRewardBranch'),false);
  const eip56=ganache.provider({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},
   wallet:{totalAccounts:1,defaultBalance:50}});
  const chain56=new BrowserProvider(eip56,undefined,{cacheTimeout:-1});
  try{
   const signer=await chain56.getSigner(0),address=await signer.getAddress();
   const mainnetFactory=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signer);
   await assert.rejects(mainnetFactory.deploy(address,tokenAddress,address));
  }finally{chain56.destroy();}
 }finally{provider.destroy();}
});
