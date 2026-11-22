import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,Wallet,ZeroAddress,keccak256,parseEther} from 'ethers';
import {deployUnifiedIsolated} from '../scripts/deploy-v3-unified-isolated.mjs';
import {planUnifiedPreviewSite} from '../scripts/v3-unified-site-preview-preflight.mjs';
import {scanUnifiedAccrual} from '../scripts/scan-v3-unified-accrual.mjs';
import {compileDailyCapitalTestnet} from '../scripts/compile-global-v3-unified-testnet.mjs';
import {DAILY_CAPITAL_PROFILE,UNIFIED_MANAGER,UNIFIED_TOKEN,UNIFIED_FEE_RECEIVER} from '../scripts/v3-unified-release-pins.mjs';

const units=value=>parseEther(String(value));
const day=86400;
const confirmed=async p=>assert.equal((await (await p).wait()).status,1);
const reverts=async p=>assert.rejects(p,error=>error.code==='CALL_EXCEPTION');

test('daily testnet account, referral ledger and backing reserve', {timeout:240000}, async t=>{
 const artifacts=compileDailyCapitalTestnet();
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000,timestampIncrement:1},wallet:{totalAccounts:12}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});
 provider.pollingInterval=15;
 try{
  const [manager,grandparent,middle,parent,child,fees,...directs]=await provider.listAccounts();
  const mock=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
  const factory=a=>new ContractFactory(a.abi,a.evm.bytecode.object,manager);
  const original=await factory(mock).deploy(18);
  await original.waitForDeployment();
  await rpc.request({method:'evm_setAccountCode',params:[UNIFIED_TOKEN,await provider.getCode(original.target)]});
  const token=new Contract(UNIFIED_TOKEN,mock.abi,manager);
  const contract=factory(artifacts.GlobalV3DailyCapitalTestnet);
  const data=(await contract.getDeployTransaction(UNIFIED_MANAGER,UNIFIED_TOKEN,UNIFIED_FEE_RECEIVER)).data;
  assert.equal(keccak256(data),DAILY_CAPITAL_PROFILE.initcodeHash);
  const vault=await contract.deploy(manager.address,UNIFIED_TOKEN,fees.address,{gasLimit:25000000});
  await vault.waitForDeployment();
  const book=new Contract(await vault.reinvestmentBook(),artifacts.DailyCapitalBook.abi,provider);
  const network=new Contract(await vault.networkPlan(),artifacts.DailyCapitalNetwork.abi,manager);
  const deposit=async(signer,amount,referrer=ZeroAddress)=>{
   await prepare(signer,amount);
   await confirmed(vault.connect(signer).deposit(units(amount),referrer,{gasLimit:3500000}));
  };
  const prepare=async(signer,amount)=>{
   await confirmed(token.mint(signer.address,units(amount)));
   await confirmed(token.connect(signer).approve(vault.target,units(amount)));
  };
  const fund=async amount=>{await prepare(manager,amount);await confirmed(vault.fundPlanReserve(units(amount)));};
  const tick=async seconds=>{
   await rpc.request({method:'evm_increaseTime',params:[seconds]});
   await rpc.request({method:'evm_mine',params:[]});
  };
  const check=async(...members)=>{for(const member of members)await confirmed(vault.connect(member).checkIn({gasLimit:500000}));};
  const accrue=()=>confirmed(vault.accrueDaily(child.address,0,{gasLimit:3000000}));
  const scenario=async(name,run)=>t.test(name,async()=>{
   const snapshot=await rpc.request({method:'evm_snapshot',params:[]});
   try{await run();}finally{assert.equal(await rpc.request({method:'evm_revert',params:[snapshot]}),true);}
  });

  await scenario('deploys the pinned daily build and binds its dashboard to the same local chain receipt',async()=>{
   const directory=fs.mkdtempSync(path.join(os.tmpdir(),'global-daily-test-'));
   try{
    for(let i=0;i<4;i++)await rpc.request({method:'evm_mine',params:[]});
    const signer=new Wallet(Object.values(rpc.getInitialAccounts())[11].secretKey,provider);
    const proof=await deployUnifiedIsolated({provider,signer,directory,expectedDeployer:signer.address,
     compile:()=>artifacts,profile:DAILY_CAPITAL_PROFILE,waitReceipt:async(reader,hash)=>{
      for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
      return reader.getTransactionReceipt(hash);
     }});
    const revision='1'.repeat(40);
    const build=await planUnifiedPreviewSite({provider,proof,sourceSha:revision,expectedSourceSha:revision,profile:DAILY_CAPITAL_PROFILE});
    assert.equal(build.routeCandidate,'/daily-capital-test/');
    assert.equal(build.env.VITE_V3_UNIFIED_MODE,'daily-capital-testnet');
    assert.equal(build.env.VITE_V3_HOURLY_TEST,'');
    assert.equal(build.env.VITE_V3_CONTRACT_ADDRESS,proof.vault);
   }finally{fs.rmSync(directory,{recursive:true,force:true});}
  });

  await scenario('each deposit and new claim needs separate spendable backing',async()=>{
   assert.equal(await vault.ACCRUAL_PERIOD(),BigInt(day));
   assert.equal(await book.PERIOD(),BigInt(day));
   await prepare(child,1000);
   await reverts(vault.connect(child).deposit.staticCall(units(1000),ZeroAddress));
   assert.equal(await vault.memberCount(),0n);
   await fund(1000);
   await confirmed(vault.connect(child).deposit(units(1000),ZeroAddress));
   const destinations=await Promise.all([vault.FEE_WALLET_1(),vault.FEE_WALLET_2(),vault.OPERATIONS_WALLET()]);
   assert.deepEqual(await Promise.all(destinations.map(address=>token.balanceOf(address))),[100,100,800].map(units));
   await check(child);
   await tick(day-3600);await check(child);await tick(3602);
   await reverts(vault.accrueDaily.staticCall(child.address,0));
   assert.equal((await book.lot(child.address,0)).daily,0n);
   await fund(7);await accrue();
   assert.deepEqual([...(await vault.cashStatus())],[1007,1000,7,0,0].map(units));
  });

  await scenario('level shares come from 7 base USDT, even when the member earns personal compound',async()=>{
   await fund(3000);
   await deposit(grandparent,100);await deposit(middle,100,grandparent.address);
   await deposit(parent,100,middle.address);await deposit(child,1000,parent.address);
   // Leave level two inactive during the first maturity.
   await check(grandparent,parent,child);
   await tick(day-3600);await check(grandparent,parent,child);
   await tick(3602);await accrue();
   const earned=async who=>(await vault.users(who.address)).cumulativeReferral;
   assert.deepEqual(await Promise.all([parent,middle,grandparent].map(earned)),['0.7',0,'0.21'].map(units));
   const first=(await book.lot(child.address,0)).lastAccruedAt;
   assert.equal((await book.lot(child.address,0)).daily,units(7));
   await check(middle);
   await tick(day-7200);await check(grandparent,middle,parent,child);
   await tick(7210);await accrue();
   const second=await book.lot(child.address,0);
   assert.equal(second.lastAccruedAt,first+BigInt(day));
   assert.equal(second.daily,units(14));assert.equal(second.compound,units('0.049'));
   assert.deepEqual(await Promise.all([parent,middle,grandparent].map(earned)),['1.4','0.35','0.42'].map(units));
   await reverts(vault.accrueDaily.staticCall(child.address,0));
   await confirmed(vault.connect(parent).requestReferral(units('0.7')));
   await confirmed(vault.rejectWithdrawal(0));
   await confirmed(vault.connect(parent).requestReferral(units('0.7')));
   await confirmed(vault.approveWithdrawal(1));await confirmed(vault.reserveExistingCash(1));
   const before=await token.balanceOf(parent.address);
   await confirmed(vault.payWithdrawal(1));
   assert.equal((await token.balanceOf(parent.address))-before,units('0.679'));
   assert.equal(await token.balanceOf(fees.address),units('0.021'));
   await reverts(vault.payWithdrawal.staticCall(1));
   await reverts(vault.connect(parent).requestReferral.staticCall(units('0.7')));
   await confirmed(vault.connect(child).reinvest(0,units(5)));
   assert.equal(await vault.positionCount(child.address),1n);
   assert.equal((await book.position(child.address)).lots,2n);
   assert.equal((await book.lot(child.address,1)).principal,units(5));
   assert.equal(await network.branchVolumeUsd(parent.address,child.address),units(1000));
   assert.equal(await vault.profitWithdrawalCap(child.address),units(100));
   assert.equal((await vault.cashStatus()).totalCashShortfall,0n);
  });

  await scenario('a late keeper pays the original eligible day and skips inactive days',async()=>{
   await fund(3000);
   await deposit(parent,100);await deposit(child,1000,parent.address);
   await check(parent,child);
   const opened=(await book.lot(child.address,0)).openedAt;
   await tick(2*day+120);
   assert.equal(await vault.isEligible(child.address),false);
   assert.equal(await vault.isEligible(parent.address),false);
   const block=await provider.getBlock('latest');
   const scan=await scanUnifiedAccrual({vault,book,blockNumber:block.number,blockTimestamp:block.timestamp,
    cursor:{member:0,position:0,lot:0},dailyPlan:true});
   const item=scan.selected.find(entry=>entry.member===child.address);
   assert.equal(item?.daily,units(7));
   assert.equal(item?.method,'accrueReinvestmentPage');
   const first=await vault.nextAccrual(child.address,opened);
   assert.deepEqual([...first],[opened+BigInt(day),70n,1n]);
   await confirmed(vault.setSuspended(child.address,true));
   await reverts(vault.accrueDaily.staticCall(child.address,0));
   await confirmed(vault.setSuspended(child.address,false));
   await check(child);
   await accrue();
   assert.equal((await vault.users(parent.address)).referralAvailable,units('0.7'));
   await reverts(vault.accrueDaily.staticCall(child.address,0));
   const afterGap=await vault.nextAccrual(child.address,first.due);
   assert.deepEqual([...afterGap],[opened+3n*BigInt(day),0n,0n]);
   await tick(day-100);
   await accrue();
   assert.equal((await book.lot(child.address,0)).daily,units(14));
   assert.equal((await vault.users(parent.address)).referralAvailable,units('0.7'));
   await reverts(vault.accrueDaily.staticCall(child.address,0));
  });

  await scenario('a qualified 500 to 510 deposit keeps the earned rate and balanced volume can repeat',async()=>{
   await fund(18000);
   await deposit(parent,500);
   for(const member of directs.slice(0,4))await deposit(member,1000,parent.address);
   assert.equal(await vault.effectiveDailyBps(parent.address),100n);
   await deposit(parent,10);
   assert.equal(await vault.effectiveDailyBps(parent.address),100n);
   const branches=directs.slice(0,2).map(s=>s.address);
   await confirmed(network.connect(parent).createRewardGroup(branches));await check(parent);
   for(const signer of directs.slice(0,2))await deposit(signer,4000,parent.address);
   await confirmed(vault.connect(parent).claimNetworkCycles(0,0,14,{gasLimit:12000000}));
   assert.equal((await network.cycleProgress(parent.address,0)).stage,14n);
   await reverts(vault.connect(parent).claimNetworkCycles.staticCall(0,0,1));
   await confirmed(vault.connect(parent).claimNetworkCycles(0,14,1));
   assert.equal(await vault.networkAvailable(parent.address),units(525));
   assert.equal((await network.cycleProgress(parent.address,0)).stage,15n);
  });
 }finally{provider.destroy();await rpc.disconnect();}
});
