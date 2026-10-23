import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Interface,MaxUint256,ZeroAddress,parseEther as E} from 'ethers';
import {processZeroStartVolume} from '../scripts/zero-start-volume.mjs';

const address=n=>'0x'+n.toString(16).padStart(40,'0');
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const volumeInterface=new Interface(['function processNetworkVolume(uint256 job,uint256 steps)']);
function fakeVault(paths=[130]){
 const jobs=paths.map(length=>({length,cursor:0,usd:100n}));let sends=0,number=1;
 const hashes=new Map(),history=new Map();
 const snapshot=()=>{hashes.set(number,hash(number));history.set(number,jobs.map(job=>({...job})));};
 snapshot();
 const mine=()=>{number++;snapshot();};
 const provider={getBlock:async tag=>{const n=tag==='latest'?number:tag;return hashes.has(n)?{number:n,hash:hashes.get(n)}:null;}};
 let reads=0;
 const vault={target:address(999),volumeJobCount:async(options={})=>{reads++;return BigInt(history.get(options.blockTag??number).length);},volumeJobs:async(id,options={})=>{
  reads++;const job=history.get(options.blockTag??number)[Number(id)];return {child:address(job.cursor+1),ancestor:job.cursor===job.length?ZeroAddress:address(job.cursor+2),usd:job.usd};
 }};
 vault.processNetworkVolume={staticCall:async()=>{},populateTransaction:async(job,steps)=>({to:vault.target,data:volumeInterface.encodeFunctionData('processNetworkVolume',[job,steps]),job:Number(job),steps})};
 const labels=[];
 const transact=async(label,request)=>{labels.push(label);const job=jobs[request.job];job.cursor=Math.min(job.length,job.cursor+request.steps);mine();return {status:1,hash:hash(++sends)};};
 return {vault,provider,jobs,labels,transact,mine,hashes,get reads(){return reads;}};
}

test('bounded progress retains its pending job until complete and never replays confirmed volume',async()=>{
 const fixture=fakeVault(),state={};let saves=0;
 const args={...fixture,state,save:()=>saves++,maxTransactions:1};
 const first=await processZeroStartVolume(args);
 assert.equal(first.complete,false);assert.equal(first.nextJob,'0');assert.equal(first.backlog,'1');assert.equal(first.transactions.length,1);assert.equal(state.volume.nextJob,'0');
 const second=await processZeroStartVolume(args);assert.equal(second.nextJob,'0');assert.equal(second.transactions.length,1);
 const third=await processZeroStartVolume(args);assert.equal(third.complete,true);assert.equal(third.nextJob,'1');assert.equal(third.processed,1);
 assert.equal(new Set(fixture.labels).size,3);assert.ok(saves>=2);
 const replay=await processZeroStartVolume(args);assert.equal(replay.complete,true);assert.deepEqual(replay.transactions,[]);assert.equal(fixture.labels.length,3);
});

test('an interrupted confirmed request resumes from chain progress rather than duplicating its ancestor batch',async()=>{
 const fixture=fakeVault(),state={};let interrupt=true;
 const args={...fixture,state,maxTransactions:1,transact:async(label,request)=>{
  const receipt=await fixture.transact(label,request);if(interrupt){interrupt=false;throw Error('Lost response after mining');}return receipt;
 }};
 await assert.rejects(processZeroStartVolume(args),/Lost response after mining/);
 assert.equal(state.volume.nextJob,'0');assert.equal(fixture.jobs[0].cursor,64);
 await processZeroStartVolume(args);assert.equal(fixture.jobs[0].cursor,128);
 const result=await processZeroStartVolume(args);assert.equal(result.complete,true);assert.equal(fixture.jobs[0].cursor,130);
 assert.equal(new Set(fixture.labels).size,3);
});

test('completed-job scanning is bounded and a concurrently added job prevents a false caught-up result',async()=>{
 const fixture=fakeVault([0,0,1]),state={};
 const scan=await processZeroStartVolume({...fixture,state,maxScans:1,maxTransactions:0});
 assert.equal(scan.nextJob,'1');assert.equal(scan.complete,false);assert.equal(fixture.labels.length,0);
 const result=await processZeroStartVolume({...fixture,state,transact:async(label,request)=>{
  const receipt=await fixture.transact(label,request);fixture.jobs.push({length:1,cursor:0,usd:100n});fixture.mine();return receipt;
 }});
 assert.equal(result.complete,false);assert.equal(result.nextJob,'3');assert.equal(result.count,'4');assert.equal(result.backlog,'1');
});

test('failed or non-progressing transactions and mismatched state never advance the persisted cursor',async()=>{
 const fixture=fakeVault([1]),state={};
 await assert.rejects(processZeroStartVolume({...fixture,state,transact:async()=>({status:0,hash:hash(1)})}),/ZERO_START_VOLUME_NOT_CONFIRMED/);
 assert.equal(state.volume.nextJob,'0');
 await assert.rejects(processZeroStartVolume({...fixture,state,transact:async()=>({status:1,hash:hash(1)})}),/ZERO_START_VOLUME_NO_PROGRESS/);
 assert.equal(state.volume.nextJob,'0');
 await assert.rejects(processZeroStartVolume({...fixture,state:{volume:{version:1,target:address(998),nextJob:'0'}}}),/ZERO_START_VOLUME_STATE_TARGET_MISMATCH/);
 await assert.rejects(processZeroStartVolume({...fixture,state,maxTransactions:17}),/ZERO_START_VOLUME_LIMIT_INVALID/);
 await assert.rejects(processZeroStartVolume({...fixture,state:{volume:{version:1,target:fixture.vault.target,nextJob:'2'}}}),/ZERO_START_VOLUME_CHECKPOINT_REQUIRED/);
 fixture.vault.processNetworkVolume.populateTransaction=async(job,steps)=>({to:address(998),data:volumeInterface.encodeFunctionData('processNetworkVolume',[job,steps])});
 await assert.rejects(processZeroStartVolume({...fixture,state}),/ZERO_START_VOLUME_REQUEST_MISMATCH/);
 assert.equal(fixture.labels.length,0);
});

test('an orphaned external-completion checkpoint fails before an advanced cursor can skip jobs',async()=>{
 const fixture=fakeVault([0,1]),state={};
 await processZeroStartVolume({...fixture,state,maxScans:1,maxTransactions:0});
 assert.equal(state.volume.nextJob,'1');assert.deepEqual(state.volume.checkpoint,{block:1,hash:hash(1)});
 const reads=fixture.reads;
 fixture.hashes.set(1,hash(900));
 await assert.rejects(processZeroStartVolume({...fixture,state}),/ZERO_START_VOLUME_CHECKPOINT_REORG/);
 assert.equal(fixture.reads,reads);assert.equal(state.volume.nextJob,'1');assert.equal(fixture.labels.length,0);
});

test('a reorg between block-tagged job reads and persistence never advances its cursor',async()=>{
 const fixture=fakeVault([0]),state={};
 const readJob=fixture.vault.volumeJobs;
 fixture.vault.volumeJobs=async(...args)=>{const job=await readJob(...args);fixture.hashes.set(args[1].blockTag,hash(900));return job;};
 await assert.rejects(processZeroStartVolume({...fixture,state,maxTransactions:0}),/ZERO_START_VOLUME_CHECKPOINT_REORG/);
 assert.equal(state.volume.nextJob,'0');assert.equal(fixture.labels.length,0);
});

test('actual fresh-contract deep jobs finish in bounded runs with exact ancestor totals and one automatic branch',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:80},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 try{
  const signers=await Promise.all(Array.from({length:80},(_,i)=>provider.getSigner(i))),addresses=await Promise.all(signers.map(s=>s.getAddress()));
  const deploy=async(name,args=[])=>{const artifact=JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));const contract=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signers[0]).deploy(...args);await contract.waitForDeployment();return contract;};
  const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]);
  const vault=await deploy('AutomaticGroupVault',[addresses[0],token.target,feed.target,feed.target,86400,addresses.slice(0,7),addresses[79]]);
  const tx=async request=>(await request).wait();
  await tx(vault.connect(signers[1]).register(ZeroAddress));
  for(let i=2;i<=75;i++)await tx(vault.connect(signers[i]).register(addresses[i-1]));
  await tx(token.mint(addresses[75],E('200')));await tx(token.connect(signers[75]).approve(vault.target,MaxUint256));
  for(let i=0;i<2;i++)await tx(vault.connect(signers[75]).deposit(token.target,E('100'),addresses[74]));
  assert.equal(await vault.branchVolumeUsd(addresses[1],addresses[2]),0n);
  const state={},labels=[];
  const args={vault,provider,state,transact:async(label,request)=>{labels.push(label);return tx(signers[10].sendTransaction({...request,gasLimit:29000000}));}};
  const first=await processZeroStartVolume({...args,maxTransactions:1});assert.equal(first.nextJob,'0');assert.equal(first.transactions.length,1);assert.equal(first.complete,false);
  const second=await processZeroStartVolume({...args,maxTransactions:2});assert.equal(second.nextJob,'1');assert.equal(second.transactions.length,2);assert.equal(second.complete,false);
  const third=await processZeroStartVolume({...args,maxTransactions:1});assert.equal(third.nextJob,'2');assert.equal(third.complete,true);assert.equal(third.backlog,'0');
  assert.equal(await vault.branchVolumeUsd(addresses[1],addresses[2]),E('200'));assert.equal(await vault.rewardGroupCount(addresses[1]),1n);
  const group=await vault.rewardGroup(addresses[1],0);assert.deepEqual(Array.from(group.branches),[addresses[2]]);
  await processZeroStartVolume(args);assert.equal(labels.length,4);assert.equal(new Set(labels).size,4);assert.equal(await vault.branchVolumeUsd(addresses[1],addresses[2]),E('200'));
 }finally{await provider.destroy();await rpc.disconnect();}
});
