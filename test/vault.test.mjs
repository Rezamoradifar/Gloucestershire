import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Interface,parseEther,ZeroAddress,ZeroHash,keccak256,toUtf8Bytes,zeroPadValue} from 'ethers';
const E=parseEther, id=s=>keccak256(toUtf8Bytes(s));
let rpc,provider,signers,addr,vault,token,bnbFeed,usdFeed,snapshot,output;
const artifact=n=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json'));
async function deploy(n,args=[]) { const a=artifact(n); const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signers[0]).deploy(...args); await c.waitForDeployment(); return c; }
async function tx(p) {return (await p).wait();}
async function fails(p) {await assert.rejects(async()=>{const r=await p;if(r?.wait)await r.wait();});}
async function warp(s) {await rpc.request({method:'evm_increaseTime',params:[s]});await rpc.request({method:'evm_mine',params:[]});}
async function refresh() {const b=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]});for(const [f,p] of [[bnbFeed,600n*10n**8n],[usdFeed,10n**8n]])await tx(f.set(p,Number(b.timestamp),1,1));}
async function deposit(i=3,amount=E('1000'),asset=token.target,parent=ZeroAddress) {await tx(vault.connect(signers[i]).deposit(asset,amount,parent,{...(asset===ZeroAddress?{value:amount}:{}),gasLimit:1500000}));}
async function sale(i=3,amount=E('100'),asset=token.target,key='sale') {
 // Fixtures explicitly fund eligible additive commissions before settlement.
 const tier=await vault.tierConfig(await vault.tierOf(addr[i]));let parent=(await vault.users(addr[i])).referrer,needed=0n;
 for(let level=0;level<4&&parent!==ZeroAddress;level++){const u=await vault.users(parent),vip=await vault.tierOf(parent)===4n;if(u.active&&(!vip||u.vipKyc)&&(level!==3||vip))needed+=amount*tier.referrals[level]/10000n;parent=u.referrer;}
 const reserve=(await vault.ledgers(asset)).rewards;
 if(needed>reserve){const funding=needed-reserve;await tx(vault.fundRewards(asset,funding,{...(asset===ZeroAddress?{value:funding}:{}),gasLimit:500000}));}
 await tx(vault.settleSalesProfit(id(key),asset,addr[i],amount,E('1000'),id('receipt'),{...(asset===ZeroAddress?{value:amount}:{}),gasLimit:1500000}));}
async function approveConfig(h) {await tx(vault.voteConfiguration(h));await tx(vault.connect(signers[1]).voteConfiguration(h));}
async function queueCall(name,args) {const data=vault.interface.encodeFunctionData(name,args);await tx(vault.queueConfiguration(keccak256(data)));await approveConfig(keccak256(data));await warp(2*86400);await tx(vault[name](...args,{gasLimit:2000000}));}
// Routed deposits intentionally leave claims unbacked by vault cash. Verify exact reported gap.
async function solvent() {for(const a of [ZeroAddress,token.target]) {const cash=await vault.assetBalance(a), debt=await vault.accounted(a);assert.equal(await vault.liquidityShortfall(a),debt>cash?debt-cash:0n);assert.equal(await vault.surplus(a),cash>debt?cash-debt:0n);}}
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:80,defaultBalance:100000},miner:{blockGasLimit:30000000}});
 // Snapshot, cancel/requeue and time travel must not reuse cached eth_estimateGas results.
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:80},(_,i)=>provider.getSigner(i)));addr=await Promise.all(signers.map(s=>s.getAddress()));
 token=await deploy('MockToken',[18]); bnbFeed=await deploy('MockFeed',[600n*10n**8n]);usdFeed=await deploy('MockFeed',[10n**8n]);
 vault=await deploy('DropshippingVault',[addr[0],token.target,bnbFeed.target,usdFeed.target,86400,[addr[0],addr[1],addr[2],addr[8],addr[9],addr[10],addr[11]],addr[14]]);
 output=await deploy('MockToken',[18]);
 for(let i=0;i<15;i++){await tx(token.mint(addr[i],E('1000000')));await tx(token.connect(signers[i]).approve(vault.target,E('1000000')));}
 await tx(vault.fundFeeReserve(token.target,E('10000')));await tx(vault.fundFeeReserve(ZeroAddress,E('100'),{value:E('100')}));
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('hard-coded fee wallets and no replacement/upgrade entrypoint',async()=>{
 assert.equal((await vault.FEE_WALLET_1()).toLowerCase(),'0x7037cc199499d7a3431285a01e435454eae51265');
 assert.equal((await vault.FEE_WALLET_2()).toLowerCase(),'0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632');
 assert.equal((await vault.WITHDRAWAL_FEE_WALLET()).toLowerCase(),'0x74015dedf36677485793f1714ec7bd4893907b26');
 for(const n of ['upgradeTo','setFeeWallet','setWithdrawalWallet'])assert.equal(vault.interface.getFunction(n),null);
 await fails(vault.renounceOwnership());
});
test('USDT deposit credits 100%, routes 80/10/10 without consuming reserve',async()=>{
 const w1=await vault.FEE_WALLET_1(),w2=await vault.FEE_WALLET_2();await deposit();
 assert.equal((await vault.accounts(addr[3],token.target)).principal,E('1000'));
 assert.equal(await token.balanceOf(w1),E('100'));assert.equal(await token.balanceOf(w2),E('100'));
 assert.equal((await vault.ledgers(token.target)).feeReserve,E('10000'));await solvent();
});
test('BNB deposit and separate reserve accounting',async()=>{
 await deposit(3,E('1'),ZeroAddress);assert.equal((await vault.accounts(addr[3],ZeroAddress)).principal,E('1'));
 assert.equal((await vault.ledgers(ZeroAddress)).feeReserve,E('100'));assert.equal((await vault.ledgers(token.target)).feeReserve,E('10000'));await solvent();
});
test('zero reserve permits atomic 80/10/10 deposit routing',async()=>{
 const v=await deploy('DropshippingVault',[addr[0],token.target,bnbFeed.target,usdFeed.target,86400,[addr[0],addr[1],addr[2],addr[8],addr[9],addr[10],addr[11]],addr[14]]);
 await tx(token.connect(signers[3]).approve(v.target,E('1000')));
 const before=await token.balanceOf(addr[14]);await tx(v.connect(signers[3]).deposit(token.target,E('1000'),ZeroAddress));
 assert.equal(await token.balanceOf(addr[14])-before,E('800'));assert.equal(await v.assetBalance(token.target),0n);
 assert.equal((await v.ledgers(token.target)).feeReserve,0n);assert.equal(await v.liquidityShortfall(token.target),E('1000'));
});
test('native value mismatch and unsupported assets rejected',async()=>{
 await fails(vault.connect(signers[3]).deposit(ZeroAddress,E('1'),ZeroAddress,{value:E('0.9')}));
 await fails(vault.fundFeeReserve(output.target,E('1')));await fails(vault.fundFeeReserve(token.target,E('1'),{value:1n}));
});
test('minimum deposit and decimal tier gaps resolved',async()=>{
 await fails(vault.connect(signers[3]).deposit(token.target,E('9.99'),ZeroAddress));
 await deposit(3,E('500'));assert.equal(await vault.tierOf(addr[3]),0n);
 await deposit(4,E('500.5'));assert.equal(await vault.tierOf(addr[4]),1n);
});
test('stale, negative, future and incomplete oracle rounds rejected',async()=>{
 const b=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]});const now=Number(b.timestamp);
 for(const [answer,time,r,a] of [[1n,now-90000,1,1],[-1n,now,1,1],[1n,now+10000,1,1],[1n,now,2,1],[1n,now,0,0]]) {
 await tx(usdFeed.set(answer,time,r,a));await fails(vault.quoteUsd(token.target,E('100')));}
});
test('only funded reporter settlements create profits; duplicate ID rejected',async()=>{
 await deposit();await fails(vault.connect(signers[3]).settleSalesProfit(id('x'),token.target,addr[3],E('1'),E('1'),id('receipt')));
 await sale();assert.equal((await vault.accounts(addr[3],token.target)).profit,E('100'));
 await fails(vault.settleSalesProfit(id('sale'),token.target,addr[3],E('100'),E('1000'),id('receipt')));await solvent();
});
test('profit withdrawal fee, cap, cooldown and exact 72h boundary',async()=>{
 await deposit();await sale(3,E('300'));await fails(vault.connect(signers[3]).withdrawProfit(token.target,E('100.01')));
 const before=await token.balanceOf(addr[3]);await tx(vault.connect(signers[3]).withdrawProfit(token.target,E('100')));
 assert.equal(await token.balanceOf(addr[3])-before,E('95'));await fails(vault.connect(signers[3]).withdrawProfit(token.target,E('1')));
 await warp(72*3600);await tx(vault.connect(signers[3]).withdrawProfit(token.target,E('100'),{gasLimit:500000}));await solvent();
});
test('principal locked 90 days, partial/full withdrawals charge 30%',async()=>{
 await deposit();await fails(vault.connect(signers[3]).withdrawPrincipal(0,E('1000')));
 await warp(90*86400);let before=await token.balanceOf(addr[3]);await tx(vault.connect(signers[3]).withdrawPrincipal(0,E('400'),{gasLimit:500000}));
 assert.equal(await token.balanceOf(addr[3])-before,E('280'));await warp(72*3600);
 await tx(vault.connect(signers[3]).withdrawPrincipal(0,E('600'),{gasLimit:500000}));assert.equal((await vault.users(addr[3])).capitalUsd,0n);await solvent();
});
test('configuration delay/access caps and old principal terms preserved',async()=>{
 await deposit();const p=await vault.positionOf(addr[3],0);
 await fails(vault.setFees(1000,4000));await fails(vault.connect(signers[3]).queueConfiguration(id('bad')));
 await queueCall('setFees',[500,4000]);await queueCall('setWithdrawalRules',[120*86400,72*3600]);await refresh();
 await deposit(3,E('100'));const old=await vault.positionOf(addr[3],0),next=await vault.positionOf(addr[3],1);
 assert.equal(old.penaltyBps,3000n);assert.equal(old.unlockAt,p.unlockAt);assert.equal(next.penaltyBps,4000n);
 await fails(vault.setFees(500,4000)); // consumed queue
});
test('updated five plan referral table, target never accrues automatic profit',async()=>{
 assert.deepEqual(Array.from((await vault.tierConfig(4)).referrals),[1600n,800n,600n,400n]);
 await deposit();await warp(86400*10);assert.equal((await vault.accounts(addr[3],token.target)).profit,0n);
});
test('immutable referral DAG rejects self registration and referrer changes',async()=>{
 await fails(vault.connect(signers[3]).register(addr[3]));await fails(vault.connect(signers[3]).register(addr[4]));
 await tx(vault.connect(signers[4]).register(ZeroAddress));await deposit(3,E('1000'),token.target,addr[4]);
 await fails(vault.connect(signers[3]).deposit(token.target,E('100'),ZeroAddress));await fails(vault.connect(signers[3]).register(addr[4]));
});
test('non-VIP level four is excluded even with active direct customer; no deposit referrals',async()=>{
 // 3 <- 4 <- 5 <- 6 <- 7; seller 7 has Starter rates
 await tx(vault.connect(signers[3]).register(ZeroAddress));
 for(let i=4;i<=7;i++)await tx(vault.connect(signers[i]).register(addr[i-1]));
 for(let i=3;i<=7;i++)await tx(vault.setCustomerStatus(addr[i],true,false));
 await deposit(7,E('100'),token.target,addr[6]);assert.equal((await vault.accounts(addr[6],token.target)).profit,0n);
 await sale(7,E('100'));
 for(const [i,v] of [[6,'8'],[5,'4'],[4,'2'],[3,'0'],[7,'100']]) assert.equal((await vault.accounts(addr[i],token.target)).profit,E(v));
 await solvent();
});
test('non-VIP and inactive referral shares remain in the funded reward pool',async()=>{
 await tx(vault.connect(signers[3]).register(ZeroAddress));for(let i=4;i<=7;i++)await tx(vault.connect(signers[i]).register(addr[i-1]));
 for(const i of [3,5,6,7])await tx(vault.setCustomerStatus(addr[i],true,false));await tx(vault.fundRewards(token.target,E('14')));await sale(7,E('100'));
 assert.equal((await vault.accounts(addr[3],token.target)).profit,0n);assert.equal((await vault.accounts(addr[4],token.target)).profit,0n);
 assert.equal((await vault.accounts(addr[7],token.target)).profit,E('100'));assert.equal((await vault.ledgers(token.target)).rewards,E('2'));await solvent();
});
test('invite-count milestones are removed from ABI and do not create profit',async()=>{
 for(const name of ['claimMilestone','setMilestoneBonus','milestoneBonusUsd','milestoneCustomers']) assert.equal(vault.interface.getFunction(name),null);
 await tx(vault.connect(signers[3]).register(ZeroAddress));
 for(let i=4;i<=8;i++){await tx(vault.connect(signers[i]).register(addr[3]));await tx(vault.setCustomerStatus(addr[i],true,false));}
 assert.equal((await vault.accounts(addr[3],token.target)).profit,0n);
});
test('bounded funded batch allocation, replay and over-allocation rejected',async()=>{
 await deposit();await fails(vault.batchProfit(id('batch'),token.target,[addr[3]],[E('10')]));await tx(vault.fundRewards(token.target,E('10')));
 await tx(vault.batchProfit(id('batch'),token.target,[addr[3]],[E('10')],{gasLimit:500000}));await fails(vault.batchProfit(id('batch'),token.target,[addr[3]],[1n]));
 await fails(vault.batchProfit(id('other'),token.target,[addr[3]],[]));await solvent();
});
test('reinvest conserves assets, opens new lock, no new deposit fees and increases withdrawal cap',async()=>{
 await deposit();await sale();const balance=await vault.assetBalance(token.target),reserve=(await vault.ledgers(token.target)).feeReserve;
 await tx(vault.connect(signers[3]).reinvest(token.target,E('50')));
 const a=await vault.accounts(addr[3],token.target);assert.equal(a.principal,E('1050'));assert.equal(a.profit,E('50'));assert.equal(a.externalDeposited,E('1000'));assert.equal(await vault.cumulativeReinvested(addr[3],token.target),E('50'));assert.equal(await vault.profitWithdrawalCap(addr[3],token.target),E('105'));
 assert.equal(await vault.assetBalance(token.target),balance);assert.equal((await vault.ledgers(token.target)).feeReserve,reserve);assert.equal(await vault.positionCount(addr[3]),2n);await solvent();
});
test('removed internal transfer rejects legacy calldata for BNB and USDT without changing accounts',async()=>{
 assert.equal(vault.interface.getFunction('transferProfit'),null);
 assert.equal(vault.interface.getEvent('InternalTransfer'),null);
 const legacy=new Interface(['function transferProfit(address asset,address recipient,uint256 amount)']);
 for(const asset of [token.target,ZeroAddress]) {
  const capital=asset===ZeroAddress?E('1'):E('100');
  const profit=asset===ZeroAddress?E('0.1'):E('10');
  await deposit(3,capital,asset);await deposit(4,capital,asset);await sale(3,profit,asset,'no-transfer-'+asset);
  const beforeSender=Array.from(await vault.accounts(addr[3],asset));
  const beforeRecipient=Array.from(await vault.accounts(addr[4],asset));
  const beforeLedger=Array.from(await vault.ledgers(asset));
  const cash=await vault.assetBalance(asset);
  const data=legacy.encodeFunctionData('transferProfit',[asset,addr[4],E('0.05')]);
  await fails(signers[3].sendTransaction({to:vault.target,data,gasLimit:200000}));
  assert.deepEqual(Array.from(await vault.accounts(addr[3],asset)),beforeSender);
  assert.deepEqual(Array.from(await vault.accounts(addr[4],asset)),beforeRecipient);
  assert.deepEqual(Array.from(await vault.ledgers(asset)),beforeLedger);
  assert.equal(await vault.assetBalance(asset),cash);
  await tx(vault.connect(signers[3]).withdrawProfit(asset,E('0.05')));
 }
 await solvent();
});
test('pause stops deposits and settlements but permits funded exits',async()=>{
 await deposit();await sale();await tx(vault.setPaused(true));await fails(vault.connect(signers[4]).deposit(token.target,E('100'),ZeroAddress));
 await tx(vault.connect(signers[3]).withdrawProfit(token.target,E('100')));await solvent();
});
test('configuration requires two distinct partner votes and two days; partners cannot withdraw',async()=>{
 const data=vault.interface.encodeFunctionData('setFees',[500,4000]),h=keccak256(data);
 await tx(vault.queueConfiguration(h));
 await fails(vault.setFees(500,4000));await fails(vault.connect(signers[3]).voteConfiguration(h));
 await tx(vault.voteConfiguration(h));await fails(vault.voteConfiguration(h));
 await warp(2*86400);await fails(vault.setFees(500,4000,{gasLimit:500000}));
 await tx(vault.connect(signers[1]).voteConfiguration(h));
 await fails(vault.connect(signers[1]).setFees(500,4000,{gasLimit:500000}));
 await tx(vault.setFees(500,4000,{gasLimit:500000}));assert.equal(await vault.profitFeeBps(),500n);
 await fails(vault.setFees(500,4000,{gasLimit:500000}));await fails(vault.voteConfiguration(h));
 await fails(vault.connect(signers[1]).ownerWithdrawCapital(token.target,addr[1],1n));
 for(const name of ['proposeSurplusWithdrawal','voteSurplusWithdrawal','executeSurplusWithdrawal','proposals','hasVoted'])assert.equal(vault.interface.getFunction(name),null);
 for(const sig of ['proposeSurplusWithdrawal(address,address,uint256)','voteSurplusWithdrawal(uint256)','executeSurplusWithdrawal(uint256)'])await fails(signers[1].sendTransaction({to:vault.target,data:id(sig).slice(0,10)+'00'.repeat(96),gasLimit:500000}));
});
test('native withdrawal resists recipient reentrancy',async()=>{
 const attacker=await deploy('ReentrantCustomer',[vault.target]);await tx(attacker.deposit({value:E('1')}));
 await tx(vault.settleSalesProfit(id('attack'),ZeroAddress,attacker.target,E('0.1'),E('1'),id('e'),{value:E('0.1')}));
 await tx(attacker.withdraw(E('0.1'),{gasLimit:1000000}));assert.equal(await attacker.attacked(),true);assert.equal(await attacker.reentrySucceeded(),false);await solvent();
});
test('seeded mixed operation sequence preserves ledger sums and reports cash shortfall',async()=>{
 let seed=7;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
 for(let i=3;i<8;i++)await deposit(i,E('1000'));
 for(let n=0;n<35;n++){const i=3+random()%5,amount=E(String(10+random()%50));
 if(random()%2===0)await sale(i,amount,token.target,'sequence-'+n);
 else {await tx(vault.fundRewards(token.target,amount));await tx(vault.batchProfit(id('sequence-'+n),token.target,[addr[i]],[amount]));}
 if(n%4===0)await tx(vault.connect(signers[i]).reinvest(token.target,E('10')));
 let principal=0n,profit=0n;for(let j=3;j<8;j++){const a=await vault.accounts(addr[j],token.target);principal+=a.principal;profit+=a.profit;}
 const l=await vault.ledgers(token.target);assert.equal(l.principal,principal);assert.equal(l.profit,profit);await solvent();}
});

test('six-decimal token retains correct USD valuations and fees',async()=>{
 const t=await deploy('MockToken',[6]);const v=await deploy('DropshippingVault',[addr[0],t.target,bnbFeed.target,usdFeed.target,86400,[addr[0],addr[1],addr[2],addr[8],addr[9],addr[10],addr[11]],addr[14]]);
 await tx(t.mint(addr[0],1200n*10n**6n));await tx(t.approve(v.target,1200n*10n**6n));await tx(v.fundFeeReserve(t.target,200n*10n**6n));
 await tx(v.deposit(t.target,1000n*10n**6n,ZeroAddress));assert.equal((await v.users(addr[0])).capitalUsd,E('1000'));
 assert.equal(await t.balanceOf(await v.FEE_WALLET_1()),100n*10n**6n);assert.equal(await v.assetBalance(t.target),200n*10n**6n);assert.equal(await v.liquidityShortfall(t.target),1000n*10n**6n);
});
test('90-day unlock boundary tested one second before and at unlock',async()=>{
 await deposit();const p=await vault.positionOf(addr[3],0);
 await rpc.request({method:'evm_setTime',params:[Number(p.unlockAt-1n)*1000]});await rpc.request({method:'evm_mine',params:[]});
 await fails(vault.connect(signers[3]).withdrawPrincipal.staticCall(0,E('1000')));
 await rpc.request({method:'evm_setTime',params:[Number(p.unlockAt)*1000]});await rpc.request({method:'evm_mine',params:[]});
 await vault.connect(signers[3]).withdrawPrincipal.staticCall(0,E('1000'));await tx(vault.connect(signers[3]).withdrawPrincipal(0,E('1000'),{gasLimit:500000}));await solvent();
});
test('governance validates referral cap, descending rates, targets and partner threshold',async()=>{
 const config=[10n*10n**18n,50,100,5,E('2500'),[1800,1100,600,0]];
 let data=vault.interface.encodeFunctionData('setTierConfig',[0,config]);await tx(vault.queueConfiguration(keccak256(data)));await approveConfig(keccak256(data));await warp(2*86400);
 await fails(vault.setTierConfig(0,config,{gasLimit:1500000}));
 config[5]=[100,200,0,0];data=vault.interface.encodeFunctionData('setTierConfig',[0,config]);await tx(vault.queueConfiguration(keccak256(data)));await approveConfig(keccak256(data));await warp(2*86400);
 await fails(vault.setTierConfig(0,config,{gasLimit:1500000}));
 data=vault.interface.encodeFunctionData('setPartnerVoteRequired',[1]);await tx(vault.queueConfiguration(keccak256(data)));await approveConfig(keccak256(data));await warp(2*86400);
 await fails(vault.setPartnerVoteRequired(1,{gasLimit:1500000}));
});
test('VIP capital requires reporter KYC and no deposit creates sales status',async()=>{
 await tx(vault.fundFeeReserve(token.target,E('10000')));await fails(vault.connect(signers[3]).deposit(token.target,E('50001'),ZeroAddress,{gasLimit:1500000}));
 await tx(vault.connect(signers[3]).register(ZeroAddress));await tx(vault.setCustomerStatus(addr[3],false,true));await deposit(3,E('50001'));
 assert.equal(await vault.tierOf(addr[3]),4n);assert.equal((await vault.users(addr[3])).active,false);await solvent();
});
test('configuration quorum is snapshotted and approved votes do not skip delay',async()=>{
 const h=keccak256(vault.interface.encodeFunctionData('setMinDeposit',[E('20')]));
 await tx(vault.queueConfiguration(h));await approveConfig(h);
 await fails(vault.setMinDeposit(E('20'),{gasLimit:500000}));
 await queueCall('setPartnerVoteRequired',[3]);assert.equal(await vault.configVotesRequired(h),2n);
 await tx(vault.setMinDeposit(E('20'),{gasLimit:500000}));assert.equal(await vault.minDepositUsd(),E('20'));
});
test('cancel and requeue never reuse old votes and calldata cannot be substituted',async()=>{
 const h=keccak256(vault.interface.encodeFunctionData('setMinDeposit',[E('20')]));
 await fails(vault.queueConfiguration(ZeroHash));await tx(vault.queueConfiguration(h));await approveConfig(h);
 await fails(vault.queueConfiguration(h));await fails(vault.connect(signers[1]).cancelConfiguration(h));
 await tx(vault.cancelConfiguration(h));await fails(vault.voteConfiguration(h));
 await tx(vault.queueConfiguration(h));assert.equal(await vault.configRound(h),2n);assert.equal(await vault.configVotes(h),0n);
 await warp(2*86400);await fails(vault.setMinDeposit(E('20'),{gasLimit:500000}));await approveConfig(h);
 await fails(vault.setMinDeposit(E('21'),{gasLimit:500000}));await tx(vault.setMinDeposit(E('20'),{gasLimit:500000}));
 await tx(vault.queueConfiguration(h));assert.equal(await vault.configRound(h),3n);assert.equal(await vault.configVotes(h),0n);
});

for(const native of [false,true]) {
 test(`owner-managed ${native?'BNB':'USDT'}: full access, unchanged claims, failed exit rollback and capital return`,async()=>{
  const a=native?ZeroAddress:token.target, unit=native?'1':'1000';
  await deposit(3,E(unit),a);await sale(3,E(native?'0.1':'100'),a);
  const claim=await vault.accounts(addr[3],a), debt=await vault.accounted(a), cash=await vault.assetBalance(a), priorOutstanding=await vault.ownerCapitalOutstanding(a);
  await fails(vault.connect(signers[3]).ownerWithdrawCapital(a,addr[3],1n));
  await fails(vault.ownerWithdrawCapital(a,ZeroAddress,1n));
  await fails(vault.ownerWithdrawCapital(a,vault.target,1n));
  await fails(vault.ownerWithdrawCapital(a,addr[0],cash+1n));
  await tx(vault.setPaused(true));
  await tx(vault.ownerWithdrawCapital(a,addr[0],cash,{gasLimit:500000}));
  assert.equal(await vault.assetBalance(a),0n);assert.equal(await vault.accounted(a),debt);
  assert.equal(await vault.liquidityShortfall(a),debt);assert.equal(await vault.ownerCapitalOutstanding(a),cash+priorOutstanding);
  await fails(vault.connect(signers[3]).withdrawProfit(a,claim.profit,{gasLimit:500000}));
  assert.deepEqual(Array.from(await vault.accounts(addr[3],a)),Array.from(claim));
  await warp(90*86400);
  await fails(vault.connect(signers[3]).withdrawPrincipal(0,claim.principal,{gasLimit:500000}));
  assert.equal((await vault.positionOf(addr[3],0)).principal,claim.principal);
  await tx(vault.returnCapital(a,debt,{...(native?{value:debt}:{}),gasLimit:500000}));
  assert.equal(await vault.accounted(a),debt);assert.equal(await vault.ownerCapitalOutstanding(a),0n);
  assert.equal(await vault.liquidityShortfall(a),0n);
  const feeWallet=await vault.WITHDRAWAL_FEE_WALLET();
  const bal=async x=>native?BigInt(await rpc.request({method:'eth_getBalance',params:[x,'latest']})):await token.balanceOf(x);
  const before=await bal(feeWallet), old=await bal(await vault.FEE_WALLET_1());
  await tx(vault.connect(signers[3]).withdrawProfit(a,claim.profit,{gasLimit:500000}));
  assert.equal(await bal(feeWallet)-before,claim.profit/20n);assert.equal(await bal(await vault.FEE_WALLET_1()),old);
  await warp(72*3600);await tx(vault.connect(signers[3]).withdrawPrincipal(0,claim.principal,{gasLimit:500000}));
  assert.equal(await bal(await vault.FEE_WALLET_1())-old,0n);
  await solvent();
 });
}
test('capital return creates no profit or deposit fee, excess is unallocated cash',async()=>{
 const debt=await vault.accounted(token.target), w1=await token.balanceOf(await vault.FEE_WALLET_1());
 await tx(vault.ownerWithdrawCapital(token.target,addr[0],E('50')));
 await tx(vault.connect(signers[4]).returnCapital(token.target,E('60')));
 assert.equal(await vault.ownerCapitalOutstanding(token.target),0n);assert.equal(await vault.accounted(token.target),debt);
 assert.equal(await vault.surplus(token.target),E('10'));assert.equal((await vault.accounts(addr[4],token.target)).externalDeposited,0n);
 assert.equal(await token.balanceOf(await vault.FEE_WALLET_1()),w1);
});
test('two immutable deposit payments survive full owner withdrawal',async()=>{
 const cash=await vault.assetBalance(token.target);await tx(vault.ownerWithdrawCapital(token.target,addr[0],cash));
 await deposit();assert.equal(await token.balanceOf(await vault.FEE_WALLET_1()),E('100'));
 assert.equal(await token.balanceOf(await vault.FEE_WALLET_2()),E('100'));
 assert.equal((await vault.accounts(addr[3],token.target)).principal,E('1000'));
 assert.equal(await vault.assetBalance(token.target),0n);assert.ok(await vault.liquidityShortfall(token.target)>0n);
});
test('only accepted new owner has treasury withdrawal authority',async()=>{
 await tx(vault.transferOwnership(addr[4]));await fails(vault.connect(signers[4]).ownerWithdrawCapital(token.target,addr[4],1n));
 await tx(vault.connect(signers[4]).acceptOwnership());await fails(vault.ownerWithdrawCapital(token.target,addr[0],1n));
 await tx(vault.connect(signers[4]).ownerWithdrawCapital(token.target,addr[4],1n,{gasLimit:500000}));
 assert.equal(await vault.ownerCapitalOutstanding(token.target),1n);
});

test('exactly seven unique nonzero partners are required',async()=>{
 const partners=[addr[0],addr[1],addr[2],addr[8],addr[9],addr[10],addr[11]];
 for(const bad of [partners.slice(0,6),[...partners,addr[12]],[...partners.slice(0,6),addr[0]],[...partners.slice(0,6),ZeroAddress]]){
  await fails(deploy('DropshippingVault',[addr[0],token.target,bnbFeed.target,usdFeed.target,86400,bad,addr[14]]));
 }
 assert.equal(await vault.partnerCount(),7n);assert.equal(await vault.partnerVotesRequired(),2n);
 for(let i=0;i<7;i++){assert.equal(await vault.partnerWallets(i),partners[i]);assert.equal(await vault.isPartner(partners[i]),true);}
});
test('all seven partners can vote once and seven-vote quorum is enforceable',async()=>{
 await queueCall('setPartnerVoteRequired',[7]);
 const h=keccak256(vault.interface.encodeFunctionData('setMinDeposit',[E('20')]));await tx(vault.queueConfiguration(h));
 const voters=[0,1,2,8,9,10,11];await warp(2*86400);
 for(let i=0;i<7;i++){
  await fails(vault.setMinDeposit(E('20'),{gasLimit:500000}));
  await tx(vault.connect(signers[voters[i]]).voteConfiguration(h));
  await fails(vault.connect(signers[voters[i]]).voteConfiguration(h,{gasLimit:500000}));
 }
 await tx(vault.setMinDeposit(E('20'),{gasLimit:500000}));assert.equal(await vault.minDepositUsd(),E('20'));
});
test('quorum cannot exceed seven and removed exchange selectors cannot execute',async()=>{
 const data=vault.interface.encodeFunctionData('setPartnerVoteRequired',[8]);await tx(vault.queueConfiguration(keccak256(data)));await approveConfig(keccak256(data));await warp(2*86400);
 await fails(vault.setPartnerVoteRequired(8,{gasLimit:500000}));
 for(const name of ['swapProfit','bridgeProfit','setAdapter','swapAdapters','bridgeAdapters','bridgeFeeBps'])assert.equal(vault.interface.getFunction(name),null);
 for(const sig of ['swapProfit(address,address,uint256,address,uint256,uint256)','bridgeProfit(address,uint256,address,uint256,bytes32)','setAdapter(address,bool,bool)']){
  await fails(signers[0].sendTransaction({to:vault.target,data:id(sig).slice(0,10)+'00'.repeat(192),gasLimit:500000}));
 }
 assert.equal(vault.interface.getFunction('setFees').inputs.length,2);
});

for(const native of [false,true])test(`80/10/10 ${native?'BNB':'USDT'} split and principal penalty retained, no fee destination receives penalty`,async()=>{
 const asset=native?ZeroAddress:token.target, amount=E(native?'1':'1000');
 const balance=async a=>native?BigInt(await rpc.request({method:'eth_getBalance',params:[a,'latest']})):await token.balanceOf(a);
 const destinations=[await vault.FEE_WALLET_1(),await vault.FEE_WALLET_2(),await vault.WITHDRAWAL_FEE_WALLET(),addr[14]];
 const before=await Promise.all(destinations.map(balance)), cash=await vault.assetBalance(asset);
 await deposit(3,amount,asset);
 const after=await Promise.all(destinations.map(balance));
 assert.deepEqual(after.map((v,i)=>v-before[i]),[amount/10n,amount/10n,0n,amount-2n*(amount/10n)]);
 assert.equal(await vault.assetBalance(asset),cash);
 assert.equal(await vault.ownerCapitalOutstanding(asset),amount*8n/10n);
 await warp(90*86400);
 const receipt=await tx(vault.connect(signers[3]).withdrawPrincipal(0,amount,{gasLimit:500000}));
 assert.equal(await vault.assetBalance(asset),cash-amount*7n/10n);
 assert.equal(await vault.retainedPrincipalPenalties(asset),amount*3n/10n);
 assert.deepEqual(await Promise.all(destinations.map(balance)),after);
 assert.equal((await vault.accounts(addr[3],asset)).principal,0n);
 assert.ok(receipt.logs.some(l=>{try{return vault.interface.parseLog(l)?.name==='PrincipalPenaltyRetained';}catch{return false;}}));
});
test('level four requires current active VIP with KYC; downgrade or KYC revocation stops eligibility',async()=>{
 await tx(vault.connect(signers[3]).register(ZeroAddress));
 for(let i=4;i<=7;i++)await tx(vault.connect(signers[i]).register(addr[i-1]));
 await tx(vault.setCustomerStatus(addr[3],true,true));await deposit(3,E('50001'));
 await tx(vault.setCustomerStatus(addr[7],false,true));await deposit(7,E('50001'),token.target,addr[6]);
 // No active direct customers: VIP replaces that old condition.
 assert.equal((await vault.users(addr[3])).activeDirect,0n);
 await sale(7,E('100'),token.target,'vip-on');assert.equal((await vault.accounts(addr[3],token.target)).profit,E('4'));
 await tx(vault.setCustomerStatus(addr[3],true,false));await sale(7,E('100'),token.target,'kyc-off');
 assert.equal((await vault.accounts(addr[3],token.target)).profit,E('4'));
 await tx(vault.setCustomerStatus(addr[3],true,true));await warp(90*86400);
 await tx(vault.connect(signers[3]).withdrawPrincipal(0,E('2'),{gasLimit:500000}));
 assert.equal(await vault.tierOf(addr[3]),3n);await sale(7,E('100'),token.target,'tier-down');
 assert.equal((await vault.accounts(addr[3],token.target)).profit,E('4'));
 assert.equal((await vault.accounts(addr[7],token.target)).profit,E('300'));
});
test('rounding remainder belongs to operations and preserves exact sum',async()=>{
 const amount=E('100')+7n,before=await token.balanceOf(addr[14]);await deposit(3,amount);
 assert.equal(await token.balanceOf(addr[14])-before,amount-2n*(amount/10n));
 assert.equal(await token.balanceOf(await vault.FEE_WALLET_1()),amount/10n);
 assert.equal(await token.balanceOf(await vault.FEE_WALLET_2()),amount/10n);
});
test('operations wallet validation and immutability',async()=>{
 const args=[addr[0],token.target,bnbFeed.target,usdFeed.target,86400,[addr[0],addr[1],addr[2],addr[8],addr[9],addr[10],addr[11]]];
 for(const bad of [ZeroAddress,await vault.FEE_WALLET_1(),await vault.FEE_WALLET_2(),await vault.WITHDRAWAL_FEE_WALLET()])await fails(deploy('DropshippingVault',[...args,bad]));
 assert.equal(await vault.dropshippingWallet(),addr[14]);assert.equal(vault.interface.getFunction('setDropshippingWallet'),null);
});
test('rejected BNB operations transfer rolls back fees, claims, outstanding and registration',async()=>{
 const reject=await deploy('RejectingOperationsWallet');const v=await deploy('DropshippingVault',[addr[0],token.target,bnbFeed.target,usdFeed.target,86400,[addr[0],addr[1],addr[2],addr[8],addr[9],addr[10],addr[11]],reject.target]);
 const w1=await v.FEE_WALLET_1(),before=await rpc.request({method:'eth_getBalance',params:[w1,'latest']});
 await fails(v.connect(signers[3]).deposit(ZeroAddress,E('1'),ZeroAddress,{value:E('1'),gasLimit:1500000}));
 assert.equal(await rpc.request({method:'eth_getBalance',params:[w1,'latest']}),before);
 assert.equal((await v.users(addr[3])).registered,false);assert.equal(await v.positionCount(addr[3]),0n);
 assert.equal(await v.ownerCapitalOutstanding(ZeroAddress),0n);assert.equal(await v.assetBalance(ZeroAddress),0n);
});
test('operations wallet callback cannot reenter deposit',async()=>{
 const receiver=await deploy('ReentrantOperationsWallet');const v=await deploy('DropshippingVault',[addr[0],token.target,bnbFeed.target,usdFeed.target,86400,[addr[0],addr[1],addr[2],addr[8],addr[9],addr[10],addr[11]],receiver.target]);
 await tx(v.connect(signers[3]).deposit(ZeroAddress,E('1'),ZeroAddress,{value:E('1'),gasLimit:1500000}));
 assert.equal(await receiver.attempted(),true);assert.equal(await receiver.succeeded(),false);
 assert.equal(await v.positionCount(addr[3]),1n);
});

test('all six governed setters require votes and governance pays no partner funds',async()=>{
 const changes=[['setReporter',[addr[12],true]],['setFees',[800,3000]],['setWithdrawalRules',[90*86400,72*3600]],['setMinDeposit',[E('11')]],['setTierConfig',[0,[E('10'),50,100,5,E('2500'),[800,400,200,0]]]],['setPartnerVoteRequired',[2]]];
 const cash=await vault.assetBalance(token.target),native=await vault.assetBalance(ZeroAddress);
 const balances=await Promise.all([0,1,2,8,9,10,11].map(i=>token.balanceOf(addr[i])));
 for(const [name,args]of changes){
  const h=keccak256(vault.interface.encodeFunctionData(name,args));await tx(vault.queueConfiguration(h));await warp(2*86400);
  await fails(vault[name](...args,{gasLimit:1500000}));await tx(vault.voteConfiguration(h));
  await fails(vault[name](...args,{gasLimit:1500000}));await tx(vault.connect(signers[1]).voteConfiguration(h));
  await tx(vault[name](...args,{gasLimit:1500000}));
 }
 assert.equal(await vault.assetBalance(token.target),cash);assert.equal(await vault.assetBalance(ZeroAddress),native);
 assert.deepEqual(await Promise.all([0,1,2,8,9,10,11].map(i=>token.balanceOf(addr[i]))),balances);
});

 test('profit withdrawal fee accepts zero and ten percent but rejects above ten even with governance approval',async()=>{
 await queueCall('setFees',[0,3000]);assert.equal(await vault.profitFeeBps(),0n);
 await queueCall('setFees',[1000,3000]);assert.equal(await vault.profitFeeBps(),1000n);
 for(const rate of [1001,2000]) {
  await fails(queueCall('setFees',[rate,3000]));
  assert.equal(await vault.profitFeeBps(),1000n);
  assert.equal(await vault.principalPenaltyBps(),3000n);
 }
});

for(const native of [false,true])test(`reinvest raises ${native?'BNB':'USDT'} cap from personal and network profit, enforces exact boundary and rollback`,async()=>{
 const asset=native?ZeroAddress:token.target,other=native?token.target:ZeroAddress;
 const initial=E(native?'1':'1000'), topup=initial/2n;
 await deposit(3,initial,asset);await tx(vault.setCustomerStatus(addr[3],true,false));
 await deposit(4,initial,asset,addr[3]);await sale(3,initial,asset,'own');await sale(4,initial,asset,'network');
 const profit=(await vault.accounts(addr[3],asset)).profit;assert.ok(profit>initial);
 assert.equal(await vault.profitWithdrawalCap(addr[3],asset),initial/10n);
 await tx(vault.connect(signers[3]).reinvest(asset,topup));
 await tx(vault.connect(signers[3]).reinvest(asset,profit-topup));
 assert.equal(await vault.cumulativeReinvested(addr[3],asset),profit);
 assert.equal(await vault.profitWithdrawalCap(addr[3],other),0n);
 const cap=(initial+profit)/10n;
 assert.equal(await vault.profitWithdrawalCap(addr[3],asset),cap);
 await fails(vault.connect(signers[3]).reinvest(asset,topup,{gasLimit:1000000}));
 assert.equal(await vault.cumulativeReinvested(addr[3],asset),profit);
 await sale(3,initial,asset,'refill');
 await fails(vault.connect(signers[3]).withdrawProfit(asset,cap+1n,{gasLimit:500000}));
 const before=(await vault.accounts(addr[3],asset)).profit;
 await tx(vault.connect(signers[3]).withdrawProfit(asset,cap,{gasLimit:500000}));
 assert.equal((await vault.accounts(addr[3],asset)).profit,before-cap);
 await fails(vault.connect(signers[3]).withdrawProfit(asset,1n,{gasLimit:500000}));
 await warp(90*86400);await tx(vault.connect(signers[3]).withdrawPrincipal(0,initial,{gasLimit:500000}));
 assert.equal(await vault.profitWithdrawalCap(addr[3],asset),cap);await solvent();
});

async function networkRoot(){ await deposit(3,E('100')); }
test('all seller tiers keep full seller profit and separately fund exact additive rates',async()=>{
 const rates=[[8,4,2,0],[10,5,3,0],[12,6,4,0],[14,7,5,0],[16,8,6,4]];
 await tx(vault.connect(signers[3]).register(ZeroAddress));
 for(let i=4;i<=7;i++)await tx(vault.connect(signers[i]).register(addr[i-1]));
 for(let i=3;i<=7;i++)await tx(vault.setCustomerStatus(addr[i],true,true));
 await deposit(3,E('50001'));
 const capital=[100,501,2501,10001,50001];let current=0;
 for(let tier=0;tier<5;tier++){
  await deposit(7,E(String(capital[tier]-current)),token.target,addr[6]);current=capital[tier];
  assert.deepEqual(Array.from((await vault.tierConfig(tier)).referrals),rates[tier].map(x=>BigInt(x*100)));
  const before=await Promise.all([3,4,5,6,7].map(i=>vault.accounts(addr[i],token.target)));
  await sale(7,E('100'),token.target,'rates-'+tier);
  let paid=0n;for(let level=0;level<4;level++){const index=6-level;const delta=(await vault.accounts(addr[index],token.target)).profit-before[index-3].profit;assert.equal(delta,E(String(rates[tier][level])));paid+=delta;}
  assert.equal((await vault.accounts(addr[7],token.target)).profit-before[4].profit,E('100'));assert.equal((await vault.ledgers(token.target)).rewards,0n);
 }
});
test('governance accepts VIP 34 percent and rejects excess and non-VIP fourth level',async()=>{
 const t=await vault.tierConfig(4);const good=[t.minUsd,t.baseDailyBps,t.maxDailyBps,t.requiredDirect,t.requiredSalesUsd,[1600,800,600,400]];
 await queueCall('setTierConfig',[4,good]);assert.deepEqual(Array.from((await vault.tierConfig(4)).referrals),[1600n,800n,600n,400n]);
 good[5]=[1601,800,600,400];const h=keccak256(vault.interface.encodeFunctionData('setTierConfig',[4,good]));await tx(vault.queueConfiguration(h));await approveConfig(h);await warp(2*86400);await fails(vault.setTierConfig(4,good));
});
test('rank caps match all fourteen goals, and arbitrary many lines can qualify',async()=>{
 await networkRoot();await groupDeposit([4,5,6,7,8],[2000,2000,2000,2000,2000]);
 assert.equal(await vault.rankQualified(addr[3],5,E('10000')),true);
 assert.equal(await vault.rankQualified(addr[3],6,E('10000')),false);
 assert.equal(await vault.networkBranchCount(addr[3]),5n);
 let summed=0n;for(let start=0;start<5;start+=2){const page=await vault.rankVolumePage(addr[3],E('10000'),start,2);summed+=page.eligibleUsd;assert.equal(page.next,BigInt(Math.min(5,start+2)));}assert.equal(summed,E('10000'));
 for(let i=0;i<14;i++){const [target]=await vault.rewardStage(i);assert.equal(await vault.branchCapBps(target),BigInt(i<5?6000:i<8?4500:3500));}
 await fails(vault.rankVolumePage(addr[3],E('10000'),0,65));await fails(vault.rankVolumePage(addr[3],0,0,1));
});
test('ten-thousand goal clips a dominant branch; equality and one-wei shortage are exact',async()=>{
 await networkRoot();await groupDeposit([4,5,6],[8000,1000,1000]);
 assert.equal(await vault.rankQualified(addr[3],3,E('10000')),false);
 assert.equal((await vault.rankVolumePage(addr[3],E('10000'),0,64)).eligibleUsd,E('8000'));
 await deposit(7,E('2000')-1n,token.target,addr[3]);assert.equal(await vault.rankQualified(addr[3],4,E('10000')),false);
 await tx(vault.settleSalesProfit(id('one-wei'),token.target,addr[7],1n,1n,id('evidence')));
 assert.equal(await vault.rankQualified(addr[3],4,E('10000')),true);
});
test('reward groups grow beyond three lines without reusing branches or resetting progress',async()=>{
 await networkRoot();await groupDeposit([4,5,6,7,8],[100,100,100,100,100]);await groupCreate([4,5]);
 assert.equal((await vault.rewardPreview(addr[3],0)).eligible,false);
 await tx(vault.connect(signers[3]).addRewardBranches(0,[addr[6],addr[7],addr[8]]));
 assert.equal((await vault.rewardPreview(addr[3],0)).eligible,true);
 await tx(vault.fundRewards(token.target,E('35')));await tx(vault.connect(signers[3]).claimNetworkReward(0));
 const group=await vault.rewardGroup(addr[3],0);assert.equal(group.stage,1n);assert.deepEqual(Array.from(group.consumedUsd),Array(5).fill(E('100')));
 await fails(vault.connect(signers[3]).addRewardBranches(0,[addr[4]]));await fails(vault.connect(signers[3]).createRewardGroup([addr[8]]));await fails(vault.connect(signers[4]).addRewardBranches(0,[addr[5]]));
});
test('partial preparation cannot exceed the per-line cap, replay volume, or lose reservations on a failed payout',async()=>{
 await networkRoot();await groupDeposit([4,5],[1000,10]);await groupCreate([4,5]);
 await tx(vault.connect(signers[3]).prepareNetworkReward(0,64,{gasLimit:600000}));
 assert.equal((await vault.rewardProgress(addr[3],0)).preparedUsd,E('310'));
 for(let i=0;i<2;i++)await tx(vault.connect(signers[3]).prepareNetworkReward(0,64,{gasLimit:600000}));
 assert.equal((await vault.rewardProgress(addr[3],0)).preparedUsd,E('310'));
 assert.equal((await vault.rewardBranch(addr[3],0,0)).reservedForStageUsd,E('300'));
 await deposit(5,E('190'),token.target,addr[3]);await tx(vault.connect(signers[3]).prepareNetworkReward(0,64,{gasLimit:600000}));
 const before=(await vault.rewardGroup(addr[3],0)).toArray(true);await fails(vault.connect(signers[3]).claimNetworkReward(0));assert.deepEqual((await vault.rewardGroup(addr[3],0)).toArray(true),before);
 await tx(vault.fundRewards(token.target,E('35')));await tx(vault.connect(signers[3]).claimNetworkReward(0));assert.equal((await vault.accounts(addr[3],token.target)).profit,E('35'));
 assert.equal((await vault.rewardProgress(addr[3],0)).preparedUsd,0n);await fails(vault.connect(signers[3]).claimNetworkReward(0));
});
test('65 independent branches complete a reward through bounded preparation with no total branch limit',async()=>{
 await networkRoot();const branches=[];
 for(let i=4;i<=68;i++){await tx(vault.connect(signers[i]).register(addr[3]));await tx(vault.settleSalesProfit(id('wide-'+i),token.target,addr[i],1n,E(String(i===68?52:7)),id('receipt'),{gasLimit:1500000}));branches.push(addr[i]);}
 await tx(vault.connect(signers[3]).createRewardGroup(branches.slice(0,64),{gasLimit:8000000}));await tx(vault.connect(signers[3]).addRewardBranches(0,branches.slice(64)));
 await tx(vault.fundRewards(token.target,E('35')));await fails(vault.connect(signers[3]).claimNetworkReward(0,{gasLimit:12000000}));
 assert.equal((await vault.rewardProgress(addr[3],0)).preparedUsd,0n);
 const receipt=await tx(vault.connect(signers[3]).prepareNetworkReward(0,64,{gasLimit:8000000}));assert.ok(receipt.gasUsed<8000000n);
 assert.equal((await vault.rewardProgress(addr[3],0)).preparedUsd,E('448'));
 await tx(vault.connect(signers[3]).claimNetworkReward(0));assert.equal((await vault.accounts(addr[3],token.target)).profit,E('35'));assert.equal((await vault.rewardProgress(addr[3],0)).stage,1n);
 const g=await vault.rewardGroup(addr[3],0);assert.equal(g.consumedUsd.reduce((a,b)=>a+b,0n),E('500'));
 await fails(vault.connect(signers[3]).prepareNetworkReward(0,0));await fails(vault.connect(signers[3]).prepareNetworkReward(0,65));
});
async function groupDeposit(indices,amounts){for(let j=0;j<indices.length;j++)await deposit(indices[j],E(String(amounts[j])),token.target,addr[3]);}
async function groupCreate(indices){await tx(vault.connect(signers[3]).createRewardGroup(indices.map(i=>addr[i])));}
test('network reward table is exact across all fourteen stages',async()=>{
 const volumes=[500,1000,3000,5000,10000,30000,50000,100000,300000,500000,1000000,3000000,5000000,10000000];
 const rewards=[35,70,210,350,700,1800,3000,6000,15000,25000,50000,90000,150000,300000];
 for(let i=0;i<14;i++)assert.deepEqual(Array.from(await vault.rewardStage(i)),[E(String(volumes[i])),E(String(rewards[i]))]);
 await fails(vault.rewardStage(14));
 for(let i=0;i<5;i++)assert.equal((await vault.tierConfig(i)).requiredDirect,BigInt([4,6,8,10,12][i]));
});
test('rank aggregates capped independent branches and four capital-qualified directs',async()=>{
 await networkRoot();await groupDeposit([4,5,6,7],[1500,500,399,100]);
 assert.equal(await vault.qualifiedDirects(addr[3]),4n);
 assert.equal(await vault.dailyTargetBps(addr[3]),50n);
 await deposit(6,E('10'),token.target,addr[3]);
 assert.equal(await vault.dailyTargetBps(addr[3]),100n);
 await warp(90*86400);await tx(vault.connect(signers[7]).withdrawPrincipal(0,E('1'),{gasLimit:600000}));
 assert.equal(await vault.qualifiedDirects(addr[3]),3n);assert.equal(await vault.dailyTargetBps(addr[3]),50n);
 await refresh();await deposit(7,E('10'),token.target,addr[3]);assert.equal(await vault.qualifiedDirects(addr[3]),4n);
});
test('two disjoint triplets earn separately; branch reassignment and duplicate branches rejected',async()=>{
 await networkRoot();await groupDeposit([4,5,6,7,8,9],[300,100,100,300,100,100]);
 await fails(vault.connect(signers[3]).createRewardGroup([addr[4],addr[4],addr[6]]));
 await fails(vault.connect(signers[3]).createRewardGroup([addr[4],addr[5],addr[0]]));
 await groupCreate([4,5,6]);await groupCreate([7,8,9]);
 await fails(vault.connect(signers[3]).createRewardGroup([addr[4],addr[8],addr[9]]));
 await tx(vault.fundRewards(token.target,E('100')));
 await tx(vault.connect(signers[3]).claimNetworkReward(0));await tx(vault.connect(signers[3]).claimNetworkReward(1));
 assert.equal((await vault.accounts(addr[3],token.target)).profit,E('70'));
 assert.equal((await vault.ledgers(token.target)).rewards,E('30'));
 await fails(vault.connect(signers[3]).claimNetworkReward(0));
});
test('second reward consumes 1000 additional volume, keeps surplus and cannot replay first reward',async()=>{
 await networkRoot();await groupDeposit([4,5,6],[300,100,100]);await groupCreate([4,5,6]);
 await tx(vault.fundRewards(token.target,E('200')));await tx(vault.connect(signers[3]).claimNetworkReward(0));
 await groupDeposit([4,5,6],[600,200,190]);assert.equal((await vault.rewardPreview(addr[3],0)).eligible,false);
 await deposit(6,E('10'),token.target,addr[3]);await tx(vault.connect(signers[3]).claimNetworkReward(0,{gasLimit:600000}));
 assert.equal((await vault.accounts(addr[3],token.target)).profit,E('105'));
 assert.deepEqual(Array.from((await vault.rewardGroup(addr[3],0)).consumedUsd),[E('900'),E('300'),E('300')]);
 assert.equal((await vault.rewardGroup(addr[3],0)).stage,2n);
 await fails(vault.connect(signers[3]).claimNetworkReward(0));
});
test('unfunded, stale oracle, paused and empty-cash reward claims roll back stage and consumed volume',async()=>{
 await networkRoot();await groupDeposit([4,5,6],[300,100,100]);await groupCreate([4,5,6]);
 await fails(vault.connect(signers[3]).claimNetworkReward(0));
 await tx(vault.fundRewards(token.target,E('35')));await warp(90000);
 await fails(vault.connect(signers[3]).claimNetworkReward(0));await refresh();
 await tx(vault.setPaused(true));await fails(vault.connect(signers[3]).claimNetworkReward(0));await tx(vault.setPaused(false));
 await tx(vault.ownerWithdrawCapital(token.target,addr[0],await token.balanceOf(vault.target)));
 await fails(vault.connect(signers[3]).claimNetworkReward(0));
 assert.equal((await vault.rewardGroup(addr[3],0)).stage,0n);
 assert.deepEqual(Array.from((await vault.rewardGroup(addr[3],0)).consumedUsd),[0n,0n,0n]);
 await tx(vault.returnCapital(token.target,E('35')));await tx(vault.connect(signers[3]).claimNetworkReward(0,{gasLimit:600000}));
 assert.equal((await vault.accounts(addr[3],token.target)).profit,E('35'));
});
test('deposit, reinvest and reported sales add once under the immediate branch; returns and rewards add no volume',async()=>{
 await networkRoot();await deposit(4,E('100'),token.target,addr[3]);
 await deposit(5,E('0.5'),ZeroAddress,addr[4]);
 assert.equal(await vault.branchVolumeUsd(addr[3],addr[4]),E('400'));
 await sale(5,E('100'),token.target,'mixed');
 assert.equal(await vault.branchVolumeUsd(addr[3],addr[4]),E('1400'));
 await tx(vault.connect(signers[5]).reinvest(token.target,E('100')));
 assert.equal(await vault.branchVolumeUsd(addr[3],addr[4]),E('1500'));
 assert.equal(await vault.branchVolumeUsd(addr[3],addr[5]),0n);
 await fails(vault.settleSalesProfit(id('mixed'),token.target,addr[5],E('100'),E('1000'),id('receipt')));
 await tx(vault.returnCapital(token.target,E('10')));
 assert.equal(await vault.branchVolumeUsd(addr[3],addr[4]),E('1500'));
});
test('bounded ancestry processing resumes without loss or duplicate volume',async()=>{
 await tx(vault.connect(signers[3]).register(ZeroAddress));
 for(let i=4;i<=13;i++)await tx(vault.connect(signers[i]).register(addr[i-1]));
 await deposit(13,E('100'),token.target,addr[12]);
 assert.equal(await vault.branchVolumeUsd(addr[3],addr[4]),0n);
 const job=(await vault.volumeJobCount())-1n;
 await fails(vault.processNetworkVolume(job,65));await fails(vault.processNetworkVolume(job,0));
 await tx(vault.connect(signers[9]).processNetworkVolume(job,1));
 await tx(vault.processNetworkVolume(job,64));assert.equal(await vault.branchVolumeUsd(addr[3],addr[4]),E('100'));
 await tx(vault.processNetworkVolume(job,64));assert.equal(await vault.branchVolumeUsd(addr[3],addr[4]),E('100'));
 assert.equal((await vault.volumeJobs(job)).ancestor,ZeroAddress);
});
test('excess dominant branch is clipped and other branches supply the remainder',async()=>{
 await networkRoot();await groupDeposit([4,5,6,7],[100,100,100,5000]);
 assert.equal(await vault.networkBranchCount(addr[3]),4n);
 assert.equal(await vault.rankQualified(addr[3],4,E('2500')),false);
 await groupCreate([7,4,5]);assert.equal((await vault.rewardPreview(addr[3],0)).eligible,true);
 await tx(vault.fundRewards(token.target,E('100')));await tx(vault.connect(signers[3]).claimNetworkReward(0));
 assert.equal((await vault.rewardPreview(addr[3],0)).eligible,false);
});
test('all fourteen rewards consume exact cumulative volume then stop; withdrawal retains existing fee and cap',async()=>{
 await networkRoot();for(const i of [4,5,6])await tx(vault.connect(signers[i]).register(addr[3]));
 let total=0n,totalRewards=0n;for(let i=0;i<14;i++){const s=await vault.rewardStage(i);total+=s[0];totalRewards+=s[1];}
 const volumes=[0n,0n,0n];for(let i=0;i<14;i++){const [target]=await vault.rewardStage(i);const cap=target*BigInt(i<5?60:i<8?45:35)/100n;let left=target;for(let j=0;j<3;j++){const n=left<cap?left:cap;volumes[j]+=n;left-=n;}}
 for(let j=0;j<3;j++)await tx(vault.settleSalesProfit(id('all'+j),token.target,addr[j+4],E('1'),volumes[j],id('evidence'),{gasLimit:1500000}));
 await groupCreate([4,5,6]);await tx(vault.fundRewards(token.target,totalRewards));
 for(let i=0;i<14;i++)await tx(vault.connect(signers[3]).claimNetworkReward(0,{gasLimit:600000}));
 assert.equal((await vault.accounts(addr[3],token.target)).profit,totalRewards);
 assert.deepEqual(Array.from((await vault.rewardGroup(addr[3],0)).consumedUsd),volumes);
 assert.equal((await vault.rewardPreview(addr[3],0)).eligible,false);
 await fails(vault.connect(signers[3]).claimNetworkReward(0));
 await fails(vault.connect(signers[3]).withdrawProfit(token.target,E('10.01')));
 const fee=await vault.WITHDRAWAL_FEE_WALLET();const before=await token.balanceOf(fee);
 await tx(vault.connect(signers[3]).withdrawProfit(token.target,E('10')));
 assert.equal(await token.balanceOf(fee)-before,E('0.5'));
});

// Independent state model: volume is computed from source ancestry, not the Solidity top-three algorithm.
test('health: seeded 72-operation model preserves every branch total, ranking and qualified-direct count',async()=>{
 const parent={3:0,4:3,5:3,6:3,7:3,8:4,9:4,10:5,11:6,12:7,13:8};
 const expected=new Map(),capital=new Map();let seed=0x51a0beef;
 const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let i=3;i<=13;i++){await tx(vault.connect(signers[i]).register(parent[i]?addr[parent[i]]:ZeroAddress));capital.set(i,0n);}
 const record=(source,usd)=>{let child=source;while(parent[child]){const p=parent[child],k=p+':'+child;expected.set(k,(expected.get(k)||0n)+usd);child=p;}};
 for(let step=0;step<72;step++){
  const who=4+next()%10,kind=next()%3;
  if(kind===0){const amount=E(String(10+next()%250));await deposit(who,amount,token.target,addr[parent[who]]);record(who,amount);capital.set(who,capital.get(who)+amount);}
  if(kind===1){const amount=E(String(2+next()%9))/100n,usd=amount*600n;await deposit(who,amount,ZeroAddress,addr[parent[who]]);record(who,usd);capital.set(who,capital.get(who)+usd);}
  if(kind===2){const usd=E(String(1+next()%1000));await tx(vault.settleSalesProfit(id('model'+step),token.target,addr[who],E('1'),usd,id('model-evidence'),{gasLimit:1500000}));record(who,usd);}
  if(step%12===11){
   for(let p=3;p<=13;p++){
    const children=Object.keys(parent).map(Number).filter(i=>parent[i]===p);
    let qualified=0n;const volumes=[];
    for(const child of children){const value=expected.get(p+':'+child)||0n;assert.equal(await vault.branchVolumeUsd(addr[p],addr[child]),value);volumes.push(value);if(capital.get(child)>=E('100'))qualified++;}
    assert.equal(await vault.qualifiedDirects(addr[p]),qualified);
    const count=Number(await vault.networkBranchCount(addr[p]));const nonzero=children.filter(i=>(expected.get(p+':'+i)||0n)>0n);assert.equal(count,nonzero.length);
    const seen=new Set();for(let k=0;k<count;k++){const child=await vault.networkBranch(addr[p],k);assert.ok(!seen.has(child));seen.add(child);assert.ok(nonzero.some(i=>addr[i]===child));}
    for(const goal of [1000n,30000n,300000n]){const target=goal*10n**18n,cap=target*(goal<=10000n?60n:goal<=100000n?45n:35n)/100n;const capped=volumes.reduce((sum,v)=>sum+(v<cap?v:cap),0n);assert.equal(await vault.rankQualified(addr[p],0,target),capped>=target);}

   }
  }
 }
});
test('health: reward caps follow remaining volume; failed claim cannot advance',async()=>{
 await networkRoot();await groupDeposit([4,5,6],[300,100,100]);await groupCreate([4,5,6]);await tx(vault.fundRewards(token.target,E('200')));
 await tx(vault.connect(signers[3]).claimNetworkReward(0));
 await groupDeposit([4,5,6],[100,600,290]);
 const before=await vault.rewardGroup(addr[3],0);await fails(vault.connect(signers[3]).claimNetworkReward(0));assert.deepEqual((await vault.rewardGroup(addr[3],0)).toArray(true),before.toArray(true));
 await deposit(6,E('10'),token.target,addr[3]);const preview=await vault.rewardPreview(addr[3],0);
 assert.equal(preview.eligible,true);assert.deepEqual(Array.from(preview.consume),[E('100'),E('600'),E('300')]);
 const cash=await token.balanceOf(vault.target),debt=await vault.accounted(token.target);
 await tx(vault.connect(signers[3]).claimNetworkReward(0,{gasLimit:600000}));
 assert.equal(await token.balanceOf(vault.target),cash);assert.equal(await vault.accounted(token.target),debt);
 assert.deepEqual(Array.from((await vault.rewardGroup(addr[3],0)).consumedUsd),[E('400'),E('700'),E('400')]);
});
test('health: independent accounts cannot claim another user group; rejected group creation is atomic',async()=>{
 await networkRoot();await groupDeposit([4,5,6],[300,100,100]);
 await fails(vault.connect(signers[3]).createRewardGroup([addr[4],addr[5],addr[4]]));
 assert.equal(await vault.groupedBranch(addr[3],addr[4]),false);assert.equal(await vault.groupedBranch(addr[3],addr[5]),false);
 await groupCreate([4,5,6]);await tx(vault.fundRewards(token.target,E('35')));
 await fails(vault.connect(signers[7]).claimNetworkReward(0));await fails(vault.connect(signers[3]).claimNetworkReward(1));
 assert.equal((await vault.rewardGroup(addr[3],0)).stage,0n);assert.equal((await vault.ledgers(token.target)).rewards,E('35'));
});
test('health: incomplete deep-volume jobs can finish out of order without replay or cross-branch attribution',async()=>{
 await tx(vault.connect(signers[3]).register(ZeroAddress));for(let i=4;i<=13;i++)await tx(vault.connect(signers[i]).register(addr[i-1]));
 await deposit(13,E('100'),token.target,addr[12]);await deposit(12,E('200'),token.target,addr[11]);
 assert.equal(await vault.volumeJobCount(),2n);
 await tx(vault.processNetworkVolume(1,1));await tx(vault.processNetworkVolume(0,1));
 assert.equal(await vault.branchVolumeUsd(addr[3],addr[4]),E('200'));
 await tx(vault.processNetworkVolume(0,1));await tx(vault.processNetworkVolume(1,64));await tx(vault.processNetworkVolume(0,64));
 assert.equal(await vault.branchVolumeUsd(addr[3],addr[4]),E('300'));
 for(let p=3;p<12;p++)assert.equal(await vault.branchVolumeUsd(addr[p],addr[p+1]),E('300'));
 assert.equal(await vault.branchVolumeUsd(addr[12],addr[13]),E('100'));
 await fails(vault.processNetworkVolume(2,1));
});
test('health: full principal withdrawal removes active direct once but preserves historical volume and cap',async()=>{
 await networkRoot();await deposit(4,E('100'),token.target,addr[3]);await tx(vault.setCustomerStatus(addr[4],true,false));
 assert.equal(await vault.qualifiedDirects(addr[3]),1n);await warp(90*86400);
 await tx(vault.connect(signers[4]).withdrawPrincipal(0,E('1'),{gasLimit:600000}));assert.equal(await vault.qualifiedDirects(addr[3]),0n);
 await warp(72*3600);await tx(vault.connect(signers[4]).withdrawPrincipal(0,E('99'),{gasLimit:600000}));
 assert.equal(await vault.qualifiedDirects(addr[3]),0n);assert.equal(await vault.branchVolumeUsd(addr[3],addr[4]),E('100'));
 assert.equal(await vault.profitWithdrawalCap(addr[4],token.target),E('10'));
 await fails(vault.connect(signers[4]).withdrawPrincipal(0,1n));
});
test('health: decimal and depeg conversion credits funded USDT units, not a hard-coded dollar peg',async()=>{
 const t=await deploy('MockToken',[6]);const v=await deploy('DropshippingVault',[addr[0],t.target,bnbFeed.target,usdFeed.target,86400,[addr[0],addr[1],addr[2],addr[8],addr[9],addr[10],addr[11]],addr[14]]);
 await tx(v.connect(signers[3]).register(ZeroAddress));
 for(const i of [4,5,6])await tx(v.connect(signers[i]).register(addr[3]));
 await tx(t.mint(addr[0],1000n*10n**6n));await tx(t.approve(v.target,1000n*10n**6n));
 for(let j=0;j<3;j++)await tx(v.settleSalesProfit(id('decimal'+j),t.target,addr[j+4],1_000_000n,E(String([300,100,100][j])),id('receipt'),{gasLimit:1500000}));
 await tx(v.connect(signers[3]).createRewardGroup([addr[4],addr[5],addr[6]]));await tx(v.fundRewards(t.target,100_000_000n));
 const b=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]});await tx(usdFeed.set(80_000_000n,Number(b.timestamp),1,1));
 await tx(v.connect(signers[3]).claimNetworkReward(0));
 assert.equal((await v.accounts(addr[3],t.target)).profit,43_750_000n);assert.equal((await v.ledgers(t.target)).rewards,56_250_000n);
});
test('health: a BNB-only member needs USDT cap for USDT rewards; reinvest creates that cap',async()=>{
 await deposit(3,E('1'),ZeroAddress);await groupDeposit([4,5,6],[300,100,100]);await groupCreate([4,5,6]);
 await tx(vault.fundRewards(token.target,E('35')));await tx(vault.connect(signers[3]).claimNetworkReward(0));
 assert.equal(await vault.profitWithdrawalCap(addr[3],token.target),0n);await fails(vault.connect(signers[3]).withdrawProfit(token.target,E('1')));
 await tx(vault.connect(signers[3]).reinvest(token.target,E('10')));
 assert.equal(await vault.profitWithdrawalCap(addr[3],token.target),E('1'));await tx(vault.connect(signers[3]).withdrawProfit(token.target,E('1'),{gasLimit:600000}));
});
test('health: local deployment and deepest automatic deposit fit explicit gas budgets',async()=>{
 const a=artifact('DropshippingVault');assert.ok(a.evm.deployedBytecode.object.length/2<=24576);
 const receipt=await vault.deploymentTransaction().wait();assert.ok(receipt.gasUsed<8_000_000n,'deployment gas');
 await tx(vault.connect(signers[3]).register(ZeroAddress));for(let i=4;i<=13;i++)await tx(vault.connect(signers[i]).register(addr[i-1]));
 const depositReceipt=await tx(vault.connect(signers[13]).deposit(token.target,E('100'),addr[12],{gasLimit:1500000}));assert.ok(depositReceipt.gasUsed<1_500_000n);
 console.log('HEALTH_GAS '+JSON.stringify({deployment:receipt.gasUsed.toString(),eightAncestorDeposit:depositReceipt.gasUsed.toString(),runtimeBytes:a.evm.deployedBytecode.object.length/2}));
});
test('health: 74-level ancestry processes a full 64-step batch within gas budget and preserves final two ancestors',async()=>{
 await tx(vault.connect(signers[3]).register(ZeroAddress));for(let i=4;i<=77;i++)await tx(vault.connect(signers[i]).register(addr[i-1]));
 await deposit(77,E('0.2'),ZeroAddress,addr[76]);const job=(await vault.volumeJobCount())-1n;
 assert.equal((await vault.volumeJobs(job)).ancestor,addr[68]);
 const receipt=await tx(vault.processNetworkVolume(job,64,{gasLimit:12_000_000}));
 assert.equal((await vault.volumeJobs(job)).ancestor,addr[4]);assert.equal(await vault.branchVolumeUsd(addr[3],addr[4]),0n);
 assert.ok(receipt.gasUsed<12_000_000n);await tx(vault.processNetworkVolume(job,64));
 assert.equal((await vault.volumeJobs(job)).ancestor,ZeroAddress);assert.equal(await vault.branchVolumeUsd(addr[3],addr[4]),E('120'));
 console.log('HEALTH_QUEUE_GAS '+receipt.gasUsed.toString());
});

for (const native of [false,true]) test(`small ${native?'BNB':'USDT'} reinvest is independent of deposit minimum and preserves accounting`,async()=>{
 const asset=native?ZeroAddress:token.target, small=native?E('0.00001'):E('0.01');
 await deposit(3,native?E('1'):E('100'),asset); await sale(3,native?E('0.01'):E('1'),asset,'small-reinvest');
 await queueCall('setMinDeposit',[E('20')]); await refresh();
 assert.equal(await vault.minDepositUsd(),E('20'));
 await fails(vault.connect(signers[3]).deposit(asset,small,ZeroAddress,{...(native?{value:small}:{}),gasLimit:1500000}));
 const a=await vault.accounts(addr[3],asset),cash=await vault.assetBalance(asset),count=await vault.positionCount(addr[3]);
 const wallets=[await vault.FEE_WALLET_1(),await vault.FEE_WALLET_2(),await vault.dropshippingWallet()];
 const balances=await Promise.all(wallets.map(w=>native?provider.getBalance(w):token.balanceOf(w)));
 const usd=await vault.quoteUsd(asset,small),capital=(await vault.users(addr[3])).capitalUsd;
 await tx(vault.connect(signers[3]).reinvest(asset,small));
 const b=await vault.accounts(addr[3],asset),pos=await vault.positionOf(addr[3],count);
 assert.equal(b.profit,a.profit-small);assert.equal(b.principal,a.principal+small);
 assert.equal(b.externalDeposited,a.externalDeposited);assert.equal(b.nextWithdrawal,a.nextWithdrawal);
 assert.equal(await vault.assetBalance(asset),cash);assert.equal(await vault.cumulativeReinvested(addr[3],asset),small);
 assert.equal(await vault.profitWithdrawalCap(addr[3],asset),(a.externalDeposited+small)/10n);
 assert.equal((await vault.users(addr[3])).capitalUsd,capital+usd);assert.equal(pos.principal,small);assert.equal(pos.capitalUsd,usd);
 assert.deepEqual(await Promise.all(wallets.map(w=>native?provider.getBalance(w):token.balanceOf(w))),balances);
 await fails(vault.connect(signers[3]).reinvest(asset,0n,{gasLimit:1000000}));
 await fails(vault.connect(signers[3]).reinvest(asset,b.profit+1n,{gasLimit:1000000}));
 assert.equal(await vault.positionCount(addr[3]),count+1n);assert.equal((await vault.accounts(addr[3],asset)).profit,b.profit);
});
test('reinvest rejects zero-dollar rounding dust without consuming profit',async()=>{
 await deposit();await sale();const b=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]});
 await tx(usdFeed.set(50000000n,Number(b.timestamp),1,1));
 assert.equal(await vault.quoteUsd(token.target,1n),0n);
 const a=await vault.accounts(addr[3],token.target);
 await fails(vault.connect(signers[3]).reinvest(token.target,1n,{gasLimit:1000000}));
 assert.equal((await vault.accounts(addr[3],token.target)).profit,a.profit);
});

test('reviewed stage guards reject stale preparation and claims without consuming the next stage',async()=>{
 await networkRoot();await groupDeposit([4,5],[1000,1000]);await groupCreate([4,5]);
 await tx(vault.fundRewards(token.target,E('105')));
 assert.equal(await vault.NETWORK_PLAN_VERSION(),2n);
 await tx(vault.connect(signers[3]).prepareNetworkRewardAtStage(0,0,64));
 await tx(vault.connect(signers[3]).claimNetworkRewardAtStage(0,0));
 const before=(await vault.rewardGroup(addr[3],0)).toArray(true);
 const profit=(await vault.accounts(addr[3],token.target)).profit;
 await assert.rejects(vault.connect(signers[3]).claimNetworkRewardAtStage.staticCall(0,0),e=>e.revert?.name==='NetworkStageChanged');
 await fails(vault.connect(signers[3]).prepareNetworkRewardAtStage(0,0,64,{gasLimit:700000}));
 await fails(vault.connect(signers[3]).claimNetworkRewardAtStage(0,0,{gasLimit:700000}));
 assert.deepEqual((await vault.rewardGroup(addr[3],0)).toArray(true),before);
 assert.equal((await vault.accounts(addr[3],token.target)).profit,profit);
 await tx(vault.connect(signers[3]).prepareNetworkRewardAtStage(0,1,64));
 await tx(vault.connect(signers[3]).claimNetworkRewardAtStage(0,1));
 assert.equal((await vault.accounts(addr[3],token.target)).profit,E('105'));
 assert.equal((await vault.rewardProgress(addr[3],0)).stage,2n);
 await fails(vault.connect(signers[3]).prepareNetworkRewardAtStage(9,0,64));
});
test('guarded preparation preserves reservations when liquidity is missing and when paused',async()=>{
 await networkRoot();await groupDeposit([4,5],[300,200]);await groupCreate([4,5]);
 await tx(vault.connect(signers[3]).prepareNetworkRewardAtStage(0,0,64));
 const before=(await vault.rewardGroup(addr[3],0)).toArray(true);
 await fails(vault.connect(signers[3]).claimNetworkRewardAtStage(0,0,{gasLimit:700000}));
 await tx(vault.setPaused(true));
 await fails(vault.connect(signers[3]).prepareNetworkRewardAtStage(0,0,64,{gasLimit:700000}));
 assert.deepEqual((await vault.rewardGroup(addr[3],0)).toArray(true),before);
 await tx(vault.setPaused(false));await tx(vault.fundRewards(token.target,E('35')));
 await tx(vault.connect(signers[3]).claimNetworkRewardAtStage(0,0));
 assert.equal((await vault.accounts(addr[3],token.target)).profit,E('35'));
});

for(const native of [false,true])test(`additive ${native?'BNB':'USDT'} settlement credits 100 plus 14 and atomically rejects underfunding`,async()=>{
 const asset=native?ZeroAddress:token.target,amount=E(native?'1':'100'),commission=amount*14n/100n;
 await tx(vault.connect(signers[3]).register(ZeroAddress));for(let i=4;i<=6;i++)await tx(vault.connect(signers[i]).register(addr[i-1]));
 for(let i=3;i<=5;i++)await tx(vault.setCustomerStatus(addr[i],true,false));
 const key=id('additive'),volume=E('1000'),supply=await token.totalSupply();
 const settle=()=>vault.settleSalesProfit(key,asset,addr[6],amount,volume,id('evidence'),{...(native?{value:amount}:{}),gasLimit:1500000});
 const beforeCash=await vault.assetBalance(asset);
 await fails(settle());assert.equal(await vault.usedSettlement(key),false);assert.equal((await vault.users(addr[6])).salesUsd,0n);assert.equal(await vault.assetBalance(asset),beforeCash);
 await tx(vault.fundRewards(asset,commission-1n,{...(native?{value:commission-1n}:{}),gasLimit:500000}));
 await fails(settle());assert.equal((await vault.ledgers(asset)).rewards,commission-1n);assert.equal((await vault.accounts(addr[6],asset)).profit,0n);
 await tx(vault.fundRewards(asset,1n,{...(native?{value:1n}:{}),gasLimit:500000}));
 const cash=await vault.assetBalance(asset);await tx(vault.ownerWithdrawCapital(asset,addr[0],cash));
 await fails(settle());assert.equal(await vault.usedSettlement(key),false);assert.equal((await vault.ledgers(asset)).rewards,commission);assert.equal(await vault.assetBalance(asset),0n);
 await tx(vault.returnCapital(asset,commission,{...(native?{value:commission}:{}),gasLimit:500000}));
 await tx(settle());assert.equal((await vault.accounts(addr[6],asset)).profit,amount);
 for(const [i,rate]of [[5,8n],[4,4n],[3,2n]])assert.equal((await vault.accounts(addr[i],asset)).profit,amount*rate/100n);
 assert.equal((await vault.ledgers(asset)).profit,amount+commission);assert.equal((await vault.ledgers(asset)).rewards,0n);assert.equal(await vault.assetBalance(asset),amount+commission);
 assert.equal(await token.totalSupply(),supply);assert.equal(await vault.SALES_REFERRAL_MODEL_VERSION(),2n);await fails(settle());
});
test('skipped uplines retain the reserved share without reducing seller profit or creating referral volume',async()=>{
 await tx(vault.connect(signers[3]).register(ZeroAddress));for(let i=4;i<=6;i++)await tx(vault.connect(signers[i]).register(addr[i-1]));
 for(const i of [3,5])await tx(vault.setCustomerStatus(addr[i],true,false));
 await tx(vault.fundRewards(token.target,E('14')));const supply=await token.totalSupply();
 await tx(vault.settleSalesProfit(id('skipped'),token.target,addr[6],E('100'),E('1000'),id('evidence')));
 assert.equal((await vault.accounts(addr[6],token.target)).profit,E('100'));assert.equal((await vault.accounts(addr[5],token.target)).profit,E('8'));assert.equal((await vault.accounts(addr[4],token.target)).profit,0n);assert.equal((await vault.accounts(addr[3],token.target)).profit,E('2'));
 assert.equal((await vault.ledgers(token.target)).rewards,E('4'));assert.equal((await vault.ledgers(token.target)).profit,E('110'));assert.equal(await vault.assetBalance(token.target),E('10114'));assert.equal(await vault.branchVolumeUsd(addr[5],addr[6]),E('1000'));assert.equal(await token.totalSupply(),supply);
});
