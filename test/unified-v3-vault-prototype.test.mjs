import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,Wallet,ZeroAddress,keccak256,parseEther} from 'ethers';
import {compileUnifiedTestnet} from '../scripts/compile-global-v3-unified-testnet.mjs';
import {planUnifiedLotPage} from '../scripts/plan-v3-unified-accrual.mjs';
import {scanUnifiedAccrual} from '../scripts/scan-v3-unified-accrual.mjs';
import {checkUnifiedKeeper} from '../scripts/check-v3-unified-keeper.mjs';
import {simulateUnifiedAccrual} from '../scripts/simulate-v3-unified-keeper.mjs';
import {executeUnifiedAccrual} from '../scripts/execute-v3-unified-keeper.mjs';

const MOCK='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const E=value=>parseEther(String(value));
const done=async promise=>{const r=await(await promise).wait();assert.equal(r.status,1);return r;};
let cached;
function compile(){
 if(cached)return cached;
 const artifacts=compileUnifiedTestnet();
 cached=artifacts.GlobalV3UnifiedTestnet;
 cached.testComponents=[artifacts.UnifiedNetworkPlan,artifacts.UnifiedReinvestmentBook];
 return cached;
}

test('the integrated experiment fits standard EVM runtime and initcode limits',()=>{
 const artifact=compile();
 assert.ok(artifact.evm.deployedBytecode.object.length/2<=24576);
 assert.ok(artifact.evm.bytecode.object.length/2<=49152);
 for(const component of artifact.testComponents){
  assert.ok(component.evm.deployedBytecode.object.length/2<=24576);
  assert.ok(component.evm.bytecode.object.length/2<=49152);
 }
});

test('the experimental vault refuses deployment outside BNB testnet',async()=>{
 const artifact=compile();
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:1,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 try{
  const manager=await provider.getSigner(0),address=await manager.getAddress();
  await assert.rejects(async()=>{
   const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,manager)
    .deploy(address,MOCK,address,{gasLimit:25000000});
   await vault.waitForDeployment();
  });
 }finally{provider.destroy();await rpc.disconnect();}
});

test('integrated vault keeps repeated reinvestments in one position and preserves separate locks',async()=>{
 const artifact=compile();
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const tokenArtifact=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:4,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 try{
  const manager=await provider.getSigner(0),user=await provider.getSigner(1),executor=await provider.getSigner(2);
  const managerAddress=await manager.getAddress(),who=await user.getAddress();
  const deployed=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,manager).deploy(18);
  await deployed.waitForDeployment();
  await rpc.request({method:'evm_setAccountCode',params:[MOCK,await provider.getCode(deployed.target)]});
  const token=new Contract(MOCK,tokenArtifact.abi,manager);
  const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,manager)
   .deploy(managerAddress,MOCK,managerAddress,{gasLimit:25000000});
  await vault.waitForDeployment();
  const book=new Contract(await vault.reinvestmentBook(),[
   'function positionCount(address) view returns(uint256)',
   'function position(address) view returns(uint256 principal,uint256 reservedPrincipal,uint256 daily,uint256 compound,uint256 basis,uint256 reservedProfit,uint256 cumulativeDaily,uint256 cumulativeCompound,uint256 lots)',
   'function lot(address,uint256) view returns(tuple(uint256 principal,uint256 reservedPrincipal,uint256 daily,uint256 compound,uint256 basis,uint256 reservedProfit,uint64 openedAt,uint64 lastAccruedAt))',
   'function maturedPrincipalPage(address,uint256,uint256) view returns(uint256 available,uint256 next)',
   'function record(address,uint256) returns(uint256)'
  ],provider);
  await assert.rejects(book.connect(user).record.staticCall(who,E(1)));
  await done(token.mint(who,E(2000)));
  await done(token.connect(user).approve(vault.target,E(2000)));
  await done(vault.connect(user).deposit(E(1000),ZeroAddress));
  await done(vault.connect(user).deposit(E(1000),ZeroAddress));
  await done(vault.connect(user).checkIn());
  await rpc.request({method:'evm_increaseTime',params:[3601]});
  await rpc.request({method:'evm_mine',params:[]});
  await done(vault.connect(executor).accrueDaily(who,0));
  await done(vault.connect(executor).accrueDaily(who,1));
  assert.equal((await vault.positionOf(who,0)).availableProfit,E(7));
  assert.equal((await vault.positionOf(who,1)).availableProfit,E(7));
  await done(vault.connect(user).reinvest(0,E(3)));
  await done(vault.connect(user).reinvest(1,E(4)));
  await done(vault.connect(user).reinvest(0,E(2)));
  assert.equal(await vault.positionCount(who),3n);
  assert.equal(await vault.reinvestmentPositionPlusOne(who),3n);
  assert.equal(await book.positionCount(who),1n);
  assert.equal((await book.position(who)).lots,3n);
  assert.equal((await book.position(who)).principal,E(9));
  assert.equal((await vault.positionOf(who,2)).principal,E(9));
  assert.equal((await vault.users(who)).capital,E(2009));
  const lastEarlyLot=await book.lot(who,2);

  await rpc.request({method:'evm_increaseTime',params:[3601]});
  await rpc.request({method:'evm_mine',params:[]});
  const head=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]});
  const lots=await Promise.all(Array.from({length:3},async(_,id)=>{
   const value=await book.lot(who,id);
   return {id,principal:value.principal,basis:value.basis,lastAccruedAt:Number(value.lastAccruedAt)};
  }));
  const plan=planUnifiedLotPage({wallet:who,start:0,totalLots:3,lots,now:Number(BigInt(head.timestamp)),
   rateBps:70,eligible:true,paused:false});
  assert.equal(plan.dueLots,3);assert.equal(plan.daily,E('0.063'));
  await done(vault.connect(executor).getFunction(plan.proposal.method)(...plan.proposal.args));
  assert.equal((await book.position(who)).daily,E('0.063'));
  assert.equal((await vault.positionOf(who,2)).availableProfit,E('0.063'));
  await done(vault.connect(user).reinvestFromPage(2,E('0.05'),0,64));
  assert.equal(await vault.positionCount(who),3n);
  assert.equal((await book.position(who)).lots,4n);
  assert.equal((await book.position(who)).principal,E('9.05'));
  assert.equal((await vault.positionOf(who,2)).principal,E('9.05'));
  assert.equal((await vault.positionOf(who,2)).availableProfit,E('0.013'));
  assert.ok((await book.lot(who,3)).openedAt>lastEarlyLot.openedAt+1n);
  await done(vault.connect(user).requestProfit(2,E('0.01')));
  assert.equal((await book.position(who)).reservedProfit,E('0.01'));
  await done(vault.rejectWithdrawal(0));
  assert.equal((await book.position(who)).reservedProfit,0n);
  assert.equal((await vault.positionOf(who,2)).availableProfit,E('0.013'));

  const latest=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]});
  const seconds=Number(lastEarlyLot.openedAt+90n*86400n+1n-BigInt(latest.timestamp));
  await rpc.request({method:'evm_increaseTime',params:[seconds]});
  await rpc.request({method:'evm_mine',params:[]});
  assert.equal((await book.maturedPrincipalPage(who,0,64)).available,E(9));
  await assert.rejects(vault.connect(user).requestPrincipal.staticCall(2,E('9.05')));
  await done(vault.connect(user).requestPrincipal(2,E(9)));
  assert.equal((await vault.positionOf(who,2)).reservedPrincipal,E(9));
  assert.equal((await book.position(who)).reservedPrincipal,E(9));
  await done(vault.rejectWithdrawal(1));
  assert.equal((await book.position(who)).reservedPrincipal,0n);
  assert.equal((await vault.positionOf(who,2)).reservedPrincipal,0n);

  // The first three lots are mature; the later lot's lock remains unchanged.
  assert.equal((await book.maturedPrincipalPage(who,0,64)).available,E(9));
  assert.equal(await vault.principalLiability(),E('2009.05'));
  assert.equal(await vault.profitLiability(),E('5.013'));

  await rpc.request({method:'evm_increaseTime',params:[72*3600+1]});
  await rpc.request({method:'evm_mine',params:[]});
  await done(vault.connect(user).requestProfit(2,E('0.003')));
  await done(vault.approveWithdrawal(2));
  await done(token.mint(managerAddress,E('0.003')));
  await done(token.approve(vault.target,E('0.003')));
  await done(vault.fundWithdrawal(2));
  await done(vault.connect(executor).payWithdrawal(2));
  assert.equal((await book.position(who)).reservedProfit,0n);
  assert.equal((await book.position(who)).daily,E('0.010'));
  assert.equal((await vault.positionOf(who,2)).availableProfit,E('0.010'));
  assert.equal(await vault.profitLiability(),E('5.010'));

  await rpc.request({method:'evm_increaseTime',params:[72*3600+1]});
  await rpc.request({method:'evm_mine',params:[]});
  assert.equal((await book.maturedPrincipalPage(who,0,64)).available,E('9.05'));
  await done(vault.connect(user).requestPrincipal(2,E('9.05')));
  await done(vault.approveWithdrawal(3));
  await done(token.mint(managerAddress,E('9.05')));
  await done(token.approve(vault.target,E('9.05')));
  await done(vault.fundWithdrawal(3));
  await done(vault.connect(executor).payWithdrawal(3));
  assert.equal((await book.position(who)).principal,0n);
  assert.equal((await vault.positionOf(who,2)).principal,0n);
  assert.equal((await vault.users(who)).capital,E(2000));
  assert.equal(await vault.principalLiability(),E(2000));
  assert.equal(await token.balanceOf(who),E('6.33791'));
 }finally{provider.destroy();await rpc.disconnect();}
});

test('split network plan retains referral eligibility, branch volume and staged rewards',async()=>{
 const artifact=compile();
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const tokenArtifact=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:5,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 try{
  const manager=await provider.getSigner(0),parent=await provider.getSigner(1);
  const child=await provider.getSigner(2),other=await provider.getSigner(3);
  const parentAddress=await parent.getAddress(),childAddress=await child.getAddress(),otherAddress=await other.getAddress();
  const deployed=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,manager).deploy(18);
  await deployed.waitForDeployment();
  await rpc.request({method:'evm_setAccountCode',params:[MOCK,await provider.getCode(deployed.target)]});
  const token=new Contract(MOCK,tokenArtifact.abi,manager);
  const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,manager)
   .deploy(await manager.getAddress(),MOCK,await manager.getAddress(),{gasLimit:25000000});
  await vault.waitForDeployment();
  const network=new Contract(await vault.networkPlan(),[
   'function vault() view returns(address)',
   'function addVolume(address,uint256)',
   'function capitalChanged(address,uint256,uint256)',
   'function consumeFor(address,uint256,uint8,uint8) returns(uint256)',
   'function qualifiedDirects(address) view returns(uint256)',
   'function qualifiedVolume(address,uint8) view returns(uint256)',
   'function branchVolumeUsd(address,address) view returns(uint256)',
   'function createRewardGroup(address[])',
   'function rewardProgress(address,uint256) view returns(uint8 stage,uint256 preparedUsd,uint256 cursor,uint256 branches)'
  ],provider);
  assert.equal(await network.vault(),await vault.getAddress());
  await assert.rejects(network.connect(child).addVolume.staticCall(childAddress,E(999)));
  await assert.rejects(network.connect(child).capitalChanged.staticCall(childAddress,0,E(100)));
  await assert.rejects(network.connect(child).consumeFor.staticCall(parentAddress,0,0,1));
  for(const [user,amount,referrer] of [[parent,E(100),ZeroAddress],[child,E(1000),parentAddress],[other,E(1000),parentAddress]]){
   const address=await user.getAddress();
   await done(token.mint(address,amount));
   await done(token.connect(user).approve(vault.target,amount));
   await done(vault.connect(user).deposit(amount,referrer));
   await done(vault.connect(user).checkIn());
  }
  assert.equal(await network.qualifiedDirects(parentAddress),2n);
  assert.equal(await network.branchVolumeUsd(parentAddress,childAddress),E(1000));
  assert.equal(await network.qualifiedVolume(parentAddress,0),E(2000));
  await done(network.connect(parent).createRewardGroup([childAddress,otherAddress]));
  await done(vault.connect(parent).prepareNetworkReward(0,0,2));
  assert.equal((await network.rewardProgress(parentAddress,0)).preparedUsd,E(500));
  await done(vault.connect(parent).claimNetworkRewards(0,0,1));
  assert.equal(await vault.networkAvailable(parentAddress),E(35));
  assert.equal((await network.rewardProgress(parentAddress,0)).stage,1n);

  await rpc.request({method:'evm_increaseTime',params:[3601]});
  await rpc.request({method:'evm_mine',params:[]});
  await done(vault.connect(manager).accrueDaily(childAddress,0));
  assert.equal((await vault.positionOf(childAddress,0)).availableProfit,E(7));
  assert.equal((await vault.users(parentAddress)).referralAvailable,E('0.7'));
  await done(vault.connect(child).reinvest(0,E(3)));
  assert.equal(await network.branchVolumeUsd(parentAddress,childAddress),E(1003));
  assert.equal(await network.qualifiedVolume(parentAddress,0),E(2003));
  assert.equal(await vault.principalLiability(),E(2103));
  assert.equal(await vault.profitLiability(),E('39.7'));
  await rpc.request({method:'evm_increaseTime',params:[3601]});
  await rpc.request({method:'evm_mine',params:[]});
  await done(vault.connect(manager).accrueReinvestmentPage(childAddress,0,8));
  assert.equal((await vault.positionOf(childAddress,1)).availableProfit,E('0.021'));
  assert.equal((await vault.users(parentAddress)).referralAvailable,E('0.7021'));
  assert.equal(await vault.profitLiability(),E('39.7231'));
 }finally{provider.destroy();await rpc.disconnect();}
});

test('more than 64 reinvestments remain one position and accrue on separate pages',async t=>{
 const artifact=compile();
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const tokenArtifact=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:3,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 const journalDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'unified-keeper-test-'));
 try{
  const manager=await provider.getSigner(0),user=await provider.getSigner(1),who=await user.getAddress();
  const deployed=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,manager).deploy(18);
  await deployed.waitForDeployment();
  await rpc.request({method:'evm_setAccountCode',params:[MOCK,await provider.getCode(deployed.target)]});
  const token=new Contract(MOCK,tokenArtifact.abi,manager);
  const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,manager)
   .deploy(await manager.getAddress(),MOCK,await manager.getAddress(),{gasLimit:25000000});
  await vault.waitForDeployment();
  const deploymentReceipt=await vault.deploymentTransaction().wait();
  const book=new Contract(await vault.reinvestmentBook(),[
   'function position(address) view returns(uint256 principal,uint256 reservedPrincipal,uint256 daily,uint256 compound,uint256 basis,uint256 reservedProfit,uint256 cumulativeDaily,uint256 cumulativeCompound,uint256 lots)',
   'function lot(address,uint256) view returns(tuple(uint256 principal,uint256 reservedPrincipal,uint256 daily,uint256 compound,uint256 basis,uint256 reservedProfit,uint64 openedAt,uint64 lastAccruedAt))'
  ],provider);
  await done(token.mint(who,E(10000)));
  await done(token.connect(user).approve(vault.target,E(10000)));
  await done(vault.connect(user).deposit(E(10000),ZeroAddress));
  await done(vault.connect(user).checkIn());
  await rpc.request({method:'evm_increaseTime',params:[3601]});await rpc.request({method:'evm_mine',params:[]});
  await done(vault.accrueDaily(who,0));
  assert.equal((await vault.positionOf(who,0)).availableProfit,E(90));
  for(let i=0;i<70;i++)await done(vault.connect(user).reinvest(0,E(1)));
  assert.equal(await vault.positionCount(who),2n);
  assert.equal((await vault.positionOf(who,1)).principal,E(70));
  assert.equal((await book.position(who)).lots,70n);
  await rpc.request({method:'evm_increaseTime',params:[3601]});
  for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
  const bookAddress=await vault.reinvestmentBook(),networkAddress=await vault.networkPlan();
  const managerAddress=await manager.getAddress();
  const proof={status:'VERIFIED_UNIFIED_TESTNET_ONLY',chainId:97,vault:vault.target,
   book:bookAddress,network:networkAddress,token:MOCK,manager:managerAddress,feeReceiver:managerAddress,
   deploymentBlock:deploymentReceipt.blockNumber,deploymentTx:deploymentReceipt.hash,
   vaultRuntimeHash:keccak256(await provider.getCode(vault.target)),
   bookRuntimeHash:keccak256(await provider.getCode(bookAddress)),
   networkRuntimeHash:keccak256(await provider.getCode(networkAddress))};
  const preflight=await checkUnifiedKeeper({provider,proof,cursor:{member:0,position:1,lot:0},maxWork:20,maxResults:10});
  assert.equal(preflight.transactionSent,false);
  const scan=preflight.plan;
  assert.equal(scan.selected.length,9);
  assert.equal(scan.selected.reduce((n,item)=>n+item.dueLots,0),70);
  assert.deepEqual(scan.selected.map(item=>item.args[1]),[0,8,16,24,32,40,48,56,64]);
  const gasKeeper=await provider.getSigner(2),keeperAddress=await gasKeeper.getAddress();
  const nonceBefore=await provider.getTransactionCount(keeperAddress);
  const simulation=await simulateUnifiedAccrual({provider,proof,candidate:scan.selected[0],operator:keeperAddress});
  assert.equal(simulation.transactionSent,false);assert.ok(simulation.gasLimit<=1500000n);
  assert.equal(await provider.getTransactionCount(keeperAddress),nonceBefore);
  await assert.rejects(simulateUnifiedAccrual({provider,proof,candidate:scan.selected[0],operator:managerAddress}),/UNPRIVILEGED/);
  const gasCeiling=2000000n;
  const secret=rpc.getInitialAccounts()[keeperAddress.toLowerCase()].secretKey;
  const localKeeper=new Wallet(secret,provider);
  const waitReceipt=async(p,hash)=>{
   await rpc.request({method:'evm_mine',params:[]});
   return p.getTransactionReceipt(hash);
  };
  const tokenBefore=await token.balanceOf(who);
  const sent=await executeUnifiedAccrual({provider,signer:localKeeper,proof,candidate:scan.selected[0],journalDirectory,waitReceipt});
  assert.equal(sent.status,'CONFIRMED');assert.equal(sent.assetTransfer,false);
  assert.equal(await token.balanceOf(who),tokenBefore);
  assert.equal(JSON.parse(fs.readFileSync(path.join(journalDirectory,'pending.json'),'utf8')).status,'CONFIRMED');
  let maximumGas=(await provider.getTransactionReceipt(sent.hash)).gasUsed;
  assert.equal((await vault.positionOf(who,1)).availableProfit,E('0.088'));
  await assert.rejects(executeUnifiedAccrual({provider,signer:localKeeper,proof,candidate:scan.selected[0],journalDirectory,waitReceipt}),/SIMULATION_FAILED/);
  const originalBroadcast=provider.broadcastTransaction.bind(provider);
  try{
   provider.broadcastTransaction=async raw=>{await originalBroadcast(raw);throw Error('simulated lost RPC response');};
   await assert.rejects(executeUnifiedAccrual({provider,signer:localKeeper,proof,candidate:scan.selected[1],journalDirectory,waitReceipt}),/simulated lost RPC response/);
  }finally{provider.broadcastTransaction=originalBroadcast;}
  assert.equal(JSON.parse(fs.readFileSync(path.join(journalDirectory,'pending.json'),'utf8')).status,'PREPARED');
  await assert.rejects(executeUnifiedAccrual({provider,signer:localKeeper,proof,candidate:scan.selected[1],journalDirectory,waitReceipt}),/PREVIOUS_TRANSACTION_NEEDS_REVIEW/);
  assert.equal((await vault.positionOf(who,1)).availableProfit,E('0.176'));
  for(const item of scan.selected.slice(2)){
   const receipt=await done(vault.getFunction(item.method)(...item.args,{gasLimit:gasCeiling}));
   if(receipt.gasUsed>maximumGas)maximumGas=receipt.gasUsed;
  }
  assert.ok(maximumGas<gasCeiling);
  t.diagnostic(`Maximum observed page gas: ${maximumGas}; this is not a network gas guarantee.`);
  assert.equal((await vault.positionOf(who,1)).availableProfit,E('0.77'));
  assert.equal((await book.position(who)).daily,E('0.77'));
  assert.equal(await vault.profitLiability(),E('20.77'));
  const block=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]});
  const repeated=await scanUnifiedAccrual({vault,book,blockNumber:Number(BigInt(block.number)),
   blockTimestamp:Number(BigInt(block.timestamp)),cursor:{member:0,position:1,lot:0},maxWork:20,maxResults:10});
  assert.equal(repeated.selected.length,0);
 }finally{provider.destroy();await rpc.disconnect();fs.rmSync(journalDirectory,{recursive:true,force:true});}
});
