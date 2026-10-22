import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,Wallet,ZeroAddress,keccak256,parseEther,toUtf8Bytes} from 'ethers';
import {deployApprovedRewards,approvedRelease} from '../scripts/deploy-approved-rewards.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const confirmed=async promise=>(await promise).wait();
let rpc,provider,signers,addresses,source,token,queue,wallet,snapshot,sourceHash;
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const deploy=async(a,args)=>{const c=await new ContractFactory(a.abi,a.bytecode||'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;};
 token=await deploy(artifact('MockToken'),[18]);
 const feed=await deploy(artifact('MockFeed'),[100000000n]);
 const legacy=JSON.parse(fs.readFileSync('deployment-console/DeferredRewardsVault.json'));
 source=await deploy(legacy,[addresses[0],token.target,feed.target,feed.target,86400,addresses.slice(0,7),addresses[11]]);
 queue=new Contract(await source.withdrawalQueue(),['function requests(uint256) view returns(address user,address asset,uint256 gross,uint256 fee,uint256 dueAt,uint8 status)','function requestCount() view returns(uint256)','function pending(address) view returns(uint256)'],provider);
 await confirmed(token.mint(addresses[0],parseEther('1000')));await confirmed(token.approve(source.target,parseEther('1000')));
 await confirmed(token.mint(addresses[1],parseEther('1000')));await confirmed(token.connect(signers[1]).approve(source.target,parseEther('1000')));
 await confirmed(source.connect(signers[1]).deposit(token.target,parseEther('100'),ZeroAddress));
 await confirmed(source.fundRewards(token.target,parseEther('10')));
 await confirmed(source.batchProfit(keccak256(toUtf8Bytes('approval-deployment-test')),token.target,[addresses[1]],[parseEther('10')]));
 await confirmed(source.connect(signers[1]).withdrawProfit(token.target,parseEther('10')));
 sourceHash=keccak256(await provider.getCode(source.target));
 wallet=new Wallet(rpc.getInitialAccounts()[addresses[8].toLowerCase()].secretKey,provider);
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});
const options=(extra={})=>({provider,wallet,source,owner:addresses[0],artifact:artifact('DeferredRewardsVault'),expectedSourceHash:sourceHash,state:{transactions:{}},save:()=>{},confirmations:1,...extra});

test('deploys the reviewed approval candidate once and preserves legacy principal, cash and pending requests',async()=>{
 assert.equal(keccak256('0x'+artifact('DeferredRewardsVault').evm.bytecode.object),approvedRelease.artifactHash);
 const account=Array.from(await source.accounts(addresses[1],token.target)),pending=Array.from(await queue.requests(0));
 const cash=await source.assetBalance(token.target),ledger=Array.from(await source.ledgers(token.target)),position=Array.from(await source.positionOf(addresses[1],0));
 const state={transactions:{}};let saved=false,broadcasts=0;
 const proxy=new Proxy(provider,{get(target,name){
  if(name==='broadcastTransaction')return async raw=>{assert.equal(saved,true);broadcasts++;await target.broadcastTransaction(raw);throw Error('response lost after broadcast');};
  const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;
 }});
 const args=options({provider:proxy,state,save:()=>{saved=true;}}),report=await deployApprovedRewards(args);
 assert.equal(report.kind,'approval-enabled-empty-candidate');assert.equal(report.owner,addresses[0]);assert.equal(report.approvalVersion,1);
 assert.equal(report.accountsMigrated,false);assert.equal(report.siteConnected,false);assert.equal(report.cutoverAllowed,false);
 const candidate=new Contract(report.contractAddress,artifact('DeferredRewardsVault').abi,provider);
 assert.equal((await candidate.users(addresses[1])).registered,false);assert.equal((await candidate.accounts(addresses[1],token.target)).principal,0n);
 const newQueue=new Contract(report.queue,artifact('ProfitWithdrawalQueue').abi,provider);
 assert.equal(await newQueue.APPROVAL_VERSION(),1n);assert.equal(await newQueue.vault(),report.contractAddress);
 assert.equal(await newQueue.requestCount(),0n);
 assert.deepEqual(Array.from(await source.accounts(addresses[1],token.target)),account);
 assert.deepEqual(Array.from(await source.positionOf(addresses[1],0)),position);
 assert.deepEqual(Array.from(await queue.requests(0)),pending);assert.equal(await queue.pending(token.target),parseEther('10'));
 assert.deepEqual(Array.from(await source.ledgers(token.target)),ledger);assert.equal(await source.assetBalance(token.target),cash);assert.equal(await source.paused(),false);
 assert.equal((await deployApprovedRewards(args)).hash,report.hash);assert.equal(broadcasts,1);assert.equal(await provider.getTransactionCount(wallet.address),1);
 await assert.rejects(deployApprovedRewards({...args,owner:addresses[2]}),/CANDIDATE_JOURNAL_IDENTITY_MISMATCH/);
 assert.equal(await provider.getTransactionCount(wallet.address),1);
});

test('wrong chain, source identity, owner, artifact or legacy journal stop before signing',async()=>{
 const state={transactions:{}};
 await assert.rejects(deployApprovedRewards(options({state,expectedSourceHash:'0x'+'00'.repeat(32)})),/SOURCE_RUNTIME_CHANGED/);
 await assert.rejects(deployApprovedRewards(options({state,owner:addresses[2]})),/SOURCE_OWNER_CHANGED/);
 const legacy=JSON.parse(fs.readFileSync('deployment-console/DeferredRewardsVault.json'));
 await assert.rejects(deployApprovedRewards(options({state,artifact:legacy})),/APPROVAL_ARTIFACT_MISMATCH/);
 const fakeChain=new Proxy(provider,{get(target,name){if(name==='send')return async method=>{assert.equal(method,'eth_chainId');return '0x38';};const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(deployApprovedRewards(options({state,provider:fakeChain})),/TESTNET_ONLY/);
 await assert.rejects(deployApprovedRewards(options({state:{transactions:{'fresh-deploy':{}}}})),/UNBOUND_CANDIDATE_JOURNAL/);
 assert.deepEqual(state,{transactions:{}});assert.equal(await provider.getTransactionCount(wallet.address),0);
});

test('source ownership is rechecked after initial validation before any deployment is signed',async()=>{
 let checks=0;
 const changed=new Proxy(source,{get(target,name){if(name==='owner')return async()=>++checks===1?addresses[0]:addresses[2];const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;}});
 const state={transactions:{}};
 await assert.rejects(deployApprovedRewards(options({state,source:changed})),/SOURCE_OWNER_CHANGED/);
 assert.ok(checks>=2);assert.deepEqual(state.transactions,{});assert.equal(await provider.getTransactionCount(wallet.address),0);
});
