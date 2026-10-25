import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import ganache from 'ganache';
import {BrowserProvider,JsonRpcProvider,ContractFactory,ZeroAddress,parseEther as E,keccak256,toUtf8Bytes} from 'ethers';
import {prepareZeroStartConnection} from '../scripts/connect-zero-start.mjs';
import {verifyZeroStartReadiness} from '../scripts/zero-start-readiness.mjs';
import {makeHourlyTestPolicy} from '../scripts/zero-start-hourly-test.mjs';
import {prepareZeroArchiveRpc} from '../scripts/prepare-zero-archive-rpc.mjs';
import {blockAtTime,indexMembers,planDailyEpoch} from '../scripts/daily-profit.mjs';
import {readConfig,createTradeFeed} from '../server/trades-api.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const fast=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json'));
const tx=async p=>(await p).wait();
const mine=async count=>{for(let i=0;i<count;i++)await rpc.request({method:'evm_mine',params:[]});};
let rpc,provider,vault,release,policy,state,base,periodSnapshot,sale,addresses,limited,gateway,deniedFilter=null;
const requests=[];
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:12,unlockedAccounts:[fast.owner,fast.deployer]},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const who of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[who,'0x'+E('10').toString(16)]});
 await rpc.request({method:'evm_setAccountNonce',params:[fast.deployer,'0x10']});
 const signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const deploy=async(name,args,signer=signers[0])=>{const a=artifact(name),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]);
 release={...fast,token:token.target,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
 const operator=await provider.getSigner(fast.deployer);
 vault=await deploy('FastTestnetVault',[release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations],operator);
 const deploymentReport={hash:vault.deploymentTransaction().hash};
 await tx(token.mint(addresses[1],E('1000')));await tx(token.connect(signers[1]).approve(vault.target,E('1000')));await tx(vault.connect(signers[1]).deposit(token.target,E('1000'),ZeroAddress));
 await tx(token.mint(fast.deployer,E('1000')));await tx(token.connect(operator).approve(vault.target,E('1000')));const fund=await tx(vault.fundRewards(token.target,E('500')));
 await mine(610);
 sale=await tx(vault.settleSalesProfit(keccak256(toUtf8Bytes('paged-live-sale')),token.target,addresses[1],E('10'),E('100'),keccak256(toUtf8Bytes('paged-evidence'))));await mine(5);
 const original='TRADES_CHAIN_ID=97\nTRADES_RPC_URL="https://archive.invalid/private-secret"\nTRADES_VAULT_ADDRESS='+vault.target+'\nTRADES_PORT=3115\nTRADES_CONFIRMATIONS=3\nTRADES_LOG_PAGE_SIZE=500\nGLOBAL_MIGRATION_ENABLED=false\nTRADES_ZERO_START_PROFILE=global-fresh-fast-test-v1\n';
 const prepared=await prepareZeroStartConnection({provider,artifact:artifact('FastTestnetVault'),release,deploymentReport,original,confirmations:3});const connectionReport={...prepared.report,siteConnected:true};
 const ready=await verifyZeroStartReadiness({provider,artifact:artifact('FastTestnetVault'),release,deploymentReport,connectionReport,original:prepared.env,hourlyTest:true,confirmations:3});policy=makeHourlyTestPolicy(ready);
 state={identity:{version:1,chainId:97,target:ready.target,owner:ready.owner,operator:ready.operator,queue:ready.queue,hash:ready.hash,runtimeHash:ready.runtimeHash},daily:{epoch:0},activation:{block:policy.activationBlock,blockHash:policy.activationBlockHash,startTimestamp:policy.startTimestamp},transactions:{fund:{hash:fund.hash,block:fund.blockNumber,blockHash:fund.blockHash,maxFee:'17'}}};
 await rpc.request({method:'evm_increaseTime',params:[7202]});await mine(5);
 periodSnapshot=await blockAtTime(provider,policy.startTimestamp,ready.block,await provider.getBlockNumber());
 base={artifact:artifact('FastTestnetVault'),release,original:prepared.env,deploymentText:JSON.stringify(deploymentReport),connectionText:JSON.stringify(connectionReport),policyText:JSON.stringify(policy),journalText:JSON.stringify(state),confirmations:3};
 gateway=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const request=JSON.parse(body);
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Connection':'close'});res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,...value}));};
  assert.equal(Array.isArray(request),false,'The HTTP fixture must inspect each RPC request independently');
  if(request.method==='eth_getLogs'){
   const filter={...request.params[0],fromBlock:Number(request.params[0].fromBlock),toBlock:Number(request.params[0].toBlock)};
   requests.push({from:filter.fromBlock,to:filter.toBlock,topic:filter.topics[0]});
   if(filter.toBlock-filter.fromBlock+1>10){send(400,{error:{code:-32600,message:'eth_getLogs is limited to a 10 block range; https://archive.invalid/private-secret'}});return;}
   if(deniedFilter?.(filter)){send(400,{error:{code:-32600,message:'Unauthorized provider https://archive.invalid/private-secret'}});return;}
  }
  assert.ok(!['eth_sendTransaction','eth_sendRawTransaction'].includes(request.method),'Read-only probes must never broadcast');
  try{send(200,{result:await rpc.request({method:request.method,params:request.params})});}
  catch(error){send(200,{error:{code:Number.isSafeInteger(error.code)?error.code:-32603,message:'Ganache read failed'}});}
 });
 await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
 limited=new JsonRpcProvider('http://127.0.0.1:'+gateway.address().port,97,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});limited.pollingInterval=10;
},60000);
after(async()=>{await limited?.destroy();await new Promise(resolve=>gateway?gateway.close(resolve):resolve());await provider?.destroy();await rpc?.disconnect();});

test('archive preparation proves complete settlement and registration windows under a ten-block log cap',async()=>{
 requests.length=0;const result=await prepareZeroArchiveRpc({...base,primary:provider,candidate:limited});
 assert.equal(result.stage.ready,true);assert.equal(result.stage.transactionsSent,0);assert.equal(result.stage.signerOpened,false);assert.equal(result.stage.period.epoch,0);
 assert.equal(result.stage.period.historicalLogProbe.fromBlock,policy.deploymentBlock);assert.ok(result.stage.period.historicalLogProbe.toBlock-policy.deploymentBlock>10);assert.ok(result.stage.period.historicalLogProbe.count>0);
 assert.equal(result.stage.period.registryStatus,'indexing');assert.equal(result.stage.period.registryThrough,policy.deploymentBlock+499);assert.equal(result.stage.period.indexedMembers,1);
 assert.ok(requests.some(r=>r.to-r.from+1>10));assert.ok(requests.some(r=>r.topic===vault.interface.getEvent('SaleSettled').topicHash));assert.ok(requests.some(r=>r.topic===vault.interface.getEvent('Registered').topicHash));
 assert.deepEqual(JSON.parse(base.journalText),state);assert.equal(JSON.parse(base.policyText).startTimestamp,policy.startTimestamp);assert.doesNotMatch(JSON.stringify(result.stage),/private-secret|archive\.invalid/);
});

test('daily membership resumes only after a fully completed logical page and leaves the unpaid epoch unchanged',async()=>{
 const daily={epoch:0},saved=[],firstEnd=policy.deploymentBlock+499,topic=vault.interface.getEvent('Registered').topicHash;
 deniedFilter=filter=>filter.topics[0]===topic&&filter.fromBlock>firstEnd;
 try{await assert.rejects(indexMembers({provider:limited,policy,state:daily,through:periodSnapshot.number,save:()=>saved.push(daily.registry.through)}));}
 finally{deniedFilter=null;}
 assert.equal(daily.epoch,0);assert.equal(daily.registry.through,firstEnd);assert.deepEqual(saved,[firstEnd]);assert.ok(Object.hasOwn(daily.registry.members,addresses[1]));
 requests.length=0;assert.equal(await indexMembers({provider:limited,policy,state:daily,through:periodSnapshot.number,save:()=>saved.push(daily.registry.through)}),true);
 assert.ok(requests.every(r=>r.from>firstEnd));assert.equal(daily.registry.through,periodSnapshot.number);assert.equal(daily.epoch,0);
 const plan=await planDailyEpoch({provider:limited,vault,policy,state:daily,epoch:0,save:()=>{},confirmations:3});assert.equal(plan.status,'ready');assert.ok(plan.batches.some(batch=>batch.recipients.includes(addresses[1])));assert.equal(daily.epoch,0);
});

test('the live settlement feed reads the full configured windows without changing its configured page size',async()=>{
 const config=readConfig({TRADES_CHAIN_ID:'97',TRADES_RPC_URL:'https://archive.invalid/private-secret',TRADES_VAULT_ADDRESS:vault.target,TRADES_LOG_PAGE_SIZE:'500',TRADES_LOOKBACK_BLOCKS:'2000',TRADES_START_BLOCK:String(policy.deploymentBlock)});
 const feed=createTradeFeed(config,{provider:limited,ttlMs:0}),data=await feed.get();assert.equal(config.pageSize,500);assert.equal(data.status,'live');assert.equal(data.trades.length,1);assert.equal(data.trades[0].transactionHash,sale.hash);assert.equal(data.trades[0].grossProfit,'10.0');assert.doesNotMatch(JSON.stringify(data),/private-secret/);
});

test('a failed old settlement subpage never publishes a partial fresh feed, and complete retry recovers',async()=>{
 const topic=vault.interface.getEvent('SaleSettled').topicHash,point=policy.deploymentBlock+20;
 deniedFilter=filter=>filter.topics[0]===topic&&filter.fromBlock<=point&&filter.toBlock>=point;
 const config=readConfig({TRADES_CHAIN_ID:'97',TRADES_RPC_URL:'https://archive.invalid/private-secret',TRADES_VAULT_ADDRESS:vault.target,TRADES_LOG_PAGE_SIZE:'500',TRADES_LOOKBACK_BLOCKS:'2000',TRADES_START_BLOCK:String(policy.deploymentBlock)}),feed=createTradeFeed(config,{provider:limited,ttlMs:0});
 try{const failed=await feed.get();assert.equal(failed.status,'unavailable');assert.deepEqual(failed.trades,[]);assert.doesNotMatch(JSON.stringify(failed),/private-secret/);}finally{deniedFilter=null;}
 const recovered=await feed.get();assert.equal(recovered.status,'live');assert.equal(recovered.trades[0].transactionHash,sale.hash);
});
