import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Interface,parseEther,ZeroAddress,ZeroHash,keccak256,toUtf8Bytes,zeroPadValue} from 'ethers';
import {compile} from '../scripts/compile.mjs';
const E=parseEther, id=s=>keccak256(toUtf8Bytes(s));
let rpc,provider,signers,addr,vault,token,bnbFeed,usdFeed,snapshot,output;
const artifact=n=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json'));
async function deploy(n,args=[]) { const a=artifact(n); const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signers[0]).deploy(...args); await c.waitForDeployment(); return c; }
async function tx(p) {return (await p).wait();}
async function fails(p) {await assert.rejects(async()=>{const r=await p;if(r?.wait)await r.wait();});}
async function warp(s) {await rpc.request({method:'evm_increaseTime',params:[s]});await rpc.request({method:'evm_mine',params:[]});}
async function refresh() {const b=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]});for(const [f,p] of [[bnbFeed,600n*10n**8n],[usdFeed,10n**8n]])await tx(f.set(p,Number(b.timestamp),1,1));}
async function deposit(i=3,amount=E('1000'),asset=token.target,parent=ZeroAddress) {await tx(vault.connect(signers[i]).deposit(asset,amount,parent,{...(asset===ZeroAddress?{value:amount}:{}),gasLimit:1500000}));}
async function sale(i=3,amount=E('100'),asset=token.target,key='sale') {await tx(vault.settleSalesProfit(id(key),asset,addr[i],amount,E('1000'),id('receipt'),{...(asset===ZeroAddress?{value:amount}:{}),gasLimit:1500000}));}
async function approveConfig(h) {await tx(vault.voteConfiguration(h));await tx(vault.connect(signers[1]).voteConfiguration(h));}
async function queueCall(name,args) {const data=vault.interface.encodeFunctionData(name,args);await tx(vault.queueConfiguration(keccak256(data)));await approveConfig(keccak256(data));await warp(2*86400);await tx(vault[name](...args,{gasLimit:2000000}));}
// Routed deposits intentionally leave claims unbacked by vault cash. Verify exact reported gap.
async function solvent() {for(const a of [ZeroAddress,token.target]) {const cash=await vault.assetBalance(a), debt=await vault.accounted(a);assert.equal(await vault.liquidityShortfall(a),debt>cash?debt-cash:0n);assert.equal(await vault.surplus(a),cash>debt?cash-debt:0n);}}
before(async()=>{
 compile();
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:15,defaultBalance:100000},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc);provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:15},(_,i)=>provider.getSigner(i)));addr=await Promise.all(signers.map(s=>s.getAddress()));
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
 assert.equal(await token.balanceOf(addr[3])-before,E('90'));await fails(vault.connect(signers[3]).withdrawProfit(token.target,E('1')));
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
 await queueCall('setFees',[1500,4000]);await queueCall('setWithdrawalRules',[120*86400,72*3600]);await refresh();
 await deposit(3,E('100'));const old=await vault.positionOf(addr[3],0),next=await vault.positionOf(addr[3],1);
 assert.equal(old.penaltyBps,3000n);assert.equal(old.unlockAt,p.unlockAt);assert.equal(next.penaltyBps,4000n);
 await fails(vault.setFees(1500,4000)); // consumed queue
});
test('five plan referral table preserved, target never accrues automatic profit',async()=>{
 assert.deepEqual(Array.from((await vault.tierConfig(4)).referrals),[1400n,700n,300n,100n]);
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
 for(const [i,v] of [[6,'6'],[5,'3'],[4,'1.5'],[3,'0'],[7,'89.5']]) assert.equal((await vault.accounts(addr[i],token.target)).profit,E(v));
 await solvent();
});
test('non-VIP and inactive referral shares stay with seller',async()=>{
 await tx(vault.connect(signers[3]).register(ZeroAddress));for(let i=4;i<=7;i++)await tx(vault.connect(signers[i]).register(addr[i-1]));
 for(const i of [3,5,6,7])await tx(vault.setCustomerStatus(addr[i],true,false));await sale(7,E('100'));
 assert.equal((await vault.accounts(addr[3],token.target)).profit,0n);assert.equal((await vault.accounts(addr[4],token.target)).profit,0n);
 assert.equal((await vault.accounts(addr[7],token.target)).profit,E('91'));await solvent();
});
test('invite-count milestones are removed from ABI and do not create profit',async()=>{
 for(const name of ['claimMilestone','setMilestoneBonus','milestoneBonusUsd','milestoneCustomers']) assert.equal(vault.interface.getFunction(name),null);
 await tx(vault.connect(signers[3]).register(ZeroAddress));
 for(let i=4;i<=8;i++){await tx(vault.connect(signers[i]).register(addr[3]));await tx(vault.setCustomerStatus(addr[i],true,false));}
 assert.equal((await vault.accounts(addr[3],token.target)).profit,0n);
});
test('bounded funded batch allocation, replay and over-allocation rejected',async()=>{
 await deposit();await fails(vault.batchProfit(id('batch'),token.target,[addr[3]],[E('10')]));await tx(vault.fundRewards(token.target,E('10')));
 await tx(vault.batchProfit(id('batch'),token.target,[addr[3]],[E('10')]));await fails(vault.batchProfit(id('batch'),token.target,[addr[3]],[1n]));
 await fails(vault.batchProfit(id('other'),token.target,[addr[3]],[]));await solvent();
});
test('reinvest conserves assets, opens new lock, no new deposit fees or external cap inflation',async()=>{
 await deposit();await sale();const balance=await vault.assetBalance(token.target),reserve=(await vault.ledgers(token.target)).feeReserve;
 await tx(vault.connect(signers[3]).reinvest(token.target,E('50')));
 const a=await vault.accounts(addr[3],token.target);assert.equal(a.principal,E('1050'));assert.equal(a.profit,E('50'));assert.equal(a.externalDeposited,E('1000'));
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
 const data=vault.interface.encodeFunctionData('setFees',[1500,4000]),h=keccak256(data);
 await tx(vault.queueConfiguration(h));
 await fails(vault.setFees(1500,4000));await fails(vault.connect(signers[3]).voteConfiguration(h));
 await tx(vault.voteConfiguration(h));await fails(vault.voteConfiguration(h));
 await warp(2*86400);await fails(vault.setFees(1500,4000,{gasLimit:500000}));
 await tx(vault.connect(signers[1]).voteConfiguration(h));
 await fails(vault.connect(signers[1]).setFees(1500,4000,{gasLimit:500000}));
 await tx(vault.setFees(1500,4000,{gasLimit:500000}));assert.equal(await vault.profitFeeBps(),1500n);
 await fails(vault.setFees(1500,4000,{gasLimit:500000}));await fails(vault.voteConfiguration(h));
 await fails(vault.connect(signers[1]).ownerWithdrawCapital(token.target,addr[1],1n));
 for(const name of ['proposeSurplusWithdrawal','voteSurplusWithdrawal','executeSurplusWithdrawal','proposals','hasVoted'])assert.equal(vault.interface.getFunction(name),null);
 for(const sig of ['proposeSurplusWithdrawal(address,address,uint256)','voteSurplusWithdrawal(uint256)','executeSurplusWithdrawal(uint256)'])await fails(signers[1].sendTransaction({to:vault.target,data:id(sig).slice(0,10)+'00'.repeat(96),gasLimit:500000}));
});
test('native withdrawal resists recipient reentrancy',async()=>{
 const attacker=await deploy('ReentrantCustomer',[vault.target]);await tx(attacker.deposit({value:E('1')}));
 await tx(vault.settleSalesProfit(id('attack'),ZeroAddress,attacker.target,E('0.1'),E('1'),id('e'),{value:E('0.1')}));
 await tx(attacker.withdraw(E('0.1'),{gasLimit:1000000}));assert.equal(await attacker.attacked(),true);assert.equal(await attacker.reentrySucceeded(),false);await solvent();
});
test('seeded mixed operation sequence preserves ledger sums and collateral',async()=>{
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
 const config=[10n*10n**18n,50,100,5,E('2500'),[1500,700,300,100]];
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
  assert.equal(await bal(feeWallet)-before,claim.profit/10n);assert.equal(await bal(await vault.FEE_WALLET_1()),old);
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
 // No active direct customers: VIP replaces that old condition.
 assert.equal((await vault.users(addr[3])).activeDirect,0n);
 await sale(7,E('100'),token.target,'vip-on');assert.equal((await vault.accounts(addr[3],token.target)).profit,E('0.5'));
 await tx(vault.setCustomerStatus(addr[3],true,false));await sale(7,E('100'),token.target,'kyc-off');
 assert.equal((await vault.accounts(addr[3],token.target)).profit,E('0.5'));
 await tx(vault.setCustomerStatus(addr[3],true,true));await warp(90*86400);
 await tx(vault.connect(signers[3]).withdrawPrincipal(0,E('2'),{gasLimit:500000}));
 assert.equal(await vault.tierOf(addr[3]),3n);await sale(7,E('100'),token.target,'tier-down');
 assert.equal((await vault.accounts(addr[3],token.target)).profit,E('0.5'));
 assert.equal((await vault.accounts(addr[7],token.target)).profit,E('299.5'));
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
 const changes=[['setReporter',[addr[12],true]],['setFees',[1200,3000]],['setWithdrawalRules',[90*86400,72*3600]],['setMinDeposit',[E('11')]],['setTierConfig',[0,[E('10'),50,100,5,E('2500'),[600,300,150,50]]]],['setPartnerVoteRequired',[2]]];
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
