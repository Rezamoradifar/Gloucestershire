import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,keccak256,parseEther as E,toUtf8Bytes} from 'ethers';
import {dailyAbi,executeDailyPlan,hourlyTestPolicyFields,planDailyEpoch} from '../scripts/daily-profit.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const fast=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json'));
const tx=async promise=>(await promise).wait();
const proxy=(target,overrides)=>new Proxy(target,{get(object,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,operator,signers,addresses,token,vault,deploymentBlock,snapshot;
const advance=async seconds=>{await rpc.request({method:'evm_increaseTime',params:[seconds]});await rpc.request({method:'evm_mine',params:[]});};
const send=async(_label,request)=>tx(operator.sendTransaction(request));
const deposit=async(index,amount)=>{await tx(token.mint(addresses[index],amount));await tx(token.connect(signers[index]).approve(vault.target,amount));await tx(vault.connect(signers[index]).deposit(token.target,amount,index===1?ZeroAddress:addresses[index-1]));};
const policy=async(hourly=false)=>({version:1,chainId:97,vaultAddress:vault.target,runtimeHash:keccak256(await provider.getCode(vault.target)),deploymentBlock,startTimestamp:(await provider.getBlock('latest')).timestamp+30,basis:'period-start-active-principal',periodSeconds:hourly?3600:86400,includeReinvestment:true,...(hourly?hourlyTestPolicyFields:{})});
const plan=async(p,state={},overrides={})=>planDailyEpoch({provider,vault,policy:p,state,epoch:0,confirmations:0,...overrides});
const referralRows=p=>p.batches.filter(batch=>batch.kind==='profit-referrals').flatMap(batch=>batch.rows);
const profits=()=>Promise.all(addresses.slice(1,7).map(address=>vault.accounts(address,token.target).then(row=>row.profit)));

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:14,unlockedAccounts:[fast.owner,fast.deployer]},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const address of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[address,'0x'+E('10').toString(16)]});
 operator=await provider.getSigner(fast.deployer);signers=await Promise.all(Array.from({length:14},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(signer=>signer.getAddress()));
 const deploy=async(name,args,signer=signers[0])=>{const a=artifact(name),contract=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await contract.waitForDeployment();return contract;};
 token=await deploy('MockToken',[18]);const feed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('FastTestnetVault',[fast.owner,token.target,feed.target,feed.target,604800,addresses.slice(0,7),addresses[13]],operator);
 deploymentBlock=(await vault.deploymentTransaction().wait()).blockNumber;
 for(let i=1;i<=6;i++){await tx(vault.connect(signers[i]).register(i===1?ZeroAddress:addresses[i-1]));await tx(vault.setCustomerStatus(addresses[i],true,true));}
 await tx(token.mint(fast.deployer,E('1000000')));await tx(token.connect(operator).approve(vault.target,E('1000000')));await tx(vault.fundRewards(token.target,E('1000000')));
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('the worker ABI reads the exact deployed user and tier structs',async()=>{
 const {Contract}=await import('ethers'),worker=new Contract(vault.target,dailyAbi,provider);
 assert.equal((await worker.users(addresses[5])).referrer,addresses[4]);assert.equal(await worker.tierOf(addresses[5]),0n);
 assert.deepEqual(Array.from((await worker.tierConfig(4)).referrals),[1600n,800n,600n,400n]);
});

for(const [tier,capital,rates]of [[0,'100',[800n,400n,200n,0n]],[1,'501',[1000n,500n,300n,0n]],[2,'2501',[1200n,600n,400n,0n]],[3,'10001',[1400n,700n,500n,0n]],[4,'50001',[1600n,800n,600n,400n]]])test('seller tier '+tier+' keeps full personal profit and funds the exact deployed multilevel rates',async()=>{
 await deposit(1,E('50001'));await deposit(5,E(capital));const p=await policy(),state={};await advance(86431);const planned=await plan(p,state);
 const personal=planned.batches.filter(batch=>!batch.kind),source=personal.flatMap(batch=>batch.rows).find(row=>row.recipient===addresses[5]),gross=BigInt(source.amount);
 const rows=referralRows(planned),expected=new Map();
 for(let level=0;level<4;level++)if(rates[level])expected.set(addresses[4-level],gross*rates[level]/10000n);
 assert.deepEqual(new Map(rows.map(row=>[row.recipient,BigInt(row.amount)])),expected);
 assert.ok(rows.every(row=>row.sources.length===1&&row.sources[0].source===addresses[5]));
 const budget=(await vault.ledgers(token.target)).rewards;
 await executeDailyPlan({provider,vault,plan:planned,transact:send});
 assert.equal((await vault.accounts(addresses[5],token.target)).profit,gross);
 for(const[address,amount]of expected){const own=personal.flatMap(batch=>batch.rows).find(row=>row.recipient===address);assert.equal((await vault.accounts(address,token.target)).profit,amount+BigInt(own?.amount||0));}
 const total=planned.batches.flatMap(batch=>batch.amounts).reduce((sum,value)=>sum+BigInt(value),0n);assert.equal((await vault.ledgers(token.target)).rewards,budget-total);
});

test('inactive and unapproved VIP recipients are skipped without compressing levels or changing later snapshots',async()=>{
 await deposit(1,E('50001'));await deposit(5,E('50001'));await tx(vault.setCustomerStatus(addresses[3],false,true));await tx(vault.setCustomerStatus(addresses[1],true,false));
 const p=await policy();await advance(31);await tx(vault.setCustomerStatus(addresses[3],true,true));await tx(vault.setCustomerStatus(addresses[1],true,true));await advance(86400);
 const rows=referralRows(await plan(p));assert.deepEqual(new Set(rows.map(row=>row.recipient)),new Set([addresses[4],addresses[2]]));
 assert.equal(rows.find(row=>row.recipient===addresses[2]).sources[0].rateBps,'600');
});

test('later source upgrades do not change the period-start referral percentage',async()=>{
 await deposit(5,E('100'));const p=await policy();await advance(31);await deposit(5,E('401'));assert.equal(await vault.tierOf(addresses[5]),1n);await advance(86400);
 const planned=await plan(p),row=referralRows(planned).find(value=>value.recipient===addresses[4]);
 assert.equal(row.amount,E('0.04').toString());assert.equal(row.sources[0].rateBps,'800');assert.equal(row.sources[0].personalProfit,E('0.5').toString());
});

test('fourth-level commissions require a VIP recipient and overlapping descendant earnings aggregate once',async()=>{
 await deposit(5,E('100'));await deposit(6,E('100'));const p=await policy();await advance(86431);const planned=await plan(p),rows=referralRows(planned);
 assert.equal(rows.some(row=>row.recipient===addresses[1]),false);
 const row=rows.find(value=>value.recipient===addresses[4]);assert.equal(row.sources.length,2);assert.equal(BigInt(row.amount),E('0.06'));
 assert.equal(row.sources[0].personalProfit,E('0.5').toString());
 assert.ok(planned.batches.every(batch=>batch.recipients.length<=100&&new Set(batch.recipients).size===batch.recipients.length));
});

test('native and token commissions stay in their originating funded asset',async()=>{
 await deposit(5,E('100'));await tx(vault.connect(signers[5]).deposit(ZeroAddress,E('100'),addresses[4],{value:E('100')}));await tx(vault.fundRewards(ZeroAddress,E('1'),{value:E('1')}));
 const p=await policy();await advance(86431);const planned=await plan(p);
 assert.equal(planned.batches.filter(batch=>batch.kind==='profit-referrals').length,2);
 await executeDailyPlan({provider,vault,plan:planned,transact:send});
 for(const asset of [ZeroAddress,token.target]){assert.equal((await vault.accounts(addresses[5],asset)).profit,E('0.5'));assert.equal((await vault.accounts(addresses[4],asset)).profit,E('0.04'));}
 assert.equal((await vault.ledgers(ZeroAddress)).rewards,E('0.43'));
});

test('old personal batch identifiers survive and a retry can finish commissions after the base was already credited',async()=>{
 await deposit(5,E('100'));const p=await policy(),state={};await advance(86431);const planned=await plan(p,state),base=planned.batches[0];
 const expected=keccak256(toUtf8Bytes(['GLOBAL_DAILY_V1',97,vault.target.toLowerCase(),p.startTimestamp,0,token.target.toLowerCase(),0].join(':')));assert.equal(base.id,expected);
 await tx(vault.batchProfit(base.id,base.asset,base.recipients,base.amounts));assert.equal((await vault.accounts(addresses[4],token.target)).profit,0n);
 const requests=[],transact=async(label,request)=>{requests.push(label);return send(label,request);};
 const complete=await executeDailyPlan({provider,vault,plan:planned,transact});assert.equal(complete[0].status,'already_credited');assert.equal(requests.length,1);assert.equal((await vault.accounts(addresses[5],token.target)).profit,E('0.5'));assert.equal((await vault.accounts(addresses[4],token.target)).profit,E('0.04'));
 await executeDailyPlan({provider,vault,plan:planned,transact});assert.equal(requests.length,1);
});

test('combined funding, historical referral reads and canonical snapshots gate every new financial send',async()=>{
 await deposit(5,E('100'));const p=await policy();await advance(86431);const planned=await plan(p);
 await tx(vault.batchProfit(keccak256(toUtf8Bytes('consume-test-budget')),token.target,[addresses[1]],[E('999999.5')]));
 let sent=0;await assert.rejects(executeDailyPlan({provider,vault,plan:planned,transact:async()=>{sent++;}}),/DAILY_PROFIT_FUNDING_REQUIRED/);assert.equal(sent,0);assert.equal(await vault.usedRewardBatch(planned.batches[0].id),false);
 await assert.rejects(plan(p,{}, {vault:proxy(vault,{users:async()=>{throw Error('HISTORICAL_USER_UNAVAILABLE');}})}),/HISTORICAL_USER_UNAVAILABLE/);assert.equal(sent,0);
 await assert.rejects(executeDailyPlan({provider:proxy(provider,{getBlock:async()=>({hash:'0x'+'11'.repeat(32)})}),vault,plan:planned,transact:async()=>{sent++;}}),/DAILY_SNAPSHOT_REORG/);assert.equal(sent,0);
});

test('hourly personal identifiers remain unchanged and referral identifiers use a separate hourly domain',async()=>{
 await deposit(5,E('100'));const p=await policy(true);await advance(3631);const planned=await plan(p);
 const expected=domain=>keccak256(toUtf8Bytes([domain,97,vault.target.toLowerCase(),p.startTimestamp,0,token.target.toLowerCase(),0].join(':')));
 assert.equal(planned.batches[0].id,expected('GLOBAL_HOURLY_TEST_V1'));assert.equal(planned.batches[1].id,expected('GLOBAL_HOURLY_TEST_REFERRAL_V1'));
 await executeDailyPlan({provider,vault,plan:planned,transact:send});assert.equal((await vault.accounts(addresses[4],token.target)).profit,E('0.04'));
});
