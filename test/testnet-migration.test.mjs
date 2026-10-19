import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,ZeroAddress} from 'ethers';
const art=n=>JSON.parse(fs.readFileSync(`artifacts/${n}.json`));
let rpc,p,s,a,t,v,feed,members,snapshot;
const tx=async x=>(await x).wait();
async function deploy(n,args=[]){const c=art(n);const x=await new ContractFactory(c.abi,c.evm.bytecode.object,s[0]).deploy(...args);await x.waitForDeployment();return x;}
async function migrate(list=members){return deploy('TestnetMigratedRewardsVault',[v.target,list,[],[]]);}
before(async()=>{
 assert.ok(art('TestnetMigratedRewardsVault').evm.deployedBytecode.object.length/2<=24576);
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 p=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 s=await Promise.all(Array.from({length:12},(_,i)=>p.getSigner(i)));a=await Promise.all(s.map(x=>x.getAddress()));
 t=await deploy('MockToken',[18]);feed=await deploy('MockFeed',[100000000n]);v=await deploy('DropshippingVault',[a[0],t.target,feed.target,feed.target,86400,a.slice(0,7),a[11]]);
 for(let i=0;i<4;i++){await tx(t.mint(a[i],E('10000')));await tx(t.connect(s[i]).approve(v.target,E('10000')));}
 await tx(v.connect(s[1]).deposit(t.target,E('1000'),ZeroAddress));
 for(let i=2;i<4;i++)await tx(v.connect(s[i]).deposit(t.target,E('3000'),a[1]));
 await tx(v.connect(s[1]).createRewardGroup([a[2],a[3]]));
 await tx(v.fundRewards(t.target,E('35')));await tx(v.connect(s[1]).claimNetworkRewardAtStage(0,0));
 await tx(v.ownerWithdrawCapital(t.target,a[0],E('35')));
 await tx(v.connect(s[2]).deposit(t.target,E('1000'),a[1]));
 await tx(v.connect(s[1]).prepareNetworkRewardAtStage(0,1,1));
 await tx(v.setPaused(true));members=a.slice(1,4).sort((x,y)=>BigInt(x)<BigInt(y)?-1:1);
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await p?.destroy();await rpc?.disconnect();});
test('copies principal, profit, positions, parents, consumed/reserved volumes and pending jobs exactly',async()=>{
 const n=await migrate();assert.equal(await n.paused(),true);assert.equal(await n.owner(),a[0]);assert.equal(await n.usdt(),t.target);
 for(const who of members){
  assert.deepEqual(Array.from(await n.users(who)),Array.from(await v.users(who)));
  for(const asset of [ZeroAddress,t.target])assert.deepEqual(Array.from(await n.accounts(who,asset)),Array.from(await v.accounts(who,asset)));
  for(let j=0n;j<await v.positionCount(who);j++)assert.deepEqual(Array.from(await n.positionOf(who,j)),Array.from(await v.positionOf(who,j)));
  assert.equal(await n.qualifiedDirects(who),await v.qualifiedDirects(who));
 }
 for(let i=0;i<2;i++)assert.deepEqual(Array.from(await n.rewardBranch(a[1],0,i)),Array.from(await v.rewardBranch(a[1],0,i)));
 assert.deepEqual(Array.from(await n.rewardProgress(a[1],0)),Array.from(await v.rewardProgress(a[1],0)));
 assert.equal(await n.accounted(t.target),await v.accounted(t.target));
 assert.equal(await n.volumeJobCount(),await v.volumeJobCount());
 for(let i=0n;i<await v.volumeJobCount();i++)assert.deepEqual(Array.from(await n.volumeJobs(i)),Array.from(await v.volumeJobs(i)));
 await tx(n.setPaused(false));await tx(n.connect(s[1]).claimNetworkRewardAtStage(0,1));
 assert.equal((await n.accounts(a[1],t.target)).profit,E('105'));assert.equal((await n.rewardProgress(a[1],0)).stage,2n);
 await assert.rejects(n.connect(s[1]).claimNetworkRewardAtStage.staticCall(0,0));
 assert.equal((await v.rewardProgress(a[1],0)).stage,1n,'source remains unchanged');
});
test('missing funded account and duplicate members cannot create a partial migration',async()=>{
 await assert.rejects(migrate(members.slice(0,2)));
 await assert.rejects(migrate([...members,members[2]]));
});
test('active source or a source with cash cannot be copied',async()=>{
 await tx(v.setPaused(false));await assert.rejects(migrate());await tx(v.setPaused(true));
 await tx(v.returnCapital(t.target,E('1')));await assert.rejects(migrate());
});
test('source withdrawal remains possible after copy: state copy is explicitly not retirement',async()=>{
 const n=await migrate();await tx(v.returnCapital(t.target,E('35')));
 await tx(v.connect(s[1]).withdrawProfit(t.target,E('35')));
 assert.equal((await v.accounts(a[1],t.target)).profit,0n);
 assert.equal((await n.accounts(a[1],t.target)).profit,E('35'),'legacy withdrawal does not extinguish new ledger; testnet-only limitation');
});
