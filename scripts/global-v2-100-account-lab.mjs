// Local-only, deterministic-scale stress lab for Global V2.
// IMPORTANT: All 100 accounts and all "USDT" amounts are MOCK test fixtures.
// This script never imports a server key, sends a public-chain transaction,
// migrates a customer balance or changes the deployed Global V2 testnet vault.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,MaxUint256,ZeroAddress,parseEther,keccak256,toUtf8Bytes} from 'ethers';

const COUNT=100;
const INITIAL_AMOUNT=parseEther('10000');
const TREASURY_AMOUNT=parseEther('500000');
const PERSONAL_DAILY=parseEther('90');
const WITHDRAW_EACH=parseEther('40');
const FEE_EACH=parseEther('1.2');
const NET_EACH=parseEther('38.8');
const ASSERT=(cond,message)=>assert.ok(cond,message);
const tx=async promise=>{
 const receipt=await (await promise).wait();
 assert.equal(receipt?.status,1,'Simulated transaction failed');
 return receipt;
};
const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
const reference=label=>keccak256(toUtf8Bytes('GLOBAL_V2_100_ACCOUNT_LAB_ONLY:'+label));
const parentIndex=i=>i<=1?0:Math.floor((i-2)/3)+1;
const rates=[1200n,600n,400n,0n];
function expectedReferralFor(i,parents){
 let cursor=parents[i],index=0,sum=0n;
 while(cursor&&index<4){
  const share=PERSONAL_DAILY*rates[index]/10000n;
  sum+=share;
  cursor=parents[cursor];
  index++;
 }
 return sum;
}
async function mustRevert(request,error){
 let caught;
 try{await request;}catch(e){caught=e;}
 ASSERT(caught,'Expected revert: '+error);
 const message=String(caught?.shortMessage||caught?.message||caught);
 ASSERT(message.includes(error)||caught?.revert?.name===error,'Unexpected revert: '+message.slice(0,300));
}
async function main(){
 execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 execFileSync(process.execPath,['scripts/compile-global-v2.mjs'],{stdio:'pipe'});
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:110,defaultBalance:100}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});
 provider.pollingInterval=10;
 let report;
 try{
  const signers=await Promise.all(Array.from({length:105},(_,i)=>provider.getSigner(i)));
  const addresses=await Promise.all(signers.map(x=>x.getAddress()));
  const deploy=async(name,args=[])=>{
   const a=artifact(name);
   const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);
   await c.waitForDeployment();return c;
  };
  const token=await deploy('MockToken',[18]);
  const feed=await deploy('MockFeed',[100000000n]);
  const vault=await deploy('GlobalV2Prototype',[
   addresses[0],token.target,feed.target,feed.target,604800,addresses[103]
  ]);
  await tx(vault.grantRole(await vault.REVENUE_FUNDER_ROLE(),addresses[101]));
  await tx(token.mint(addresses[101],parseEther('50000')));
  await tx(token.connect(signers[101]).approve(vault.target,MaxUint256));
  const parents=Array(COUNT+1).fill(0),expectedProfits=Array(COUNT+1).fill(0n),expectedPersonal=Array(COUNT+1).fill(0n);
  const wallets=[];
  const seeded=Date.now();
  const feeWallet1=await vault.FEE_WALLET_1();
  const feeWallet2=await vault.FEE_WALLET_2();
  const initialFees=[
   await token.balanceOf(feeWallet1),
   await token.balanceOf(feeWallet2),
   await token.balanceOf(addresses[103])
  ];
  // 100 independently signing Ganache accounts, all funded with the same
  // fake ERC20 and entered into the contract through its actual deposit path.
  for(let i=1;i<=COUNT;i++){
   parents[i]=parentIndex(i);
   const parent=parents[i]?addresses[parents[i]]:ZeroAddress;
   await tx(token.mint(addresses[i],INITIAL_AMOUNT));
   await tx(token.connect(signers[i]).approve(vault.target,INITIAL_AMOUNT));
   await tx(vault.connect(signers[i]).deposit(token.target,INITIAL_AMOUNT,parent));
   expectedProfits[i]=0n;expectedPersonal[i]=0n;
   if(i%25===0)console.log('LAB_SEED_PROGRESS '+i+'/'+COUNT);
  }
  assert.equal(await vault.memberCount(),BigInt(COUNT));
  assert.equal(await vault.principalLiability(token.target),parseEther('1000000'));
  assert.equal(await vault.assetBalance(token.target),0n);
  const routed=[
   (await token.balanceOf(feeWallet1))-initialFees[0],
   (await token.balanceOf(feeWallet2))-initialFees[1],
   (await token.balanceOf(addresses[103]))-initialFees[2]
  ];
  assert.deepEqual(routed,[
   parseEther('100000'),parseEther('100000'),parseEther('800000')
  ]);
  for(let i=1;i<=COUNT;i++){
   const account=await vault.accounts(addresses[i],token.target);
   assert.equal(account.principal,INITIAL_AMOUNT);
   assert.equal(account.externalDeposited,INITIAL_AMOUNT);
  }
  // 500,000 units of fake, mintable test ERC20 are transferred INTO vault.
  // This backs only 50% of the 1M principal, demonstrating uncovered claims.
  await tx(token.mint(addresses[102],TREASURY_AMOUNT));
  await tx(token.connect(signers[102]).approve(vault.target,TREASURY_AMOUNT));
  await tx(vault.connect(signers[102]).fundPrincipalLiquidity(token.target,TREASURY_AMOUNT));
  assert.equal(await vault.assetBalance(token.target),TREASURY_AMOUNT);
  assert.equal(await vault.unfundedPrincipal(token.target),parseEther('500000'));
  assert.equal(await vault.profitLiability(token.target),0n);
  // No activity for unregistered or unfunded users. All seeded wallets start
  // ineligible; one day elapses before the first funded settlement.
  for(let i=1;i<=COUNT;i++)assert.equal(await vault.isEligible(addresses[i]),false);
  await rpc.request({method:'evm_increaseTime',params:[86461]});
  await rpc.request({method:'evm_mine',params:[]});
  for(let i=1;i<=COUNT;i++)await tx(vault.connect(signers[i]).checkIn());
  for(let i=1;i<=COUNT;i++)assert.equal(await vault.isEligible(addresses[i]),true);
  assert.equal(await vault.baseDailyBps(2),90n);
  assert.equal(await vault.PROFIT_FEE_BPS(),300n);
  assert.equal(await vault.WITHDRAWAL_COOLDOWN(),259200n);
  // Revenue is a distinct, actual inbound mock-token transfer, not a new
  // principal deposit. It atomically credits both the user and valid uplines.
  let totalFundedEarnings=0n;
  let totalPersonalEarnings=0n;
  let totalReferralEarnings=0n;
  let fullDepth=0;
  for(let i=1;i<=COUNT;i++){
   expectedProfits[i]+=PERSONAL_DAILY;
   expectedPersonal[i]+=PERSONAL_DAILY;
   let parent=parents[i];
   let level=0;
   let shareTotal=0n;
   while(parent && level<4){
    const reward=PERSONAL_DAILY*rates[level]/10000n;
    expectedProfits[parent]+=reward;
    totalReferralEarnings+=reward;
    shareTotal+=reward;
    parent=parents[parent];
    level++;
   }
   if(level>=4)fullDepth++;
   const proof=reference('settlement-'+i);
   await tx(vault.connect(signers[101]).settleFundedEarnings(
    addresses[i],0,PERSONAL_DAILY,proof
   ));
   assert.equal(await vault.usedRevenueProof(proof),true);
   totalFundedEarnings+=PERSONAL_DAILY+shareTotal;
   totalPersonalEarnings+=PERSONAL_DAILY;
   if(i%25===0)console.log('LAB_FUNDED_PROFIT_PROGRESS '+i+'/'+COUNT);
  }
  assert.equal(totalPersonalEarnings,parseEther('9000'));
  assert.equal(totalFundedEarnings,totalPersonalEarnings+totalReferralEarnings);
  assert.equal(await vault.profitLiability(token.target),totalFundedEarnings);
  assert.equal(await vault.assetBalance(token.target),TREASURY_AMOUNT+totalFundedEarnings);
  assert.equal(await vault.unfundedPrincipal(token.target),parseEther('500000'));
  for(let i=1;i<=COUNT;i++){
   const acc=await vault.accounts(addresses[i],token.target);
   assert.equal(acc.profit,expectedProfits[i],'Profit/referral mismatch for synthetic account '+i);
  }
  await mustRevert(vault.connect(signers[101]).settleFundedEarnings.staticCall(
   addresses[1],0,PERSONAL_DAILY,reference('settlement-1')),'Ineligible');
  await mustRevert(vault.connect(signers[101]).settleFundedEarnings.staticCall(
   addresses[1],0,PERSONAL_DAILY,reference('fresh-too-soon')),'Locked');
  await mustRevert(vault.connect(signers[1]).setVipKyc.staticCall(addresses[1],true),'AccessControlUnauthorizedAccount');
  await mustRevert(vault.connect(signers[1]).approveWithdrawal.staticCall(0),'AccessControlUnauthorizedAccount');
  // All 100 request real (mock-token) withdrawals. Manager approval is required
  // for each and no transaction can redirect beneficiary to a new wallet.
  for(let i=1;i<=COUNT;i++){
   await tx(vault.connect(signers[i]).requestWithdrawal(token.target,WITHDRAW_EACH,false,0));
  }
  assert.equal(await vault.withdrawalCount(),100n);
  await mustRevert(vault.payWithdrawal.staticCall(0),'WrongState');
  await mustRevert(vault.connect(signers[1]).requestWithdrawal.staticCall(token.target,parseEther('1'),false,0),'Locked');
  const netBefore=await token.balanceOf(addresses[1]);
  const feeBefore=await token.balanceOf(await vault.WITHDRAWAL_FEE_WALLET());
  for(let i=0;i<COUNT;i++){
   await tx(vault.approveWithdrawal(i));
   await tx(vault.connect(signers[102]).payWithdrawal(i));
   if((i+1)%25===0)console.log('LAB_WITHDRAWAL_PROGRESS '+(i+1)+'/'+COUNT);
  }
  assert.equal(await vault.withdrawalCount(),100n);
  for(let i=1;i<=COUNT;i++){
   const row=await vault.withdrawalOf(i-1);
   assert.equal(row.status,2n);
   assert.equal(row.user,addresses[i]);
   assert.equal(row.gross,WITHDRAW_EACH);
   assert.equal(row.fee,FEE_EACH);
   const acc=await vault.accounts(addresses[i],token.target);
   assert.equal(acc.requestPending,false);
   assert.equal(acc.profit,expectedProfits[i]-WITHDRAW_EACH);
  }
  assert.equal((await token.balanceOf(addresses[1]))-netBefore,NET_EACH);
  assert.equal((await token.balanceOf(await vault.WITHDRAWAL_FEE_WALLET()))-feeBefore,FEE_EACH*100n);
  await mustRevert(vault.payWithdrawal.staticCall(0),'WrongState');
  // Reinvestment is entirely manual. Check exact accounting without generating
  // additional cash or misidentifying it as an external deposit.
  const accountBefore=await vault.accounts(addresses[1],token.target);
  const oldPositionCount=await vault.positionCount(addresses[1]);
  await tx(vault.connect(signers[1]).reinvest(token.target,parseEther('20')));
  const accountAfter=await vault.accounts(addresses[1],token.target);
  assert.equal(accountAfter.principal,INITIAL_AMOUNT+parseEther('20'));
  assert.equal(accountAfter.profit,accountBefore.profit-parseEther('20'));
  assert.equal(accountAfter.reinvested,parseEther('20'));
  assert.equal(await vault.positionCount(addresses[1]),oldPositionCount+1n);
  await mustRevert(vault.connect(signers[1]).requestWithdrawal.staticCall(token.target,parseEther('10'),true,0),'Locked');
  // A 24h check-in expires by time, not because of a manager action.
  await rpc.request({method:'evm_increaseTime',params:[86401]});
  await rpc.request({method:'evm_mine',params:[]});
  for(let i=1;i<=COUNT;i++)assert.equal(await vault.isEligible(addresses[i]),false);
  const principal=await vault.principalLiability(token.target);
  const profit=await vault.profitLiability(token.target);
  const cash=await vault.assetBalance(token.target);
  assert.equal(principal,parseEther('1000020'));
  assert.equal(profit,totalFundedEarnings-WITHDRAW_EACH*100n-parseEther('20'));
  assert.equal(cash,TREASURY_AMOUNT+totalFundedEarnings-WITHDRAW_EACH*100n);
  const shortfall=await vault.unfundedPrincipal(token.target);
  assert.equal(shortfall,parseEther('500000'));
  const summary={
   mode:'LOCAL_GANACHE_SIMULATION_ONLY',chainId:97,
   token:'MOCK_ERC20_NOT_REAL_USDT',
   deployedPublicV2Touched:false,existingUsersTouched:false,
   accountsCreated:COUNT,initialMockUsdPerAccount:'10000',
   grossRecordedPrincipalMockUsd:'1000000',
   depositRouting:{feeWallet1:'100000',feeWallet2:'100000',operations:'800000'},
   fundingVaultCashMockUsd:'500000',principalCashShortfallAtStart:'500000',
   checkinsOnChain:COUNT,checkinsExpiredAfter24h:COUNT,
   positionsOpened:101,manualReinvestments:1,
   personalEarningsMockUnits:totalPersonalEarnings.toString(),
   referralEarningsMockUnits:totalReferralEarnings.toString(),
   combinedFundedEarningsMockUnits:totalFundedEarnings.toString(),
   settlementTransactions:COUNT,
   withdrawalRequests:COUNT,managerApprovals:COUNT,
   paidWithdrawals:COUNT,profitWithdrawalFeeBps:300,
   totalGrossWithdrawalsMockUsd:'4000',
   totalWithdrawalFeesMockUsd:'120',
   totalPaidToUsersMockUsd:'3880',
   unapprovedWithdrawalDenied:true,replayedSettlementDenied:true,
   repeatPaymentDenied:true,automaticReinvestment:false,
   kycWithoutRoleDenied:true,principalWithdrawBefore90DaysDenied:true,
   endingPrincipalLiabilityMockUnits:principal.toString(),
   endingProfitLiabilityMockUnits:profit.toString(),
   endingVaultCashMockUnits:cash.toString(),
   endingUnfundedPrincipalMockUnits:shortfall.toString(),
   distinctTestWallets:COUNT,
   elapsedWallMilliseconds:Date.now()-seeded,
   result:'PASS',
  };
  const reportPath='reports/global-v2-local-100-account-report.json';
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});
  fs.writeFileSync(reportPath,JSON.stringify(summary,null,2)+'\n');
  console.log('GLOBAL_V2_100_ACCOUNT_LAB_PASS '+JSON.stringify(summary));
  report=summary;
 }finally{
  await provider.destroy();
  await rpc.disconnect();
 }
 return report;
}
main().catch(e=>{console.error('GLOBAL_V2_100_ACCOUNT_LAB_FAILED '+String(e?.message||e).slice(0,600));process.exitCode=1;});
