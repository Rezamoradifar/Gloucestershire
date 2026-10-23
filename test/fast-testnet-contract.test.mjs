import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,MaxUint256,ZeroAddress,keccak256,toUtf8Bytes,toQuantity,parseEther as E} from 'ethers';
import {planDailyEpoch,executeDailyPlan} from '../scripts/daily-profit.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const config=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json'));
const tx=async request=>(await request).wait();
const id=value=>keccak256(toUtf8Bytes(value));
let rpc,provider,signers,addresses,owner,operator,partners,token,feed,vault,queue,snapshot,deploymentBlock;
async function deploy(name,args=[],signer=signers[0]){
 const a=artifact(name),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);
 await c.waitForDeployment();return c;
}
const rejected=async(request,name)=>assert.rejects(request,error=>{
 let found=error.revert?.name;
 for(const contract of [vault,queue])try{found??=contract.interface.parseError(error.data)?.name;}catch{}
 return found===name;
});
async function deposit(index,value,referrer=ZeroAddress){return tx(vault.connect(signers[index]).deposit(token.target,E(value),referrer));}
async function family(){await deposit(1,'1000');await deposit(2,'3000',addresses[1]);await deposit(3,'3000',addresses[1]);}
async function advance(seconds){await rpc.request({method:'evm_increaseTime',params:[seconds]});await rpc.request({method:'evm_mine',params:[]});}
const args=()=>[config.owner,token.target,feed.target,feed.target,86400,config.partners,addresses[11]];

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12,unlockedAccounts:[config.owner,config.deployer,...config.partners]},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 for(const who of [config.owner,config.deployer,...config.partners])await rpc.request({method:'evm_setAccountBalance',params:[who,toQuantity(E('10'))]});
 owner=await provider.getSigner(config.owner);operator=await provider.getSigner(config.deployer);partners=await Promise.all(config.partners.map(who=>provider.getSigner(who)));
 token=await deploy('MockToken',[18]);feed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('FastTestnetVault',args(),operator);deploymentBlock=(await vault.deploymentTransaction().wait()).blockNumber;
 queue=new Contract(await vault.withdrawalQueue(),artifact('ProfitWithdrawalQueue').abi,owner);
 for(let i=0;i<8;i++){await tx(token.mint(addresses[i],E('10000')));await tx(token.connect(signers[i]).approve(vault.target,MaxUint256));}
 await tx(token.mint(config.deployer,E('1000')));await tx(token.connect(operator).approve(vault.target,MaxUint256));
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('fast release is separately pinned, reproducible and within network bytecode limits',()=>{
 const fast=artifact('FastTestnetVault'),browser=JSON.parse(fs.readFileSync('deployment-console/FastTestnetVault.json'));
 assert.equal(config.releaseId,'global-fresh-fast-test-v1');assert.equal(config.artifact,'FastTestnetVault');assert.equal(config.chainId,97);
 assert.equal(config.owner,'0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');assert.equal(config.deployer,'0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2');
 assert.equal(config.testMode,true);assert.equal(config.initialServerReporter,true);
 assert.equal(browser.bytecode,'0x'+fast.evm.bytecode.object);assert.deepEqual(browser.abi,fast.abi);assert.equal(keccak256(browser.bytecode),config.artifactHash);
 assert.ok(fast.evm.deployedBytecode.object.length/2<=24576);assert.ok(fast.evm.bytecode.object.length/2<=49152);
 assert.equal(keccak256('0x'+artifact('AutomaticGroupVault').evm.bytecode.object),'0x64f24990045d9ef3d268e97657ed6e6af013cb73fc8ec39b9a862929c069e8cf');
 const oldConfig=JSON.parse(fs.readFileSync('config/fresh-zero-testnet.json'));
 for(const key of ['owner','deployer','token','bnbFeed','tokenFeed','age','partners','operations'])assert.deepEqual(config[key],oldConfig[key]);
 const input=JSON.parse(fs.readFileSync('artifacts/fast-testnet-standard-input.json'));
 assert.equal(input.settings.viaIR,true);assert.equal(input.settings.optimizer.runs,1);assert.equal(input.settings.evmVersion,'shanghai');
 assert.ok(input.sources['fresh/FastTestnetVault.sol'].content.includes('contract FastTestnetVault'));
 assert.equal(fast.abi.find(x=>x.type==='constructor').inputs.map(x=>x.type).join(','),artifact('AutomaticGroupVault').abi.find(x=>x.type==='constructor').inputs.map(x=>x.type).join(','));
});

test('new testnet vault has zero state, the requested owner and only the two initial reporters',async()=>{
 assert.equal(await vault.owner(),config.owner);assert.equal(await vault.pendingOwner(),ZeroAddress);assert.equal(await vault.paused(),false);
 for(const name of ['FAST_TESTNET_VERSION','AUTO_REWARD_GROUP_VERSION','REWARD_ACCRUAL_VERSION'])assert.equal(await vault[name](),1n);
 assert.equal(await vault.reporters(config.owner),true);assert.equal(await vault.reporters(config.deployer),true);assert.equal(await vault.reporters(addresses[0]),false);
 assert.equal(await queue.APPROVAL_VERSION(),1n);assert.equal(await queue.vault(),vault.target);assert.equal(await queue.requestCount(),0n);
 assert.equal(await vault.volumeJobCount(),0n);
 for(const who of [...addresses,config.owner,config.deployer]){
  assert.equal((await vault.users(who)).registered,false);assert.equal(await vault.positionCount(who),0n);assert.equal(await vault.rewardGroupCount(who),0n);
  assert.deepEqual(Array.from(await vault.accounts(who,token.target)),[0n,0n,0n,0n]);
 }
 for(const asset of [ZeroAddress,token.target]){assert.deepEqual(Array.from(await vault.ledgers(asset)),[0n,0n,0n,0n]);assert.equal(await vault.accounted(asset),0n);assert.equal(await vault.assetBalance(asset),0n);}
 assert.equal(vault.interface.hasFunction('migrationSource'),false);
});

test('deployment rejects any different operator or owner and rejects BNB mainnet',async()=>{
 const a=artifact('FastTestnetVault');
 for(const [signer,constructorArgs] of [[signers[0],args()],[operator,[addresses[0],...args().slice(1)]]]){
  await assert.rejects(async()=>{const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...constructorArgs,{gasLimit:15000000});await c.waitForDeployment();});
 }
 const mainnet=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:1,unlockedAccounts:[config.deployer]},chain:{chainId:56,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 const mainProvider=new BrowserProvider(mainnet,undefined,{cacheTimeout:-1});mainProvider.pollingInterval=10;
 try{
  await mainnet.request({method:'evm_setAccountBalance',params:[config.deployer,toQuantity(E('10'))]});
  for(const address of [token.target,feed.target])await mainnet.request({method:'evm_setAccountCode',params:[address,'0x601260005260206000f3']});
  const mainOperator=await mainProvider.getSigner(config.deployer);
  await assert.rejects(async()=>{const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,mainOperator).deploy(...args(),{gasLimit:15000000});await c.waitForDeployment();});
 }finally{await mainProvider.destroy();await mainnet.disconnect();}
});

test('later reporter changes still require owner proposal, two distinct partner votes and 48 hours',async()=>{
 const data=vault.interface.encodeFunctionData('setReporter',[addresses[8],true]),hash=keccak256(data);
 assert.equal(await vault.CONFIG_DELAY(),172800n);assert.equal(await vault.partnerVotesRequired(),2n);
 await rejected(vault.connect(operator).queueConfiguration.staticCall(hash),'OwnableUnauthorizedAccount');
 await rejected(vault.connect(operator).setReporter.staticCall(addresses[8],true),'OwnableUnauthorizedAccount');
 await rejected(vault.connect(owner).setReporter.staticCall(addresses[8],true),'Locked');
 await tx(vault.connect(owner).queueConfiguration(hash));
 await tx(vault.connect(partners[0]).voteConfiguration(hash));
 await rejected(vault.connect(partners[0]).voteConfiguration.staticCall(hash),'Invalid');
 await rejected(vault.connect(owner).setReporter.staticCall(addresses[8],true),'Locked');
 await tx(vault.connect(partners[1]).voteConfiguration(hash));
 await rejected(vault.connect(owner).setReporter.staticCall(addresses[8],true),'Locked');
 await advance(172801);await tx(vault.connect(owner).setReporter(addresses[8],true));
 assert.equal(await vault.reporters(addresses[8]),true);assert.equal(await vault.queuedConfig(hash),0n);assert.equal(await vault.reporters(config.deployer),true);
});

test('plan percentages, locks, fees and partner voting remain unchanged',async()=>{
 const ordinary=await deploy('AutomaticGroupVault',args());
 for(let i=0;i<5;i++)assert.deepEqual((await vault.tierConfig(i)).toArray(true),(await ordinary.tierConfig(i)).toArray(true));
 for(const name of ['CONFIG_DELAY','partnerCount','partnerVotesRequired','profitFeeBps','principalPenaltyBps','lockDuration','withdrawalCooldown','minDepositUsd'])assert.equal(await vault[name](),await ordinary[name]());
 assert.equal(await vault.lockDuration(),90n*86400n);assert.equal(await vault.withdrawalCooldown(),72n*3600n);assert.equal(await vault.profitFeeBps(),500n);
 assert.deepEqual(await Promise.all([0,1,2,3,4].map(async i=>(await vault.tierConfig(i)).baseDailyBps)),[50n,70n,90n,110n,130n]);
 assert.deepEqual(await Promise.all([0,1,2,3,4].map(async i=>(await vault.tierConfig(i)).maxDailyBps)),[100n,120n,150n,180n,200n]);
});

test('automatic groups and earned-reward reinvestment retain their existing economics',async()=>{
 await family();assert.equal(await vault.rewardGroupCount(addresses[1]),1n);
 assert.deepEqual(Array.from((await vault.rewardGroup(addresses[1],0)).branches),[addresses[2],addresses[3]]);
 await tx(vault.connect(signers[1]).claimNetworkRewards(0,0,2));
 await deposit(4,'100',addresses[1]);await deposit(4,'100',addresses[1]);
 const group=await vault.rewardGroup(addresses[1],0);assert.equal(group.stage,2n);assert.deepEqual(Array.from(group.branches),[addresses[2],addresses[3],addresses[4]]);
 assert.equal(await vault.branchVolumeUsd(addresses[1],addresses[4]),E('200'));assert.equal(await vault.rewardGroupCount(addresses[1]),1n);
 const debt=await vault.accounted(token.target),wallets=await Promise.all([vault.FEE_WALLET_1(),vault.FEE_WALLET_2(),vault.dropshippingWallet()]);
 const before=await Promise.all(wallets.map(who=>token.balanceOf(who)));
 await tx(vault.connect(signers[1]).reinvest(token.target,E('1')));await tx(vault.connect(signers[1]).reinvest(token.target,E('104')));
 const account=await vault.accounts(addresses[1],token.target);assert.equal(account.principal,E('1105'));assert.equal(account.profit,0n);assert.equal(await vault.cumulativeReinvested(addresses[1],token.target),E('105'));
 assert.equal(await vault.accounted(token.target),debt);assert.equal(await vault.assetBalance(token.target),0n);assert.deepEqual(await Promise.all(wallets.map(who=>token.balanceOf(who))),before);
});

test('the initial server reporter can credit funded daily percentages only after a full worker day',async()=>{
 await family();await rejected(vault.connect(signers[8]).batchProfit.staticCall(id('unauthorized-fast-daily'),token.target,[addresses[1]],[E('7')]),'Unauthorized');
 await rejected(vault.connect(operator).batchProfit.staticCall(id('unfunded-fast-daily'),token.target,[addresses[1]],[E('7')]),'Insufficient');
 await tx(vault.connect(operator).fundRewards(token.target,E('100')));
 const block=await provider.getBlock('latest'),policy={version:1,chainId:97,vaultAddress:vault.target,runtimeHash:keccak256(await provider.getCode(vault.target)),deploymentBlock,startTimestamp:block.timestamp,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true};
 await advance(300);assert.equal((await planDailyEpoch({provider,vault,policy,state:{},epoch:0,confirmations:0})).status,'not_due');
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,0n);
 await advance(86101);const plan=await planDailyEpoch({provider,vault,policy,state:{},epoch:0,confirmations:0});assert.equal(plan.status,'ready');
 const amounts=new Map(plan.batches.flatMap(batch=>batch.recipients.map((who,i)=>[who,batch.amounts[i]])));
 assert.equal(amounts.get(addresses[1]),E('7').toString());assert.equal(amounts.get(addresses[2]),E('27').toString());assert.equal(amounts.get(addresses[3]),E('27').toString());
 await executeDailyPlan({provider,vault,plan,transact:async(_label,request)=>tx(operator.sendTransaction(request))});
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,E('7'));assert.equal((await vault.ledgers(token.target)).rewards,E('39'));assert.equal(await queue.requestCount(),0n);
 let replays=0;await executeDailyPlan({provider,vault,plan,transact:async()=>{replays++;}});assert.equal(replays,0);
});

test('server authorization cannot approve withdrawals and payment still needs the actual owner',async()=>{
 await deposit(1,'1000');await tx(vault.connect(operator).fundRewards(token.target,E('100')));
 await tx(vault.connect(operator).batchProfit(id('fast-withdrawal-profit'),token.target,[addresses[1]],[E('7')]));
 await tx(vault.connect(signers[1]).withdrawProfit(token.target,E('7')));
 const request=await queue.requests(0);assert.equal(request.user,addresses[1]);assert.equal(request.gross,E('7'));assert.equal(request.fee,E('0.35'));assert.equal(request.status,0n);
 await rejected(queue.connect(operator).approve.staticCall(0),'InvalidRequest');await rejected(queue.connect(operator).pay.staticCall(0),'InvalidRequest');
 await tx(queue.connect(owner).approve(0));const before=await token.balanceOf(addresses[1]),feeWallet=await vault.WITHDRAWAL_FEE_WALLET(),feeBefore=await token.balanceOf(feeWallet);
 await tx(queue.connect(operator).pay(0));assert.equal(await token.balanceOf(addresses[1])-before,E('6.65'));assert.equal(await token.balanceOf(feeWallet)-feeBefore,E('0.35'));
 assert.equal((await vault.accounts(addresses[1],token.target)).principal,E('1000'));assert.equal(await queue.pending(token.target),0n);await rejected(queue.connect(operator).pay.staticCall(0),'InvalidRequest');
});
