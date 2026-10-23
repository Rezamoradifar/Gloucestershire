import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,keccak256,parseEther as E,toUtf8Bytes} from 'ethers';
import {runZeroStartAutomation} from '../scripts/zero-start-automation.mjs';

let rpc,provider,signers,addresses,token,feed,vault,queue,snapshot,deployment;
const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const tx=async request=>(await request).wait();
const id=value=>keccak256(toUtf8Bytes(value));
async function advance(seconds){await rpc.request({method:'evm_increaseTime',params:[seconds]});for(let i=0;i<5;i++)await rpc.request({method:'evm_mine',params:[]});}
async function authorize(){
 const data=vault.interface.encodeFunctionData('setReporter',[addresses[8],true]),hash=keccak256(data);
 await tx(vault.queueConfiguration(hash));
 await tx(vault.connect(signers[0]).voteConfiguration(hash));await tx(vault.connect(signers[3]).voteConfiguration(hash));
 await advance(172801);await tx(vault.setReporter(addresses[8],true));
}
async function readiness(overrides={}){
 const block=await provider.getBlock('latest');
 const reporterAuthorized=await vault.reporters(addresses[8]);
 return {version:1,kind:'fresh-zero-daily-readiness',releaseId:'global-fresh-zero-v1',chainId:97,target:vault.target,contractAddress:vault.target,
  owner:addresses[0],operator:addresses[8],token:token.target,tokenDecimals:18,queue:queue.target,
  hash:deployment.hash,block:deployment.blockNumber,blockHash:deployment.blockHash,runtimeHash:keccak256(await provider.getCode(vault.target)),
  approvalVersion:1,automaticGroupVersion:1,checkpoint:{block:block.number,blockHash:block.hash,timestamp:block.timestamp},
  paused:false,reporterAuthorized,funding:{ready:true,assets:[]},operatorGas:{positive:true},archive:{status:'supported',fullyVerified:true},
  ready:reporterAuthorized,blockers:reporterAuthorized?[]:['COUNCIL_AUTHORIZED_SERVER_REPORTER_REQUIRED'],...overrides};
}
function session(){
 const state={transactions:{}};let policy;
 const requests=[];
 const run=async(extra={})=>runZeroStartAutomation({provider,vault:vault.connect(signers[8]),queue:queue.connect(signers[8]),readiness:await readiness(),
  state,save:()=>{},loadPolicy:()=>policy,savePolicy:value=>{policy=structuredClone(value);},
  transact:async(label,request)=>{
   assert.ok([vault.target,queue.target].includes(request.to),'Unexpected transaction target');
   const contract=request.to===queue.target?queue:vault;
   const parsed=contract.interface.parseTransaction(request);
   assert.notEqual(parsed?.name,'approve','Automation must never approve a withdrawal');
   requests.push({label,name:parsed?.name});return tx(signers[8].sendTransaction(request));
  },
  maintainOracles:async()=>({status:'TESTNET_ORACLES_VALID',transactions:[]}),
  processVolume:async()=>({complete:true,backlog:'0',transactions:[]}),refreshReadiness:()=>readiness(),confirmations:3,...extra});
 return {state,requests,run,get policy(){return policy;},set policy(value){policy=value;}};
}

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const deploy=async(name,args=[])=>{const a=artifact(name),contract=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await contract.waitForDeployment();return contract;};
 token=await deploy('MockToken',[18]);feed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('AutomaticGroupVault',[addresses[0],token.target,feed.target,feed.target,604800,addresses.slice(0,7),addresses[11]]);
 deployment=await vault.deploymentTransaction().wait();queue=new Contract(await vault.withdrawalQueue(),artifact('ProfitWithdrawalQueue').abi,signers[0]);
 for(const n of [0,1]){await tx(token.mint(addresses[n],E('10000')));await tx(token.connect(signers[n]).approve(vault.target,E('10000')));}
 await tx(vault.connect(signers[1]).deposit(token.target,E('1000'),ZeroAddress));await tx(vault.connect(signers[2]).register(ZeroAddress));
 await tx(vault.fundRewards(token.target,E('500')));
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('waiting for reporter authorization never creates a daily policy or credits profit',async()=>{
 const s=session(),original=(await vault.accounts(addresses[1],token.target)).profit;
 const status=await s.run();
 assert.equal(s.policy,undefined);assert.equal(s.requests.length,0);
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,original);
 assert.equal(await vault.reporters(addresses[8]),false);
 assert.equal(status.status,'waiting');assert.equal(status.policyCreated,false);
});

test('new policy begins at readiness, includes completed reinvestment and credits a funded daily batch once',async()=>{
 await authorize();
 await tx(vault.batchProfit(id('seed-reinvestment'),token.target,[addresses[1]],[E('50')]));await tx(vault.connect(signers[1]).reinvest(token.target,E('50')));
 const s=session(),ready=await readiness(),oldCheckpointTime=ready.checkpoint.timestamp;
 await s.run({readiness:ready,processVolume:async()=>{await advance(15);return {complete:true,backlog:'0',transactions:[]};}});
 assert.ok(s.policy.startTimestamp>=oldCheckpointTime+15,'Policy must begin after volume catch-up, not at stale readiness');
 assert.equal(s.policy.startTimestamp,(await provider.getBlock('latest')).timestamp);assert.equal(s.policy.deploymentBlock,deployment.blockNumber);
 assert.equal(s.policy.vaultAddress,vault.target);assert.ok(s.policy.startTimestamp>(await provider.getBlock(deployment.blockNumber)).timestamp);
 assert.equal(s.requests.length,0);assert.equal((await vault.accounts(addresses[1],token.target)).profit,0n);
 const fixed=structuredClone(s.policy);await advance(86401);
 await s.run();
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('7.35'));
 assert.equal(s.requests.filter(row=>row.name==='batchProfit').length,1);
 assert.deepEqual(s.policy,fixed);
 await s.run();
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('7.35'));
 assert.equal(s.requests.filter(row=>row.name==='batchProfit').length,1);
 const activationHash=s.state.activation.blockHash;s.state.activation.blockHash=id('orphaned-activation');
 await assert.rejects(s.run(),/ZERO_START_ACTIVATION_CHECKPOINT_REORG/);
 s.state.activation.blockHash=activationHash;s.policy=undefined;
 await assert.rejects(s.run(),/ZERO_START_EXISTING_POLICY_MISSING/);
 assert.equal(s.requests.filter(row=>row.name==='batchProfit').length,1);
});

test('an incomplete deep-volume backlog prevents the initial policy boundary',async()=>{
 await authorize();const s=session();
 const status=await s.run({processVolume:async()=>({complete:false,backlog:'1',transactions:[]})});
 assert.equal(s.policy,undefined);assert.equal(s.requests.length,0);assert.equal(status.status,'waiting');assert.equal(status.policyCreated,false);
});

test('daily funding loss preserves the original epoch while approved withdrawal payment remains independent',async()=>{
 await authorize();await tx(vault.batchProfit(id('withdrawal-profit'),token.target,[addresses[1]],[E('20')]));
 const s=session();await s.run();const fixed=structuredClone(s.policy);
 await tx(vault.batchProfit(id('consume-reward-budget'),token.target,[addresses[2]],[E('479')]));
 await tx(vault.connect(signers[1]).withdrawProfit(token.target,E('10')));await tx(queue.approve(0));
 const before=await token.balanceOf(addresses[1]);await advance(86401);
 const waiting=await readiness({ready:false,funding:{ready:false,assets:[]},blockers:['FUNDED_DAILY_REWARD_BUDGET_REQUIRED']});
 await s.run({readiness:waiting});
 assert.equal((await queue.requests(0)).status,1n);assert.equal(await token.balanceOf(addresses[1])-before,E('9.5'));
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('10'));
 assert.deepEqual(s.policy,fixed);assert.equal(s.requests.filter(row=>row.name==='batchProfit').length,0);
 await tx(vault.fundRewards(token.target,E('20')));await s.run();
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('17'));
 assert.equal(s.requests.filter(row=>row.name==='pay').length,1);assert.equal(s.requests.filter(row=>row.name==='batchProfit').length,1);
 await s.run();assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('17'));
 assert.deepEqual(s.policy,fixed);
});

test('an orphaned completed journal entry stops the runner before paying another approved request',async()=>{
 const s=session();await s.run();
 await tx(vault.batchProfit(id('journal-reorg-profit'),token.target,[addresses[1]],[E('20')]));
 await tx(vault.connect(signers[1]).withdrawProfit(token.target,E('10')));await tx(queue.approve(0));
 const block=await provider.getBlock('latest'),before=await token.balanceOf(addresses[1]);
 s.state.transactions['old-confirmed-credit']={block:block.number,blockHash:id('orphaned-credit-block')};
 await assert.rejects(s.run(),/ZERO_START_COMPLETED_JOURNAL_NOT_CANONICAL/);
 assert.equal((await queue.requests(0)).status,3n);assert.equal(await token.balanceOf(addresses[1]),before);
 assert.equal(s.requests.length,0);assert.equal(s.policy,undefined);
});
