import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider} from 'ethers';
import {deploymentKey,guard,requestFor,verify} from '../deployment-console/core.mjs';

const config=JSON.parse(fs.readFileSync('deployment-console/config.json'));
const artifacts=Object.fromEntries(['MockToken','MockFeed','DropshippingVault'].map(n=>[n,JSON.parse(fs.readFileSync(`deployment-console/${n}.json`))]));

test('browser journal isolates changed bytecode and constructor settings',()=>{
 const key=deploymentKey(config,artifacts);
 assert.equal(deploymentKey(structuredClone(config),structuredClone(artifacts)),key);
 assert.notEqual(deploymentKey({...config,maxOracleAge:3600},artifacts),key);
 assert.notEqual(deploymentKey({...config,partners:[...config.partners].reverse()},artifacts),key);
 assert.notEqual(deploymentKey(config,{...artifacts,MockFeed:{...artifacts.MockFeed,bytecode:'0x00'}}),key);
 assert.throws(()=>deploymentKey({...config,chainId:56},artifacts),/97/);
});

test('browser console guards signing and verifies four current-version deployment receipts',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 try{
  const signer=await provider.getSigner(),owner=await signer.getAddress();
  const c={...config,initialOwner:owner};
  await guard(rpc,owner);
  await assert.rejects(guard(rpc,config.initialOwner),/owner/);
  await assert.rejects(guard({request:async()=> '0x38'},owner),/97/);
  const done=[];
  for(let i=0;i<4;i++){
   const request=await requestFor(i,c,done,artifacts);
   const tx=await signer.sendTransaction({...request,chainId:97,value:0n});
   await tx.wait();
   done.push(await verify(i,tx.hash,provider,c,done,artifacts));
  }
  assert.equal(new Set(done.map(r=>r.address)).size,4);
  assert.ok(done.every(r=>r.blockNumber>0&&BigInt(r.gasUsed)>0n));
  await assert.rejects(verify(3,done[3].hash,provider,{...c,dropshippingWallet:owner},done,artifacts),/match/);
  await assert.rejects(verify(1,done[0].hash,provider,c,done,artifacts),/match/);
 }finally{await provider.destroy();await rpc.disconnect();}
});
