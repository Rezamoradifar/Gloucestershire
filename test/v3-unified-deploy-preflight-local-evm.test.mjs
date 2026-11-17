import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory} from 'ethers';
import {planUnifiedDeployment} from '../scripts/v3-unified-deploy-preflight.mjs';

const TOKEN='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
test('local EVM estimates the three-contract creation without a transaction',async t=>{
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const mock=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:2,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 try{
  const signer=await provider.getSigner(0),who=await signer.getAddress();
  const token=await new ContractFactory(mock.abi,'0x'+mock.evm.bytecode.object,signer).deploy(18);
  await token.waitForDeployment();
  await rpc.request({method:'evm_setAccountCode',params:[TOKEN,await provider.getCode(token.target)]});
  for(let i=0;i<4;i++)await rpc.request({method:'evm_mine',params:[]});
  const nonce=await provider.getTransactionCount(who,'latest');
  const plan=await planUnifiedDeployment({provider,from:who});
  assert.equal(plan.status,'ESTIMATE_ONLY_NOT_RELEASE_READY');
  assert.equal(plan.transactionSent,false);assert.equal(plan.releaseReady,false);
  assert.equal(await provider.getTransactionCount(who,'latest'),nonce);
  assert.equal(await provider.getCode(plan.candidateAddress),'0x');
  assert.ok(BigInt(plan.gasEstimate)>0n);
  t.diagnostic('Local creation gas estimate: '+plan.gasEstimate+'; not a network guarantee.');
 }finally{provider.destroy();await rpc.disconnect();}
});
