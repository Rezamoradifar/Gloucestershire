import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,Wallet,ZeroAddress,getAddress,keccak256,parseEther} from 'ethers';
import {deployZeroStart,zeroStartRelease} from '../scripts/deploy-zero-start.mjs';
import {verifyZeroStartReadiness,zeroStartArchiveProbeDiagnostic,sanitizeZeroStartArchiveProbeDiagnostic} from '../scripts/zero-start-readiness.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
const proxy=(target,overrides)=>new Proxy(target,{get(object,name){if(Object.hasOwn(overrides,name))return overrides[name];const value=Reflect.get(object,name);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,signers,addresses,token,feed,wallet,release,deploymentReport,connectionReport,target,original,snapshot;
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const deploy=async(a,args)=>{const c=await new ContractFactory(a.abi,a.bytecode||'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;};
 token=await deploy(artifact('MockToken'),[18]);feed=await deploy(artifact('MockFeed'),[100000000n]);
 wallet=new Wallet(rpc.getInitialAccounts()[addresses[8].toLowerCase()].secretKey,provider);
 release={...zeroStartRelease,owner:addresses[0],deployer:wallet.address,token:token.target,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
 deploymentReport=await deployZeroStart({provider,wallet,artifact:artifact('AutomaticGroupVault'),release,state:{transactions:{}},save:()=>{},confirmations:1});
 target=new Contract(deploymentReport.contractAddress,artifact('AutomaticGroupVault').abi,signers[0]);
 connectionReport={...deploymentReport,kind:'fresh-zero-site-connection',target:target.target,siteConnected:true,verified:true};
 original=['TRADES_CHAIN_ID=97','TRADES_RPC_URL="https://rpc.example.invalid/?key=rpc-secret"','TRADES_VAULT_ADDRESS='+target.target,'TRADES_START_BLOCK='+deploymentReport.block,'TRADES_PORT=3115','TRADES_CONFIRMATIONS=1','TRADES_LOG_PAGE_SIZE=20','GLOBAL_MIGRATION_ENABLED=false','API_KEY="private-api-secret"',''].join('\n');
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});
const options=(extra={})=>({provider,artifact:artifact('AutomaticGroupVault'),deploymentReport,connectionReport,original,release,confirmations:1,...extra});
const checked=async(extra={})=>{await rpc.request({method:'evm_mine',params:[]});return verifyZeroStartReadiness(options(extra));};
const authorize=async()=>{
 const hash=keccak256(target.interface.encodeFunctionData('setReporter',[wallet.address,true]));
 await (await target.queueConfiguration(hash)).wait();
 await (await target.connect(signers[1]).voteConfiguration(hash)).wait();await (await target.connect(signers[2]).voteConfiguration(hash)).wait();
 await rpc.request({method:'evm_increaseTime',params:[172801]});await rpc.request({method:'evm_mine',params:[]});
 await (await target.setReporter(wallet.address,true)).wait();
};

test('reports exact council state without signing and distinguishes readiness from a running worker',async()=>{
 const allowed=new Set([target.target,deploymentReport.queue]);let broadcasts=0;
 const observed=proxy(provider,{call:async tx=>{assert.ok(allowed.has(getAddress(tx.to)));return provider.call(tx);},broadcastTransaction:async()=>{broadcasts++;throw Error('Readiness cannot broadcast');}});
 let report=await checked({provider:observed});
 const calldata=target.interface.encodeFunctionData('setReporter',[wallet.address,true]),hash=keccak256(calldata);
 assert.equal(report.reporterProposal.calldata,calldata);assert.equal(report.reporterProposal.hash,hash);assert.equal(report.reporterAuthorized,false);
 assert.equal(report.reporterProposal.queued,false);assert.equal(report.reporterProposal.requiredVotes,2);
 assert.ok(report.blockers.includes('COUNCIL_AUTHORIZED_SERVER_REPORTER_REQUIRED'));assert.ok(report.blockers.includes('REPORTER_PROPOSAL_REQUIRED'));
 assert.equal(report.archive.status,'provisional');assert.equal(report.ready,false);assert.equal(report.automationStatus,'not-inspected');
 await (await target.queueConfiguration(hash)).wait();await (await target.connect(signers[1]).voteConfiguration(hash)).wait();
 report=await checked({provider:observed});
 assert.equal(report.reporterProposal.votes,1);assert.equal(report.reporterProposal.partners.find(p=>p.address===addresses[1]).voted,true);
 assert.equal(report.reporterProposal.delayElapsed,false);assert.equal(report.reporterProposal.executable,false);
 await (await target.connect(signers[2]).voteConfiguration(hash)).wait();
 await rpc.request({method:'evm_increaseTime',params:[172801]});await rpc.request({method:'evm_mine',params:[]});
 report=await checked({provider:observed});
 assert.equal(report.reporterProposal.votes,2);assert.equal(report.reporterProposal.delayElapsed,true);assert.equal(report.reporterProposal.executable,true);
 assert.ok(report.blockers.includes('REPORTER_ENABLE_EXECUTION_REQUIRED'));
 await (await target.setReporter(wallet.address,true)).wait();
 report=await verifyZeroStartReadiness(options({provider:observed}));assert.equal(report.reporterAuthorized,false);
 await (await target.fundRewards(ZeroAddress,1n,{value:1n})).wait();
 report=await verifyZeroStartReadiness(options({provider:observed}));assert.equal(report.funding.ready,false);
 report=await checked({provider:observed});
 assert.equal(report.reporterAuthorized,true);assert.equal(report.archive.status,'supported');assert.equal(report.funding.ready,true);assert.equal(report.ready,true);assert.deepEqual(report.blockers,[]);
 assert.equal(report.funding.assets[0].minimumBudgetRequired,'1');assert.equal(report.transactionsSent,0);assert.equal(broadcasts,0);
 const serialized=JSON.stringify(report);for(const value of ['rpc-secret','private-api-secret','https://rpc.example.invalid'])assert.equal(serialized.includes(value),false);
 assert.equal(await provider.getTransactionCount(wallet.address),1);
});

test('requires one funded period for each existing principal asset, an unpaused vault and positive operator gas',async()=>{
 await (await token.mint(addresses[1],parseEther('100'))).wait();await (await token.connect(signers[1]).approve(target.target,parseEther('100'))).wait();
 await (await target.connect(signers[1]).deposit(token.target,parseEther('100'),ZeroAddress)).wait();
 await (await token.mint(addresses[0],parseEther('100'))).wait();await (await token.approve(target.target,parseEther('100'))).wait();
 await (await target.fundRewards(token.target,1n)).wait();await authorize();
 let report=await checked(),asset=report.funding.assets.find(row=>row.symbol==='USDT');
 const principal=(await target.ledgers(token.target)).principal,personal=(principal*200n+9999n)/10000n,referrals=(personal*3400n+9999n)/10000n,minimum=personal+referrals;
 assert.equal(report.funding.estimateVersion,2);assert.equal(report.funding.maxReferralBps,3400);
 assert.equal(asset.estimatedDailyRequirement,personal.toString());assert.equal(asset.estimatedReferralRequirement,referrals.toString());assert.equal(asset.estimatedTotalDailyRequirement,minimum.toString());
 assert.equal(asset.minimumBudgetRequired,minimum.toString());assert.equal(asset.ready,false);assert.ok(report.blockers.includes('USDT_REWARD_BUDGET_REQUIRED'));
 await (await target.fundRewards(token.target,personal)).wait();
 report=await checked();assert.equal(report.funding.ready,false);assert.ok(report.blockers.includes('USDT_REWARD_BUDGET_REQUIRED'));
 await (await target.fundRewards(token.target,referrals)).wait();
 report=await checked();assert.equal(report.ready,true);assert.equal(report.funding.assets.find(row=>row.symbol==='BNB').requiredForExistingPrincipal,false);
 const cashSelector=target.interface.getFunction('assetBalance').selector;
 const ledgerSelector=target.interface.getFunction('ledgers').selector;
 const dust=proxy(provider,{call:async request=>{
  if(request.to===target.target&&request.data.startsWith(ledgerSelector)&&target.interface.decodeFunctionData('ledgers',request.data)[0]===token.target)return target.interface.encodeFunctionResult('ledgers',[1n,0n,0n,1n]);
  if(request.to===target.target&&request.data.startsWith(cashSelector)&&target.interface.decodeFunctionData('assetBalance',request.data)[0]===token.target)return target.interface.encodeFunctionResult('assetBalance',[1n]);
  return provider.call(request);
 }});
 const dustReport=await checked({provider:dust}),dustAsset=dustReport.funding.assets.find(row=>row.symbol==='USDT');
 assert.equal(dustAsset.estimatedDailyRequirement,'1');assert.equal(dustAsset.estimatedReferralRequirement,'1');assert.equal(dustAsset.estimatedTotalDailyRequirement,'2');assert.equal(dustAsset.minimumBudgetRequired,'2');assert.equal(dustAsset.ready,false);
 const partiallyBacked=proxy(provider,{call:async tx=>tx.to===target.target&&tx.data.startsWith(cashSelector)?target.interface.encodeFunctionResult('assetBalance',[minimum]):provider.call(tx)});
 report=await checked({provider:partiallyBacked});asset=report.funding.assets.find(row=>row.symbol==='USDT');
 assert.equal(report.ready,true);assert.equal(asset.fullyBackedRewards,false);assert.equal(asset.rewardBackingShortfall,'1');
 const unbacked=proxy(provider,{call:async tx=>tx.to===target.target&&tx.data.startsWith(cashSelector)?target.interface.encodeFunctionResult('assetBalance',[0n]):provider.call(tx)});
 report=await checked({provider:unbacked});assert.equal(report.funding.ready,false);assert.equal(report.funding.assets.find(row=>row.symbol==='USDT').backed,false);
 await (await target.setPaused(true)).wait();report=await checked();assert.ok(report.blockers.includes('OWNER_UNPAUSE_REQUIRED'));assert.equal(report.ready,false);
 await (await target.setPaused(false)).wait();await rpc.request({method:'evm_setAccountBalance',params:[wallet.address,'0x0']});
 report=await checked();assert.equal(report.operatorGas.positive,false);assert.ok(report.blockers.includes('SERVER_OPERATOR_TEST_BNB_REQUIRED'));assert.equal(report.ready,false);
});

test('fails closed on pruned history and probes only the fresh target, including a requested policy period',async()=>{
 await authorize();await (await target.fundRewards(ZeroAddress,1n,{value:1n})).wait();
 const checkpoint=await provider.getBlock('latest'),historical=[];
 const pruned=proxy(provider,{call:async tx=>{
  const value=typeof tx.blockTag==='number'?tx.blockTag:typeof tx.blockTag==='string'&&tx.blockTag.startsWith('0x')?Number(BigInt(tx.blockTag)):checkpoint.number;
  if(value<checkpoint.number){historical.push({address:getAddress(tx.to),block:value});throw Error('historical trie pruned');}
  return provider.call(tx);
 }});
 let report=await checked({provider:pruned});
 assert.equal(report.archive.status,'unavailable');assert.equal(report.ready,false);assert.ok(report.blockers.includes('ARCHIVE_RPC_REQUIRED_FOR_PERIOD_START_PRINCIPAL'));
 assert.ok(historical.length>0);assert.ok(historical.every(row=>row.address===target.target&&row.block>=deploymentReport.block));
 const created=await provider.getBlock(deploymentReport.block),policy={version:1,chainId:97,vaultAddress:target.target,runtimeHash:deploymentReport.runtimeHash,deploymentBlock:deploymentReport.block,startTimestamp:created.timestamp,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true};
 report=await checked({policy,periodStartTimestamp:created.timestamp});
 assert.equal(report.archive.status,'supported');assert.ok(report.archive.probes.some(probe=>probe.purpose==='requested-period-start'));
 assert.ok(report.archive.probes.every(probe=>probe.block>=deploymentReport.block&&probe.supported));
 await assert.rejects(checked({policy:{...policy,vaultAddress:addresses[4]}}),/ZERO_START_DAILY_POLICY_IDENTITY_MISMATCH/);
 await assert.rejects(checked({policy:{...policy,chainId:56}}),/ZERO_START_DAILY_POLICY_IDENTITY_MISMATCH/);
});

test('rejects forged connection identity, unrelated active targets, legacy mode and wrong creation proof',async()=>{
 await assert.rejects(checked({connectionReport:{...connectionReport,target:addresses[4]}}),/ZERO_START_CONNECTED_IDENTITY_MISMATCH/);
 await assert.rejects(checked({connectionReport:{...connectionReport,siteConnected:false}}),/ZERO_START_CONNECTED_MARKER_REQUIRED/);
 await assert.rejects(checked({original:original.replace(target.target,addresses[4])}),/ZERO_START_ACTIVE_API_TARGET_MISMATCH/);
 await assert.rejects(checked({original:original.replace('GLOBAL_MIGRATION_ENABLED=false','GLOBAL_MIGRATION_ENABLED=true')}),/ZERO_START_LEGACY_MIGRATION_MUST_BE_DISABLED/);
 const wrongInitcode=proxy(provider,{getTransaction:async hash=>{const tx=await provider.getTransaction(hash);return {...tx,data:tx.data+'00'};}});
 await assert.rejects(checked({provider:wrongInitcode}),/ZERO_START_TRANSACTION_MISMATCH/);
 const wrongChain=proxy(provider,{send:async method=>{assert.equal(method,'eth_chainId');return '0x38';}});
 await assert.rejects(checked({provider:wrongChain}),/TESTNET_ONLY/);
 await (await target.transferOwnership(addresses[3])).wait();await (await target.connect(signers[3]).acceptOwnership()).wait();
 await (await target.connect(signers[3]).transferOwnership(addresses[0])).wait();await (await target.acceptOwnership()).wait();
 await assert.rejects(verifyZeroStartReadiness(options()),/ZERO_START_CONFIRMED_OWNER_MISMATCH/);
 assert.equal(await provider.getTransactionCount(wallet.address),1);
});

test('historical probe diagnostics identify the exact failing view without exposing provider exceptions',async()=>{
 await authorize();await (await target.fundRewards(ZeroAddress,1n,{value:1n})).wait();await rpc.request({method:'evm_mine',params:[]});
 const reference=(await provider.getBlock('latest')).number-1;
 for(const [operation,method,asset]of [['owner','owner'],['accounts-native','accounts',ZeroAddress],['accounts-token','accounts',token.target],['dailyTargetBps','dailyTargetBps'],['ledgers-native','ledgers',ZeroAddress],['ledgers-token','ledgers',token.target]]){
  const selector=target.interface.getFunction(method).selector;
  const observed=proxy(provider,{call:async request=>{
   const tag=typeof request.blockTag==='number'?request.blockTag:typeof request.blockTag==='string'&&request.blockTag.startsWith('0x')?Number(BigInt(request.blockTag)):reference;
   const args=request.to===target.target&&request.data.startsWith(selector)?target.interface.decodeFunctionData(method,request.data):null;
   const matches=args&&(asset===undefined||args[method==='accounts'?1:0]===asset);
   if(tag<reference&&matches)throw Object.assign(Error('https://private.invalid/?key=never-print-this-secret'),{code:'CALL_EXCEPTION',info:{error:{code:-32603,message:'private provider response'},payload:{params:['private calldata']}}});
   return provider.call(request);
  }});
  const report=await verifyZeroStartReadiness(options({provider:observed})),failed=report.archive.probes.find(probe=>!probe.supported);
  assert.equal(report.ready,false);assert.equal(report.archive.status,'unavailable');assert.deepEqual(failed.failure,{operation,errorCode:'CALL_EXCEPTION',rpcCode:-32603,httpStatus:null,reason:'UNKNOWN'});
  assert.doesNotMatch(JSON.stringify(report),/never-print-this-secret|private provider response|private calldata|https:\/\/private/);
 }
 assert.deepEqual(zeroStartArchiveProbeDiagnostic({code:'https://private.invalid',error:{code:'secret'}},'secret'),{operation:'unknown',errorCode:null,rpcCode:null,httpStatus:null,reason:'UNKNOWN'});
});

test('probe reason categories are fixed hints and never expose or trust raw exception text',()=>{
 const samples=[
  [{code:'TIMEOUT',message:'https://private.invalid/?key=secret'},'TIMEOUT'],
  [{code:'CALL_EXCEPTION',info:{error:{code:-32603,message:'missing trie node private secret'}}},'HISTORICAL_STATE_UNAVAILABLE'],
  [{code:'UNKNOWN_ERROR',info:{error:{code:-32005,message:'private quota'}}},'RATE_LIMITED'],
  [{code:'SERVER_ERROR',info:{responseStatus:'429 Too Many Requests',error:{message:'private response body'}}},'RATE_LIMITED'],
  [{code:'UNKNOWN_ERROR',info:{error:{code:-32601,message:'private backend'}}},'METHOD_UNAVAILABLE'],
  [{code:'NETWORK_ERROR',message:'private network URL'},'TRANSPORT_UNAVAILABLE'],
  [{code:'BAD_DATA',message:'private response'},'INVALID_RESPONSE'],
  [{code:'CALL_EXCEPTION',data:'0x1234',message:'private revert data'},'REVERTED'],
  [{message:'private unknown detail'},'UNKNOWN']
 ];
 for(const [error,reason]of samples){
  const result=zeroStartArchiveProbeDiagnostic(error,'owner');assert.equal(result.reason,reason);assert.doesNotMatch(JSON.stringify(result),/private|secret|https|0x1234/);
 }
 assert.equal(zeroStartArchiveProbeDiagnostic(samples[3][0],'owner').httpStatus,429);
 const sanitized=sanitizeZeroStartArchiveProbeDiagnostic({operation:'accounts-token',errorCode:'CALL_EXCEPTION',rpcCode:-32603,httpStatus:503,reason:'HISTORICAL_STATE_UNAVAILABLE',message:'private body'});
 assert.deepEqual(sanitized,{operation:'accounts-token',errorCode:'CALL_EXCEPTION',rpcCode:-32603,httpStatus:503,reason:'HISTORICAL_STATE_UNAVAILABLE'});
 assert.deepEqual(sanitizeZeroStartArchiveProbeDiagnostic({operation:'secret',errorCode:'secret',rpcCode:'secret',httpStatus:'secret',reason:'secret',message:'secret'}),{operation:'unknown',errorCode:null,rpcCode:null,httpStatus:null,reason:'UNKNOWN'});
});
