import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,parseEther,keccak256} from 'ethers';
import {compileHourly,hourlyV3Source} from '../scripts/compile-global-v3-hourly-testnet.mjs';
import {checkHourlyProof,verifiedHourlyDeployment} from '../scripts/verify-v3-hourly-testnet.mjs';

const MOCK='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const ADMIN='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const FEE='0x74015dedf36677485793f1714ec7bd4893907b26';
let compiled;
const hourlyArtifact=()=>compiled??=compileHourly();
const done=async p=>{
 const receipt=await(await p).wait();
 assert.equal(receipt.status,1);
 return receipt;
};

test('hourly derivative is exact, bounded and rejects changed source anchors',()=>{
 const source=fs.readFileSync('contracts/v3/GlobalV3DeferredTestnet.sol','utf8');
 const hourly=hourlyV3Source(source);
 assert.match(hourly,/ACCRUAL_PERIOD = 1 hours/);
 assert.match(hourly,/block\.timestamp-u\.lastCheckIn<ONE_DAY/);
 assert.match(hourly,/block\.chainid!=97/);
 assert.match(hourly,/PRINCIPAL_LOCK = 90 days/);
 assert.match(hourly,/WITHDRAWAL_COOLDOWN = 72 hours/);
 assert.match(hourly,/DEPOSIT_FEE_EACH_BPS = 1000/);
 assert.throws(()=>hourlyV3Source(source.replace('uint256(p.lastAccruedAt)+ONE_DAY','0')),
  /SOURCE_ANCHOR_CHANGED/);
 assert.throws(()=>hourlyV3Source(source.replace('if(block.chainid!=97) revert WrongChain();','')),
  /TESTNET_CHAIN_GUARD_REQUIRED/);
});

test('one-hour testnet daily and compound claims are real contract state, not a cash payout',async()=>{
 const artifact=hourlyArtifact();
 if(!fs.existsSync('artifacts/MockToken.json'))
  execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const tokenArtifact=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const eip=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:4,defaultBalance:50}});
 const provider=new BrowserProvider(eip,undefined,{cacheTimeout:-1});
 provider.pollingInterval=25;
 try{
  const s=await Promise.all([0,1,2].map(i=>provider.getSigner(i)));
  const a=await Promise.all(s.map(x=>x.getAddress()));
  const tokenDeployed=await new ContractFactory(tokenArtifact.abi,
   '0x'+tokenArtifact.evm.bytecode.object,s[0]).deploy(18);
  await tokenDeployed.waitForDeployment();
  const tokenCode=await provider.getCode(tokenDeployed.target);
  await eip.request({method:'evm_setAccountCode',params:[MOCK,tokenCode]});
  const token=new Contract(MOCK,tokenArtifact.abi,s[0]);
  assert.equal(await token.decimals(),18n);
  const factory=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,s[0]);
  await assert.rejects(factory.deploy(a[0],tokenDeployed.target,a[0]));
  const vault=await factory.deploy(ADMIN,MOCK,FEE);
  await vault.waitForDeployment();
  assert.equal(await vault.ACCRUAL_PERIOD(),3600n);
  assert.equal(await vault.ONE_DAY(),86400n);
  const fee1=await vault.FEE_WALLET_1(),fee2=await vault.FEE_WALLET_2();
  const operations=await vault.OPERATIONS_WALLET();
  const principal=parseEther('100');
  await done(token.mint(a[1],principal));
  await done(token.connect(s[1]).approve(vault.target,principal));
  await done(vault.connect(s[1]).deposit(principal,ZeroAddress));
  await done(vault.connect(s[1]).checkIn());
  const deployReceipt=await vault.deploymentTransaction().wait();
  const proof={status:'VERIFIED_BNB_TESTNET_ONLY',profile:'ISOLATED_HOURLY_TESTNET_ONLY',
   accrualPeriodSeconds:3600,chainId:97,contract:vault.target,asset:MOCK,admin:ADMIN,
   feeReceiver:FEE,runtimeHash:keccak256(await provider.getCode(vault.target)),
   txHash:deployReceipt.hash,blockNumber:deployReceipt.blockNumber,
   creationBytecodeHash:keccak256('0x'+artifact.evm.bytecode.object)};
  assert.throws(()=>checkHourlyProof({...proof,accrualPeriodSeconds:86400}));
  const verified=await verifiedHourlyDeployment(proof,{compile:()=>artifact,
   endpoints:['http://local.test'],makeProvider:()=>new BrowserProvider(eip,undefined,{cacheTimeout:-1})});
  assert.equal(verified.contract,vault.target);
  await assert.rejects(verifiedHourlyDeployment({...proof,runtimeHash:'0x'+'0'.repeat(64)},
   {compile:()=>artifact,endpoints:['http://local.test'],
    makeProvider:()=>new BrowserProvider(eip,undefined,{cacheTimeout:-1})}));
  assert.equal(await token.balanceOf(fee1),parseEther('10'));
  assert.equal(await token.balanceOf(fee2),parseEther('10'));
  assert.equal(await token.balanceOf(operations),parseEther('80'));
  assert.equal(await token.balanceOf(vault.target),0n);
  await eip.request({method:'evm_increaseTime',params:[3590]});
  await eip.request({method:'evm_mine',params:[]});
  await assert.rejects(vault.connect(s[2]).accrueDaily.staticCall(a[1],0));
  await eip.request({method:'evm_increaseTime',params:[11]});
  await eip.request({method:'evm_mine',params:[]});
  const one=await done(vault.connect(s[2]).accrueDaily(a[1],0));
  const first=await vault.positionOf(a[1],0);
  assert.equal(first.availableProfit,parseEther('0.5'));
  assert.equal(first.cumulativeDaily,parseEther('0.5'));
  assert.equal(first.cumulativeCompound,0n);
  assert.ok(one.logs.some(x=>{try{return vault.interface.parseLog(x)?.name==='DailyClaimAccrued';}catch{return false;}}));
  await assert.rejects(vault.connect(s[2]).accrueDaily.staticCall(a[1],0));
  await eip.request({method:'evm_increaseTime',params:[3601]});
  await eip.request({method:'evm_mine',params:[]});
  await done(vault.connect(s[2]).accrueDaily(a[1],0));
  const second=await vault.positionOf(a[1],0);
  assert.equal(second.cumulativeDaily,parseEther('1'));
  assert.equal(second.cumulativeCompound,parseEther('0.0025'));
  assert.equal(second.availableProfit,parseEther('1.0025'));
  assert.equal(await token.balanceOf(a[1]),0n);
  const cash=await vault.cashStatus();
  assert.equal(cash.cash,0n);
  assert.equal(cash.accruedProfit,parseEther('1.0025'));
  assert.equal(cash.totalCashShortfall,parseEther('101.0025'));
  await eip.request({method:'evm_increaseTime',params:[86401]});
  await eip.request({method:'evm_mine',params:[]});
  assert.equal(await vault.isEligible(a[1]),false);
  await assert.rejects(vault.connect(s[2]).accrueDaily.staticCall(a[1],0));
 }finally{provider.destroy();}
});

test('hourly contract refuses BNB mainnet chain ID',async()=>{
 const artifact=hourlyArtifact();
 const eip=ganache.provider({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},
  wallet:{totalAccounts:1,defaultBalance:50}});
 const provider=new BrowserProvider(eip,undefined,{cacheTimeout:-1});
 try{
  const signer=await provider.getSigner(0);
  const addr=await signer.getAddress();
  const factory=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signer);
  await assert.rejects(factory.deploy(addr,MOCK,addr));
 }finally{provider.destroy();}
});
