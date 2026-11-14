import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,keccak256,parseEther} from 'ethers';
import {auditV3Snapshot} from '../scripts/audit-global-v3-readonly.mjs';

test('V3 constructor rejects chain 56 and accepts the same setup on local chain 97',async()=>{
 execFileSync(process.execPath,['scripts/compile-global-v3.mjs'],{stdio:'pipe'});
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const v3=JSON.parse(fs.readFileSync('artifacts/GlobalV3DeferredTestnet.json','utf8'));
 const mock=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 for(const chainId of [56,97]){
  const local=ganache.provider({logging:{quiet:true},chain:{chainId,hardfork:'shanghai'},
   wallet:{totalAccounts:1,defaultBalance:10}});
  const provider=new BrowserProvider(local,undefined,{cacheTimeout:-1});
  provider.pollingInterval=25;
  try{
   const signer=await provider.getSigner(),owner=await signer.getAddress();
   const asset=await new ContractFactory(mock.abi,'0x'+mock.evm.bytecode.object,signer).deploy(18);
   await asset.waitForDeployment();
   const factory=new ContractFactory(v3.abi,'0x'+v3.evm.bytecode.object,signer);
   const request=await factory.getDeployTransaction(owner,asset.target,owner);
   if(chainId===56){
    await assert.rejects(provider.call({...request,from:owner}),error=>{
     assert.equal(factory.interface.parseError(error.data)?.name,'WrongChain');return true;
    });
   }else{
    const vault=await factory.deploy(owner,asset.target,owner);await vault.waitForDeployment();
    assert.equal(await vault.asset(),asset.target);
    const amount=parseEther('100');
    await (await asset.mint(owner,amount)).wait();
    await (await asset.approve(vault.target,amount)).wait();
    await (await vault.deposit(amount,ZeroAddress)).wait();
    await local.request({method:'evm_mine',params:[]});
    await local.request({method:'evm_mine',params:[]});
    const result=await auditV3Snapshot(provider,vault.target,keccak256(await provider.getCode(vault.target)));
    assert.equal(result.fullyCovered,false);
    assert.equal(result.coverageTestUnits,'0');
    assert.equal(result.totalLiabilityTestUnits,amount.toString());
    assert.equal(result.shortfallTestUnits,amount.toString());
   }
  }finally{provider.destroy();await local.disconnect();}
 }
});
