import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,Wallet,ZeroAddress,Transaction,keccak256,parseEther as E} from 'ethers';
import {getZeroStartProfile} from '../scripts/zero-start-profile.mjs';
import {prepareZeroStartConnection} from '../scripts/connect-zero-start.mjs';
import {verifyZeroStartTarget,verifyZeroStartReadiness} from '../scripts/zero-start-readiness.mjs';
import {assertZeroStartOraclePending,inspectZeroStartOracles,runZeroStartOracleMaintenance,runZeroStartAutomation,retryableDailyReadFailure,partitionZeroStartDailyReadErrors} from '../scripts/zero-start-automation.mjs';
import {journalTransaction} from '../scripts/migration-journal.mjs';
import {blockAtTime} from '../scripts/daily-profit.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
const pinned=getZeroStartProfile(true).release;
const tx=async promise=>(await promise).wait();
const proxy=(target,overrides)=>new Proxy(target,{get(object,name){if(Object.hasOwn(overrides,name))return overrides[name];const value=Reflect.get(object,name);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,operator,signers,addresses,token,bnb,usd,vault,release,deploymentReport,connectionReport,original,snapshot,knownWallet;
const mine=async()=>{for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});};
const advance=async seconds=>{await rpc.request({method:'evm_increaseTime',params:[seconds]});await mine();};
const options=extra=>({provider,artifact:artifact('FastTestnetVault'),deploymentReport,connectionReport,original,release,confirmations:1,...extra});
const verified=extra=>verifyZeroStartTarget(options(extra));
const identity=ready=>({version:1,chainId:97,target:ready.target,owner:ready.owner,operator:ready.operator,queue:ready.queue,hash:ready.hash,runtimeHash:ready.runtimeHash});
const wallet=()=>({address:pinned.deployer,connect:()=>operator});

before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12,unlockedAccounts:[pinned.owner,pinned.deployer]},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 for(const who of [pinned.owner,pinned.deployer])await rpc.request({method:'evm_setAccountBalance',params:[who,'0x'+E('10').toString(16)]});
 operator=await provider.getSigner(pinned.deployer);signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 await rpc.request({method:'evm_setAccountNonce',params:[pinned.deployer,'0x10']});
 const known=Object.values(rpc.getInitialAccounts())[0];knownWallet=new Wallet(known.secretKey,provider);
 const deploy=async(name,args,signer=signers[0])=>{const a=artifact(name),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 token=await deploy('MockToken',[18]);bnb=await deploy('MockFeed',[60000000000n]);usd=await deploy('MockFeed',[100000000n]);
 release={...pinned,token:token.target,bnbFeed:bnb.target,tokenFeed:usd.target,partners:addresses.slice(0,7),operations:addresses[11]};
 vault=await deploy('FastTestnetVault',[release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations],operator);
 deploymentReport={hash:vault.deploymentTransaction().hash};await mine();
 const prepared=await prepareZeroStartConnection(options({original:'TRADES_CHAIN_ID=97\nTRADES_RPC_URL=https://rpc.example.invalid/private\nTRADES_VAULT_ADDRESS='+vault.target+'\nTRADES_PORT=3115\nTRADES_CONFIRMATIONS=1\nGLOBAL_MIGRATION_ENABLED=false\n'}));
 original=prepared.env;connectionReport={...prepared.report,siteConnected:true};
 await tx(token.mint(addresses[1],E('2000')));await tx(token.connect(signers[1]).approve(vault.target,E('2000')));
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});

function session(readiness){
 const state={identity:identity(readiness),transactions:{}};let sends=0;
 const transact=async(label,request)=>{
  assert.ok([bnb.target,usd.target].includes(request.to));assert.equal(BigInt(request.value??0),0n);
  const action=bnb.interface.parseTransaction(request);assert.equal(action.name,'set');
  const entry=state.transactions[label];if(entry?.block)return provider.getTransactionReceipt(entry.hash);
  sends++;const receipt=await tx(operator.sendTransaction(request));
  state.transactions[label]={hash:receipt.hash,block:receipt.blockNumber,blockHash:receipt.blockHash,maxFee:'0'};return receipt;
 };
 const run=extra=>runZeroStartOracleMaintenance({provider,wallet:wallet(),artifact:artifact('MockFeed'),release,readiness,state,save:()=>{},transact,confirmations:1,oraclesOnly:true,...extra});
 return {state,run,get sends(){return sends;}};
}

test('oracle-only recovery restores actual fast-vault investments while daily funding and archive readiness remain blocked',async()=>{
 await advance(90000);
 await assert.rejects(vault.quoteUsd(token.target,E('1')));
 await assert.rejects(vault.connect(signers[1]).deposit.staticCall(token.target,E('1000'),ZeroAddress));
 const selector=vault.interface.getFunction('accounts').selector;
 const pruned=proxy(provider,{call:async request=>{if(request.to===vault.target&&request.data.startsWith(selector))throw Error('historical account state unavailable');return provider.call(request);}});
 const ready=await verified({provider:pruned});assert.equal(ready.siteConnected,true);assert.equal(ready.archive,undefined);assert.equal(ready.funding,undefined);
 const daily=await verifyZeroStartReadiness(options({provider:pruned}));
 assert.equal(daily.ready,false);assert.ok(daily.blockers.includes('ARCHIVE_RPC_REQUIRED_FOR_PERIOD_START_PRINCIPAL'));assert.ok(daily.blockers.includes('FUNDED_DAILY_REWARD_BUDGET_REQUIRED'));
 const nonce=await provider.getTransactionCount(pinned.deployer);
 const before=await inspectZeroStartOracles({provider,artifact:artifact('MockFeed'),release,readiness:ready});assert.equal(before.ready,false);assert.ok(before.feeds.every(f=>BigInt(f.ageSeconds)>86400n));
 assert.equal(await provider.getTransactionCount(pinned.deployer),nonce,'Read-only checks must not send');
 const s=session(ready),result=await s.run();assert.equal(result.status,'TESTNET_ORACLES_VALID');assert.equal(s.sends,2);
 assert.equal(await vault.quoteUsd(token.target,E('1')),E('1'));assert.equal(await vault.quoteUsd(ZeroAddress,E('1')),E('600'));
 await tx(vault.connect(signers[1]).deposit(token.target,E('1000'),ZeroAddress));assert.equal((await vault.accounts(addresses[1],token.target)).principal,E('1000'));
 assert.equal((await vault.ledgers(token.target)).rewards,0n,'Oracle repair must not seed or credit rewards');
 const final=await inspectZeroStartOracles({provider,artifact:artifact('MockFeed'),release,readiness:ready});assert.equal(final.ready,true);assert.equal(final.transactionsSent,0);
 const afterNonce=await provider.getTransactionCount(pinned.deployer);assert.equal((await s.run()).transactions.length,0);assert.equal(s.sends,2);assert.equal(await provider.getTransactionCount(pinned.deployer),afterNonce);
 assert.ok(Object.keys(s.state.transactions).every(label=>/^oracle-refresh-/.test(label)));
});

test('oracle-only rejects any financial or mixed pending journal before the first broadcast',async()=>{
 await advance(90000);const ready=await verified(),s=session(ready);
 const signing=new Wallet('0x'+'11'.repeat(32));
 const request={to:usd.target,data:usd.interface.encodeFunctionData('set',[100000000n,(await provider.getBlock('latest')).timestamp,2,2])};
 const raw=await signing.signTransaction({...request,type:0,chainId:97,nonce:0,gasLimit:100000n,gasPrice:1000000000n,value:0n});
 s.state.transactions['daily-batch-unconfirmed']={raw,hash:keccak256(raw),maxFee:'1'};
 await assert.rejects(s.run(),/ZERO_START_NON_ORACLE_PENDING_REQUIRES_FULL_WORKER/);assert.equal(s.sends,0);
 delete s.state.transactions['daily-batch-unconfirmed'];
 s.state.oracle={sequence:1,pending:{label:'oracle-refresh-1',request}};
 s.state.transactions['oracle-refresh-1']={raw,hash:keccak256(raw),maxFee:'1'};
 assert.doesNotThrow(()=>assertZeroStartOraclePending({state:s.state,release,artifact:artifact('MockFeed')}));
 s.state.transactions['withdrawal-0']={raw,hash:keccak256(raw),maxFee:'1'};
 await assert.rejects(s.run(),/ZERO_START_NON_ORACLE_PENDING_REQUIRES_FULL_WORKER/);assert.equal(s.sends,0);
 delete s.state.transactions['withdrawal-0'];
 s.state.oracle.pending.request={...request,data:usd.interface.encodeFunctionData('set',[200000000n,(await provider.getBlock('latest')).timestamp,2,2])};
 await assert.rejects(s.run(),/ZERO_START_ORACLE_PENDING_SCOPE_MISMATCH/);assert.equal(s.sends,0);
 assert.equal(Transaction.from(raw).value,0n);
});

test('oracle repair preserves the cumulative fee cap and rejects invalid rounds before either feed changes',async()=>{
 await advance(90000);const ready=await verified(),s=session(ready),block=await provider.getBlock('latest');
 s.state.transactions.previous={maxFee:E('0.1').toString(),block:block.number,blockHash:block.hash};
 const nonce=await provider.getTransactionCount(knownWallet.address),oldRound=await bnb.round();
 await assert.rejects(s.run({transact:(label,request)=>journalTransaction({provider,wallet:knownWallet,state:s.state,save:()=>{},label,request,guard:async()=>{},confirmations:1,maxTotalFee:E('0.1')})}),/TOTAL_TEST_BNB_FEE_LIMIT_0_1/);
 assert.equal(await provider.getTransactionCount(knownWallet.address),nonce);assert.equal(await bnb.round(),oldRound);
 const invalid=session(ready);await tx(usd.set(0n,block.timestamp,9,9));
 await assert.rejects(invalid.run(),/Invalid mock price/);assert.equal(invalid.sends,0);assert.equal(await bnb.round(),oldRound);
});

test('minimal target proof and oracle inspection retain chain, creation, marker and runtime checks',async()=>{
 const ready=await verified();
 await assert.rejects(verified({connectionReport:{...connectionReport,siteConnected:false}}),/ZERO_START_CONNECTED_MARKER_REQUIRED/);
 await assert.rejects(verified({original:original+'TRADES_VAULT_ADDRESS='+addresses[2]+'\n'}),/ZERO_START_ACTIVE_API_TARGET_MISMATCH/);
 await assert.rejects(verified({artifact:artifact('AutomaticGroupVault')}),/ZERO_START_ARTIFACT_MISMATCH/);
 await assert.rejects(inspectZeroStartOracles({provider:{getNetwork:async()=>({chainId:56n})},artifact:artifact('MockFeed'),release,readiness:ready}),/Testnet/);
 await assert.rejects(inspectZeroStartOracles({provider,artifact:{...artifact('MockFeed'),evm:{deployedBytecode:{object:'00'}}},release,readiness:ready}),/reviewed MockFeed/);
 const noLogs=proxy(provider,{getLogs:async()=>{throw Error('settlement log RPC unavailable');}});
 assert.equal((await verified({provider:noLogs,inspectSettlementLogs:false})).target,vault.target);
 await assert.rejects(verifyZeroStartReadiness(options({provider:noLogs})),/ZERO_START_SETTLEMENT_LOG_RPC_REQUIRED/);
});

test('explicit fast hourly mode creates a one-hour policy and credits its percentage once after a full hour',async()=>{
 await tx(token.mint(addresses[0],E('100')));await tx(token.approve(vault.target,E('100')));await tx(vault.connect(signers[0]).fundRewards(token.target,E('100')));
 await tx(vault.connect(signers[1]).deposit(token.target,E('1000'),ZeroAddress));await mine();
 const target=await verified(),s=session(target),oracles=await s.run();let policy;
 const queue=new Contract(target.queue,artifact('ProfitWithdrawalQueue').abi,operator);
 const full=()=>verifyZeroStartReadiness(options({hourlyTest:true,policy,periodStartTimestamp:policy?policy.startTimestamp+(s.state.daily?.epoch||0)*policy.periodSeconds:undefined}));
 const transact=async(label,request)=>{
  assert.equal(request.to,vault.target);assert.equal(BigInt(request.value??0),0n);
  const receipt=await tx(operator.sendTransaction(request));s.state.transactions[label]={hash:receipt.hash,block:receipt.blockNumber,blockHash:receipt.blockHash,maxFee:'0'};return receipt;
 };
 const run=async(hourlyTest=true)=>runZeroStartAutomation({provider,vault:vault.connect(operator),queue,readiness:await full(),state:s.state,save:()=>{},loadPolicy:()=>policy,savePolicy:value=>{policy=value;},transact,refreshReadiness:full,maintainOracles:async()=>oracles,confirmations:1,hourlyTest});
 const first=await run();assert.equal(first.status,'scheduled');assert.equal(policy.periodSeconds,3600);assert.equal(policy.testInterval,'hourly');assert.equal(first.firstPeriodEndsAt,policy.startTimestamp+3600);
 const funded=await full();assert.equal(funded.ready,true);
 assert.deepEqual(partitionZeroStartDailyReadErrors(['TEST_REWARD_SEED_READ_UNAVAILABLE'],funded),{warnings:['TEST_REWARD_SEED_READ_UNAVAILABLE'],blocking:[]});
 assert.deepEqual(partitionZeroStartDailyReadErrors(['TEST_REWARD_SEED_READ_UNAVAILABLE'],{...funded,ready:false,funding:{ready:false}}),{warnings:[],blocking:['TEST_REWARD_SEED_READ_UNAVAILABLE']});
 assert.equal((await vault.accounts(addresses[1],token.target)).profit,0n);
 const rate=await vault.dailyTargetBps(addresses[1],{blockTag:policy.activationBlock}),expected=E('1000')*rate/10000n;
 await advance(3601);const credited=await run();assert.equal(credited.nextEpoch,1);assert.equal((await vault.accounts(addresses[1],token.target)).profit,expected);
 const count=Object.keys(s.state.transactions).length;await run();assert.equal(Object.keys(s.state.transactions).length,count);assert.equal((await vault.accounts(addresses[1],token.target)).profit,expected);
 await assert.rejects(run(false),/HOURLY_TEST_EXPLICIT_MODE_REQUIRED/);
});

test('explicit hourly readiness needs one-hour retention and its actual unpaid period snapshot, while ordinary readiness keeps 24 hours',async()=>{
 await tx(vault.fundRewards(ZeroAddress,1n,{value:1n}));
 await advance(86400);const previousHour=await provider.getBlock('latest');
 await advance(3601);
 const selector=vault.interface.getFunction('accounts').selector;
 const pruned=proxy(provider,{call:async request=>{if(request.to===vault.target&&request.data.startsWith(selector)&&Number(request.blockTag)<previousHour.number)throw Error('24-hour history unavailable');return provider.call(request);}});
 const ordinary=await verifyZeroStartReadiness(options({provider:pruned}));assert.equal(ordinary.ready,false);assert.equal(ordinary.archive.requiredRetentionSeconds,86400);
 const hourly=await verifyZeroStartReadiness(options({provider:pruned,hourlyTest:true}));assert.equal(hourly.ready,true);assert.equal(hourly.archive.status,'supported');assert.equal(hourly.archive.requiredRetentionSeconds,3600);assert.equal(hourly.testInterval,'hourly');assert.equal(hourly.allocationPeriodSeconds,3600);
 const marker=hourly.checkpoint;
 const policy={version:1,chainId:97,vaultAddress:vault.target,runtimeHash:hourly.runtimeHash,deploymentBlock:hourly.block,startTimestamp:marker.timestamp,activationBlock:marker.block,activationBlockHash:marker.blockHash,basis:'period-start-active-principal',periodSeconds:3600,includeReinvestment:true,testMode:true,releaseId:pinned.releaseId,testInterval:'hourly',fastTestnetVersion:1};
 await advance(3601);
 const periodBlock=await blockAtTime(provider,policy.startTimestamp,connectionReport.block,(await provider.getBlock('latest')).number);
 const missingPeriod=proxy(provider,{call:async request=>{if(request.to===vault.target&&request.data.startsWith(selector)&&Number(request.blockTag)===periodBlock.number)throw Error('unpaid hourly principal unavailable');return provider.call(request);}});
 const blocked=await verifyZeroStartReadiness(options({provider:missingPeriod,hourlyTest:true,policy,periodStartTimestamp:policy.startTimestamp}));assert.equal(blocked.ready,false);assert.equal(blocked.archive.status,'unavailable');assert.ok(blocked.archive.probes.some(row=>row.requestedTimestamp===policy.startTimestamp&&!row.supported));
});

test('optional read failures can wait only without pending financial signatures or safety failures',()=>{
 assert.equal(retryableDailyReadFailure({code:'CALL_EXCEPTION'},{transactions:{}}),true);
 assert.equal(retryableDailyReadFailure({message:'TEST_TOKEN_METADATA_MISMATCH'},{transactions:{}}),true);
 assert.equal(retryableDailyReadFailure({message:'ZERO_START_SETTLEMENT_LOG_RPC_REQUIRED'},{transactions:{}}),true);
 for(const message of ['TOTAL_TEST_BNB_FEE_LIMIT_0_1','ZERO_START_AUTOMATION_IDENTITY_CHANGED','ZERO_START_COMPLETED_JOURNAL_NOT_CANONICAL','OWNER_HAS_PENDING_TRANSACTIONS'])assert.equal(retryableDailyReadFailure({message},{transactions:{}}),false);
 assert.equal(retryableDailyReadFailure({code:'CALL_EXCEPTION'},{transactions:{seed:{raw:'unconfirmed'}}}),false);
});

test('read-only CLI failures preserve the public status instead of publishing an execution failure',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'global-oracle-read-only-'));
 try{
  const publicDirectory=path.join(directory,'public');fs.mkdirSync(publicDirectory,{mode:0o755});
  const status=path.join(publicDirectory,'activation.json');fs.writeFileSync(status,'preserved-public-status\n',{mode:0o644});
  const sourceUrl=new URL('../scripts/zero-start-automation.mjs',import.meta.url);
  let source=fs.readFileSync(sourceUrl,'utf8').replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>'from '+JSON.stringify(new URL(relative,sourceUrl).href));
  source=source.replace("from 'ethers'",'from '+JSON.stringify(import.meta.resolve('ethers')));
  source=source.replace("const publicRoot='/var/www/globaldroptrade/automation-data';",'const publicRoot='+JSON.stringify(publicDirectory)+';');
  source=source.replaceAll("'/etc/globaldroptrade/trades.env'",JSON.stringify(path.join(directory,'absent-private-env')));
  const file=path.join(directory,'read-only-check.mjs');fs.writeFileSync(file,source);
  for(const args of [['--check'],['--oracles-only','--check']]){
   const result=spawnSync(process.execPath,[file,...args],{encoding:'utf8',timeout:15000});
   assert.equal(result.status,1,result.stdout+result.stderr);assert.match(result.stderr,/ZERO_START_AUTOMATION_STOPPED/);
   assert.equal(fs.readFileSync(status,'utf8'),'preserved-public-status\n');
  }
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
