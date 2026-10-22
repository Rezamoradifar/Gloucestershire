import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,parseEther as E,keccak256,toUtf8Bytes} from 'ethers';
import {verifyCopy} from '../scripts/migration-core.mjs';
import {indexMembers,planDailyEpoch} from '../scripts/daily-profit.mjs';
import {verifyDeferredImport,assertDeferredSnapshotStable,discoverDeferredCopies} from '../scripts/deferred-migration-core.mjs';
import {prepareDeferredConnection} from '../scripts/connect-migrated-deferred.mjs';
import {verifyDeferredAutomation} from '../scripts/prepare-deferred-automation.mjs';
import {createMigrationService} from '../server/migration-service.mjs';
import {createApiServer} from '../server/trades-api.mjs';

const art=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const tx=async promise=>(await promise).wait();
const id=s=>keccak256(toUtf8Bytes(s));
let rpc,p,s,a,t,feed,v,q,members,snapshot,creation;
const batchIds=[id('migration-paid-profit'),id('migration-cancelled-profit')];
async function deploy(artifact,args=[],signer=s[0]){
 const c=await new ContractFactory(artifact.abi,artifact.bytecode||'0x'+artifact.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;
}
const migrate=async(list=members,batches=batchIds.slice().sort(),settlements=[])=>{
 const n=await deploy(art('TestnetDeferredMigrationVault'),[v.target,list,settlements,batches],s[8]);
 return n;
};
before(async()=>{
 assert.ok(art('TestnetDeferredMigrationVault').evm.deployedBytecode.object.length/2<=24576);
 assert.ok(art('TestnetDeferredMigrationVault').evm.bytecode.object.length/2<49152);
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 p=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 s=await Promise.all(Array.from({length:12},(_,i)=>p.getSigner(i)));a=await Promise.all(s.map(x=>x.getAddress()));
 t=await deploy(art('MockToken'),[18]);feed=await deploy(art('MockFeed'),[100000000n]);
 const legacy=JSON.parse(fs.readFileSync('deployment-console/DeferredRewardsVault.json'));
 v=await deploy(legacy,[a[0],t.target,feed.target,feed.target,86400,a.slice(0,7),a[11]]);creation=await v.deploymentTransaction().wait();
 q=new Contract(await v.withdrawalQueue(),art('ProfitWithdrawalQueue').abi,s[0]);
 for(let i=0;i<4;i++){await tx(t.mint(a[i],E('10000')));await tx(t.connect(s[i]).approve(v.target,E('10000')));}
 await tx(v.connect(s[1]).deposit(t.target,E('1000'),ZeroAddress));
 for(let i=2;i<=3;i++){await tx(v.connect(s[i]).deposit(t.target,E('3000'),a[1]));await tx(v.setCustomerStatus(a[i],true,i===3));}
 await tx(v.connect(s[1]).createRewardGroup([a[2],a[3]]));await tx(v.connect(s[1]).claimNetworkRewards(0,0,2));
 await tx(v.connect(s[1]).withdrawProfit(t.target,E('20')));await tx(v.connect(s[1]).reinvest(t.target,E('5')));
 await tx(v.connect(s[1]).prepareNetworkRewardAtStage(0,2,1));
 for(let i=2;i<=3;i++){
  const amount=E(i===2?'20':'10');await tx(v.fundRewards(t.target,amount));await tx(v.batchProfit(batchIds[i-2],t.target,[a[i]],[amount]));await tx(v.connect(s[i]).withdrawProfit(t.target,amount));
 }
 await tx(q.pay(1));await rpc.request({method:'evm_increaseTime',params:[259200]});await rpc.request({method:'evm_mine',params:[]});
 await tx(q.connect(s[3]).cancel(2));await tx(v.ownerWithdrawCapital(t.target,a[0],E('10')));
 await tx(v.setPaused(true));
 members=a.slice(1,4).sort((x,y)=>BigInt(x)<BigInt(y)?-1:1);
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await p?.destroy();await rpc?.disconnect();});

test('imports all principal, profit, original positions, groups and queued withdrawal history exactly',async()=>{
 const n=await migrate(),receipt=await n.deploymentTransaction().wait(),queue=new Contract(await n.withdrawalQueue(),art('ImportedWithdrawalQueue').abi,p);
 assert.equal(await n.owner(),a[0]);assert.equal(await n.migrationSource(),v.target);assert.equal(await n.migrationBlock(),BigInt(receipt.blockNumber));assert.equal(await n.paused(),true);
 await verifyCopy(p,v,art('TestnetDeferredMigrationVault'),receipt,{members,settlements:[],batches:batchIds});
 assert.equal(await queue.APPROVAL_VERSION(),1n);assert.equal(await queue.vault(),n.target);assert.equal(await queue.requestCount(),3n);
 for(let i=0;i<3;i++)assert.deepEqual(Array.from(await queue.requests(i)),Array.from(await q.requests(i)));
 for(const who of members){
  assert.equal(await queue.userRequestCount(who),1n);assert.equal(await queue.userRequestId(who,0),BigInt(a.indexOf(who)-1));
  assert.equal((await queue.principalRequests(a.indexOf(who)-1)).exists,false);
 }
 assert.equal(await queue.pending(t.target),E('20'));assert.equal(await queue.hasPending(a[1],t.target),true);assert.equal(await queue.hasPending(a[2],t.target),false);
 assert.equal(await n.accounted(t.target),await v.accounted(t.target));assert.equal(await n.assetBalance(t.target),0n);
 assert.equal(await n.reporters(a[8]),false);await assert.rejects(n.connect(s[8]).setPaused.staticCall(false));
});

test('imported pending requests require owner approval and pay the original recipient and fee once',async()=>{
 const n=await migrate(),queue=new Contract(await n.withdrawalQueue(),art('ImportedWithdrawalQueue').abi,s[0]);
 await assert.rejects(queue.connect(s[8]).pay.staticCall(0));await assert.rejects(queue.connect(s[8]).approve.staticCall(0));
 await assert.rejects(queue.approve.staticCall(1));await assert.rejects(queue.connect(s[3]).cancel.staticCall(2));
 await tx(t.approve(n.target,E('20')));await tx(n.connect(s[0]).returnCapital(t.target,E('20')));
 const before=await t.balanceOf(a[1]),legacy=Array.from(await q.requests(0));
 await tx(queue.approve(0));assert.equal((await queue.requests(0)).status,3n);await tx(queue.connect(s[8]).pay(0));
 assert.equal(await t.balanceOf(a[1])-before,E('19'));assert.equal(await queue.pending(t.target),0n);await assert.rejects(queue.pay.staticCall(0));
 assert.deepEqual(Array.from(await q.requests(0)),legacy,'legacy claims remain independent; the copy is testnet-only');
});

test('overdue imported cancellation restores the exact reserved profit without changing legacy balances',async()=>{
 const n=await migrate(),queue=new Contract(await n.withdrawalQueue(),art('ImportedWithdrawalQueue').abi,s[1]);
 const before=(await n.accounts(a[1],t.target)).profit,legacy=(await v.accounts(a[1],t.target)).profit,debt=await n.accounted(t.target);
 await tx(queue.cancel(0));assert.equal((await n.accounts(a[1],t.target)).profit,before+E('20'));assert.equal(await n.accounted(t.target),debt);
 assert.equal((await v.accounts(a[1],t.target)).profit,legacy);assert.equal(await q.pending(t.target),E('20'));
});

test('new principal requests preserve the imported position until approved payment',async()=>{
 const n=await migrate(),queue=new Contract(await n.withdrawalQueue(),art('ImportedWithdrawalQueue').abi,s[0]);
 await tx(queue.connect(s[1]).cancel(0));await rpc.request({method:'evm_increaseTime',params:[90*86400]});await rpc.request({method:'evm_mine',params:[]});
 const before=Array.from(await n.positionOf(a[1],0)),principal=(await n.accounts(a[1],t.target)).principal;
 await tx(n.connect(s[1]).withdrawPrincipal(0,E('100')));const request=await queue.requests(3);
 assert.equal(request.gross,E('100'));assert.equal(request.fee,E('30'));assert.equal((await queue.principalRequests(3)).exists,true);
 assert.deepEqual(Array.from(await n.positionOf(a[1],0)),before);assert.equal((await n.accounts(a[1],t.target)).principal,principal);
 await tx(t.approve(n.target,E('100')));await tx(n.connect(s[0]).returnCapital(t.target,E('100')));await tx(queue.approveAndPay(3));
 assert.equal((await n.accounts(a[1],t.target)).principal,principal-E('100'));assert.equal((await v.accounts(a[1],t.target)).principal,principal);
});

test('import emits registration events so the daily worker includes every copied account',async()=>{
 const n=await migrate(),receipt=await n.deploymentTransaction().wait(),block=await p.getBlock(receipt.blockNumber);
 const policy={version:1,chainId:97,vaultAddress:n.target,runtimeHash:keccak256(await p.getCode(n.target)),deploymentBlock:receipt.blockNumber,startTimestamp:block.timestamp,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true};
 const state={};assert.equal(await indexMembers({provider:p,policy,state,through:receipt.blockNumber,save:()=>{}}),true);
 assert.deepEqual(Object.keys(state.registry.members).sort(),members.slice().sort());
 await rpc.request({method:'evm_increaseTime',params:[86400]});await rpc.request({method:'evm_mine',params:[]});
 const plan=await planDailyEpoch({provider:p,vault:n,policy,state,epoch:0,confirmations:0});
 assert.equal(plan.status,'ready');assert.equal(plan.batches.length,1);assert.equal(plan.batches[0].recipients.length,3);
 assert.equal(plan.batches[0].rows.reduce((sum,r)=>sum+BigInt(r.principal),0n),(await n.ledgers(t.target)).principal);
});

test('partial inventories, duplicate members and unknown used IDs cannot deploy a partial copy',async()=>{
 await assert.rejects(migrate(members.filter(who=>who!==a[1])));
 await assert.rejects(migrate([...members,members[2]]));
 await assert.rejects(migrate(members,[...batchIds,id('unknown-batch')]));
 await assert.rejects(migrate(members,batchIds,[id('unknown-sale')]));
});

test('unpaused sources, nonempty treasuries and pending ownership stop migration',async()=>{
 await tx(v.setPaused(false));await assert.rejects(migrate());await tx(v.setPaused(true));
 await tx(v.transferOwnership(a[8]));await assert.rejects(migrate());await tx(v.transferOwnership(ZeroAddress));
 await tx(v.returnCapital(t.target,E('1')));await assert.rejects(migrate());
});

test('approval-enabled source queues are rejected instead of importing principal requests as profit',async()=>{
 const current=await deploy(art('DeferredRewardsVault'),[a[0],t.target,feed.target,feed.target,86400,a.slice(0,7),a[11]]);
 await tx(current.setPaused(true));await assert.rejects(deploy(art('TestnetDeferredMigrationVault'),[current.target,[],[],[]]));
});

const policy=async()=>({chainId:97,source:v.target,owner:a[0],operator:a[8],migrationDeployer:a[8],sourceHash:keccak256(await p.getCode(v.target)),creationHash:creation.hash});
const seedAtCreation=async()=>({version:1,chainId:97,source:v.target,creationHash:creation.hash,creationBlock:creation.blockNumber,through:creation.blockNumber,blockHash:(await p.getBlock(creation.blockNumber)).hash,members:[],settlements:[],creditIds:[]});
test('copy discovery recovers a mined deployment across browsers before confirmation without another signature',async()=>{
 const n=await migrate(),receipt=await n.deploymentTransaction().wait(),config=await policy(),seed=await seedAtCreation();
 for(const state of [{},{}]){
  const result=await discoverDeferredCopies({provider:p,artifact:art('TestnetDeferredMigrationVault'),seed,policy:config,state});
  assert.equal(result.complete,true);assert.equal(result.copies.length,1);assert.equal(result.copies[0].hash,receipt.hash);assert.equal(result.copies[0].target,n.target);assert.equal(result.copies[0].paused,true);
  const again=await discoverDeferredCopies({provider:p,artifact:art('TestnetDeferredMigrationVault'),seed,policy:config,state});assert.equal(again.copies.length,1);
 }
});
test('constructor proof verifies the full import without historical storage calls and detects later legacy mutations',async()=>{
 const n=await migrate(),receipt=await n.deploymentTransaction().wait();
 for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
 const latestOnly=new Proxy(p,{get(target,name){
  if(name==='call')return request=>{assert.ok(request.blockTag===undefined||request.blockTag==='latest','historical storage is unavailable');return target.call(request);};
  if(name==='getCode')return(address,block)=>{assert.ok(block===undefined||block==='latest');return target.getCode(address,block);};
  const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;
 }});
 const config=await policy(),report=await verifyDeferredImport({provider:latestOnly,artifact:art('TestnetDeferredMigrationVault'),hash:receipt.hash,policy:config});
 assert.equal(report.atomicConstructorCopyVerified,true);assert.equal(report.target,n.target);assert.equal(report.accountsMigrated,true);assert.equal(report.legacyClaimsExtinguished,false);
 await assertDeferredSnapshotStable({provider:latestOnly,report,policy:config});
 await assert.rejects(verifyDeferredImport({provider:latestOnly,artifact:art('DeferredRewardsVault'),hash:receipt.hash,policy:config}),/MIGRATION_BYTECODE_MISMATCH/);
 await tx(q.connect(s[1]).cancel(0));
 await assert.rejects(assertDeferredSnapshotStable({provider:latestOnly,report,policy:config}),/SOURCE_CHANGED_AFTER_COPY/);
});

test('read-only migration API verifies a transaction without changing contracts or exposing RPC credentials',async()=>{
 const n=await migrate(),receipt=await n.deploymentTransaction().wait();for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
 const config=await policy(),checkpoint=await p.getBlock(creation.blockNumber);
 const seed={version:1,chainId:97,source:v.target,creationHash:creation.hash,creationBlock:creation.blockNumber,through:creation.blockNumber,blockHash:checkpoint.hash,members:[],settlements:[],creditIds:[]};
 const service=createMigrationService({chainId:97,address:v.target,rpcUrl:'https://private.invalid/never-expose-this-key'},{provider:p,artifact:art('TestnetDeferredMigrationVault'),seedReader:()=>seed,policy:config});
 const server=createApiServer({configured:true,publicConfig:{version:1,chainId:97,vaultAddress:v.target},get:async()=>({status:'live',trades:[]})},{migration:service});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const before=await p.getTransactionCount(a[0]);
 try{
  assert.equal((await fetch(origin+'/api/migration/verify?hash=invalid')).status,400);
  assert.equal((await fetch(origin+'/api/migration/status',{method:'POST'})).status,405);
  const poll=async url=>{
   for(let i=0;i<200;i++){
    const response=await fetch(origin+url),body=await response.json();assert.ok(!JSON.stringify(body).includes('never-expose-this-key'));
    if(body.ready)return body;if(body.error)throw Error(body.error);
    await new Promise(resolve=>setTimeout(resolve,25));
   }throw Error('API_DID_NOT_FINISH');
  };
  const status=await poll('/api/migration/status');assert.equal(status.sourcePaused,true);assert.equal(status.tokenDecimals,18);
  const inventory=await poll('/api/migration/inventory');assert.deepEqual(inventory.inventory.members,members);
  const copies=await poll('/api/migration/discover?afterBlock='+receipt.blockNumber);assert.equal(copies.copies[0].hash,receipt.hash);
  const verified=await poll('/api/migration/verify?hash='+receipt.hash);assert.equal(verified.report.target,n.target);assert.equal(verified.report.siteConnected,false);
  assert.equal(verified.report.reporterAuthorization.quorum,2);assert.equal(verified.report.reporterAuthorization.operator,a[8]);
  assert.equal(await p.getTransactionCount(a[0]),before);assert.equal(await v.paused(),true);assert.equal(await n.paused(),true);
 }finally{await new Promise(resolve=>server.close(resolve));service.close();}
});

test('cutover preserves private settings and rejects unrelated, active or changed copies',async()=>{
 const n=await migrate(),receipt=await n.deploymentTransaction().wait();for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
 const original='TRADES_CHAIN_ID="97"\nTRADES_RPC_URL="https://private.invalid/keep-this"\nTRADES_VAULT_ADDRESS="'+v.target+'"\nTRADES_START_BLOCK=1\nEBAY_CLIENT_ID="keep-catalog"\n',config=await policy();
 const options={provider:p,artifact:art('TestnetDeferredMigrationVault'),hash:receipt.hash,seed:await seedAtCreation(),original,policy:config};
 const ready=await prepareDeferredConnection(options);assert.ok(ready.env.includes('https://private.invalid/keep-this'));assert.ok(ready.env.includes('EBAY_CLIENT_ID="keep-catalog"'));assert.ok(ready.env.includes('TRADES_VAULT_ADDRESS="'+n.target+'"'));assert.equal(ready.report.siteConnected,false);
 await assert.rejects(prepareDeferredConnection({...options,original:original.replace(v.target,a[9])}),/UNRELATED_ACTIVE_TARGET/);
 await tx(n.connect(s[0]).setPaused(false));await assert.rejects(prepareDeferredConnection(options),/COPIED_TARGET_MUST_BE_PAUSED/);await tx(n.connect(s[0]).setPaused(true));
 await tx(q.connect(s[1]).cancel(0));await assert.rejects(prepareDeferredConnection(options),/SOURCE_CHANGED_AFTER_COPY/);
});

test('daily enrollment requires owner activation, original council delay, funded budget and archival state',async()=>{
 const n=await migrate(),receipt=await n.deploymentTransaction().wait();for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
 const options={provider:p,artifact:art('TestnetDeferredMigrationVault'),hash:receipt.hash,seed:await seedAtCreation(),address:n.target,policy:await policy()};
 await assert.rejects(verifyDeferredAutomation(options),/OWNER_ACTIVATION_REQUIRED/);await tx(n.connect(s[0]).setPaused(false));
 await assert.rejects(verifyDeferredAutomation(options),/COUNCIL_AUTHORIZED_SERVER_REPORTER_REQUIRED/);
 const calldata=n.interface.encodeFunctionData('setReporter',[a[8],true]),proposal=keccak256(calldata);
 await tx(n.connect(s[0]).queueConfiguration(proposal));await tx(n.connect(s[1]).voteConfiguration(proposal));await tx(n.connect(s[2]).voteConfiguration(proposal));
 await assert.rejects(n.connect(s[0]).setReporter.staticCall(a[8],true));await rpc.request({method:'evm_increaseTime',params:[2*86400]});await rpc.request({method:'evm_mine',params:[]});await tx(n.connect(s[0]).setReporter(a[8],true));
 await assert.rejects(verifyDeferredAutomation(options),/FUNDED_DAILY_REWARD_BUDGET_REQUIRED/);await tx(t.connect(s[0]).approve(n.target,E('10')));await tx(n.connect(s[0]).fundRewards(t.target,E('10')));
 const pruned=new Proxy(p,{get(target,name){if(name==='call')return request=>{if(request.blockTag!==undefined&&request.blockTag!=='latest')throw Error('missing trie node https://private.invalid/secret');return target.call(request);};const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(verifyDeferredAutomation({...options,provider:pruned}),/^Error: ARCHIVE_RPC_REQUIRED_FOR_PERIOD_START_PRINCIPAL$/);
 const enrolled=await verifyDeferredAutomation(options);assert.equal(enrolled.target,n.target);assert.ok(enrolled.historicalStateProbeBlock<await p.getBlockNumber());
});
