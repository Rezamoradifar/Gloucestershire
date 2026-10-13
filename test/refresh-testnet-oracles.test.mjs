import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Wallet,ContractFactory,ZeroAddress,parseEther} from 'ethers';
import {refreshMockFeeds} from '../scripts/refresh-testnet-oracles.mjs';
test('refresh restores both stale mock quotes, preserves prices, skips fresh feeds and rejects mainnet',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97},wallet:{totalAccounts:8}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const wallets=Object.entries(rpc.getInitialAccounts());const wallet=new Wallet(wallets[0][1].secretKey,provider);
 const artifact=n=>JSON.parse(fs.readFileSync(`artifacts/${n}.json`));
 async function deploy(n,args){const a=artifact(n),c=await new ContractFactory(a.abi,a.evm.bytecode.object,wallet).deploy(...args);await c.waitForDeployment();return c;}
 try{
  const token=await deploy('MockToken',[18]),bnb=await deploy('MockFeed',[60000000000n]),usd=await deploy('MockFeed',[100000000n]);
  const vault=await deploy('DropshippingVault',[wallet.address,token.target,bnb.target,usd.target,86400,wallets.slice(0,7).map(([a])=>a),wallets[7][0]]);
  await rpc.request({method:'evm_increaseTime',params:[90000]});await rpc.request({method:'evm_mine',params:[]});
  await assert.rejects(vault.quoteUsd(token.target,parseEther('1')));
  const args={provider,wallet,artifact:artifact('MockFeed'),vaultAddress:vault.target,feedAddresses:[bnb.target,usd.target]};
  assert.equal((await refreshMockFeeds(args)).transactions.length,2);
  assert.equal(await vault.quoteUsd(token.target,parseEther('1')),parseEther('1'));
  assert.equal(await vault.quoteUsd(ZeroAddress,parseEther('1')),parseEther('600'));
  assert.equal((await refreshMockFeeds(args)).transactions.length,0);
  await assert.rejects(refreshMockFeeds({...args,provider:{getNetwork:async()=>({chainId:56n})}}),/Testnet/);
  await assert.rejects(refreshMockFeeds({...args,feedAddresses:[usd.target,bnb.target]}),/Unexpected feeds/);
 }finally{await provider.destroy();await rpc.disconnect();}
});
