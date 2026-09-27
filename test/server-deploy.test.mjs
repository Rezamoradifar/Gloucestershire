import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Wallet} from 'ethers';
import {deployTestnet} from '../scripts/server-testnet.mjs';
test('server deployment verifies configured owner and safely resumes without duplicates',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const wallet=new Wallet(Object.values(rpc.getInitialAccounts())[0].secretKey);
 const config=JSON.parse(fs.readFileSync('config.example.json'));
 const artifacts=Object.fromEntries(['MockToken','MockFeed','DropshippingVault'].map(n=>[n,JSON.parse(fs.readFileSync(`artifacts/${n}.json`))]));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'global-deploy-test-'));
 try{
  await assert.rejects(deployTestnet({provider:{getNetwork:async()=>({chainId:56n})},wallet,config,dir,artifacts}),/97/);
  const first=await deployTestnet({provider,wallet,config,dir,artifacts});
  assert.equal(first.config.initialOwner,config.initialOwner);assert.notEqual(wallet.address,config.initialOwner);
  const count=await provider.getTransactionCount(wallet.address);
  // Simulate interrupted write after mining, before marking the last receipt confirmed.
  const journal=path.join(dir,'deployment-journal.json'),state=JSON.parse(fs.readFileSync(journal));delete state.steps[3].address;fs.writeFileSync(journal,JSON.stringify(state));
  const second=await deployTestnet({provider,wallet,config,dir,artifacts});
  assert.equal(second.contractAddress,first.contractAddress);assert.equal(await provider.getTransactionCount(wallet.address),count);
  assert.ok(!fs.readFileSync(path.join(dir,'deployment-public.json'),'utf8').includes(wallet.privateKey));
  await assert.rejects(deployTestnet({provider,wallet,config:{...config,initialOwner:wallet.address},dir,artifacts}),/differs/);
 }finally{await provider.destroy();await rpc.disconnect();fs.rmSync(dir,{recursive:true,force:true});}
});
