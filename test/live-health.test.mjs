import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Wallet} from 'ethers';
import {deployTestnet} from '../scripts/server-testnet.mjs';
import {liveHealth} from '../scripts/test-live-testnet.mjs';
test('live health runner verifies routes/reverts, blocks mainnet and does not repeat deposits',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const wallet=new Wallet(Object.values(rpc.getInitialAccounts())[0].secretKey);
 const config=JSON.parse(fs.readFileSync('config.example.json'));
 const artifacts=Object.fromEntries(['MockToken','MockFeed','DropshippingVault'].map(n=>[n,JSON.parse(fs.readFileSync(`artifacts/${n}.json`))]));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'global-health-'));
 try{
  const deployment=await deployTestnet({provider,wallet,config,dir,artifacts});
  const args={provider,wallet,config,deployment,artifacts,dir};
  await assert.rejects(liveHealth({...args,provider:{getNetwork:async()=>({chainId:56n})}}),/97/);
  const report=await liveHealth(args);assert.equal(report.status,'completed');assert.equal(report.checks.filter(x=>x.status==='PASS').length,10);
  const nonce=await provider.getTransactionCount(wallet.address);
  const repeated=await liveHealth(args);assert.equal(repeated.status,'completed');assert.equal(await provider.getTransactionCount(wallet.address),nonce);
  assert.ok(!fs.readFileSync(path.join(dir,'health-public.json'),'utf8').includes(wallet.privateKey));
 }finally{await provider.destroy();await rpc.disconnect();fs.rmSync(dir,{recursive:true,force:true});}
});
