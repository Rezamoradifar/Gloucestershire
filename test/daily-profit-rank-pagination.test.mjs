import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,keccak256,parseEther as E} from 'ethers';
import {planDailyEpoch,readDailyTargetBpsAtSnapshot} from '../scripts/daily-profit.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const tx=async promise=>(await promise).wait();
const member='0x1111111111111111111111111111111111111111';
const proxy=(target,overrides)=>new Proxy(target,{get(object,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});

function stub({count=130n,capital=E('100'),directs=4n,config:changes={},overrides={}}={}){
 const calls=[],config={minUsd:E('10'),baseDailyBps:50n,maxDailyBps:100n,requiredDirect:4n,requiredSalesUsd:E('2500'),...changes};
 const methods={users:async()=>({capitalUsd:capital,registered:true,active:false,activeDirect:99n}),tierConfig:async()=>config,tierOf:async()=>0n,qualifiedDirects:async()=>directs,networkBranchCount:async()=>count,rankVolumePage:async(_member,_target,start,limit)=>{const next=start+BigInt(limit)<count?start+BigInt(limit):count;return {eligibleUsd:(next-start)*E('1'),next};},dailyTargetBps:async()=>{throw Error('UNBOUNDED_RATE_GETTER_FORBIDDEN');},...overrides};
 return {calls,vault:Object.fromEntries(Object.entries(methods).map(([name,method])=>[name,async(...args)=>{calls.push({name,args});return method(...args);}]))};
}

test('ordinary mainnet rates use every capped historical branch and the exact snapshot without the unbounded getter',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:12,defaultBalance:10000},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 try{
  const signers=await Promise.all(Array.from({length:12},(_,index)=>provider.getSigner(index))),addresses=await Promise.all(signers.map(signer=>signer.getAddress()));
  const deploy=async(name,args)=>{const a=artifact(name),contract=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await contract.waitForDeployment();return contract;};
  const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]),vault=await deploy('AutomaticGroupVault',[addresses[0],token.target,feed.target,feed.target,604800,addresses.slice(0,7),addresses[11]]),deployment=await vault.deploymentTransaction().wait(),root=addresses[1];
  await tx(vault.connect(signers[1]).deposit(ZeroAddress,E('100'),ZeroAddress,{value:E('100')}));
  const branches=['3000','100','100','100','10','10'];
  for(let index=0;index<branches.length;index++)await tx(vault.connect(signers[index+2]).deposit(ZeroAddress,E(branches[index]),root,{value:E(branches[index])}));
  await tx(vault.fundRewards(ZeroAddress,E('100'),{value:E('100')}));
  const old=await provider.getBlock('latest'),target=E('2500'),readMethods=['users','tierConfig','tierOf','qualifiedDirects','networkBranchCount','rankVolumePage'],calls=[];let forbidden=0;
  const bounded=proxy(vault,{dailyTargetBps:async()=>{forbidden++;throw Error('UNBOUNDED_RATE_GETTER_FORBIDDEN');},...Object.fromEntries(readMethods.map(name=>[name,async(...args)=>{calls.push({name,args});return vault[name](...args);}]))});
  const checkTags=blockTag=>{assert.ok(calls.length>0);for(const call of calls)assert.deepEqual(call.args.at(-1),{blockTag},call.name);};
  assert.equal((await vault.users(root)).active,false);assert.equal((await vault.users(root)).activeDirect,0n);assert.equal(await vault.qualifiedDirects(root),4n);assert.equal(await vault.networkBranchCount(root),6n);assert.equal(await vault.branchCapBps(target),6000n);
  assert.equal(branches.map(E).reduce((sum,value)=>sum+value,0n),E('3320'));
  const oldRate=await readDailyTargetBpsAtSnapshot({vault:bounded,member:root,blockTag:old.number,pageSize:2});assert.equal(oldRate,50n);assert.equal(oldRate,await vault.dailyTargetBps(root,{blockTag:old.number}));checkTags(old.number);
  const oldPages=calls.filter(call=>call.name==='rankVolumePage');assert.deepEqual(oldPages.map(call=>[call.args[2],call.args[3]]),[[0n,2],[2n,2],[4n,2]]);
  const oldAmounts=await Promise.all([0n,2n,4n].map(start=>vault.rankVolumePage(root,target,start,2,{blockTag:old.number})));assert.equal(oldAmounts.reduce((sum,page)=>sum+page.eligibleUsd,0n),E('1820'));

  await tx(vault.connect(signers[3]).deposit(ZeroAddress,E('1000'),root,{value:E('1000')}));const current=await provider.getBlock('latest');calls.length=0;
  const newRate=await readDailyTargetBpsAtSnapshot({vault:bounded,member:root,blockTag:current.number,pageSize:2});assert.equal(newRate,100n);assert.equal(newRate,await vault.dailyTargetBps(root,{blockTag:current.number}));checkTags(current.number);assert.equal(calls.filter(call=>call.name==='rankVolumePage').length,1);
  calls.length=0;assert.equal(await readDailyTargetBpsAtSnapshot({vault:bounded,member:root,blockTag:old.number,pageSize:2}),50n);checkTags(old.number);
  calls.length=0;assert.equal(await readDailyTargetBpsAtSnapshot({vault:bounded,member:ZeroAddress,blockTag:current.number,pageSize:2}),0n);assert.equal(await vault.dailyTargetBps(ZeroAddress,{blockTag:current.number}),0n);checkTags(current.number);assert.equal(calls.some(call=>call.name==='rankVolumePage'),false);

  const policy={version:1,chainId:56,vaultAddress:vault.target,runtimeHash:keccak256(await provider.getCode(vault.target)),deploymentBlock:deployment.blockNumber,startTimestamp:current.timestamp+30,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true};
  await rpc.request({method:'evm_increaseTime',params:[86431]});await rpc.request({method:'evm_mine',params:[]});calls.length=0;
  const plan=await planDailyEpoch({provider,vault:bounded,policy,state:{epoch:0},epoch:0,confirmations:0});assert.equal(plan.status,'ready');assert.equal(plan.chainId,56);assert.equal(plan.snapshotBlock,current.number);checkTags(plan.snapshotBlock);
  const own=plan.batches.flatMap(batch=>batch.rows).find(row=>row.recipient===root);assert.equal(own.rateBps,'100');assert.equal(own.amount,E('1').toString());assert.equal(forbidden,0);assert.ok(calls.some(call=>call.name==='rankVolumePage'));
 }finally{await provider.destroy();await rpc.disconnect();}
},60000);

test('below-target accounts span networks larger than 64 branches with bounded pages at one historical block',async()=>{
 const {vault,calls}=stub(),blockTag=777;
 assert.equal(await readDailyTargetBpsAtSnapshot({vault,member,blockTag}),50n);
 const pages=calls.filter(call=>call.name==='rankVolumePage');assert.deepEqual(pages.map(call=>[call.args[2],call.args[3]]),[[0n,64],[64n,64],[128n,64]]);
 for(const call of calls)assert.deepEqual(call.args.at(-1),{blockTag},call.name);
 assert.equal(calls.some(call=>call.name==='dailyTargetBps'),false);
 const unqualified=stub({directs:3n,overrides:{networkBranchCount:async()=>{throw Error('UNQUALIFIED_MEMBER_MUST_NOT_SCAN_BRANCHES');}}});
 assert.equal(await readDailyTargetBpsAtSnapshot({vault:unqualified.vault,member,blockTag}),50n);assert.equal(unqualified.calls.some(call=>call.name==='rankVolumePage'),false);
});

test('rank pages reject skipped cursors, invalid quantities and impossible capped totals without a base-rate fallback',async()=>{
 const malformed=[
  {eligibleUsd:0n,next:0n},
  {eligibleUsd:0n,next:3n},
  {eligibleUsd:0n,next:'2'},
  {eligibleUsd:0,next:2n},
  {eligibleUsd:-1n,next:2n},
  {eligibleUsd:E('2500')+1n,next:2n},
  [0n,2n],
  null
 ];
 for(const result of malformed){const h=stub({count:3n,overrides:{rankVolumePage:async()=>result}});await assert.rejects(readDailyTargetBpsAtSnapshot({vault:h.vault,member,blockTag:777,pageSize:2}),/INVALID_DAILY_RANK_PAGE/);assert.equal(h.calls.filter(call=>call.name==='rankVolumePage').length,1);assert.equal(h.calls.some(call=>call.name==='dailyTargetBps'),false);}
 const overCap=stub({count:1n,overrides:{rankVolumePage:async()=>({eligibleUsd:E('1500')+1n,next:1n})}});await assert.rejects(readDailyTargetBpsAtSnapshot({vault:overCap.vault,member,blockTag:777,pageSize:1}),/INVALID_DAILY_RANK_PAGE/);
 const late=stub({count:3n,overrides:{rankVolumePage:async(_who,_target,start)=>({eligibleUsd:0n,next:start===0n?2n:4n})}});await assert.rejects(readDailyTargetBpsAtSnapshot({vault:late.vault,member,blockTag:777,pageSize:2}),/INVALID_DAILY_RANK_PAGE/);assert.equal(late.calls.filter(call=>call.name==='rankVolumePage').length,2);
 const failure=Object.assign(Error('HISTORICAL_RANK_RPC_FAILED'),{code:'TIMEOUT'}),rpc=stub({overrides:{rankVolumePage:async()=>{throw failure;}}});await assert.rejects(readDailyTargetBpsAtSnapshot({vault:rpc.vault,member,blockTag:777}),error=>error===failure);assert.equal(rpc.calls.filter(call=>call.name==='rankVolumePage').length,1);assert.equal(rpc.calls.some(call=>call.name==='dailyTargetBps'),false);
});

test('rank snapshot inputs and historical state types fail closed before incomplete qualification can be accepted',async()=>{
 for(const change of [{blockTag:'latest'},{blockTag:-1},{blockTag:1.5},{pageSize:0},{pageSize:65},{pageSize:'2'}]){const h=stub();await assert.rejects(readDailyTargetBpsAtSnapshot({vault:h.vault,member,blockTag:777,...change}),/DAILY_RANK_SNAPSHOT_REQUIRED/);assert.equal(h.calls.length,0);}
 for(const options of [{capital:'100'},{config:{minUsd:0n}},{config:{baseDailyBps:101n}},{config:{maxDailyBps:1001n}},{config:{requiredDirect:4}},{config:{requiredSalesUsd:'2500'}},{directs:4},{count:130}]){const h=stub(options);await assert.rejects(readDailyTargetBpsAtSnapshot({vault:h.vault,member,blockTag:777}),/INVALID_DAILY_RANK_STATE/);assert.equal(h.calls.some(call=>call.name==='rankVolumePage'),false);}
 const low=stub({capital:E('1'),overrides:{tierOf:async()=>{throw Error('LOW_CAPITAL_MUST_NOT_READ_TIER');}}});assert.equal(await readDailyTargetBpsAtSnapshot({vault:low.vault,member,blockTag:777}),0n);
 const zeroTarget=stub({config:{requiredSalesUsd:0n},overrides:{qualifiedDirects:async()=>{throw Error('ZERO_TARGET_MUST_NOT_SCAN_QUALIFICATION');}}});assert.equal(await readDailyTargetBpsAtSnapshot({vault:zeroTarget.vault,member,blockTag:777}),50n);
});
