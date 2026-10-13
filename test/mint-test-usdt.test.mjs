import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Wallet,ContractFactory,parseEther} from 'ethers';
import {mintTestUsdt} from '../scripts/mint-test-usdt.mjs';
test('issues exactly one million mock tokens and does not duplicate them on rerun',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97},wallet:{totalAccounts:2}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const key=Object.values(rpc.getInitialAccounts())[0].secretKey,wallet=new Wallet(key,provider);
 const artifact=JSON.parse(fs.readFileSync('artifacts/MockToken.json'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'global-mint-'));
 try{
  const token=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,wallet).deploy(18);await token.waitForDeployment();
  const destination='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
  const options={provider,wallet,tokenAddress:token.target,destination,dir};
  const first=await mintTestUsdt(options),second=await mintTestUsdt(options);
  assert.equal(first.hash,second.hash);assert.equal(await token.balanceOf(destination),parseEther('1000000'));
  assert.equal(fs.statSync(path.join(dir,'mint-private.json')).mode&0o777,0o600);
  await assert.rejects(mintTestUsdt({...options,destination:wallet.address}),/differs/);
  await assert.rejects(mintTestUsdt({...options,provider:{getNetwork:async()=>({chainId:56n})}}),/Testnet/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});await provider.destroy();await rpc.disconnect();}
});
