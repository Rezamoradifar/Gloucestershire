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
import {MANUAL_REINVEST_PROFILE,UPLINE_RATES_PROFILE,UNIFIED_MANAGER,UNIFIED_TOKEN} from '../scripts/v3-unified-release-pins.mjs';

const units=value=>parseEther(String(value));
const mined=async pending=>{
 const receipt=await (await pending).wait();
 assert.equal(receipt.status,1);
 return receipt;
};

for(const profile of [MANUAL_REINVEST_PROFILE,UPLINE_RATES_PROFILE]){
test(profile.mode+': manual reinvestment, referral rates and funded withdrawals',{timeout:300000},async t=>{
 const uplineRates=profile===UPLINE_RATES_PROFILE;
 const {name,compile}=deploymentArtifact(profile);
 const artifacts=compile();
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000,timestampIncrement:1},wallet:{totalAccounts:10,unlockedAccounts:[UNIFIED_MANAGER]}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'global-manual-plan-'));
 const mine=()=>rpc.request({method:'evm_mine',params:[]});
 const advance=async(seconds=3601)=>{await rpc.request({method:'evm_increaseTime',params:[seconds]});await mine();};
 async function scenario(description,run){
  await t.test(description,async()=>{
   const id=await rpc.request({method:'evm_snapshot',params:[]});
   try{await run();}finally{assert.equal(await rpc.request({method:'evm_revert',params:[id]}),true);}
  });
 }
 try{
  const [operator,root,parent,member,second,third,fourth,eighth,ninth]=await provider.listAccounts();
  await rpc.request({method:'evm_setAccountBalance',params:[UNIFIED_MANAGER,toQuantity(units(5))]});
  const manager=await provider.getSigner(UNIFIED_MANAGER);
  const mock=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
  const tokenImplementation=await new ContractFactory(mock.abi,mock.evm.bytecode.object,operator).deploy(18);
  await tokenImplementation.waitForDeployment();
  await rpc.request({method:'evm_setAccountCode',params:[UNIFIED_TOKEN,await provider.getCode(tokenImplementation.target)]});
  for(let i=0;i<4;i++)await mine();
  const signer=new Wallet(Object.values(rpc.getInitialAccounts())[9].secretKey,provider);
  const proof=await deployUnifiedIsolated({provider,signer,directory,expectedDeployer:signer.address,profile,compile:()=>artifacts,
   waitReceipt:async(reader,hash)=>{for(let i=0;i<3;i++)await mine();return reader.getTransactionReceipt(hash);}});
  const sha='1'.repeat(40);
  const site=await planUnifiedPreviewSite({provider,proof,sourceSha:sha,expectedSourceSha:sha,profile});
  assert.equal(site.routeCandidate,profile.route);assert.equal(site.env.VITE_V3_UNIFIED_MODE,profile.mode);
  const vault=new Contract(proof.vault,artifacts[name].abi,manager);
  const network=new Contract(proof.network,artifacts.UnifiedNetworkPlan.abi,provider);
  const book=new Contract(proof.book,artifacts.SingleCapitalBook.abi,provider);
  const token=new Contract(UNIFIED_TOKEN,mock.abi,operator);
  const deposit=async(who,amount,referrer=ZeroAddress)=>{
   await mined(token.mint(who.address,units(amount)));
   await mined(token.connect(who).approve(vault.target,units(amount)));
   await mined(vault.connect(who).deposit(units(amount),referrer,{gasLimit:7000000}));
  };
  const accrue=()=>mined(vault.accrueReinvestmentPage(member.address,0,8,{gasLimit:3000000}));
  async function pay(who,request,gross,fee){
   const id=await vault.withdrawalCount();
   await mined(request());
   const item=await vault.withdrawalOf(id);
   assert.equal(item.gross,units(gross));assert.equal(item.fee,units(fee));
   await mined(vault.approveWithdrawal(id));
   await mined(token.mint(UNIFIED_MANAGER,item.gross));await mined(token.connect(manager).approve(vault.target,item.gross));
   await mined(vault.fundWithdrawal(id));
   const before=await token.balanceOf(who.address);
   await mined(vault.payWithdrawal(id,{gasLimit:2000000}));
   assert.equal(await token.balanceOf(who.address)-before,item.gross-item.fee);
  }
  await deposit(root,100);await deposit(parent,1000,root.address);
  await mined(vault.connect(member).register(parent.address));
  assert.equal(await network.rewardGroupCount(parent.address),0n);
  await deposit(member,1000,parent.address);
  for(const who of [root,parent,member])await mined(vault.connect(who).checkIn());
  await scenario('leaving 7 recorded earns exactly another 7 and still pays the eligible uplines',async()=>{
   await advance();await mined(vault.accrueDaily(member.address,0,{gasLimit:3000000}));
   assert.equal((await book.lot(member.address,0)).daily,units(7));
   await advance();await accrue();
   const lot=await book.lot(member.address,0);
   assert.equal(lot.principal,units(1000));assert.equal(lot.daily,units(14));assert.equal(lot.compound,0n);
   assert.equal((await vault.users(parent.address)).referralAvailable,units('1.40'));
   assert.equal((await vault.users(root.address)).referralAvailable,units(uplineRates?'.56':'.70'));
   await assert.rejects(vault.accrueDaily.staticCall(member.address,0),{code:'CALL_EXCEPTION'});
   await pay(member,()=>vault.connect(member).requestProfit(0,units(7)),7,'.14');
   assert.equal((await book.lot(member.address,0)).daily,units(7));
   await pay(parent,()=>vault.connect(parent).requestReferral(units('.70')),'.70','.014');
  });
  await scenario('manual reinvest spends 7 once and earns 7.049 on the same account after both lots mature',async()=>{
   await advance();await accrue();
   await mined(vault.connect(member).reinvest(0,units(7),{gasLimit:3000000}));
   assert.equal(await vault.positionCount(member.address),1n);
   assert.equal((await vault.positionOf(member.address,0)).principal,units(1007));
   assert.equal((await book.lot(member.address,0)).daily,0n);
   assert.equal((await book.lot(member.address,1)).principal,units(7));
   await assert.rejects(vault.connect(member).reinvest.staticCall(0,units(7)),{code:'CALL_EXCEPTION'});
   await assert.rejects(vault.accrueDaily.staticCall(member.address,0),{code:'CALL_EXCEPTION'});
   await advance();await accrue();
   const oldLot=await book.lot(member.address,0),newLot=await book.lot(member.address,1);
   assert.equal(oldLot.daily+newLot.daily,units('7.049'));assert.equal(oldLot.compound+newLot.compound,0n);
   assert.equal((await vault.users(parent.address)).referralAvailable,units('1.4049'));
   assert.equal((await network.rewardProgress(parent.address,0)).branches,1n);
  });
  await scenario('automatic group observes the branch cap, fresh stage volume, and the 2% network withdrawal fee',async()=>{
   assert.equal(await network.rewardGroupCount(parent.address),1n);
   assert.equal(network.interface.hasFunction('createRewardGroup'),false);
   assert.equal(network.interface.hasFunction('addRewardBranches'),false);
   const one=await network.rewardPreview(parent.address,0);
   assert.equal(one.eligible,false);assert.deepEqual([...one.consume],[units(300)]);
   await assert.rejects(vault.connect(parent).claimNetworkRewards.staticCall(0,0,1),{code:'CALL_EXCEPTION'});
   await deposit(second,200,parent.address);
   const ready=await network.rewardPreview(parent.address,0);
   assert.equal(ready.eligible,true);assert.deepEqual([...ready.consume],[units(300),units(200)]);
   await mined(vault.connect(parent).claimNetworkRewards(0,0,1,{gasLimit:3000000}));
   assert.equal(await vault.networkAvailable(parent.address),units(35));
   assert.equal((await network.rewardPreview(parent.address,0)).eligible,false);
   await deposit(second,400,parent.address);
   await mined(vault.connect(parent).claimNetworkRewards(0,1,1,{gasLimit:3000000}));
   assert.equal(await vault.networkAvailable(parent.address),units(105));
   assert.equal((await network.rewardBranch(parent.address,0,0)).consumedUsd,units(900));
   assert.equal((await network.rewardBranch(parent.address,0,1)).consumedUsd,units(600));
   // The next ancestor sees volume from the same intermediate branch exactly once.
   assert.equal((await network.rewardProgress(root.address,0)).branches,1n);
   await pay(parent,()=>vault.connect(parent).requestNetworkReward(units(100)),100,2);
  });
  await scenario('after stage 14 only a new direct branch opens a new group',async()=>{
   for(const who of [member,second,third]){
    if(who!==member)await mined(vault.connect(who).register(parent.address));
    await mined(vault.setVipKyc(who.address,true));await deposit(who,20000000,parent.address);
   }
   await mined(vault.connect(parent).claimNetworkRewards(0,0,14,{gasLimit:14000000}));
   await deposit(member,10,parent.address);
   assert.equal(await network.rewardGroupCount(parent.address),1n);
   await deposit(fourth,1000,parent.address);
   assert.equal(await network.rewardGroupCount(parent.address),2n);
   assert.equal((await network.rewardProgress(parent.address,0)).stage,14n);
   assert.equal((await network.rewardBranch(parent.address,1,0)).branch,fourth.address);
   assert.deepEqual([...(await network.rewardPreview(parent.address,1)).consume],[units(300)]);
  });
  await scenario('locked principal keeps its separate 90-day term and 30% deduction',async()=>{
   await assert.rejects(vault.connect(member).requestPrincipal.staticCall(0,units(1000)),{code:'CALL_EXCEPTION'});
   await advance(90*86400+1);
   await pay(member,()=>vault.connect(member).requestPrincipal(0,units(1000)),1000,300);
  });
  if(uplineRates){
   await scenario('each upline earns its own bracket at its permanent depth and only for new eligible postings',async()=>{
    await deposit(third,5000,member.address);
    await deposit(second,100,third.address);
    await deposit(fourth,1000,second.address);
    for(const who of [third,second,fourth])await mined(vault.connect(who).checkIn());
    const levels=[second,third,member,parent];
    const quoted=()=>Promise.all(levels.map((_,i)=>vault.currentReferralBps(fourth.address,i+1)));
    const balances=()=>Promise.all(levels.map(async who=>(await vault.users(who.address)).referralAvailable));
    await advance();
    await mined(vault.setPaused(true));
    assert.deepEqual(await quoted(),[0n,0n,0n,0n]);
    await mined(vault.setPaused(false));
    assert.deepEqual(await quoted(),[800n,600n,300n,0n]);
    const receipt=await mined(vault.accrueDaily(fourth.address,0,{gasLimit:3000000}));
    const events=receipt.logs.map(log=>vault.interface.parseLog(log)).filter(event=>event?.name==='ReferralClaimAccrued');
    assert.deepEqual(events.map(e=>[e.args.upline,e.args.source,e.args.level,e.args.amount]),[
     [second.address,fourth.address,1n,units('.56')],[third.address,fourth.address,2n,units('.42')],
     [member.address,fourth.address,3n,units('.21')]]);
    assert.equal((await book.lot(fourth.address,0)).daily,units(7));
    await deposit(second,500,third.address);
    await mined(vault.setSuspended(third.address,true));
    await advance();
    assert.deepEqual(await quoted(),[1000n,0n,300n,0n]);
    await mined(vault.accrueReinvestmentPage(fourth.address,0,8,{gasLimit:3000000}));
    assert.deepEqual(await balances(),['1.26','.42','.42',0].map(units));
    await assert.rejects(vault.accrueDaily.staticCall(fourth.address,0),{code:'CALL_EXCEPTION'});
    await advance(86400);
    for(const who of [fourth,member])await mined(vault.connect(who).checkIn());
    assert.deepEqual(await quoted(),[0n,0n,300n,0n]);
    await mined(vault.accrueDaily(fourth.address,0,{gasLimit:3000000}));
    assert.deepEqual(await balances(),['1.26','.42','.63',0].map(units));
   });
   await scenario('all five recipient bands at four depths, exact upper bounds, and VIP status for both parties',async()=>{
    const levels=[second,third,fourth,eighth];
    for(let i=levels.length-1;i>=0;i--){
     await deposit(levels[i],10,levels[i+1]?.address);
     await mined(vault.setVipKyc(levels[i].address,true));
     await mined(vault.connect(levels[i]).checkIn());
    }
    await deposit(ninth,1000,second.address);
    await mined(vault.connect(ninth).checkIn());
    const quote=()=>Promise.all(levels.map((_,i)=>vault.currentReferralBps(ninth.address,i+1)));
    await assert.rejects(vault.currentReferralBps(ninth.address,0),{code:'CALL_EXCEPTION'});
    await assert.rejects(vault.currentReferralBps(ninth.address,5),{code:'CALL_EXCEPTION'});
    assert.equal(await vault.currentReferralBps(eighth.address,1),0n);
    await mined(vault.setVipKyc(ninth.address,true));
    await deposit(ninth,50000,second.address);
    let previous=10;
    for(const [capital,rates] of [[10,[800,400,200,0]],[500,[800,400,200,0]],
     [510,[1000,500,300,0]],[2500,[1000,500,300,0]],[2510,[1200,600,400,0]],
     [10000,[1200,600,400,0]],[10010,[1400,700,500,0]],[50000,[1400,700,500,0]],
     [50010,[1600,800,600,400]]]){
     if(capital>previous)for(const [i,who] of levels.entries())await deposit(who,capital-previous,levels[i+1]?.address);
     previous=capital;
     assert.deepEqual(await quote(),rates.map(BigInt));
    }
    await advance();
    await mined(vault.accrueDaily(ninth.address,0,{gasLimit:3000000}));
    const base=(await book.position(ninth.address)).daily;
    for(const [i,who] of levels.entries()){
     assert.equal((await vault.users(who.address)).referralAvailable,base*[16n,8n,6n,4n][i]/100n);
    }
    await mined(vault.setVipKyc(eighth.address,false));
    assert.deepEqual(await quote(),[1600n,800n,600n,0n]);
    await mined(vault.setVipKyc(ninth.address,false));
    assert.deepEqual(await quote(),[0n,0n,0n,0n]);
    await assert.rejects(vault.accrueDaily.staticCall(ninth.address,0),{code:'CALL_EXCEPTION'});
    await mined(vault.setVipKyc(eighth.address,true));
    await deposit(operator,1000,second.address);
    await mined(vault.connect(operator).checkIn());
    assert.equal(await vault.currentReferralBps(operator.address,1),1600n);
    assert.equal(await vault.currentReferralBps(operator.address,4),0n);
    const before=(await vault.users(eighth.address)).referralAvailable;
    await advance();
    await mined(vault.accrueDaily(operator.address,0,{gasLimit:3000000}));
    assert.equal((await vault.users(eighth.address)).referralAvailable,before);
   });
   await scenario('manual reinvestment can cross a recipient band while uninvested earnings do not',async()=>{
    await deposit(second,500,parent.address);
    await deposit(fourth,1000,second.address);
    for(const who of [second,fourth])await mined(vault.connect(who).checkIn());
    await advance();
    await mined(vault.accrueDaily(second.address,0,{gasLimit:3000000}));
    assert.equal((await book.position(second.address)).daily,units('2.5'));
    assert.equal(await vault.currentReferralBps(fourth.address,1),800n);
    await mined(vault.accrueDaily(fourth.address,0,{gasLimit:3000000}));
    await mined(vault.connect(second).reinvest(0,units('2.5'),{gasLimit:3000000}));
    assert.equal((await vault.users(second.address)).capital,units('502.5'));
    assert.equal(await vault.currentReferralBps(fourth.address,1),1000n);
    await advance();
    await mined(vault.accrueDaily(fourth.address,0,{gasLimit:3000000}));
    assert.equal((await vault.users(second.address)).referralAvailable,units('1.26'));
   });
  }
 }finally{provider.destroy();await rpc.disconnect();fs.rmSync(directory,{recursive:true,force:true});}
});
}
