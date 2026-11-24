import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,Wallet,ZeroAddress,parseEther,toQuantity} from 'ethers';
import {deploymentArtifact} from '../scripts/v3-unified-deploy-preflight.mjs';
import {deployUnifiedIsolated} from '../scripts/deploy-v3-unified-isolated.mjs';
import {planUnifiedPreviewSite} from '../scripts/v3-unified-site-preview-preflight.mjs';
import {PORTFOLIO_PROFILE,UNIFIED_MANAGER,UNIFIED_FEE_RECEIVER,UNIFIED_TOKEN} from '../scripts/v3-unified-release-pins.mjs';

const units=v=>parseEther(String(v));
const mined=async tx=>(await tx).wait();
test('a portfolio request reserves, releases and pays one itemized amount', {timeout:300000}, async t=>{
 const artifacts=deploymentArtifact(PORTFOLIO_PROFILE).compile();
 const chain=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000,timestampIncrement:1},wallet:{unlockedAccounts:[UNIFIED_MANAGER]}});
 const provider=new BrowserProvider(chain,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'global-portfolio-'));
 const mine=()=>chain.request({method:'evm_mine',params:[]});
 const advance=async seconds=>{await chain.request({method:'evm_increaseTime',params:[seconds]});await mine();};
 async function scenario(name,run){
  await t.test(name,async()=>{
   const snapshot=await chain.request({method:'evm_snapshot',params:[]});
   try{await run();}finally{assert.equal(await chain.request({method:'evm_revert',params:[snapshot]}),true);}
  });
 }
 try{
  const [operator,member,child,other]=await provider.listAccounts();
  const mock=JSON.parse(fs.readFileSync('artifacts/MockToken.json'));
  const implementation=await new ContractFactory(mock.abi,mock.evm.bytecode.object,operator).deploy(18);
  await implementation.waitForDeployment();
  await chain.request({method:'evm_setAccountCode',params:[UNIFIED_TOKEN,await provider.getCode(implementation.target)]});
  await chain.request({method:'evm_setAccountBalance',params:[UNIFIED_MANAGER,toQuantity(units(5))]});
  const manager=await provider.getSigner(UNIFIED_MANAGER);
  for(let i=0;i<6;i++)await mine();
  const signer=new Wallet(Object.values(chain.getInitialAccounts())[8].secretKey,provider);
  const proof=await deployUnifiedIsolated({provider,signer,directory,expectedDeployer:signer.address,profile:PORTFOLIO_PROFILE,
   compile:()=>artifacts,waitReceipt:async(reader,hash)=>{for(let i=0;i<5;i++)await mine();return reader.getTransactionReceipt(hash);}});
  const sha='1'.repeat(40);
  const site=await planUnifiedPreviewSite({provider,proof,sourceSha:sha,expectedSourceSha:sha,profile:PORTFOLIO_PROFILE});
  assert.equal(site.routeCandidate,'/portfolio-test/');
  const vault=new Contract(proof.vault,artifacts.GlobalV3PortfolioTestnet.abi,manager);
  const book=new Contract(proof.book,artifacts.SingleCapitalBook.abi,provider);
  const token=new Contract(UNIFIED_TOKEN,mock.abi,operator);
  const account=vault.connect(member),who=member.address;
  for(const [owner,amount,referrer] of [[member,1000,ZeroAddress],[child,1000,who],[other,200,who]]){
   await mined(token.mint(owner.address,units(amount)));
   await mined(token.connect(owner).approve(vault.target,units(amount)));
   await mined(vault.connect(owner).deposit(units(amount),referrer,{gasLimit:7000000}));
   await mined(vault.connect(owner).checkIn());
  }
  await mined(account.claimNetworkRewards(0,0,1,{gasLimit:3000000}));
  await advance(3601);
  for(const owner of [child,member])await mined(vault.accrueDaily(owner.address,0,{gasLimit:3000000}));
  const earnings=[units(7),units('.7'),units(35),0n];
  const mixed=[...earnings.slice(0,3),units(10)];
  const request=parts=>mined(account.requestAccountWithdrawal(parts,0,0,{gasLimit:2800000}));
  const user=()=>vault.users(who);
  async function released(){
   const u=await user(),p=await book.position(who);
   assert.equal(u.referralAvailable,earnings[1]);assert.equal(u.referralReserved,0n);
   assert.equal(await vault.networkAvailable(who),earnings[2]);assert.equal(await vault.networkReserved(who),0n);
   assert.equal(p.daily,earnings[0]);assert.equal(p.reservedProfit,0n);assert.equal(p.reservedPrincipal,0n);
   assert.equal(u.pendingRequest,false);
  }
  await scenario('locked principal and stale splits roll back every ledger',async()=>{
   await assert.rejects(account.requestAccountWithdrawal.staticCall(mixed,0,0));
   await assert.rejects(account.requestAccountWithdrawal.staticCall([units(8),...earnings.slice(1)],0,0));
   assert.equal(await vault.withdrawalCount(),0n);await released();
  });
  await scenario('one shared cap applies even when each balance individually fits',async()=>{
   for(let i=0;i<10;i++){await advance(3602);await mined(vault.accrueDaily(who,0,{gasLimit:3000000}));}
   const profit=(await book.position(who)).daily,cap=await vault.profitWithdrawalCap(who);
   assert.ok(profit<cap&&profit+earnings[1]+earnings[2]>cap);
   await assert.rejects(account.requestAccountWithdrawal.staticCall([profit,...earnings.slice(1)],0,0));
   await request([cap-earnings[1]-earnings[2],...earnings.slice(1)]);
   assert.equal((await vault.withdrawalOf(0)).gross,cap);
  });
  await scenario('three earnings balances pay once with the 2% fee',async()=>{
   const before=await vault.profitLiability();
   const receipt=await request(earnings);
   const events=receipt.logs.filter(l=>l.address===vault.target).map(l=>vault.interface.parseLog(l));
   assert.equal(events.filter(e=>e.name==='WithdrawalRequested').length,1);
   assert.deepEqual([...(events.find(e=>e.name==='AccountWithdrawalAllocated').args)],[0n,who,...earnings]);
   const r=await vault.withdrawalOf(0);assert.equal(r.kind,4n);assert.equal(r.gross,units('42.7'));assert.equal(r.fee,units('.854'));
   assert.equal(await vault.userWithdrawalCount(who),1n);
   await assert.rejects(account.requestAccountWithdrawal.staticCall([0n,0n,1n,0n],0,0));
   await assert.rejects(vault.payWithdrawal.staticCall(0));
   await mined(vault.approveWithdrawal(0));await mined(token.mint(UNIFIED_MANAGER,r.gross));
   await mined(token.connect(manager).approve(vault.target,r.gross));await mined(vault.fundWithdrawal(0));
   await mined(vault.payWithdrawal(0));
   assert.equal(await token.balanceOf(who),units('41.846'));assert.equal(await token.balanceOf(UNIFIED_FEE_RECEIVER),r.fee);
   assert.equal(await vault.profitLiability(),before-r.gross);assert.equal((await user()).capital,units(1000));
   await assert.rejects(vault.payWithdrawal.staticCall(0));
  });
  await scenario('rejection and timed cancellation restore each source including mature principal',async()=>{
   await advance(90*86400);
   await request(mixed);
   await mined(vault.approveWithdrawal(0));await mined(vault.rejectWithdrawal(0));await released();
   await assert.rejects(account.requestAccountWithdrawal.staticCall(mixed,0,0));
   await advance(72*3600);await request(mixed);await assert.rejects(account.cancelWithdrawal.staticCall(1));
   await advance(72*3600);await mined(account.cancelWithdrawal(1));await released();
  });
  await scenario('mixed cash reservation protects principal and charges each part its rate',async()=>{
   await advance(90*86400);const prior=await vault.principalLiability(),liability=await vault.profitLiability();
   await request(mixed);const r=await vault.withdrawalOf(0);
   assert.equal(r.gross,units('52.7'));assert.equal(r.fee,units('3.854'));
   await mined(vault.approveWithdrawal(0));await mined(token.mint(vault.target,prior));
   await assert.rejects(vault.reserveExistingCash.staticCall(0));
   await mined(token.mint(vault.target,units('42.7')));await mined(vault.reserveExistingCash(0,{gasLimit:500000}));
   assert.equal(await vault.principalEscrowed(),units(10));assert.equal(await vault.reservedForPayout(),r.gross);
   await mined(vault.payWithdrawal(0));assert.equal(await token.balanceOf(who),units('48.846'));
   assert.equal((await book.lot(who,0)).principal,units(990));assert.equal((await user()).capital,units(990));
   assert.equal(await vault.principalLiability(),prior-units(10));assert.equal(await vault.profitLiability(),liability-units('42.7'));
   assert.equal(await vault.principalEscrowed(),0n);assert.equal(await vault.reservedForPayout(),0n);
  });
 }finally{provider.destroy();await chain.disconnect();fs.rmSync(directory,{recursive:true,force:true});}
});
