import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,parseEther} from 'ethers';
import {compileHourly} from '../scripts/compile-global-v3-hourly-testnet.mjs';

const MOCK='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const E=value=>parseEther(String(value));
const done=async promise=>{const receipt=await(await promise).wait();assert.equal(receipt.status,1);return receipt;};

test('pausing the existing V3 vault alone does not freeze an already funded withdrawal',async()=>{
 const artifact=compileHourly();
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const tokenArtifact=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:3,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 try{
  const manager=await provider.getSigner(0),user=await provider.getSigner(1),executor=await provider.getSigner(2);
  const managerAddress=await manager.getAddress(),userAddress=await user.getAddress();
  const tokenDeployed=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,manager).deploy(18);
  await tokenDeployed.waitForDeployment();
  await rpc.request({method:'evm_setAccountCode',params:[MOCK,await provider.getCode(tokenDeployed.target)]});
  const token=new Contract(MOCK,tokenArtifact.abi,manager);
  const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,manager)
   .deploy(managerAddress,MOCK,managerAddress);
  await vault.waitForDeployment();
  await done(token.mint(userAddress,E(1000)));
  await done(token.connect(user).approve(vault.target,E(1000)));
  await done(vault.connect(user).deposit(E(1000),ZeroAddress));
  await done(vault.connect(user).checkIn());
  await rpc.request({method:'evm_increaseTime',params:[3601]});
  await rpc.request({method:'evm_mine',params:[]});
  await done(vault.connect(executor).accrueDaily(userAddress,0));
  await done(vault.connect(user).requestProfit(0,E(1)));
  await done(vault.approveWithdrawal(0));
  await done(token.mint(managerAddress,E(1)));
  await done(token.approve(vault.target,E(1)));
  await done(vault.fundWithdrawal(0));
  await done(vault.setPaused(true));
  const before=await vault.cashStatus();
  assert.equal(before.accruedProfit,E(7));assert.equal(before.escrowedCash,E(1));
  assert.equal((await vault.users(userAddress)).pendingRequest,true);
  await assert.rejects(vault.connect(user).reinvest.staticCall(0,E(1)));
  await assert.rejects(vault.connect(user).requestProfit.staticCall(0,E(1)));
  const userBefore=await token.balanceOf(userAddress);
  await done(vault.connect(executor).payWithdrawal(0));
  assert.equal((await token.balanceOf(userAddress))-userBefore,E('0.97'));
  assert.equal((await vault.cashStatus()).accruedProfit,E(6));
  assert.equal((await vault.users(userAddress)).pendingRequest,false);
  assert.equal((await vault.withdrawalOf(0)).status,3n);
 }finally{provider.destroy();await rpc.disconnect();}
});
