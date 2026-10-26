import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,MaxUint256,ZeroAddress,keccak256,toUtf8Bytes,parseEther as E} from 'ethers';

// These are local fixtures on a chain with ID56, never calls to a public network.
const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const tx=async request=>(await request).wait();
const batch=value=>keccak256(toUtf8Bytes('mainnet-boundary:'+value));
let rpc,provider,signers,addresses,token,bnbFeed,tokenFeed,vault,queue,snapshot;
const rejected=async(request,name)=>assert.rejects(request,error=>{
 let found=error.revert?.name;
 for(const target of [vault,queue])try{found??=target.interface.parseError(error.data)?.name;}catch{}
 return found===name;
});
const account=async index=>Array.from(await vault.accounts(addresses[index],token.target));
const ledger=async()=>Array.from(await vault.ledgers(token.target));
const deposit=async(index,value='1000')=>tx(vault.connect(signers[index]).deposit(token.target,E(value),ZeroAddress));
async function state(){return {ledger:await ledger(),user:await account(2),used:await vault.usedRewardBatch(batch('atomic')),cash:await vault.assetBalance(token.target),pending:await queue.pending(token.target)};}
async function deploy(name,args){const a=artifact(name),value=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await value.waitForDeployment();return value;}

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:14},chain:{chainId:56,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:14},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(value=>value.getAddress()));
 token=await deploy('MockToken',[18]);bnbFeed=await deploy('MockFeed',[60000000000n]);tokenFeed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('AutomaticGroupVault',[addresses[1],token.target,bnbFeed.target,tokenFeed.target,3600,addresses.slice(5,12),addresses[12]]);
 queue=new Contract(await vault.withdrawalQueue(),artifact('ProfitWithdrawalQueue').abi,signers[1]);
 for(const index of [0,1,2]){await tx(token.mint(addresses[index],E('10000')));await tx(token.connect(signers[index]).approve(vault.target,MaxUint256));}
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('the ordinary contract deploys on local chain56 without fast-testnet authority or test-only entrypoints',async()=>{
 assert.equal((await provider.getNetwork()).chainId,56n);assert.equal(await vault.owner(),addresses[1]);
 assert.equal(await vault.reporters(addresses[0]),false);assert.equal(await vault.reporters(addresses[1]),true);
 assert.equal(vault.interface.hasFunction('FAST_TESTNET_VERSION'),false);assert.equal(vault.interface.hasFunction('mint'),false);
 assert.equal(await queue.APPROVAL_VERSION(),1n);assert.equal(await queue.vault(),vault.target);
 assert.equal(await vault.tokenDecimals(),18n);assert.equal(await vault.quoteUsd(token.target,E('10')),E('10'));
 assert.equal(await vault.quoteUsd(ZeroAddress,E('1')),E('600'));assert.equal(await vault.quoteAsset(ZeroAddress,E('600')),E('1'));
 assert.equal(await queue.requestCount(),0n);assert.equal(await vault.accounted(token.target),0n);
});

test('unauthorized, unfunded, malformed and oversized allocations cannot consume a batch ID or alter balances',async()=>{
 await deposit(2);const owner=vault.connect(signers[1]),id=batch('atomic');
 await rejected(vault.batchProfit.staticCall(id,token.target,[addresses[2]],[E('10')]),'Unauthorized');
 await rejected(owner.batchProfit.staticCall(id,token.target,[addresses[2]],[E('10')]),'Insufficient');
 await tx(vault.fundRewards(token.target,E('100')));const original=await state();
 for(const [recipients,amounts,error]of [
  [[addresses[2],addresses[3]],[E('10'),E('10')],'Invalid'],
  [[addresses[2]],[],'Invalid'],
  [[addresses[2]],[0n],'Invalid'],
  [[addresses[2]],[E('101')],'Insufficient'],
  [Array(101).fill(addresses[2]),Array(101).fill(1n),'Invalid']
 ]){await rejected(owner.batchProfit.staticCall(id,token.target,recipients,amounts),error);assert.deepEqual(await state(),original);}
 const failed=await owner.batchProfit(id,token.target,[addresses[2],addresses[3]],[E('10'),E('10')],{gasLimit:700000});
 await assert.rejects(failed.wait(),error=>error.receipt?.status===0);assert.deepEqual(await state(),original);
 await tx(owner.batchProfit(id,token.target,[addresses[2]],[E('10')]));
 assert.equal((await vault.accounts(addresses[2],token.target)).profit,E('10'));assert.equal((await vault.ledgers(token.target)).rewards,E('90'));
 await rejected(owner.batchProfit.staticCall(id,token.target,[addresses[2]],[E('10')]),'Invalid');
 assert.equal((await vault.accounts(addresses[2],token.target)).profit,E('10'));assert.equal(await queue.requestCount(),0n);
});

test('queue callbacks cannot be forged and only the accepted current owner can approve a recorded payment',async()=>{
 await deposit(2);await tx(vault.fundRewards(token.target,E('100')));await tx(vault.connect(signers[1]).batchProfit(batch('ownership'),token.target,[addresses[2]],[E('20')]));
 await tx(vault.connect(signers[2]).withdrawProfit(token.target,E('10')));const request=Array.from(await queue.requests(0));
 await rejected(queue.connect(signers[2]).record.staticCall(addresses[2],token.target,E('1'),0,0,false),'InvalidRequest');
 await rejected(vault.connect(signers[2]).settleQueuedWithdrawal.staticCall(addresses[2],token.target,E('10'),0,0,false,false),'Unauthorized');
 await tx(vault.connect(signers[1]).transferOwnership(addresses[3]));
 await rejected(queue.connect(signers[3]).approve.staticCall(0),'InvalidRequest');assert.deepEqual(Array.from(await queue.requests(0)),request);
 await tx(vault.connect(signers[3]).acceptOwnership());await rejected(queue.connect(signers[1]).approve.staticCall(0),'InvalidRequest');
 await tx(queue.connect(signers[3]).approve(0));const before=await token.balanceOf(addresses[2]);
 await tx(queue.connect(signers[4]).pay(0));assert.equal(await token.balanceOf(addresses[2])-before,E('9.5'));
 assert.equal(await queue.pending(token.target),0n);assert.equal((await queue.requests(0)).status,1n);
 await rejected(queue.connect(signers[4]).pay.staticCall(0),'InvalidRequest');
});

test('invalid oracle rounds reject deposits atomically before registration or any fee routing',async()=>{
 const timestamp=(await provider.getBlock('latest')).timestamp;
 const feeWallets=await Promise.all([vault.FEE_WALLET_1(),vault.FEE_WALLET_2(),vault.dropshippingWallet()]);
 const balances=await Promise.all(feeWallets.map(who=>token.balanceOf(who))),cash=await token.balanceOf(addresses[2]);
 for(const [answer,updated,round,answered]of [
  [100000000n,timestamp,0,0],[0n,timestamp,1,1],[-1n,timestamp,1,1],
  [100000000n,0,1,1],[100000000n,timestamp+36000,1,1],
  [100000000n,timestamp-3601,1,1],[100000000n,timestamp,2,1]
 ]){
  await tx(tokenFeed.set(answer,updated,round,answered));
  await rejected(vault.connect(signers[2]).deposit.staticCall(token.target,E('1000'),ZeroAddress),'StalePrice');
  assert.equal((await vault.users(addresses[2])).registered,false);assert.equal(await vault.positionCount(addresses[2]),0n);
  assert.deepEqual(await ledger(),[0n,0n,0n,0n]);assert.equal(await token.balanceOf(addresses[2]),cash);
  assert.deepEqual(await Promise.all(feeWallets.map(who=>token.balanceOf(who))),balances);
 }
});

test('routed principal and owner-controlled liquidity remain visible liabilities, and a failed approved payout preserves debt',async()=>{
 await deposit(2);assert.equal(await vault.assetBalance(token.target),0n);assert.equal(await vault.accounted(token.target),E('1000'));
 assert.equal(await vault.liquidityShortfall(token.target),E('1000'));assert.equal(await vault.ownerCapitalOutstanding(token.target),E('800'));
 await tx(vault.fundRewards(token.target,E('100')));await tx(vault.connect(signers[1]).ownerWithdrawCapital(token.target,addresses[1],E('100')));
 await tx(vault.connect(signers[1]).batchProfit(batch('liquidity'),token.target,[addresses[2]],[E('100')]));
 assert.equal(await vault.accounted(token.target),E('1100'));assert.equal(await vault.assetBalance(token.target),0n);
 await tx(vault.connect(signers[2]).withdrawProfit(token.target,E('10')));await tx(queue.approve(0));
 const debt=await vault.accounted(token.target),request=Array.from(await queue.requests(0)),pending=await queue.pending(token.target),profit=await account(2);
 await rejected(queue.connect(signers[4]).pay.staticCall(0),'InsufficientLiquidity');
 const failed=await queue.connect(signers[4]).pay(0,{gasLimit:500000});await assert.rejects(failed.wait(),error=>error.receipt?.status===0);
 assert.deepEqual(Array.from(await queue.requests(0)),request);assert.equal(await queue.pending(token.target),pending);assert.deepEqual(await account(2),profit);assert.equal(await vault.accounted(token.target),debt);
 await tx(vault.returnCapital(token.target,E('10')));const before=await token.balanceOf(addresses[2]);await tx(queue.connect(signers[4]).pay(0));
 assert.equal(await token.balanceOf(addresses[2])-before,E('9.5'));assert.equal(await queue.pending(token.target),0n);
 assert.equal(await vault.accounted(token.target),debt-E('10'));assert.equal(await vault.assetBalance(token.target),0n);
 assert.equal(await vault.ownerCapitalOutstanding(token.target),E('890'));
});
