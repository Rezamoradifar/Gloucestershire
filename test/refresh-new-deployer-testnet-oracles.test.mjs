import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Wallet} from 'ethers';
import {assertRefreshBudget,refreshNewDeployerOracles} from '../scripts/refresh-new-deployer-testnet-oracles.mjs';
import {journalTransaction} from '../scripts/migration-journal.mjs';

const artifact=JSON.parse(fs.readFileSync('artifacts/MockFeed.json'));
test('refreshes only stale reviewed chain-97 mocks preserving answers and journals once',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97},wallet:{totalAccounts:2}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 try{
  const accounts=Object.values(rpc.getInitialAccounts()),wallet=new Wallet(accounts[0].secretKey,provider);
  const signer=await provider.getSigner(0),factory=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signer);
  const a=await factory.deploy(60000000000n);await a.waitForDeployment();
  const b=await factory.deploy(100000000n);await b.waitForDeployment();
  await rpc.request({method:'evm_increaseTime',params:[90000]});await rpc.request({method:'evm_mine',params:[]});
  const release={deployer:wallet.address,bnbFeed:a.target,tokenFeed:b.target,age:'86400'},state={transactions:{},plans:{}};
  let saves=0;const save=()=>saves++;
  const first=await refreshNewDeployerOracles({provider,wallet,release,state,save,confirmations:1});
  assert.deepEqual(first.map(x=>x.status),['refreshed','refreshed']);
  assert.equal((await a.latestRoundData())[1],60000000000n);assert.equal((await b.latestRoundData())[1],100000000n);
  assert.equal((await a.latestRoundData())[0],2n);assert.equal((await b.latestRoundData())[0],2n);
  assert.equal(Object.keys(state.transactions).length,2);assert.ok(saves>=5);
  const hashes=Object.values(state.transactions).map(x=>x.hash);
  await refreshNewDeployerOracles({provider,wallet,release,state,save,confirmations:1});
  assert.deepEqual(Object.values(state.transactions).map(x=>x.hash),hashes);
  assert.equal((await a.latestRoundData())[0],2n);
  await rpc.request({method:'evm_increaseTime',params:[90000]});await rpc.request({method:'evm_mine',params:[]});
  const pending={transactions:{},plans:{}};
  const interrupted=async options=>{
   const p=new Proxy(provider,{get(target,key){if(key==='waitForTransaction')return async()=>{throw Error('SIMULATED_DISCONNECT');};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
   return journalTransaction({...options,provider:p});
  };
  await assert.rejects(refreshNewDeployerOracles({provider,wallet,release,state:pending,save,confirmations:1,journal:interrupted}),/SIMULATED_DISCONNECT/);
  assert.ok(pending.transactions['testnet-oracle-0'].raw);
  const pendingHash=pending.transactions['testnet-oracle-0'].hash;
  assert.ok(await provider.getTransactionReceipt(pendingHash));
  await refreshNewDeployerOracles({provider,wallet,release,state:pending,save,confirmations:1});
  assert.equal(pending.transactions['testnet-oracle-0'].hash,pendingHash);
  assert.equal((await a.latestRoundData())[0],3n);assert.equal((await b.latestRoundData())[0],3n);
  await rpc.request({method:'evm_increaseTime',params:[90000]});await rpc.request({method:'evm_mine',params:[]});
  const unsigned={transactions:{},plans:{}};
  await assert.rejects(refreshNewDeployerOracles({provider,wallet,release,state:unsigned,save,confirmations:1,budgetGuard:async()=>{throw Error('SIMULATED_BEFORE_SIGN');}}),/SIMULATED_BEFORE_SIGN/);
  assert.ok(unsigned.plans['testnet-oracle-0']);assert.equal(Object.keys(unsigned.transactions).length,0);
  await rpc.request({method:'evm_increaseTime',params:[50000]});await rpc.request({method:'evm_mine',params:[]});
  await assert.rejects(refreshNewDeployerOracles({provider,wallet,release,state:unsigned,save,confirmations:1}),/ORACLE_SAVED_PLAN_STALE_REVIEW_REQUIRED/);
  assert.equal(Object.keys(unsigned.transactions).length,0);
 }finally{await provider.destroy();await rpc.disconnect();}
});

test('rejects wrong chain and changed mock runtime before signing',async()=>{
 const provider={send:async()=>56,getCode:async()=> '0x',getBlock:async()=>({timestamp:1})};
 await assert.rejects(refreshNewDeployerOracles({provider,wallet:{address:'x'},release:{deployer:'x'},state:{transactions:{},plans:{}},save:()=>{}}),/ORACLE_TESTNET_IDENTITY_REQUIRED/);
 provider.send=async()=>97;
 await assert.rejects(refreshNewDeployerOracles({provider,wallet:{address:'x'},release:{deployer:'x',bnbFeed:'0x0000000000000000000000000000000000000001',tokenFeed:'0x0000000000000000000000000000000000000002'},state:{transactions:{},plans:{}},save:()=>{}}),/ORACLE_TESTNET_MOCK_REQUIRED/);
});

test('reserves deployment gas and enforces total 0.1 test BNB before refresh',async()=>{
 const provider={getFeeData:async()=>({gasPrice:1000000000n}),estimateGas:async()=>100000n,getBalance:async()=>100000000000000000n};
 const options={provider,wallet:{address:'0x0000000000000000000000000000000000000001'},request:{},deployment:{},state:{transactions:{}}};
 await assertRefreshBudget(options);
 await assert.rejects(assertRefreshBudget({...options,state:{transactions:{a:{maxFee:'99900000000000000'}}}}),/ORACLE_AND_DEPLOY_FEE_BUDGET_REQUIRED/);
 await assert.rejects(assertRefreshBudget({...options,provider:{...provider,getBalance:async()=>1n}}),/ORACLE_AND_DEPLOY_FEE_BUDGET_REQUIRED/);
});
