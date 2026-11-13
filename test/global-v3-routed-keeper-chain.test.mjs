import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,parseEther} from 'ethers';

const done=async transaction=>{
 const receipt=await(await transaction).wait();
 assert.equal(receipt.status,1);return receipt;
};
test('routed keeper gas bound covers a four-level eligible referral chain on two accrual days',async()=>{
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 if(!fs.existsSync('artifacts/GlobalV3DeferredTestnet.json'))execFileSync(process.execPath,['scripts/compile-global-v3.mjs'],{stdio:'pipe'});
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:7,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=25;
 try{
  const s=await Promise.all(Array.from({length:7},(_,i)=>provider.getSigner(i)));
  const a=await Promise.all(s.map(x=>x.getAddress()));
  const deploy=async(name,args)=>{
   const artifact=JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
   const instance=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,s[0]).deploy(...args);
   await instance.waitForDeployment();return instance;
  };
  const token=await deploy('MockToken',[18]);
  const vault=await deploy('GlobalV3DeferredTestnet',[a[0],token.target,a[0]]);
  for(let i=1;i<=5;i++){
   const amount=parseEther(i===1||i===5?'50001':'1000');
   const parent=i===1?ZeroAddress:a[i-1];
   await done(vault.connect(s[i]).register(parent));
   if(i===1||i===5)await done(vault.setVipKyc(a[i],true));
   await done(token.mint(a[i],amount));
   await done(token.connect(s[i]).approve(vault.target,amount));
   await done(vault.connect(s[i]).deposit(amount,parent));
  }
  const balance=await token.balanceOf(a[5]);
  for(let day=0;day<2;day++){
   await rpc.request({method:'evm_increaseTime',params:[86461]});
   await rpc.request({method:'evm_mine',params:[]});
   for(let i=1;i<=5;i++)await done(vault.connect(s[i]).checkIn());
   const gas=await vault.connect(s[6]).accrueDaily.estimateGas(a[5],0);
   console.log('V3_ROUTED_FOUR_LEVEL_GAS_ESTIMATE day='+day+' gas='+gas);
   assert.ok(gas*12n/10n<=500000n,'keeper gas limit must accommodate routed referral accrual');
   await done(vault.connect(s[6]).accrueDaily(a[5],0,{gasLimit:gas*12n/10n}));
  }
  assert.ok(await vault.claimableDaily(a[5],0)>0n);
  assert.ok(await vault.claimableCompound(a[5],0)>0n);
  for(let i=1;i<=4;i++)assert.ok((await vault.users(a[i])).referralAvailable>0n);
  assert.equal(await token.balanceOf(a[5]),balance);
 }finally{provider.destroy();}
});
