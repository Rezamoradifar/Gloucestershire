// Isolated in-process EVM only. No live endpoint, key or deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,parseEther} from 'ethers';
import {compileAutoNetworkPrototype} from '../scripts/compile-v3-auto-network-prototype.mjs';
import {runLocalSimulationSweep,scanRewardStages} from '../scripts/v3-reward-sweep-local-prototype.mjs';

const tokenAddress='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const done=async tx=>{const r=await(await tx).wait();assert.equal(r.status,1);return r;};
test('local-only sweep observes full three-branch stage, records beneficiary and never moves tokens',async()=>{
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const mock=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const artifact=compileAutoNetworkPrototype();
 const eip=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:6,defaultBalance:50}});
 const provider=new BrowserProvider(eip,undefined,{cacheTimeout:-1});provider.pollingInterval=25;
 try{
  const s=await Promise.all(Array.from({length:6},(_,i)=>provider.getSigner(i)));
  const a=await Promise.all(s.map(x=>x.getAddress()));
  const source=await new ContractFactory(mock.abi,'0x'+mock.evm.bytecode.object,s[0]).deploy(18);
  await source.waitForDeployment();
  await eip.request({method:'evm_setAccountCode',params:[tokenAddress,await provider.getCode(source.target)]});
  const token=new Contract(tokenAddress,mock.abi,s[0]);
  const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,s[0])
   .deploy(a[0],tokenAddress,a[0]);
  await vault.waitForDeployment();
  const deposit=async(i,amount,parent)=>{
   const n=parseEther(String(amount));await done(token.mint(a[i],n));
   await done(token.connect(s[i]).approve(vault.target,n));
   await done(vault.connect(s[i]).deposit(n,parent));
  };
  await deposit(1,100,ZeroAddress);
  await done(vault.connect(s[1]).checkIn());
  for(const i of [2,3,4])await done(vault.connect(s[i]).register(a[1]));
  await deposit(2,300,a[1]);
  const keeper=vault.connect(s[5]);
  const cursor={member:0,group:0};
  const empty=await scanRewardStages(keeper,cursor);
  assert.equal(empty.status,'NO_READY_STAGE');
  assert.equal((await vault.rewardProgress(a[1],0)).preparedUsd,0n);
  assert.equal((await vault.rewardBranch(a[1],0,0)).consumedUsd,0n);
  await deposit(3,200,a[1]);
  const tracked=[...a,vault.target,await vault.FEE_WALLET_1(),await vault.FEE_WALLET_2(),await vault.OPERATIONS_WALLET()];
  const before=await Promise.all(tracked.map(x=>token.balanceOf(x)));
  let pending=null,committed=null;
  const journal={begin:async item=>{assert.equal(pending,null);pending=item;},
   commit:async item=>{committed=item;pending=null;}};
  const result=await runLocalSimulationSweep({vault:keeper,cursor,journal,
   send:async item=>done(keeper.claimNetworkRewardsFor(item.who,item.group,item.stage,item.count))});
  assert.equal(result.status,'CONFIRMED_LOCAL_SIMULATION');
  assert.equal(result.candidate.who,a[1]);assert.equal(result.amount,parseEther('35'));
  assert.equal(committed.item.who,a[1]);assert.equal(pending,null);
  assert.equal(await vault.networkAvailable(a[1]),parseEther('35'));
  assert.equal(await vault.networkAvailable(a[5]),0n);
  assert.deepEqual(await Promise.all(tracked.map(x=>token.balanceOf(x))),before);
  await assert.rejects(keeper.claimNetworkRewardsFor.staticCall(a[1],0,0,1));
  assert.equal((await scanRewardStages(keeper,cursor)).status,'NO_READY_STAGE');
 }finally{provider.destroy();}
});
