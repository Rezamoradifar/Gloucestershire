import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Wallet,Contract,parseEther} from 'ethers';
import {deployTestnet} from '../scripts/server-testnet.mjs';
import {runMillion,millionHtml} from '../scripts/million-testnet.mjs';
let rpc,provider,wallet,config,artifacts,deployment,base,snapshot;
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},miner:{defaultGasPrice:100000000}});
 // Let the local EIP-1559 base fee fall below the observed 0.1 gwei testnet gas price.
 for(let i=0;i<20;i++)await rpc.request({method:'evm_mine',params:[]});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 wallet=new Wallet(Object.values(rpc.getInitialAccounts())[0].secretKey);
 config=JSON.parse(fs.readFileSync('config.example.json'));
 artifacts=Object.fromEntries(['MockToken','MockFeed','DropshippingVault'].map(n=>[n,JSON.parse(fs.readFileSync(`artifacts/${n}.json`))]));
 base=fs.mkdtempSync(path.join(os.tmpdir(),'global-million-'));
 deployment=await deployTestnet({provider,wallet,config,dir:base,artifacts});
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider.destroy();await rpc.disconnect();fs.rmSync(base,{recursive:true,force:true});});
const args=name=>({provider,wallet,config,artifacts,deployment,dir:path.join(base,name)});
test('exact million is deposited across 20 unique accounts, routes correctly and cannot repeat',async()=>{
 const a=args('million'),report=await runMillion(a);
 assert.equal(report.status,'completed');assert.equal(report.totalDepositedTestUsdt,'1000000');
 assert.equal(report.accounts.length,20);assert.equal(new Set(report.accounts.map(x=>x.address)).size,20);
 assert.equal(report.transactions.length,82);
 const token=new Contract(deployment.contracts[0].address,artifacts.MockToken.abi,provider);
 const vault=new Contract(deployment.contractAddress,artifacts.DropshippingVault.abi,provider);
 assert.equal(await token.totalSupply(),parseEther('1000000'));
 assert.equal((await vault.ledgers(token.target)).principal,parseEther('1000000'));
 assert.equal(await token.balanceOf(vault.target),0n);
 assert.equal(await token.balanceOf(config.dropshippingWallet),parseEther('800000'));
 assert.equal(await token.balanceOf(await vault.FEE_WALLET_1()),parseEther('100000'));
 assert.equal(await token.balanceOf(await vault.FEE_WALLET_2()),parseEther('100000'));
 assert.equal(await vault.qualifiedDirects(wallet.address),20n);
 for(const account of report.accounts){
  assert.equal((await vault.users(account.address)).vipKyc,false);
  assert.equal(await vault.profitWithdrawalCap(account.address,token.target),parseEther('5000'));
 }
 const nonce=await provider.getTransactionCount(wallet.address);
 assert.equal((await runMillion(a)).status,'completed');assert.equal(await provider.getTransactionCount(wallet.address),nonce);
 const state=JSON.parse(fs.readFileSync(path.join(a.dir,'million-private.json')));
 assert.equal(fs.statSync(path.join(a.dir,'million-private.json')).mode&0o777,0o600);
 const publicText=fs.readFileSync(path.join(a.dir,'million-public.json'),'utf8')+millionHtml(report);
 for(const secret of [wallet.privateKey,...state.keys,...state.steps.map(x=>x.raw)])assert.ok(!publicText.includes(secret));
 assert.ok(millionHtml(report).includes('۲۰ حساب'));assert.ok(millionHtml(report).includes(report.accounts[19].address));
});
test('interrupted seventh deposit resumes to exactly one million using the same wallets and hash',async()=>{
 const a=args('resume');
 const existing=new Contract(deployment.contractAddress,artifacts.DropshippingVault.abi,wallet.connect(provider));
 await (await existing.register('0x0000000000000000000000000000000000000000')).wait();
 await assert.rejects(runMillion({...a,afterBroadcast:async name=>{if(name==='Account 7: deposit 50000 TEST USDT')throw Error('disconnected');}}),/disconnected/);
 const state=JSON.parse(fs.readFileSync(path.join(a.dir,'million-private.json'))),hash=state.steps.at(-1).hash;
 const report=await runMillion(a);
 assert.equal(report.totalDepositedTestUsdt,'1000000');assert.equal(report.transactions.length,81);
 assert.equal(report.accounts[6].transaction,hash);
 assert.deepEqual(report.accounts.map(x=>x.address),state.keys.map(k=>new Wallet(k).address));
});
test('mainnet, wrong deployment, and too little gas balance stop without creating test accounts',async()=>{
 const a=args('guard'),nonce=await provider.getTransactionCount(wallet.address);
 await assert.rejects(runMillion({...a,provider:{getNetwork:async()=>({chainId:56n})}}),/97/);
 const bad={...deployment,contracts:deployment.contracts.map(x=>({...x}))};bad.contracts[0].hash='0x'+'00'.repeat(32);
 await assert.rejects(runMillion({...a,deployment:bad}),/provenance/);
 await rpc.request({method:'evm_setAccountBalance',params:[wallet.address,'0x1']});
 await assert.rejects(runMillion(a),/at least 0.08/);
 assert.equal(await provider.getTransactionCount(wallet.address),nonce);
 assert.ok(!fs.existsSync(path.join(a.dir,'million-private.json')));
});
