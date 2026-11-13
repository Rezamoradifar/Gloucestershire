// Isolated 97-only prototype tests: no real wallets, assets, deployments or public funds.
import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,MaxUint256,keccak256,toUtf8Bytes,parseEther as E} from 'ethers';

execFileSync(process.execPath,['scripts/compile-global-v2.mjs'],{stdio:'pipe'});
const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const id=value=>keccak256(toUtf8Bytes(value));
const tx=async call=>(await call).wait();
let rpc,provider,signers,addresses,token,feed,vault,snapshot;
async function deploy(name,args=[]){
 const a=artifact(name),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);
 await c.waitForDeployment();return c;
}
const advance=async seconds=>{
 await rpc.request({method:'evm_increaseTime',params:[seconds]});
 await rpc.request({method:'evm_mine',params:[]});
};
const missing=async(promise,errorName)=>{
 try{await promise;assert.fail('Expected revert '+errorName);}
 catch(e){
  if(e?.code==='ERR_ASSERTION')throw e;
  let reason=e?.revert?.name;
  try{reason??=vault.interface.parseError(e?.data)?.name;}catch{}
  assert.equal(reason,errorName,String(e).slice(0,500));
 }
};
async function deposit(index,amount,referrer=ZeroAddress,asset=token.target){
 if(asset===ZeroAddress)return tx(vault.connect(signers[index]).deposit(asset,E(amount),referrer,{value:E(amount)}));
 await tx(token.mint(addresses[index],E(amount)));
 return tx(vault.connect(signers[index]).deposit(asset,E(amount),referrer));
}
async function active(index){await tx(vault.connect(signers[index]).checkIn());}
async function settle(source,amount,proof='test-funded-1',asset=token.target){
 const parent=Number(source);
 return tx(vault.connect(signers[10]).settleFundedEarnings(addresses[parent],0,E(amount),id(proof),
  asset===ZeroAddress?{value:E(amount)}:{}));
}
async function initFamily(){
 await deposit(1,'500');
 await deposit(2,'1000',addresses[1]);
 await active(1);await active(2);
 await advance(86401);
 await active(1);await active(2);
}
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000},wallet:{totalAccounts:20}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:20},(_,i)=>provider.getSigner(i)));
 addresses=await Promise.all(signers.map(s=>s.getAddress()));
 token=await deploy('MockToken',[18]);
 feed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('GlobalV2Prototype',[addresses[0],token.target,feed.target,feed.target,604800,addresses[11]]);
 assert.ok(artifact('GlobalV2Prototype').evm.deployedBytecode.object.length/2<=24576);
 await tx(vault.grantRole(await vault.REVENUE_FUNDER_ROLE(),addresses[10]));
 await tx(token.mint(addresses[10],E('1000000')));
 await tx(token.connect(signers[10]).approve(vault.target,MaxUint256));
 await tx(token.connect(signers[11]).approve(vault.target,MaxUint256));
 for(let i=1;i<=9;i++)await tx(token.connect(signers[i]).approve(vault.target,MaxUint256));
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{
 await rpc.request({method:'evm_revert',params:[snapshot]});
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('contract roles, rate, fee, cooldown and manual KYC have the exact requested boundaries',async()=>{
 assert.equal(await vault.PROFIT_FEE_BPS(),300n);
 assert.equal(await vault.WITHDRAWAL_COOLDOWN(),259200n);
 assert.equal(await vault.PRINCIPAL_LOCK(),7776000n);
 assert.equal(await vault.PRINCIPAL_PENALTY_BPS(),3000n);
 assert.equal(await vault.PROFIT_WITHDRAWAL_CAP_BPS(),1000n);
 assert.equal(await vault.memberCount(),0n);
 assert.equal(await vault.hasRole(await vault.KYC_ADMIN_ROLE(),addresses[10]),false);
 assert.equal(await vault.hasRole(await vault.REVENUE_FUNDER_ROLE(),addresses[10]),true);
 assert.equal(vault.interface.hasFunction('batchProfit'),false);
 assert.equal(vault.interface.hasFunction('autoReinvest'),false);
});

test('gross deposit remains 100% recorded while 10%+10%+80% is physically routed away',async()=>{
 const f1=await vault.FEE_WALLET_1(),f2=await vault.FEE_WALLET_2();
 const before=await Promise.all([f1,f2,addresses[11]].map(a=>token.balanceOf(a)));
 await deposit(1,'1000');
 const a=await vault.accounts(addresses[1],token.target);
 assert.equal(a.principal,E('1000'));assert.equal(a.externalDeposited,E('1000'));
 const balances=await Promise.all([f1,f2,addresses[11]].map(a=>token.balanceOf(a)));
 assert.deepEqual(balances.map((v,i)=>v-before[i]),[E('100'),E('100'),E('800')]);
 assert.equal(await vault.assetBalance(token.target),0n);
 assert.equal(await vault.principalLiability(token.target),E('1000'));
 assert.equal(await vault.unfundedPrincipal(token.target),E('1000'));
 assert.equal((await vault.users(addresses[1])).registered,true);
 assert.equal(await vault.memberCount(),1n);
});

test('activity is on-chain and expires after 24h without a stale stored active flag',async()=>{
 await deposit(1,'100');
 assert.equal(await vault.isEligible(addresses[1]),false);
 await active(1);
 assert.equal(await vault.isEligible(addresses[1]),true);
 assert.equal((await vault.users(addresses[1])).vipKyc,false);
 await missing(vault.connect(signers[10]).setVipKyc.staticCall(addresses[1],true),'AccessControlUnauthorizedAccount');
 await tx(vault.setVipKyc(addresses[1],true));
 assert.equal((await vault.users(addresses[1])).vipKyc,true);
 await advance(86401);
 assert.equal(await vault.isEligible(addresses[1]),false);
 await active(1);
 assert.equal(await vault.isEligible(addresses[1]),true);
});

test('one funded event atomically records personal profit AND eligible tier-based upline referral',async()=>{
 await initFamily();
 const feeWallet=await token.balanceOf(await vault.WITHDRAWAL_FEE_WALLET());
 const old=await token.balanceOf(vault.target);
 await settle(2,'5');
 const mine=await vault.accounts(addresses[2],token.target);
 const parent=await vault.accounts(addresses[1],token.target);
 // Source is tier 1 (1000 USD); referral rate to parent is 10% of funded personal profit.
 assert.equal(mine.profit,E('5'));
 assert.equal(parent.profit,E('0.5'));
 assert.equal(await vault.profitLiability(token.target),E('5.5'));
 assert.equal((await token.balanceOf(vault.target))-old,E('5.5'));
 assert.equal(await token.balanceOf(await vault.WITHDRAWAL_FEE_WALLET()),feeWallet);
 assert.equal(await vault.usedRevenueProof(id('test-funded-1')),true);
 await missing(vault.connect(signers[10]).settleFundedEarnings.staticCall(addresses[2],0,E('5'),id('test-funded-1')),'Ineligible');
 await missing(vault.connect(signers[10]).settleFundedEarnings.staticCall(addresses[2],0,E('5'),id('different-proof')),'Locked');
});

test('all four uplines receive exact source-tier referral shares when VIP and KYC rules are met',async()=>{
 await tx(vault.connect(signers[1]).register(ZeroAddress));
 await tx(vault.setVipKyc(addresses[1],true));
 await deposit(1,'50001');
 for(let i=2;i<=4;i++)await deposit(i,'100',addresses[i-1]);
 await tx(vault.connect(signers[5]).register(addresses[4]));
 await tx(vault.setVipKyc(addresses[5],true));
 await deposit(5,'50001',addresses[4]);
 for(let i=1;i<=5;i++)await active(i);
 await advance(86401);
 for(let i=1;i<=5;i++)await active(i);
 await settle(5,'10','four-level-funded');
 assert.equal((await vault.accounts(addresses[5],token.target)).profit,E('10'));
 assert.equal((await vault.accounts(addresses[4],token.target)).profit,E('1.6'));
 assert.equal((await vault.accounts(addresses[3],token.target)).profit,E('0.8'));
 assert.equal((await vault.accounts(addresses[2],token.target)).profit,E('0.6'));
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('0.4'));
 assert.equal(await vault.profitLiability(token.target),E('13.4'));
});

test('ineligible referrer never gets a referral credit; no robot can make it active',async()=>{
 await deposit(1,'500');await deposit(2,'1000',addresses[1]);
 await active(1);await active(2);
 await advance(86401);
 await active(2);
 await settle(2,'5');
 assert.equal((await vault.accounts(addresses[2],token.target)).profit,E('5'));
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,0n);
 assert.equal(await vault.profitLiability(token.target),E('5'));
});

test('daily rate cap rejects over-credit and no funder amount can exceed one day of base accrual',async()=>{
 await deposit(1,'1000');await active(1);await advance(86401);await active(1);
 assert.equal(await vault.tierOf(addresses[1]),1n);
 assert.equal(await vault.baseDailyBps(1),70n);
 await missing(vault.connect(signers[10]).settleFundedEarnings.staticCall(addresses[1],0,E('8'),id('too-high')),'Insufficient');
 assert.equal(await vault.usedRevenueProof(id('too-high')),false);
 await settle(1,'7','valid-max');
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('7'));
});

test('reinvestment cannot occur automatically and only the wallet can reinvest credited profit',async()=>{
 await deposit(1,'1000');await active(1);await advance(86401);await active(1);
 await settle(1,'5');
 const before=await vault.positionCount(addresses[1]);
 await missing(vault.connect(signers[2]).reinvest.staticCall(token.target,E('1')),'Insufficient');
 await tx(vault.connect(signers[1]).reinvest(token.target,E('3')));
 assert.equal(await vault.positionCount(addresses[1]),before+1n);
 const a=await vault.accounts(addresses[1],token.target);
 assert.equal(a.principal,E('1003'));assert.equal(a.profit,E('2'));assert.equal(a.reinvested,E('3'));
 assert.equal(await vault.principalLiability(token.target),E('1003'));
 assert.equal(await vault.profitLiability(token.target),E('2'));
});

test('withdrawals always need approval and are paid only to the original user at 3% fee',async()=>{
 await deposit(1,'1000');await active(1);await advance(86401);await active(1);await settle(1,'5');
 await tx(vault.connect(signers[1]).requestWithdrawal(token.target,E('5'),false,0));
 const r=await vault.withdrawalOf(0);
 assert.equal(r.user,addresses[1]);assert.equal(r.gross,E('5'));assert.equal(r.fee,E('0.15'));
 assert.equal(r.status,0n);
 await missing(vault.payWithdrawal.staticCall(0),'WrongState');
 await missing(vault.connect(signers[10]).approveWithdrawal.staticCall(0),'AccessControlUnauthorizedAccount');
 await tx(vault.approveWithdrawal(0));
 const before=await token.balanceOf(addresses[1]);
 const feeBefore=await token.balanceOf(await vault.WITHDRAWAL_FEE_WALLET());
 await tx(vault.connect(signers[3]).payWithdrawal(0));
 assert.equal((await token.balanceOf(addresses[1]))-before,E('4.85'));
 assert.equal((await token.balanceOf(await vault.WITHDRAWAL_FEE_WALLET()))-feeBefore,E('0.15'));
 assert.equal((await vault.withdrawalOf(0)).status,2n);
 assert.equal(await vault.profitLiability(token.target),0n);
 await missing(vault.payWithdrawal.staticCall(0),'WrongState');
});

test('principal claim is locked for 90 days, requires admin, and cannot spend profit reserves',async()=>{
 await deposit(1,'1000');
 await missing(vault.connect(signers[1]).requestWithdrawal.staticCall(token.target,E('100'),true,0),'Insufficient');
 await advance(90*86400+1);
 await tx(vault.connect(signers[1]).requestWithdrawal(token.target,E('100'),true,0));
 assert.equal((await vault.withdrawalOf(0)).fee,E('30'));
 await tx(vault.approveWithdrawal(0));
 await missing(vault.payWithdrawal.staticCall(0),'InsufficientCash');
 await tx(token.mint(addresses[11],E('100')));
 await tx(vault.connect(signers[11]).fundPrincipalLiquidity(token.target,E('100')));
 const old=await token.balanceOf(addresses[1]);
 await tx(vault.connect(signers[5]).payWithdrawal(0));
 assert.equal((await token.balanceOf(addresses[1]))-old,E('70'));
 assert.equal((await vault.accounts(addresses[1],token.target)).principal,E('900'));
 assert.equal(await vault.unfundedPrincipal(token.target),E('900'));
});

test('manager rejection and user cancellation safely restore pending profit without payment',async()=>{
 await deposit(1,'1000');await active(1);await advance(86401);await active(1);await settle(1,'5');
 await tx(vault.connect(signers[1]).requestWithdrawal(token.target,E('3'),false,0));
 await tx(vault.rejectWithdrawal(0,id('review-rejected')));
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('5'));
 assert.equal((await vault.withdrawalOf(0)).status,4n);
 await missing(vault.payWithdrawal.staticCall(0),'WrongState');
 await advance(72*3600+1);
 await tx(vault.connect(signers[1]).requestWithdrawal(token.target,E('4'),false,0));
 await missing(vault.connect(signers[1]).cancelWithdrawal.staticCall(1),'Forbidden');
 await advance(72*3600+1);
 await tx(vault.connect(signers[1]).cancelWithdrawal(1));
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('5'));
 assert.equal((await vault.withdrawalOf(1)).status,3n);
});


test('only a KYC administrator may unlock VIP-sized deposits; suspended members cannot add capital',async()=>{
 await tx(vault.connect(signers[1]).register(ZeroAddress));
 await missing(vault.connect(signers[1]).deposit.staticCall(token.target,E('50001'),ZeroAddress),'Forbidden');
 await missing(vault.connect(signers[10]).setVipKyc.staticCall(addresses[1],true),'AccessControlUnauthorizedAccount');
 await tx(vault.setVipKyc(addresses[1],true));
 await deposit(1,'50001');
 assert.equal(await vault.tierOf(addresses[1]),4n);
 await tx(vault.setSuspended(addresses[1],true));
 await missing(vault.connect(signers[1]).deposit.staticCall(token.target,E('10'),ZeroAddress),'Forbidden');
});

test('asset support includes BNB, with the same 20/80 routing and cash-backed profit',async()=>{
 await deposit(1,'100',ZeroAddress,ZeroAddress);
 assert.equal((await vault.accounts(addresses[1],ZeroAddress)).principal,E('100'));
 assert.equal(await vault.assetBalance(ZeroAddress),0n);
 await active(1);await advance(86401);await active(1);
 await tx(vault.connect(signers[10]).settleFundedEarnings(addresses[1],0,E('0.4'),id('native-profit'),{value:E('0.4')}));
 assert.equal((await vault.accounts(addresses[1],ZeroAddress)).profit,E('0.4'));
 assert.equal(await vault.profitLiability(ZeroAddress),E('0.4'));
});
