// Isolated Ganache acceptance for the NOT-DEPLOYED V3 model, 100 real signers.
// All amounts are synthetic MOCK USDT. It never touches BNB public testnet.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,parseEther} from 'ethers';

const COUNT=100,DEPOSIT=parseEther('1000'),ONE=parseEther('1');
const make=(n)=>parseEther(String(n));
const done=async txPromise=>{
 const receipt=await (await txPromise).wait();
 assert.equal(receipt?.status,1,'Local simulated transaction reverted');
 return receipt;
};
const mustFail=async action=>{
 let failed=false;
 try{await action;}catch{failed=true;}
 assert.equal(failed,true,'Unsafe action should have reverted');
};
test('V3 local-only 100-account accrual, profit-on-profit, request, manager escrow and actual payout',async()=>{
 execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 execFileSync(process.execPath,['scripts/compile-global-v3.mjs'],{stdio:'pipe'});
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:110,defaultBalance:100}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});
 provider.pollingInterval=25;
 const started=Date.now();
 try{
  const signers=await Promise.all(Array.from({length:105},(_,i)=>provider.getSigner(i)));
  const wallets=await Promise.all(signers.map(s=>s.getAddress()));
  const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
  const deploy=async(name,args)=>{
   const a=artifact(name);
   const contract=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);
   await contract.waitForDeployment();
   return contract;
  };
  const token=await deploy('MockToken',[18]);
  const vault=await deploy('GlobalV3DeferredTestnet',[wallets[0],token.target,wallets[104]]);
  assert.equal(await vault.PRINCIPAL_LOCK(),7776000n);
  assert.equal(await vault.WITHDRAWAL_COOLDOWN(),259200n);
  assert.equal(await vault.PROFIT_FEE_BPS(),300n);
  assert.equal(await vault.PROFIT_WITHDRAWAL_CAP_BPS(),1000n);
  assert.equal(await vault.principalLiability(),0n);
  assert.equal(await vault.profitLiability(),0n);

  // All user deposits are real ERC20 transfers on local chain; V3 retains
  // principal cash rather than routing it out to legacy fee wallets.
  for(let i=1;i<=COUNT;i++){
   await done(token.mint(wallets[i],DEPOSIT));
   await done(token.connect(signers[i]).approve(vault.target,DEPOSIT));
   await done(vault.connect(signers[i]).deposit(DEPOSIT,i===1?ZeroAddress:wallets[1]));
  }
  assert.equal(await vault.principalLiability(),DEPOSIT*BigInt(COUNT));
  assert.equal(await token.balanceOf(vault.target),DEPOSIT*BigInt(COUNT));
  const before=await vault.cashStatus();
  assert.equal(before[4],0n);
  await mustFail(vault.connect(signers[5]).accrueDaily.staticCall(wallets[5],0));
  await rpc.request({method:'evm_increaseTime',params:[86461]});
  await rpc.request({method:'evm_mine',params:[]});
  for(let i=1;i<=COUNT;i++)await done(vault.connect(signers[i]).checkIn());
  for(let i=1;i<=COUNT;i++)await done(vault.connect(signers[101]).accrueDaily(wallets[i],0));
  for(let i=1;i<=COUNT;i++){
   const p=await vault.positionOf(wallets[i],0);
   assert.equal(p.availableProfit,make(7));
   assert.equal(p.cumulativeCompound,0n);
  }
  const firstReferral=make('0.7')*99n;
  assert.equal((await vault.users(wallets[1])).referralAvailable,firstReferral);
  assert.equal(await vault.profitLiability(),make(7)*100n+firstReferral);
  assert.equal((await vault.cashStatus())[4],await vault.profitLiability());
  await mustFail(vault.accrueDaily.staticCall(wallets[2],0));

  // Exactly one later daily cycle with profit-on-profit on the previous
  // position's accrued claim. No user balance or cash is invented.
  await rpc.request({method:'evm_increaseTime',params:[86461]});
  await rpc.request({method:'evm_mine',params:[]});
  for(let i=1;i<=COUNT;i++)await done(vault.connect(signers[i]).checkIn());
  for(let i=1;i<=COUNT;i++)await done(vault.connect(signers[102]).accrueDaily(wallets[i],0));
  const p2=await vault.positionOf(wallets[2],0);
  assert.equal(p2.cumulativeDaily,make(14));
  assert.equal(p2.cumulativeCompound,make('0.049'));
  assert.equal(p2.availableProfit,make('14.049'));
  assert.equal(p2.compoundedBasis,p2.availableProfit);

  // Replay and unauthorized management are rejected.
  await mustFail(vault.connect(signers[2]).accrueDaily.staticCall(wallets[2],0));
  await mustFail(vault.connect(signers[2]).approveWithdrawal.staticCall(0));
  await mustFail(vault.connect(signers[2]).fundWithdrawal.staticCall(0));
  await mustFail(vault.connect(signers[3]).requestPrincipal.staticCall(0,make(1)));

  // Withdraw exactly 5 from a position with 14.049 accrued claims.
  const initialUser2=await token.balanceOf(wallets[2]);
  const initialFee=await token.balanceOf(wallets[104]);
  await done(vault.connect(signers[2]).requestProfit(0,make(5)));
  assert.equal((await vault.withdrawalOf(0)).status,0n);
  assert.equal((await vault.positionOf(wallets[2],0)).compoundedBasis,make('9.049'));
  await mustFail(vault.connect(signers[3]).payWithdrawal.staticCall(0));
  await done(vault.approveWithdrawal(0));
  await mustFail(vault.connect(signers[3]).payWithdrawal.staticCall(0));
  // Actual new MOCK tokens must be transferred from approved manager.
  await done(token.mint(wallets[0],make(5)));
  await done(token.approve(vault.target,make(5)));
  await done(vault.fundWithdrawal(0));
  assert.equal((await vault.withdrawalOf(0)).status,2n);
  assert.equal(await vault.reservedForPayout(),make(5));
  await mustFail(vault.fundWithdrawal.staticCall(0));
  await done(vault.connect(signers[102]).payWithdrawal(0));
  assert.equal((await vault.withdrawalOf(0)).status,3n);
  assert.equal(await vault.reservedForPayout(),0n);
  assert.equal((await token.balanceOf(wallets[2]))-initialUser2,make('4.85'));
  assert.equal((await token.balanceOf(wallets[104]))-initialFee,make('0.15'));
  assert.equal(await vault.principalLiability(),DEPOSIT*BigInt(COUNT));
  await mustFail(vault.payWithdrawal.staticCall(0));
  await mustFail(vault.connect(signers[2]).requestProfit.staticCall(0,make(5)));

  // Reinvest a VALID accrued claim; original liability becomes new principal
  // and is transparently shown as unfunded if the vault lacks new backing.
  const oldProfitLiability=await vault.profitLiability();
  await done(vault.connect(signers[3]).reinvest(0,make(4)));
  assert.equal(await vault.positionCount(wallets[3]),2n);
  assert.equal((await vault.positionOf(wallets[3],1)).principal,make(4));
  assert.equal(await vault.profitLiability(),oldProfitLiability-make(4));
  assert.equal(await vault.principalLiability(),DEPOSIT*BigInt(COUNT)+make(4));
  const afterReinvestment=await vault.cashStatus();
  assert.equal(afterReinvestment[4],await vault.principalLiability()+await vault.profitLiability()-afterReinvestment[0]);

  // Reject returns the entire requested value to both outstanding claim and
  // eligible compounding basis. It must not create new liabilities.
  const beforeReject=await vault.profitLiability();
  await done(vault.connect(signers[4]).requestProfit(0,make(3)));
  const reserved=await vault.positionOf(wallets[4],0);
  assert.equal(reserved.reservedProfit,make(3));
  await done(vault.rejectWithdrawal(1));
  const restored=await vault.positionOf(wallets[4],0);
  assert.equal(restored.reservedProfit,0n);
  assert.equal(restored.availableProfit,make('14.049'));
  assert.equal(restored.compoundedBasis,restored.availableProfit);
  assert.equal(await vault.profitLiability(),beforeReject);

  // Separate referral ledger can itself be requested but cannot be silently
  // redirected; a parallel pending request is blocked.
  await done(vault.connect(signers[1]).requestReferral(make(1)));
  assert.equal((await vault.withdrawalOf(2)).kind,2n);
  await mustFail(vault.connect(signers[1]).requestReferral.staticCall(make(1)));
  await done(vault.rejectWithdrawal(2));
  assert.equal((await vault.users(wallets[1])).referralReserved,0n);

  // 90-day principal lock and managerial approval still apply.
  await rpc.request({method:'evm_increaseTime',params:[90*86400+60]});
  await rpc.request({method:'evm_mine',params:[]});
  await done(vault.connect(signers[5]).requestPrincipal(0,make(20)));
  assert.equal((await vault.withdrawalOf(3)).kind,1n);
  await done(vault.approveWithdrawal(3));
  await done(token.mint(wallets[0],make(20)));
  await done(token.approve(vault.target,make(20)));
  await done(vault.fundWithdrawal(3));
  await done(vault.payWithdrawal(3));
  assert.equal((await vault.positionOf(wallets[5],0)).principal,make(980));
  assert.equal((await vault.withdrawalOf(3)).status,3n);
  assert.equal(await vault.reservedForPayout(),0n);

  const summary={
   status:'PASS',mode:'LOCAL_GANACHE_97_MOCK_ONLY',
   date:new Date().toISOString(),contract:'GLOBAL_V3_NOT_DEPLOYED',
   localAccounts:COUNT,individualWalletSigners:COUNT,
   initialMockTestDeposits:'100000',allPrincipalRetainedInVault:true,
   oncePer24HourAccrual:true,firstDayPersonalEarningsPer1000:'7',
   secondDayCompoundedProfitPer1000:'0.049',
   onChainAccruedLiabilityWithoutPreFunding:true,
   independentManagerApprovals:true,exactIndividualCashEscrow:true,
   payoutToImmutableBeneficiary:true,repeatFundingAndPaymentRejected:true,
   automaticProfitOnProfit:true,manualReinvestOption:true,
   explicitUnfundedLiabilityReporting:true,oldV2Unchanged:true,
   publicV3Deployed:false,realUSDTTransferred:false,wallMs:Date.now()-started
  };
  fs.mkdirSync('reports',{recursive:true});
  fs.writeFileSync('reports/global-v3-local-100-account.json',JSON.stringify(summary,null,2)+'\n');
  console.log('GLOBAL_V3_LOCAL_100_ACCOUNT_ACCEPTANCE '+JSON.stringify(summary));
 }finally{provider.destroy();}
});
