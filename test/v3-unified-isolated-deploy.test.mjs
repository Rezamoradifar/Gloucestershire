import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Wallet,keccak256} from 'ethers';
import {compileUnifiedTestnet} from '../scripts/compile-global-v3-unified-testnet.mjs';
import {planUnifiedDeployment} from '../scripts/v3-unified-deploy-preflight.mjs';
import {deployUnifiedIsolated} from '../scripts/deploy-v3-unified-isolated.mjs';

const TOKEN='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
test('isolated chain-97 deployment journals before broadcast, proves components and blocks uncertain retries',async()=>{
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const mock=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:3,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'unified-isolated-'));
 try{
  const token=await new ContractFactory(mock.abi,'0x'+mock.evm.bytecode.object,await provider.getSigner(0)).deploy(18);
  await token.waitForDeployment();
  const tokenCode=await provider.getCode(token.target);
  await rpc.request({method:'evm_setAccountCode',params:[TOKEN,tokenCode]});
  for(let i=0;i<4;i++)await rpc.request({method:'evm_mine',params:[]});
  const secrets=Object.values(rpc.getInitialAccounts()).map(account=>account.secretKey);
  const signer=new Wallet(secrets[1],provider),artifacts=compileUnifiedTestnet(),compile=()=>artifacts;
  const plan=await planUnifiedDeployment({provider,from:signer.address,compile});
  const common={provider,signer,directory,expectedDeployer:signer.address,
   expectedInitcodeHash:plan.initcodeHash,expectedTokenRuntimeHash:keccak256(tokenCode),compile};
  await assert.rejects(deployUnifiedIsolated({...common,expectedTokenRuntimeHash:'0x'+'11'.repeat(32)}),/TOKEN_HASH_MISMATCH/);
  assert.equal(fs.existsSync(path.join(directory,'pending.json')),false);
  const broadcast=provider.broadcastTransaction.bind(provider);
  provider.broadcastTransaction=async raw=>{
   const before=JSON.parse(fs.readFileSync(path.join(directory,'pending.json'),'utf8'));
   assert.equal(before.status,'PREPARED');
   assert.equal(before.hash,keccak256(raw));
   return broadcast(raw);
  };
  const waitReceipt=async(p,hash)=>{
   for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
   return p.getTransactionReceipt(hash);
  };
  const proof=await deployUnifiedIsolated({...common,waitReceipt});
  assert.equal(proof.chainId,97);assert.equal(proof.siteUpdated,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'pending.json'))).status,'CONFIRMED');
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'deployment-proof.json'))).vault,proof.vault);
  await assert.rejects(deployUnifiedIsolated({...common,waitReceipt}),/PREVIOUS_DEPLOYMENT_NEEDS_REVIEW/);

  const uncertainDir=fs.mkdtempSync(path.join(os.tmpdir(),'unified-uncertain-'));
  try{
   const other=new Wallet(secrets[2],provider);
   const otherPlan=await planUnifiedDeployment({provider,from:other.address,compile});
   const uncertain={...common,directory:uncertainDir,signer:other,expectedDeployer:other.address,
    expectedInitcodeHash:otherPlan.initcodeHash,waitReceipt};
   provider.broadcastTransaction=async raw=>{await broadcast(raw);throw Error('simulated RPC timeout');};
   await assert.rejects(deployUnifiedIsolated(uncertain),/simulated RPC timeout/);
   const pending=JSON.parse(fs.readFileSync(path.join(uncertainDir,'pending.json'),'utf8'));
   assert.equal(pending.status,'PREPARED');
   assert.equal(fs.existsSync(path.join(uncertainDir,'deployment-proof.json')),false);
   await assert.rejects(deployUnifiedIsolated(uncertain),/PREVIOUS_DEPLOYMENT_NEEDS_REVIEW/);
  }finally{fs.rmSync(uncertainDir,{recursive:true,force:true});}
 }finally{fs.rmSync(directory,{recursive:true,force:true});provider.destroy();await rpc.disconnect();}
});
