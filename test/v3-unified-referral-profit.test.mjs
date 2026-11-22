import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,Wallet,ZeroAddress,parseEther,toQuantity} from 'ethers';
import {deploymentArtifact} from '../scripts/v3-unified-deploy-preflight.mjs';
import {deployUnifiedIsolated} from '../scripts/deploy-v3-unified-isolated.mjs';
import {planUnifiedPreviewSite} from '../scripts/v3-unified-site-preview-preflight.mjs';
import {REFERRAL_PROFIT_PROFILE,UNIFIED_MANAGER,UNIFIED_TOKEN} from '../scripts/v3-unified-release-pins.mjs';

const units=value=>parseEther(String(value));
const confirmed=async pending=>{
 const receipt=await (await pending).wait();
 assert.equal(receipt.status,1);
 return receipt;
};

test('hourly single-account referral profit, deployment proof and user balances',{timeout:240000},async t=>{
 const {name,compile}=deploymentArtifact(REFERRAL_PROFIT_PROFILE);
 const artifacts=compile();
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000,timestampIncrement:1},wallet:{totalAccounts:10,unlockedAccounts:[UNIFIED_MANAGER]}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'global-referral-test-'));
 const mine=()=>rpc.request({method:'evm_mine',params:[]});
 try{
  const [operator,l4,l3,l2,l1,member,boundary]=await provider.listAccounts();
  await rpc.request({method:'evm_setAccountBalance',params:[UNIFIED_MANAGER,toQuantity(units(5))]});
  const manager=await provider.getSigner(UNIFIED_MANAGER);
  const mock=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
  const deployed=await new ContractFactory(mock.abi,mock.evm.bytecode.object,operator).deploy(18);
  await deployed.waitForDeployment();
  await rpc.request({method:'evm_setAccountCode',params:[UNIFIED_TOKEN,await provider.getCode(deployed.target)]});
  for(let i=0;i<4;i++)await mine();
  const signer=new Wallet(Object.values(rpc.getInitialAccounts())[9].secretKey,provider);
  const proof=await deployUnifiedIsolated({provider,signer,directory,expectedDeployer:signer.address,
   profile:REFERRAL_PROFIT_PROFILE,compile:()=>artifacts,waitReceipt:async(reader,hash)=>{
    for(let i=0;i<3;i++)await mine();
    return reader.getTransactionReceipt(hash);
   }});
  const sha='1'.repeat(40);
  const site=await planUnifiedPreviewSite({provider,proof,sourceSha:sha,expectedSourceSha:sha,profile:REFERRAL_PROFIT_PROFILE});
  assert.equal(site.routeCandidate,'/referral-profit-test/');
  assert.equal(site.env.VITE_V3_UNIFIED_MODE,'referral-profit-testnet');
  const vault=new Contract(proof.vault,artifacts[name].abi,manager);
  const book=new Contract(proof.book,artifacts.SingleCapitalBook.abi,provider);
  const token=new Contract(UNIFIED_TOKEN,mock.abi,operator);
  assert.equal(await vault.SINGLE_CAPITAL_VERSION(),3n);
  const levels=[l1,l2,l3,l4];
  const balances=()=>Promise.all(levels.map(async who=>(await vault.users(who.address)).referralAvailable));
  const deposit=async(who,amount,referrer=ZeroAddress)=>{
   await confirmed(token.mint(who.address,amount));
   await confirmed(token.connect(who).approve(vault.target,amount));
   await confirmed(vault.connect(who).deposit(amount,referrer,{gasLimit:3500000}));
  };
  const nextCycle=async()=>{await rpc.request({method:'evm_increaseTime',params:[3601]});await mine();};
  const accrue=()=>confirmed(vault.accrueReinvestmentPage(member.address,0,8,{gasLimit:3000000}));
  const scenario=(description,run)=>t.test(description,async()=>{
   const snapshot=await rpc.request({method:'evm_snapshot',params:[]});
   try{await run();}finally{assert.equal(await rpc.request({method:'evm_revert',params:[snapshot]}),true);}
  });
  await deposit(l4,units(100));await deposit(l3,units(100),l4.address);await deposit(l2,units(100),l3.address);
  await deposit(l1,units(100),l2.address);await deposit(member,units(1000),l1.address);
  for(const who of [...levels,member])await confirmed(vault.connect(who).checkIn());

  await scenario('the 7 unit example, repeated with personal compound and a referral withdrawal',async()=>{
   await nextCycle();
   const receipt=await confirmed(vault.accrueDaily(member.address,0,{gasLimit:3000000}));
   const awards=receipt.logs.map(log=>vault.interface.parseLog(log)).filter(event=>event?.name==='ReferralClaimAccrued');
   assert.deepEqual(awards.map(e=>[e.args.upline,e.args.source,e.args.level,e.args.amount]),[
    [l1.address,member.address,1n,units('.70')],[l2.address,member.address,2n,units('.35')],[l3.address,member.address,3n,units('.21')]]);
   assert.equal((await book.lot(member.address,0)).daily,units(7));
   await nextCycle();await accrue();
   const lot=await book.lot(member.address,0);
   assert.equal(lot.daily,units(14));assert.equal(lot.compound,units('.049'));
   assert.deepEqual(await balances(),['1.40','.70','.42',0].map(units));
   await assert.rejects(vault.accrueDaily.staticCall(member.address,0),{code:'CALL_EXCEPTION'});
   await confirmed(vault.connect(l1).requestReferral(units('.70')));
   assert.equal((await vault.users(l1.address)).referralReserved,units('.70'));
   assert.deepEqual(await balances(),['.70','.70','.42',0].map(units));
   await confirmed(vault.rejectWithdrawal(0));
   assert.deepEqual(await balances(),['1.40','.70','.42',0].map(units));
  });

  await scenario('an inactive level earns zero, a higher level keeps its slot and its own rate',async()=>{
   await confirmed(vault.setSuspended(l2.address,true));
   await nextCycle();await accrue();
   assert.deepEqual(await balances(),['.70',0,'.21',0].map(units));
   await confirmed(vault.setSuspended(l2.address,false));await confirmed(vault.connect(l2).checkIn());
   await nextCycle();await accrue();
   assert.deepEqual(await balances(),['1.40','.35','.42',0].map(units));
  });

  await scenario('level four requires both a VIP earner and an eligible KYC-approved VIP recipient',async()=>{
   await confirmed(vault.setVipKyc(l4.address,true));await deposit(l4,units(50000));
   await nextCycle();await accrue();
   assert.equal((await vault.users(l4.address)).referralAvailable,0n);
   await confirmed(vault.setVipKyc(member.address,true));await deposit(member,units(50000),l1.address);
   assert.equal(await vault.positionCount(member.address),1n);
   await nextCycle();await accrue();
   assert.deepEqual(await balances(),['106.78','53.39','39.99','26.52'].map(units));
   await confirmed(vault.setVipKyc(l4.address,false));
   await nextCycle();await accrue();
   assert.equal((await vault.users(l4.address)).referralAvailable,units('26.52'));
   assert.equal((await vault.users(l1.address)).referralAvailable,units('212.86'));
   await confirmed(vault.setVipKyc(member.address,false));await nextCycle();
   await assert.rejects(vault.accrueDaily.staticCall(member.address,0),{code:'CALL_EXCEPTION'});
  });

  await scenario('all twenty rate entries and inclusive upper bounds come from the earner',async()=>{
   const rates=[[800,400,200,0],[1000,500,300,0],[1200,600,400,0],[1400,700,500,0],[1600,800,600,400]];
   for(const [tier,row] of rates.entries())
    assert.deepEqual(await Promise.all(row.map((_,level)=>vault.referralBps(tier,level))),row.map(BigInt));
   await confirmed(vault.connect(boundary).register(ZeroAddress));await confirmed(vault.setVipKyc(boundary.address,true));
   for(const [amount,tier] of [[units(10),0],[units(500),0],[units(500)+1n,1],[units(2500),1],[units(2500)+1n,2],
    [units(10000),2],[units(10000)+1n,3],[units(50000),3],[units(50000)+1n,4]]){
    const snapshot=await rpc.request({method:'evm_snapshot',params:[]});
    await deposit(boundary,amount);assert.equal(await vault.tierOf(boundary.address),BigInt(tier));
    assert.equal(await rpc.request({method:'evm_revert',params:[snapshot]}),true);
   }
  });
 }finally{provider.destroy();await rpc.disconnect();fs.rmSync(directory,{recursive:true,force:true});}
});
