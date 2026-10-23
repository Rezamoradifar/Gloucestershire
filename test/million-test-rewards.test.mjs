import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,Wallet,ZeroAddress,keccak256,parseEther as E,toUtf8Bytes} from 'ethers';
import {getZeroStartProfile} from '../scripts/zero-start-profile.mjs';
import {prepareZeroStartConnection} from '../scripts/connect-zero-start.mjs';
import {verifyZeroStartTarget} from '../scripts/zero-start-readiness.mjs';
import {fundMillionTestRewards,verifyMillionTestRewardPending,assertMillionTestRewardPendingScope,isMillionTestRewardLabel} from '../scripts/fund-million-test-rewards.mjs';
import {journalTransaction} from '../scripts/migration-journal.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const fast=getZeroStartProfile(true).release;
const amount=E('1000000');
const tx=async promise=>(await promise).wait();
const proxy=(target,overrides)=>new Proxy(target,{get(object,name){if(Object.hasOwn(overrides,name))return overrides[name];const value=Reflect.get(object,name);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,operator,signers,addresses,token,vault,release,deploymentReport,connectionReport,original,snapshot,knownWallet;
const mine=async()=>{for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});};
const verified=()=>verifyZeroStartTarget({provider,artifact:artifact('FastTestnetVault'),deploymentReport,connectionReport,original,release,confirmations:1,inspectSettlementLogs:false});
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12,unlockedAccounts:[fast.owner,fast.deployer]},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const who of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[who,'0x'+E('10').toString(16)]});
 operator=await provider.getSigner(fast.deployer);await rpc.request({method:'evm_setAccountNonce',params:[fast.deployer,'0x10']});
 signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 knownWallet=new Wallet(Object.values(rpc.getInitialAccounts())[0].secretKey,provider);
 const deploy=async(name,args,signer=signers[0])=>{const a=artifact(name),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const sourceToken=await deploy('MockToken',[18]);
 await rpc.request({method:'evm_setAccountCode',params:[fast.token,await provider.getCode(sourceToken.target)]});
 for(const slot of [3,4])await rpc.request({method:'evm_setAccountStorageAt',params:[fast.token,'0x'+slot.toString(16).padStart(64,'0'),await provider.getStorage(sourceToken.target,slot)]});
 token=new Contract(fast.token,artifact('MockToken').abi,signers[0]);
 const feed=await deploy('MockFeed',[100000000n]);release={...fast,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
 vault=await deploy('FastTestnetVault',[release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations],operator);
 deploymentReport={hash:vault.deploymentTransaction().hash};await mine();
 const prepared=await prepareZeroStartConnection({provider,artifact:artifact('FastTestnetVault'),deploymentReport,release,confirmations:1,original:'TRADES_CHAIN_ID=97\nTRADES_RPC_URL=https://rpc.example.invalid/private\nTRADES_VAULT_ADDRESS='+vault.target+'\nTRADES_PORT=3115\nTRADES_CONFIRMATIONS=1\nGLOBAL_MIGRATION_ENABLED=false\n'});
 original=prepared.env;connectionReport={...prepared.report,siteConnected:true};snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

async function session(){
 const readiness=await verified(),state={identity:{version:1,chainId:97,target:readiness.target,owner:readiness.owner,operator:readiness.operator,queue:readiness.queue,hash:readiness.hash,runtimeHash:readiness.runtimeHash},transactions:{},seedTest:{preserved:'separate-ten-token-seed'}};
 const requests=[];let saves=0;
 const record=(label,request,receipt)=>{requests.push({label,request});state.transactions[label]={hash:receipt.hash,block:receipt.blockNumber,blockHash:receipt.blockHash,maxFee:'0'};return receipt;};
 const transact=async(label,request)=>{
  assert.equal(BigInt(request.value??0),0n);assert.ok([token.target,vault.target].includes(request.to));assert.equal(isMillionTestRewardLabel(label),true);
  if(state.transactions[label]?.block)return provider.getTransactionReceipt(state.transactions[label].hash);
  assert.ok(state.millionTestRewardGrant,'Plan must be persisted before any transaction');assert.ok(saves>0);
  return record(label,request,await tx(operator.sendTransaction(request)));
 };
 const options={provider,wallet:operator,artifact:artifact('MockToken'),release,readiness,vault,state,save:()=>{saves++;},transact};
 return {options,state,requests,transact,record,fund:extra=>fundMillionTestRewards({...options,...extra}),get saves(){return saves;}};
}

test('one exact million-token grant credits the reward ledger; plain transfers do not; later spending never refills it',async()=>{
 await tx(token.mint(addresses[0],E('25')));await tx(token.transfer(vault.target,E('25')));assert.equal((await vault.ledgers(token.target)).rewards,0n);
 const s=await session(),report=await s.fund();
 assert.equal(report.amountTestUsdt,'1000000');assert.equal(report.purpose,'fast-test-reward-topup-1000000-v1');assert.equal(report.ledgerProof.verifiedGrantCreditUnits,amount.toString());
 assert.equal(report.ledgerProof.rewardLedgerNetChangeUnits,amount.toString());assert.equal(report.ledgerProof.rewardsAfterUnits,amount.toString());
 assert.equal((await vault.ledgers(token.target)).rewards,amount);assert.equal(await token.balanceOf(vault.target),amount+E('25'));assert.equal(await token.balanceOf(fast.deployer),0n);assert.equal(await token.allowance(fast.deployer,vault.target),0n);
 assert.deepEqual(s.requests.map(row=>row.label.split('-').at(-1)),['mint','approve','fund']);assert.deepEqual(s.state.seedTest,{preserved:'separate-ten-token-seed'});
 await tx(vault.connect(signers[1]).register(ZeroAddress));await tx(vault.batchProfit(keccak256(toUtf8Bytes('consume-million-test-budget')),token.target,[addresses[1]],[amount]));
 assert.equal((await vault.ledgers(token.target)).rewards,0n);assert.deepEqual(await s.fund(),report);assert.equal(s.requests.length,3);assert.equal((await vault.ledgers(token.target)).rewards,0n);
});

test('mint uses only the initial shortfall and a larger prior allowance is reduced to exactly one million',async()=>{
 await tx(token.mint(fast.deployer,amount-E('10')));await tx(token.connect(operator).approve(vault.target,amount*2n));
 const s=await session(),report=await s.fund();assert.equal(report.mintedTestUsdtUnits,E('10').toString());
 const mint=token.interface.parseTransaction(s.requests[0].request),approve=token.interface.parseTransaction(s.requests[1].request);
 assert.equal(mint.args[1],E('10'));assert.equal(approve.args[1],amount);assert.equal(await token.allowance(fast.deployer,vault.target),0n);assert.equal((await vault.ledgers(token.target)).rewards,amount);
});

for(const stage of ['mint','approve','fund'])test('interruption after '+stage+' resumes the same grant without another mint or funding transaction',async()=>{
 const s=await session();let interrupted=false;
 await assert.rejects(s.fund({transact:async(label,request)=>{const receipt=await s.transact(label,request);if(label.endsWith('-'+stage)&&!interrupted){interrupted=true;throw Error('INTERRUPTED_AFTER_'+stage.toUpperCase());}return receipt;}}),/INTERRUPTED_AFTER_/);
 assert.equal(s.state.millionTestRewardGrant.completed,false);
 for(const row of s.requests)assert.equal(await verifyMillionTestRewardPending({...s.options,label:row.label,request:row.request}),true);
 const report=await s.fund();assert.equal(report.amountTestUsdt,'1000000');assert.equal((await vault.ledgers(token.target)).rewards,amount);
 for(const suffix of ['mint','approve','fund'])assert.equal(s.requests.filter(row=>row.label.endsWith('-'+suffix)).length,1);
});

test('all target, metadata, value, amount, pending-scope and cumulative fee guards fail before another send',async()=>{
 const s=await session(),nameSelector=token.interface.getFunction('name').selector;
 const badMetadata=proxy(provider,{call:async request=>request.to===token.target&&request.data?.startsWith(nameSelector)?token.interface.encodeFunctionResult('name',['Real Token']):provider.call(request)});
 await assert.rejects(s.fund({provider:badMetadata}),/TEST_TOKEN_METADATA_MISMATCH/);
 await assert.rejects(s.fund({provider:proxy(provider,{send:async()=> '0x38'})}),/TESTNET_ONLY/);
 await assert.rejects(s.fund({release:{...release,token:addresses[4]}}),/MILLION_TEST_REWARDS_FAST_PROFILE_REQUIRED/);
 await assert.rejects(s.fund({readiness:{...s.options.readiness,runtimeHash:'0x'+'11'.repeat(32)}}),/MILLION_TEST_REWARDS_VAULT_MISMATCH/);
 await assert.rejects(s.fund({readiness:{...s.options.readiness,target:addresses[4],contractAddress:addresses[4]}}),/MILLION_TEST_REWARDS_VAULT_MISMATCH/);
 assert.equal(s.requests.length,0);assert.equal(s.state.millionTestRewardGrant,undefined);
 s.state.transactions['withdrawal-0']={raw:'unconfirmed'};await assert.rejects(s.fund(),/OTHER_PENDING_REQUIRES_RECONCILIATION/);delete s.state.transactions['withdrawal-0'];
 s.state.oracle={pending:{label:'oracle-refresh-1',request:{}}};await assert.rejects(s.fund(),/OTHER_PENDING_REQUIRES_RECONCILIATION/);delete s.state.oracle;
 await assert.rejects(s.fund({transact:async(label,request)=>{await s.transact(label,request);throw Error('PAUSE_AFTER_MINT');}}),/PAUSE_AFTER_MINT/);
 const plan=s.state.millionTestRewardGrant,fundLabel='fast-test-reward-topup-1000000-v1-fund';
 for(const request of [{to:vault.target,data:vault.interface.encodeFunctionData('fundRewards',[token.target,amount+1n])},{to:vault.target,data:vault.interface.encodeFunctionData('fundRewards',[token.target,amount]),value:1n}])await assert.rejects(verifyMillionTestRewardPending({...s.options,label:fundLabel,request}),/PENDING_REQUEST_MISMATCH/);
 plan.mintAmount=E('2').toString();await assert.rejects(s.fund(),/PLAN_INVALID/);plan.mintAmount=amount.toString();
 const before=s.requests.length,block=await provider.getBlock('latest');s.state.transactions.previous={maxFee:E('0.1').toString(),block:block.number,blockHash:block.hash};
 const nonce=await provider.getTransactionCount(knownWallet.address);
 await assert.rejects(s.fund({transact:(label,request)=>s.state.transactions[label]?.block?provider.getTransactionReceipt(s.state.transactions[label].hash):journalTransaction({provider,wallet:knownWallet,state:s.state,save:()=>{},label,request,guard:async()=>{},confirmations:1,maxTotalFee:E('0.1')})}),/TOTAL_TEST_BNB_FEE_LIMIT_0_1/);
 assert.equal(await provider.getTransactionCount(knownWallet.address),nonce);assert.equal(s.requests.length,before);assert.equal((await vault.ledgers(token.target)).rewards,0n);
});

test('out-of-order or multiple pending grant transactions never allocate an earlier-step nonce',async()=>{
 const s=await session();await assert.rejects(s.fund({save:()=>{throw Error('PLAN_SAVED_BEFORE_DISPATCH');}}),/PLAN_SAVED_BEFORE_DISPATCH/);assert.equal(s.requests.length,0);
 const prefix='fast-test-reward-topup-1000000-v1-',entry={raw:'unbroadcast-signed-transaction',hash:'0x'+'11'.repeat(32),maxFee:'1'};
 for(const suffix of ['approve','fund']){
  s.state.transactions[prefix+suffix]={...entry};await assert.rejects(s.fund(),/JOURNAL_STEP_ORDER_MISMATCH/);assert.equal(s.requests.length,0);delete s.state.transactions[prefix+suffix];
 }
 s.state.transactions[prefix+'mint']={...entry};s.state.transactions[prefix+'approve']={...entry};await assert.rejects(s.fund(),/MULTIPLE_PENDING_TRANSACTIONS/);assert.equal(s.requests.length,0);s.state.transactions={};
 const block=await provider.getBlock('latest');s.state.transactions[prefix+'fund']={...entry,block:block.number,blockHash:block.hash};
 await assert.rejects(s.fund(),/JOURNAL_STEP_ORDER_MISMATCH/);assert.equal(s.requests.length,0);
});

test('plan persistence and canonical receipt proofs gate completion without resending confirmed funding',async()=>{
 const first=await session();await assert.rejects(first.fund({save:async()=>{throw Error('DURABLE_SAVE_FAILED');}}),/DURABLE_SAVE_FAILED/);assert.equal(first.requests.length,0);
 const s=await session();let stripped=false;
 await assert.rejects(s.fund({transact:async(label,request)=>{const receipt=await s.transact(label,request);if(label.endsWith('-fund')){stripped=true;return {...receipt,logs:[]};}return receipt;}}),/FUND_EVENT_MISMATCH/);
 assert.equal(stripped,true);assert.equal(s.state.millionTestRewardGrant.completed,false);assert.equal((await vault.ledgers(token.target)).rewards,amount);
 const count=s.requests.length;assert.equal((await s.fund()).amountTestUsdt,'1000000');assert.equal(s.requests.length,count);
 const fundEntry=s.state.transactions['fast-test-reward-topup-1000000-v1-fund'];fundEntry.blockHash='0x'+'11'.repeat(32);await assert.rejects(s.fund(),/JOURNAL_NOT_CANONICAL/);assert.equal(s.requests.length,count);
});

test('a concurrent same-block reward fund is recorded separately from this exact grant',async()=>{
 await tx(token.mint(addresses[0],E('10')));await tx(token.approve(vault.target,E('10')));
 const s=await session();let otherReceipt;
 const report=await s.fund({transact:async(label,request)=>{
  if(!label.endsWith('-fund'))return s.transact(label,request);
  await rpc.request({method:'miner_stop',params:[]});
  try{
   const first=await operator.sendTransaction({...request,gasLimit:200000n});
   const other=await vault.connect(signers[0]).fundRewards(token.target,E('10'),{gasLimit:200000n});
   await rpc.request({method:'evm_mine',params:[]});
   const receipt=await first.wait();otherReceipt=await other.wait();assert.equal(receipt.blockNumber,otherReceipt.blockNumber);
   return s.record(label,request,receipt);
  }finally{await rpc.request({method:'miner_start',params:[1]});}
 }});
 assert.ok(otherReceipt);assert.equal(report.ledgerProof.verifiedGrantCreditUnits,amount.toString());assert.equal(report.ledgerProof.rewardLedgerNetChangeUnits,(amount+E('10')).toString());assert.equal(report.ledgerProof.otherSameBlockRewardChangeUnits,E('10').toString());assert.equal((await vault.ledgers(token.target)).rewards,amount+E('10'));
 const count=s.requests.length;await s.fund();assert.equal(s.requests.length,count);
});
