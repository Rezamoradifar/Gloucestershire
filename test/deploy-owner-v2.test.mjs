import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import ganache from 'ganache';import {BrowserProvider,ContractFactory,Wallet,parseEther,ZeroAddress} from 'ethers';
import {deployOwnerV2} from '../scripts/deploy-owner-v2.mjs';
test('new owner deployment preserves old records/assets, verifies model 2 and resumes without a second deployment',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97},wallet:{totalAccounts:12,defaultBalance:10000}}),provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'global-owner-v2-'));
 try{
 const signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i))),addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const keys=rpc.getInitialAccounts(),wallet=new Wallet(keys[addresses[1].toLowerCase()].secretKey);
 const load=name=>JSON.parse(fs.readFileSync(new URL('../artifacts/'+name+'.json',import.meta.url))),artifact=load('DropshippingVault');
 async function deploy(name,args){const a=load(name),v=await new ContractFactory(a.abi,a.evm.bytecode.object,signers[0]).deploy(...args);await v.waitForDeployment();return v;}
 const token=await deploy('MockToken',[18]),bnb=await deploy('MockFeed',[60000000000n]),usd=await deploy('MockFeed',[100000000n]);
 const old=await deploy('DropshippingVault',[addresses[0],token.target,bnb.target,usd.target,86400,addresses.slice(0,7),addresses[9]]);
 await(await token.mint(addresses[0],parseEther('100'))).wait();await(await token.approve(old.target,parseEther('100'))).wait();await(await old.deposit(token.target,parseEther('100'),ZeroAddress)).wait();
 const config={provider,wallet,artifact,previous:old.target,owner:addresses[8],dir};
 const report=await deployOwnerV2(config);assert.equal(report.owner,addresses[8]);assert.equal(report.usdt,token.target);assert.equal(report.usersMigrated,false);assert.notEqual(report.contractAddress,old.target);
 const vault=new (await import('ethers')).Contract(report.contractAddress,artifact.abi,provider);
 assert.equal((await old.accounts(addresses[0],token.target)).principal,parseEther('100'));assert.equal((await vault.accounts(addresses[0],token.target)).principal,0n);assert.equal(await vault.reporters(addresses[8]),true);assert.equal(await vault.SALES_REFERRAL_MODEL_VERSION(),2n);
 const nonce=await provider.getTransactionCount(wallet.address);const resumed=await deployOwnerV2(config);assert.equal(resumed.contractAddress,report.contractAddress);assert.equal(await provider.getTransactionCount(wallet.address),nonce);
 await assert.rejects(deployOwnerV2({...config,owner:addresses[7]}),/Saved deployment differs/);
 await assert.rejects(deployOwnerV2({...config,provider:{getNetwork:async()=>({chainId:56n})}}),/Only BNB Testnet/);
 const publicReport=fs.readFileSync(path.join(dir,'deployment-public.json'),'utf8');assert.equal(publicReport.includes('"raw"'),false);assert.equal(fs.statSync(path.join(dir,'deployment-private.json')).mode&0o077,0);
 }finally{await provider.destroy();await rpc.disconnect();fs.rmSync(dir,{recursive:true,force:true});}
});
