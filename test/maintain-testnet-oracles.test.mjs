import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Wallet,ContractFactory,ZeroAddress,parseEther} from 'ethers';
import {maintainOracles} from '../scripts/maintain-testnet-oracles.mjs';
import {journalTransaction} from '../scripts/migration-journal.mjs';

test('scheduled mock maintenance resumes an interrupted update, skips fresh rounds, refreshes before expiry and preserves prices',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97},wallet:{totalAccounts:8}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const accounts=Object.entries(rpc.getInitialAccounts()),wallet=new Wallet(accounts[0][1].secretKey,provider);
 const artifact=n=>JSON.parse(fs.readFileSync(`artifacts/${n}.json`));
 const deploy=async(n,args)=>{const a=artifact(n),v=await new ContractFactory(a.abi,a.evm.bytecode.object,wallet).deploy(...args);await v.waitForDeployment();return v;};
 const advance=async seconds=>{await rpc.request({method:'evm_increaseTime',params:[seconds]});await rpc.request({method:'evm_mine',params:[]});};
 try{
  const token=await deploy('MockToken',[18]),bnb=await deploy('MockFeed',[60000000000n]),usd=await deploy('MockFeed',[100000000n]);
  const vault=await deploy('DropshippingVault',[wallet.address,token.target,bnb.target,usd.target,86400,accounts.slice(0,7).map(([a])=>a),accounts[7][0]]);
  const state={};let saved;
  const options={provider,wallet,artifact:artifact('MockFeed'),vaultAddress:vault.target,feedAddresses:[bnb.target,usd.target],state,save:()=>{saved=JSON.parse(JSON.stringify(state));},confirmations:1};
  await advance(90000);
  await assert.rejects(vault.quoteUsd(token.target,parseEther('1')));
  const before=await provider.getTransactionCount(wallet.address);
  await assert.rejects(maintainOracles({...options,transact:async args=>{await journalTransaction(args);throw Error('SIMULATED_RESTART_AFTER_MINING');}}),/SIMULATED_RESTART/);
  assert.ok(saved.pending);assert.equal(Object.keys(saved.transactions).length,1);
  const resumedState=structuredClone(saved),resumed={...options,state:resumedState,save:()=>{saved=structuredClone(resumedState);}};
  const result=await maintainOracles(resumed);
  assert.equal(result.status,'TESTNET_ORACLES_VALID');assert.equal(result.transactions.length,1);
  assert.equal(resumedState.pending,undefined);assert.equal(Object.keys(resumedState.transactions).length,2);
  assert.equal(await provider.getTransactionCount(wallet.address),before+2);
  assert.equal(await vault.quoteUsd(token.target,parseEther('1')),parseEther('1'));
  assert.equal(await vault.quoteUsd(ZeroAddress,parseEther('1')),parseEther('600'));
  assert.equal((await maintainOracles(resumed)).transactions.length,0);
  await advance(44000); // Still valid, but refresh before the 24-hour deadline.
  assert.equal(await vault.quoteUsd(token.target,parseEther('1')),parseEther('1'));
  assert.equal((await maintainOracles(resumed)).transactions.length,2);
  assert.equal(await bnb.answer(),60000000000n);assert.equal(await usd.answer(),100000000n);
  const count=await provider.getTransactionCount(wallet.address);
  await assert.rejects(maintainOracles({...resumed,provider:{send:async()=> '0x38'}}),/TESTNET_ONLY/);
  await assert.rejects(maintainOracles({...resumed,feedAddresses:[usd.target,bnb.target]}),/Unexpected feeds/);
  await assert.rejects(maintainOracles({...resumed,artifact:{...artifact('MockFeed'),evm:{deployedBytecode:{object:'00'}}}}),/reviewed MockFeed/);
  assert.equal(await provider.getTransactionCount(wallet.address),count);
  await advance(44000);
  const limited={...resumed,state:{transactions:{previous:{maxFee:parseEther('0.1').toString()}}},save:()=>{}};
  await assert.rejects(maintainOracles(limited),/TOTAL_TEST_BNB_FEE_LIMIT/);
  assert.equal(await provider.getTransactionCount(wallet.address),count);
  // An invalid second feed must not result in a partial update of the first.
  const block=await provider.getBlock('latest');await(await usd.set(0n,block.timestamp,9,9)).wait();
  const invalidCount=await provider.getTransactionCount(wallet.address);
  await assert.rejects(maintainOracles(resumed),/Invalid mock price/);
  assert.equal(await provider.getTransactionCount(wallet.address),invalidCount);
 }finally{provider.destroy();await rpc.disconnect();}
});
