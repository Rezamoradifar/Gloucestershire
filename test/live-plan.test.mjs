import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Wallet,parseEther,Contract} from 'ethers';
import {deployTestnet} from '../scripts/server-testnet.mjs';
import {runLivePlan,reportHtml} from '../scripts/live-plan-test.mjs';
let rpc,provider,wallet,config,artifacts,deployment,base,snapshot;
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 wallet=new Wallet(Object.values(rpc.getInitialAccounts())[0].secretKey);
 config=JSON.parse(fs.readFileSync('config.example.json'));
 artifacts=Object.fromEntries(['MockToken','MockFeed','DropshippingVault'].map(n=>[n,JSON.parse(fs.readFileSync(`artifacts/${n}.json`))]));
 base=fs.mkdtempSync(path.join(os.tmpdir(),'global-live-plan-'));
 deployment=await deployTestnet({provider,wallet,config,dir:base,artifacts});
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider.destroy();await rpc.disconnect();fs.rmSync(base,{recursive:true,force:true});});
const args=label=>({provider,wallet,config,artifacts,deployment,dir:path.join(base,label)});
test('public plan scenario credits 35, withdraws 9.5 net, reinvests 5 and cannot repeat',async()=>{
 const a=args('complete'),report=await runLivePlan(a);
 assert.equal(report.status,'completed');assert.equal(report.transactions.length,20);
 assert.deepEqual(report.balances,{principal:'105.0',profit:'20.0',withdrawalCap:'10.5',nextWithdrawalUtc:report.balances.nextWithdrawalUtc});
 const token=new Contract(deployment.contracts[0].address,artifacts.MockToken.abi,provider);
 assert.equal(await token.balanceOf(wallet.address),parseEther('9.5'));
 const vault=new Contract(deployment.contractAddress,artifacts.DropshippingVault.abi,provider);
 assert.equal(await token.balanceOf(await vault.WITHDRAWAL_FEE_WALLET()),parseEther('0.5'));
 const nonce=await provider.getTransactionCount(wallet.address);
 assert.equal((await runLivePlan(a)).status,'completed');assert.equal(await provider.getTransactionCount(wallet.address),nonce);
 const privateState=JSON.parse(fs.readFileSync(path.join(a.dir,'plan-private.json')));
 assert.equal(fs.statSync(path.join(a.dir,'plan-private.json')).mode&0o777,0o600);
 const html=reportHtml(report),publicData=fs.readFileSync(path.join(a.dir,'plan-public.json'),'utf8');
 for(const secret of [wallet.privateKey,...privateState.children,...privateState.steps.map(s=>s.raw)]){
  assert.ok(!html.includes(secret));assert.ok(!publicData.includes(secret));
 }
 assert.ok(html.includes('testnet.bscscan.com/tx/'));assert.ok(html.includes('Test completed'));
});
test('resume after broadcast reuses signed transaction and consumes exactly one stage',async()=>{
 const a=args('resume');
 await assert.rejects(runLivePlan({...a,afterBroadcast:async name=>{if(name==='Claim 35 TEST USDT')throw Error('simulated disconnect');}}),/disconnect/);
 const first=JSON.parse(fs.readFileSync(path.join(a.dir,'plan-private.json'))),hash=first.steps.find(s=>s.name==='Claim 35 TEST USDT').hash;
 const report=await runLivePlan(a);
 assert.equal(report.status,'completed');assert.equal(report.transactions.filter(t=>t.name==='Claim 35 TEST USDT').length,1);
 assert.equal(report.transactions.find(t=>t.name==='Claim 35 TEST USDT').hash,hash);
 assert.equal(report.balances.profit,'20.0');
});
test('mainnet, wrong provenance, and owner-wallet execution stop before a transaction',async()=>{
 const a=args('blocked'),nonce=await provider.getTransactionCount(wallet.address);
 await assert.rejects(runLivePlan({...a,provider:{getNetwork:async()=>({chainId:56n})}}),/97/);
 const bad={...deployment,contracts:deployment.contracts.map(x=>({...x}))};bad.contracts[0].hash='0x'+'00'.repeat(32);
 await assert.rejects(runLivePlan({...a,deployment:bad}),/provenance/);
 await assert.rejects(runLivePlan({...a,wallet:{address:config.initialOwner}}),/separate test deployer/);
 assert.equal(await provider.getTransactionCount(wallet.address),nonce);
 assert.ok(!fs.existsSync(path.join(a.dir,'plan-private.json')));
});
