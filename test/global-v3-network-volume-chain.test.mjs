// Local-only EVM coverage of permissionless V3 volume propagation. No public
// testnet transactions, real wallets, or actual assets are used by this test.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,parseEther} from 'ethers';
import {compileHourly} from '../scripts/compile-global-v3-hourly-testnet.mjs';

const MOCK='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const ADMIN='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const FEE='0x74015dedf36677485793f1714ec7bd4893907b26';
const done=async tx=>{
 const receipt=await(await tx).wait();
 assert.equal(receipt.status,1);
 return receipt;
};

test('hourly V3 processes deep volume in bounded permissionless steps without replay or token transfers',async()=>{
 if(!fs.existsSync('artifacts/MockToken.json'))
  execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const tokenArtifact=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const hourly=compileHourly();
 const eip=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:14,defaultBalance:50}});
 const provider=new BrowserProvider(eip,undefined,{cacheTimeout:-1});
 provider.pollingInterval=25;
 try{
  const signers=await Promise.all(Array.from({length:14},(_,i)=>provider.getSigner(i)));
  const wallets=await Promise.all(signers.map(s=>s.getAddress()));
  const tokenSource=await new ContractFactory(tokenArtifact.abi,
   '0x'+tokenArtifact.evm.bytecode.object,signers[0]).deploy(18);
  await tokenSource.waitForDeployment();
  await eip.request({method:'evm_setAccountCode',params:[MOCK,await provider.getCode(tokenSource.target)]});
  const token=new Contract(MOCK,tokenArtifact.abi,signers[0]);
  const vault=await new ContractFactory(hourly.abi,'0x'+hourly.evm.bytecode.object,signers[0])
   .deploy(ADMIN,MOCK,FEE);
  await vault.waitForDeployment();
  assert.equal(await vault.ACCRUAL_PERIOD(),3600n);

  // Twelve registered accounts make eleven ancestors for the final depositor.
  for(let i=1;i<=12;i++)
   await done(vault.connect(signers[i]).register(i===1?ZeroAddress:wallets[i-1]));
  assert.equal(await vault.memberCount(),12n);
  const principal=parseEther('100');
  await done(token.mint(wallets[12],principal));
  await done(token.connect(signers[12]).approve(vault.target,principal));
  const deposit=await done(vault.connect(signers[12]).deposit(principal,wallets[11]));
  const queued=deposit.logs.map(log=>{
   try{return vault.interface.parseLog(log);}catch{return null;}
  }).find(log=>log?.name==='NetworkVolumeQueued');
  assert.ok(queued);
  assert.equal(queued.args.job,0n);
  assert.equal(queued.args.usd,principal);
  assert.equal(await vault.volumeJobCount(),1n);

  // The deposit processes exactly the nearest eight ancestors on chain.
  for(let i=4;i<=11;i++)
   assert.equal(await vault.branchVolumeUsd(wallets[i],wallets[i+1]),principal,`ancestor ${i}`);
  for(let i=1;i<=3;i++)
   assert.equal(await vault.branchVolumeUsd(wallets[i],wallets[i+1]),0n,`pending ancestor ${i}`);
  let job=await vault.volumeJobs(0);
  assert.equal(job.child,wallets[4]);
  assert.equal(job.ancestor,wallets[3]);
  assert.equal(job.usd,principal);

  const tracked=[...wallets,vault.target,await vault.FEE_WALLET_1(),
   await vault.FEE_WALLET_2(),await vault.OPERATIONS_WALLET(),FEE];
  const balances=await Promise.all(tracked.map(address=>token.balanceOf(address)));
  const principalBefore=await vault.principalLiability(),profitBefore=await vault.profitLiability();
  assert.equal(await vault.users(wallets[13]).then(user=>user.registered),false);
  await assert.rejects(vault.connect(signers[13]).processNetworkVolume.staticCall(0,0));
  await assert.rejects(vault.connect(signers[13]).processNetworkVolume.staticCall(0,65));

  // An unrelated, unregistered gas payer completes the pending ancestry.
  const partial=await done(vault.connect(signers[13]).processNetworkVolume(0,2));
  assert.ok(partial.logs.some(log=>{
   try{return vault.interface.parseLog(log)?.name==='NetworkVolumeProgress';}catch{return false;}
  }));
  job=await vault.volumeJobs(0);
  assert.equal(job.child,wallets[2]);
  assert.equal(job.ancestor,wallets[1]);
  assert.equal(await vault.branchVolumeUsd(wallets[3],wallets[4]),principal);
  assert.equal(await vault.branchVolumeUsd(wallets[2],wallets[3]),principal);
  assert.equal(await vault.branchVolumeUsd(wallets[1],wallets[2]),0n);

  await done(vault.connect(signers[13]).processNetworkVolume(0,64));
  job=await vault.volumeJobs(0);
  assert.equal(job.ancestor,ZeroAddress);
  for(let i=1;i<=11;i++)
   assert.equal(await vault.branchVolumeUsd(wallets[i],wallets[i+1]),principal,`completed ancestor ${i}`);
  // A repeat completes as a harmless no-op, not a second volume credit.
  await done(vault.connect(signers[13]).processNetworkVolume(0,64));
  for(let i=1;i<=11;i++)
   assert.equal(await vault.branchVolumeUsd(wallets[i],wallets[i+1]),principal,`replayed ancestor ${i}`);
  assert.deepEqual(await Promise.all(tracked.map(address=>token.balanceOf(address))),balances);
  assert.equal(await vault.principalLiability(),principalBefore);
  assert.equal(await vault.profitLiability(),profitBefore);
 }finally{provider.destroy();}
});
