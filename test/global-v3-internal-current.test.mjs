import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,parseEther} from 'ethers';

const done=async tx=>{const receipt=await(await tx).wait();assert.equal(receipt.status,1);return receipt;};
test('daily and compounded test claims stay internal until separately funded withdrawal',async()=>{
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 if(!fs.existsSync('artifacts/GlobalV3DeferredTestnet.json'))execFileSync(process.execPath,['scripts/compile-global-v3.mjs'],{stdio:'pipe'});
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:3,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=25;
 try{
  const manager=await provider.getSigner(0),user=await provider.getSigner(1),fees=await provider.getSigner(2);
  const address=await user.getAddress();
  const deploy=async(name,args)=>{
   const a=JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
   const contract=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,manager).deploy(...args);
   await contract.waitForDeployment();return contract;
  };
  const token=await deploy('MockToken',[18]);
  const vault=await deploy('GlobalV3DeferredTestnet',[await manager.getAddress(),token.target,await fees.getAddress()]);
  const amount=parseEther('1000');
  await done(token.mint(address,amount));
  await done(token.connect(user).approve(vault.target,amount));
  await done(vault.connect(user).deposit(amount,ZeroAddress));
  const before=await token.balanceOf(address);
  for(let i=0;i<2;i++){
   await rpc.request({method:'evm_increaseTime',params:[86461]});
   await rpc.request({method:'evm_mine',params:[]});
   await done(vault.connect(user).checkInAndAccrue([0]));
   assert.equal(await token.balanceOf(address),before);
  }
  assert.equal(await vault.claimableDaily(address,0),parseEther('14'));
  assert.equal(await vault.claimableCompound(address,0),parseEther('0.049'));
  assert.equal((await vault.positionOf(address,0)).availableProfit,parseEther('14.049'));
  assert.equal(await token.balanceOf(vault.target),0n);
 }finally{provider.destroy();}
});
