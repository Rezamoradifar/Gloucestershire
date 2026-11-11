import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,MaxUint256,ZeroAddress,toQuantity,parseEther as E} from 'ethers';

const config=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json'));
const deployer='0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d';
const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const tx=async request=>(await request).wait();
let rpc,provider,signers,addresses,owner,operator,token,feed,vault,ordinary;
async function deploy(name,args,signer){
 const a=artifact(name),instance=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);
 await instance.waitForDeployment();return instance;
}
const args=()=>[config.owner,config.token,config.bnbFeed,config.tokenFeed,86400,config.partners,config.operations];

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:5,unlockedAccounts:[config.owner,deployer]},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:5},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 for(const who of [config.owner,deployer])await rpc.request({method:'evm_setAccountBalance',params:[who,toQuantity(E('10'))]});
 owner=await provider.getSigner(config.owner);operator=await provider.getSigner(deployer);
 const deployedToken=await deploy('MockToken',[18],signers[0]),deployedFeed=await deploy('MockFeed',[100000000n],signers[0]);
 await rpc.request({method:'evm_setAccountCode',params:[config.token,await provider.getCode(deployedToken.target)]});
 for(const address of [config.bnbFeed,config.tokenFeed]){
  await rpc.request({method:'evm_setAccountCode',params:[address,await provider.getCode(deployedFeed.target)]});
  const fixedFeed=new Contract(address,artifact('MockFeed').abi,signers[0]),block=await provider.getBlock('latest');
  await tx(fixedFeed.set(100000000n,block.timestamp,1,1));
 }
 token=new Contract(config.token,artifact('MockToken').abi,signers[0]);feed=new Contract(config.bnbFeed,artifact('MockFeed').abi,signers[0]);
 vault=await deploy('FastNewDeployerTestnetVault',args(),operator);
 ordinary=await deploy('AutomaticGroupVault',args(),signers[0]);
});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

test('same original plan and roles with the replacement reporter',async()=>{
 assert.equal(await vault.owner(),config.owner);assert.equal(await vault.reporters(config.owner),true);assert.equal(await vault.reporters(deployer),true);
 assert.equal(await vault.reporters(config.deployer),false);assert.equal(await vault.FAST_TESTNET_VERSION(),1n);
 for(const name of ['FEE_WALLET_1','FEE_WALLET_2','WITHDRAWAL_FEE_WALLET','dropshippingWallet','CONFIG_DELAY','partnerCount','partnerVotesRequired','profitFeeBps','principalPenaltyBps','lockDuration','withdrawalCooldown','minDepositUsd'])assert.equal(await vault[name](),await ordinary[name](),name);
 for(let i=0;i<5;i++)assert.deepEqual((await vault.tierConfig(i)).toArray(true),(await ordinary.tierConfig(i)).toArray(true));
});

test('initial deposits route 10% to each fee wallet and 80% to operations',async()=>{
 const wallets=[await vault.FEE_WALLET_1(),await vault.FEE_WALLET_2(),await vault.dropshippingWallet()];
 await tx(token.mint(addresses[1],E('100')));await tx(token.connect(signers[1]).approve(vault.target,MaxUint256));
 const prior=await Promise.all(wallets.map(who=>token.balanceOf(who)));
 await tx(vault.connect(signers[1]).deposit(token.target,E('100'),ZeroAddress));
 const after=await Promise.all(wallets.map(who=>token.balanceOf(who)));
 assert.deepEqual(after.map((value,i)=>value-prior[i]),[E('10'),E('10'),E('80')]);
 assert.equal(await vault.assetBalance(token.target),0n);assert.equal((await vault.accounts(addresses[1],token.target)).principal,E('100'));
});

test('owner can withdraw all liquid funded rewards without partner votes or delay',async()=>{
 await tx(token.mint(addresses[0],E('20')));await tx(token.approve(vault.target,MaxUint256));await tx(vault.connect(signers[0]).fundRewards(token.target,E('20')));
 assert.equal(await vault.surplus(token.target),0n);assert.equal((await vault.ledgers(token.target)).rewards,E('20'));
 await assert.rejects(vault.connect(signers[1]).ownerWithdrawCapital.staticCall(token.target,addresses[2],E('1')));
 const previous=await token.balanceOf(addresses[2]);
 await tx(vault.connect(owner).ownerWithdrawCapital(token.target,addresses[2],E('20')));
 assert.equal((await token.balanceOf(addresses[2]))-previous,E('20'));assert.equal(await vault.assetBalance(token.target),0n);
});

test('deployment rejects other deployers, owners, chain IDs, and changed original settings',async()=>{
 const a=artifact('FastNewDeployerTestnetVault');
 const alteredPartners=[...config.partners];alteredPartners.reverse();
 for(const [signer,constructorArgs] of [
  [signers[0],args()],
  [operator,[addresses[0],...args().slice(1)]],
  [operator,[config.owner,config.bnbFeed,config.bnbFeed,config.tokenFeed,86400,config.partners,config.operations]],
  [operator,[config.owner,config.token,config.bnbFeed,config.tokenFeed,86400,alteredPartners,config.operations]],
  [operator,[config.owner,config.token,config.bnbFeed,config.tokenFeed,3600,config.partners,config.operations]]
 ]){
  await assert.rejects(async()=>{const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...constructorArgs,{gasLimit:15000000});await c.waitForDeployment();});
 }
 const other=ganache.provider({logging:{quiet:true},wallet:{unlockedAccounts:[deployer]},chain:{chainId:56,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 const p=new BrowserProvider(other,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
  await other.request({method:'evm_setAccountBalance',params:[deployer,toQuantity(E('10'))]});
  await other.request({method:'evm_setAccountCode',params:[config.token,await provider.getCode(config.token)]});
  for(const address of [config.bnbFeed,config.tokenFeed])await other.request({method:'evm_setAccountCode',params:[address,await provider.getCode(config.bnbFeed)]});
  const signer=await p.getSigner(deployer);
  await assert.rejects(async()=>{const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args(),{gasLimit:15000000});await c.waitForDeployment();});
 }finally{await p.destroy();await other.disconnect();}
});
