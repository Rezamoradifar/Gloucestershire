import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Transaction,Wallet,ZeroAddress,keccak256,parseEther as E} from 'ethers';
import {journalTransaction} from '../scripts/migration-journal.mjs';
import {validateNewDeployerPendingTransactions} from '../scripts/new-deployer-testnet-automation.mjs';
import {topupNewDeployerMillion} from '../scripts/topup-new-deployer-million.mjs';

const artifact=name=>JSON.parse(fs.readFileSync(`artifacts/${name}.json`,'utf8'));
const tx=async request=>(await request).wait();
let rpc,provider,wallet,signer,token,vault,identity,snapshot;
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signer=await provider.getSigner(0);
 wallet=new Wallet(Object.values(rpc.getInitialAccounts())[0].secretKey,provider);
 const addresses=await Promise.all(Array.from({length:12},async(_,i)=>(await provider.getSigner(i)).getAddress()));
 const deploy=async(name,args)=>{const a=artifact(name),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 token=await deploy('MockToken',[18]);const feed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('AutomaticGroupVault',[wallet.address,token.target,feed.target,feed.target,86400,addresses.slice(1,8),addresses[8]]);
 const creation=await vault.deploymentTransaction().wait();
 identity={version:1,purpose:'new-deployer-test-rewards-one-million-v1',chainId:97,target:vault.target,owner:wallet.address,operator:wallet.address,token:token.target,queue:await vault.withdrawalQueue(),hash:creation.hash,runtimeHash:keccak256(await provider.getCode(vault.target))};
 // The actual testnet wrapper exposes the same version marker; emulate only this marker.
 const wrapper=new Proxy(vault,{get(target,key,receiver){if(key==='FAST_TESTNET_VERSION')return async()=>1n;return Reflect.get(target,key,receiver);}});
 vault=wrapper;snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

function runSession(){
 const state={transactions:{}},counts={saves:0},save=()=>{counts.saves++;},guard=async()=>{};
 const transact=(label,request,check)=>journalTransaction({provider,wallet,state,save,label,request,guard:check,confirmations:1,timeout:10000,maxTotalFee:E('0.1')});
 return {state,counts,save,guard,transact,run:(extra={})=>topupNewDeployerMillion({provider,wallet,vault,tokenArtifact:artifact('MockToken'),identity,state,save,guard,transact,...extra})};
}

test('tops up only the initial gap, proves receipt, and never automatically refills',async()=>{
 await tx(token.connect(signer).mint(wallet.address,E('10')));await tx(token.connect(signer).approve(vault.target,E('10')));await tx(vault.connect(signer).fundRewards(token.target,E('10')));
 const s=runSession(),result=await s.run();
 assert.equal(result.status,'TEST_REWARDS_TOPUP_CONFIRMED');assert.equal(result.initialRewards,'10.0');assert.equal(result.fundedTestUsdt,'999990.0');
 assert.equal((await vault.ledgers(token.target)).rewards,E('1000000'));assert.equal(await vault.assetBalance(token.target),E('1000000'));
 const count=Object.keys(s.state.transactions).length;const prior=await token.totalSupply();
 await tx(vault.connect(signer).register(ZeroAddress));
 await tx(vault.connect(signer).batchProfit(keccak256('0x1234'),token.target,[wallet.address],[E('20')]));
 await tx(vault.connect(signer).ownerWithdrawCapital(token.target,wallet.address,E('10')));
 const repeat=await s.run();assert.equal(repeat.status,'TEST_REWARDS_TOPUP_ALREADY_COMPLETED');assert.equal(repeat.currentRewards,'999980.0');assert.equal(repeat.currentCash,'999990.0');assert.equal(repeat.totalCashShortfall,'10.0');assert.equal(Object.keys(s.state.transactions).length,count);assert.equal(await token.totalSupply(),prior);
});

for(const mode of ['before-broadcast','after-broadcast'])test(`signed mint interrupted ${mode} blocks worker and resumes the same transaction`,async()=>{
 const s=runSession();let interrupted=false;
 const interruptedTransact=async(label,request,check)=>{
  if(label.endsWith('-mint')&&!interrupted){
   await check();const nonce=await provider.getTransactionCount(wallet.address,'pending'),gas=await provider.estimateGas({...request,from:wallet.address}),fee=(await provider.getFeeData()).gasPrice;
   const raw=await wallet.signTransaction({...request,chainId:97,type:0,nonce,value:0n,gasLimit:gas*12n/10n,gasPrice:fee});
   s.state.transactions[label]={raw,hash:keccak256(raw),maxFee:String(gas*12n/10n*fee)};s.save();if(mode==='after-broadcast')await provider.broadcastTransaction(raw);interrupted=true;throw Error('TEST_INTERRUPTED');
  }
  return s.transact(label,request,check);
 };
 await assert.rejects(s.run({transact:interruptedTransact}),/TEST_INTERRUPTED/);
 const entry=Object.values(s.state.transactions)[0],savedHash=entry.hash;assert.equal(Transaction.from(entry.raw).from,wallet.address);
 await assert.rejects(validateNewDeployerPendingTransactions({provider,wallet,expectedOperator:wallet.address,state:s.state,vault,queue:{},feedAddresses:[],feedArtifact:{},seedOptions:{}}),/NEW_DEPLOYER_PENDING_TRANSACTION_SCOPE_MISMATCH/);
 const result=await s.run();assert.equal(result.status,'TEST_REWARDS_TOPUP_CONFIRMED');assert.equal((await vault.ledgers(token.target)).rewards,E('1000000'));
 assert.equal(Object.values(s.state.transactions).find(row=>row.hash===savedHash)?.hash,savedHash);assert.equal(await token.totalSupply(),E('1000000'));
});

test('no top-up when ledger already meets goal, and cash shortfall is disclosed',async()=>{
 await tx(token.connect(signer).mint(wallet.address,E('1000000')));await tx(token.connect(signer).approve(vault.target,E('1000000')));await tx(vault.connect(signer).fundRewards(token.target,E('1000000')));
 await tx(vault.connect(signer).ownerWithdrawCapital(token.target,wallet.address,E('1000000')));
 const s=runSession(),result=await s.run();
 assert.equal(result.status,'TEST_REWARDS_LEDGER_ALREADY_AT_GOAL');assert.equal(result.fundedTestUsdt,'0.0');assert.equal(result.currentCash,'0.0');assert.equal(result.totalCashShortfall,'1000000.0');assert.equal(Object.keys(s.state.transactions).length,0);
});
