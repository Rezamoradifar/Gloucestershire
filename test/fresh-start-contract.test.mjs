import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,MaxUint256,ZeroAddress,keccak256,toUtf8Bytes,parseEther as E} from 'ethers';
import {planDailyEpoch,executeDailyPlan} from '../scripts/daily-profit.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const tx=async request=>(await request).wait();
const id=value=>keccak256(toUtf8Bytes(value));
let rpc,provider,signers,addresses,token,feed,vault,queue,snapshot,deploymentBlock;
const expectedOwner='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
async function deploy(name,args=[]){const a=artifact(name),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;}
const rejected=async(request,name)=>assert.rejects(request,error=>{
 let found=error.revert?.name;
 for(const contract of [vault,queue])try{found??=contract.interface.parseError(error.data)?.name;}catch{}
 return found===name;
});
async function deposit(index,value,referrer=ZeroAddress){return tx(vault.connect(signers[index]).deposit(token.target,E(value),referrer));}
async function family(){await deposit(1,'1000');await deposit(2,'3000',addresses[1]);await deposit(3,'3000',addresses[1]);}
async function advance(seconds){await rpc.request({method:'evm_increaseTime',params:[seconds]});await rpc.request({method:'evm_mine',params:[]});}

before(async()=>{
 const a=artifact('AutomaticGroupVault');
 assert.ok(a.evm.deployedBytecode.object.length/2<=24576,'fresh runtime must fit EIP-170');
 assert.ok(a.evm.bytecode.object.length/2<49152,'fresh initcode must fit its network limit');
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:80},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:80},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(signer=>signer.getAddress()));
 token=await deploy('MockToken',[18]);feed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('AutomaticGroupVault',[addresses[0],token.target,feed.target,feed.target,86400,addresses.slice(0,7),addresses[11]]);
 deploymentBlock=(await vault.deploymentTransaction().wait()).blockNumber;
 queue=new Contract(await vault.withdrawalQueue(),artifact('ProfitWithdrawalQueue').abi,signers[0]);
 for(let i=0;i<8;i++){await tx(token.mint(addresses[i],E('10000')));await tx(token.connect(signers[i]).approve(vault.target,MaxUint256));}
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('fresh release uses current approval snapshots without modifying prior deployable artifacts',()=>{
 for(const name of ['DropshippingVault','DeferredRewardsVault','ProfitWithdrawalQueue'])assert.equal(fs.readFileSync('contracts/fresh/'+name+'.sol','utf8'),fs.readFileSync('contracts/'+name+'.sol','utf8'));
 assert.equal(keccak256('0x'+artifact('DeferredRewardsVault').evm.bytecode.object),'0x715abdf6424a7100d572984070dbc29cfc11349e6cc35f85827ffc2e37fe29b6');
 const browser=JSON.parse(fs.readFileSync('deployment-console/AutomaticGroupVault.json'));
 assert.equal(browser.bytecode,'0x'+artifact('AutomaticGroupVault').evm.bytecode.object);assert.deepEqual(browser.abi,artifact('AutomaticGroupVault').abi);
 assert.equal(keccak256(browser.bytecode),'0x64f24990045d9ef3d268e97657ed6e6af013cb73fc8ec39b9a862929c069e8cf');
});

test('new vault and approval queue start with no accounts, positions, groups, claims or imported state',async()=>{
 assert.equal(await vault.owner(),addresses[0]);assert.equal(await vault.pendingOwner(),ZeroAddress);
 assert.equal(await vault.AUTO_REWARD_GROUP_VERSION(),1n);assert.equal(await vault.REWARD_ACCRUAL_VERSION(),1n);
 assert.equal(await queue.APPROVAL_VERSION(),1n);assert.equal(await queue.vault(),vault.target);assert.equal(await queue.requestCount(),0n);
 assert.equal(await vault.volumeJobCount(),0n);assert.equal(await vault.rewardGroupCount(addresses[1]),0n);assert.equal(await vault.positionCount(addresses[1]),0n);
 assert.equal((await vault.users(addresses[1])).registered,false);assert.equal(await vault.paused(),false);
 for(const asset of [ZeroAddress,token.target]){assert.deepEqual(Array.from(await vault.ledgers(asset)),[0n,0n,0n,0n]);assert.equal(await vault.accounted(asset),0n);assert.equal(await vault.assetBalance(asset),0n);}
 assert.equal(vault.interface.hasFunction('migrationSource'),false);
 assert.equal(await vault.reporters(addresses[0]),true);assert.equal(await vault.reporters(addresses[8]),false);
});

test('fresh constructor retains the requested owner without granting the deployer a reporter role',async()=>{
 const configured=await deploy('AutomaticGroupVault',[expectedOwner,token.target,feed.target,feed.target,86400,addresses.slice(0,7),addresses[11]]);
 assert.equal(await configured.owner(),expectedOwner);assert.equal(await configured.reporters(expectedOwner),true);assert.equal(await configured.reporters(addresses[0]),false);
 assert.equal(await new Contract(await configured.withdrawalQueue(),artifact('ProfitWithdrawalQueue').abi,provider).requestCount(),0n);
});

test('first and later direct branches join one group without selection, duplicate membership or stage reset',async()=>{
 await family();assert.equal(await vault.rewardGroupCount(addresses[1]),1n);
 assert.deepEqual(Array.from((await vault.rewardGroup(addresses[1],0)).branches),[addresses[2],addresses[3]]);
 await tx(vault.connect(signers[1]).claimNetworkRewards(0,0,2));
 await deposit(4,'100',addresses[1]);await deposit(4,'100',addresses[1]);
 const group=await vault.rewardGroup(addresses[1],0);
 assert.equal(group.stage,2n);assert.equal(await vault.rewardGroupCount(addresses[1]),1n);
 assert.deepEqual(Array.from(group.branches),[addresses[2],addresses[3],addresses[4]]);
 assert.deepEqual(Array.from(group.consumedUsd),[E('900'),E('600'),0n]);
 assert.equal(await vault.branchVolumeUsd(addresses[1],addresses[4]),E('200'));assert.equal(await vault.groupedBranch(addresses[1],addresses[4]),true);
 await rejected(vault.connect(signers[1]).createRewardGroup.staticCall([addresses[4]]),'NetworkInvalid');
 await rejected(vault.connect(signers[1]).addRewardBranches.staticCall(0,[addresses[4]]),'NetworkInvalid');
});

test('descendants remain in their immediate ancestor branch and new branches preserve partial reservations',async()=>{
 await family();await tx(vault.connect(signers[1]).prepareNetworkRewardAtStage(0,0,1));
 const before=await vault.rewardProgress(addresses[1],0),reserved=await vault.rewardBranch(addresses[1],0,0);
 await deposit(4,'100',addresses[1]);
 const after=await vault.rewardProgress(addresses[1],0);assert.equal(after.preparedUsd,before.preparedUsd);assert.equal(after.cursor,before.cursor);
 assert.deepEqual(Array.from(await vault.rewardBranch(addresses[1],0,0)),Array.from(reserved));
 await deposit(5,'100',addresses[2]);
 assert.equal(await vault.branchVolumeUsd(addresses[1],addresses[2]),E('3100'));
 assert.deepEqual(Array.from((await vault.rewardGroup(addresses[2],0)).branches),[addresses[5]]);
 assert.deepEqual(Array.from((await vault.rewardGroup(addresses[1],0)).branches),[addresses[2],addresses[3],addresses[4]]);
 await tx(vault.connect(signers[1]).claimNetworkRewardAtStage(0,0));
 const group=await vault.rewardGroup(addresses[1],0);assert.equal(group.stage,1n);assert.equal(group.consumedUsd.reduce((sum,n)=>sum+n,0n),E('500'));
});

test('all fourteen stages consume exact volume once and later branches never restart completed rewards',async()=>{
 await family();await deposit(4,'100',addresses[1]);
 for(const index of [2,3,4]){await tx(vault.setCustomerStatus(addresses[index],true,true));await tx(token.mint(addresses[index],E('30000000')));await deposit(index,'30000000',addresses[1]);}
 let volume=0n,reward=0n;for(let stage=0;stage<14;stage++){const terms=await vault.rewardStage(stage);volume+=terms[0];reward+=terms[1];}
 await tx(vault.connect(signers[1]).claimNetworkRewards(0,0,14));
 const group=await vault.rewardGroup(addresses[1],0);assert.equal(group.stage,14n);assert.equal(group.consumedUsd.reduce((sum,n)=>sum+n,0n),volume);
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,reward);assert.equal(await vault.assetBalance(token.target),0n);
 await rejected(vault.connect(signers[1]).claimNetworkRewardAtStage.staticCall(0,14),'NetworkInsufficient');
 await deposit(5,'100',addresses[1]);const completed=await vault.rewardGroup(addresses[1],0);
 assert.equal(completed.stage,14n);assert.deepEqual(Array.from(completed.consumedUsd).slice(0,3),Array.from(group.consumedUsd));assert.equal(completed.consumedUsd[3],0n);assert.equal(await vault.rewardGroupCount(addresses[1]),1n);
});

test('deep ancestry uses bounded propagation and cannot duplicate automatic members when resumed',async()=>{
 await tx(vault.connect(signers[1]).register(ZeroAddress));
 for(let i=2;i<=75;i++)await tx(vault.connect(signers[i]).register(addresses[i-1]));
 await tx(token.mint(addresses[75],E('100')));await tx(token.connect(signers[75]).approve(vault.target,E('100')));await deposit(75,'100',addresses[74]);
 assert.equal(await vault.rewardGroupCount(addresses[1]),0n);assert.equal((await vault.volumeJobs(0)).ancestor,addresses[66]);
 const first=await tx(vault.connect(signers[9]).processNetworkVolume(0,64,{gasLimit:29000000}));assert.ok(first.gasUsed<30000000n);
 assert.equal((await vault.volumeJobs(0)).ancestor,addresses[2]);assert.equal(await vault.rewardGroupCount(addresses[1]),0n);
 await tx(vault.connect(signers[8]).processNetworkVolume(0,64));assert.equal((await vault.volumeJobs(0)).ancestor,ZeroAddress);
 assert.deepEqual(Array.from((await vault.rewardGroup(addresses[1],0)).branches),[addresses[2]]);assert.equal(await vault.branchVolumeUsd(addresses[1],addresses[2]),E('100'));
 await tx(vault.processNetworkVolume(0,64));assert.equal(await vault.rewardGroupCount(addresses[1]),1n);assert.equal((await vault.rewardGroup(addresses[1],0)).branches.length,1);
});

test('earned rewards can reinvest below the external deposit minimum without cash or new fees',async()=>{
 await family();await tx(vault.connect(signers[1]).claimNetworkRewards(0,0,2));const debt=await vault.accounted(token.target);
 const fees=await Promise.all([vault.FEE_WALLET_1(),vault.FEE_WALLET_2(),vault.dropshippingWallet()].map(async p=>token.balanceOf(await p)));
 await tx(vault.connect(signers[1]).reinvest(token.target,E('1')));await tx(vault.connect(signers[1]).reinvest(token.target,E('104')));
 const account=await vault.accounts(addresses[1],token.target);assert.equal(account.principal,E('1105'));assert.equal(account.profit,0n);
 assert.equal(await vault.cumulativeReinvested(addresses[1],token.target),E('105'));assert.equal(await vault.profitWithdrawalCap(addresses[1],token.target),E('110.5'));
 assert.equal(await vault.accounted(token.target),debt);assert.equal(await vault.assetBalance(token.target),0n);
 assert.deepEqual(await Promise.all([vault.FEE_WALLET_1(),vault.FEE_WALLET_2(),vault.dropshippingWallet()].map(async p=>token.balanceOf(await p))),fees);
});

test('profit withdrawals reserve debt and pay only the original approved recipient and fee once',async()=>{
 await family();await tx(vault.connect(signers[1]).claimNetworkRewards(0,0,2));const debt=await vault.accounted(token.target);
 await tx(vault.connect(signers[1]).withdrawProfit(token.target,E('100')));const request=await queue.requests(0);
 assert.equal(request.user,addresses[1]);assert.equal(request.gross,E('100'));assert.equal(request.fee,E('5'));assert.equal(request.status,0n);
 assert.equal(await vault.accounted(token.target),debt);assert.equal(await queue.pending(token.target),E('100'));
 await rejected(queue.connect(signers[4]).approve.staticCall(0),'InvalidRequest');await rejected(queue.connect(signers[4]).pay.staticCall(0),'InvalidRequest');
 await tx(queue.approve(0));await rejected(queue.pay.staticCall(0),'InsufficientLiquidity');assert.equal((await queue.requests(0)).status,3n);
 await tx(vault.returnCapital(token.target,E('100')));const before=await token.balanceOf(addresses[1]);await tx(queue.connect(signers[4]).pay(0));
 assert.equal(await token.balanceOf(addresses[1])-before,E('95'));assert.equal(await queue.pending(token.target),0n);await rejected(queue.pay.staticCall(0),'InvalidRequest');
});

test('principal remains invested until approved payment and retains the existing lock and penalty',async()=>{
 await family();const original=Array.from(await vault.positionOf(addresses[1],0));
 await rejected(vault.connect(signers[1]).withdrawPrincipal.staticCall(0,E('200')),'Locked');await advance(90*86400);
 await tx(vault.connect(signers[1]).withdrawPrincipal(0,E('200')));assert.equal((await queue.principalRequests(0)).exists,true);
 assert.deepEqual(Array.from(await vault.positionOf(addresses[1],0)),original);assert.equal((await vault.accounts(addresses[1],token.target)).principal,E('1000'));
 await rejected(queue.connect(signers[1]).pay.staticCall(0),'InvalidRequest');await tx(queue.approve(0));await rejected(queue.pay.staticCall(0),'InsufficientLiquidity');
 await tx(vault.returnCapital(token.target,E('200')));const before=await token.balanceOf(addresses[1]);await tx(queue.connect(signers[4]).pay(0));
 assert.equal(await token.balanceOf(addresses[1])-before,E('140'));assert.equal((await vault.accounts(addresses[1],token.target)).principal,E('800'));
 assert.equal(await vault.retainedPrincipalPenalties(token.target),E('60'));assert.equal(await vault.assetBalance(token.target),E('60'));await rejected(queue.pay.staticCall(0),'InvalidRequest');
});

test('daily percentages require funded reporter batches and need no per-user withdrawal approval',async()=>{
 await family();const batch=id('fresh-unauthorized-daily');
 await rejected(vault.connect(signers[8]).batchProfit.staticCall(batch,token.target,[addresses[1]],[E('7')]),'Unauthorized');
 await rejected(vault.batchProfit.staticCall(batch,token.target,[addresses[1]],[E('7')]),'Insufficient');
 await tx(vault.fundRewards(token.target,E('100')));
 const block=await provider.getBlock('latest'),policy={version:1,chainId:97,vaultAddress:vault.target,runtimeHash:keccak256(await provider.getCode(vault.target)),deploymentBlock,startTimestamp:block.timestamp,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true};
 await advance(86401);
 const plan=await planDailyEpoch({provider,vault,policy,state:{},epoch:0,confirmations:0});assert.equal(plan.status,'ready');
 const amounts=new Map(plan.batches.flatMap(batch=>batch.recipients.map((who,i)=>[who,batch.amounts[i]])));
 assert.equal(amounts.get(addresses[1]),E('7').toString());assert.equal(amounts.get(addresses[2]),E('27').toString());assert.equal(amounts.get(addresses[3]),E('27').toString());
 await executeDailyPlan({provider,vault,plan,transact:async(_label,request)=>tx(signers[0].sendTransaction(request))});
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('7'));assert.equal((await vault.ledgers(token.target)).rewards,E('39'));assert.equal(await queue.requestCount(),0n);
 let replays=0;await executeDailyPlan({provider,vault,plan,transact:async()=>{replays++;}});assert.equal(replays,0);
});
