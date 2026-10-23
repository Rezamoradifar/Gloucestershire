import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,Wallet,ZeroAddress,getAddress,parseEther} from 'ethers';
import {deployZeroStart,zeroStartRelease} from '../scripts/deploy-zero-start.mjs';
import {prepareZeroStartConnection,checkZeroStartConnection,publishZeroStartConnection} from '../scripts/connect-zero-start.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
const proxy=(target,overrides)=>new Proxy(target,{get(object,name){if(Object.hasOwn(overrides,name))return overrides[name];const value=Reflect.get(object,name);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,signers,addresses,token,feed,wallet,release,deploymentReport,target,snapshot,original;
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
 for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
 original=[
  '# Existing API settings and private integrations',
  'TRADES_RPC_URL="https://rpc.example.invalid/private?key=rpc-secret"',
  'TRADES_CHAIN_ID=97',
  'TRADES_VAULT_ADDRESS='+addresses[10],
  'TRADES_START_BLOCK=1',
  'TRADES_CONFIRMATIONS=1',
  'TRADES_LOG_PAGE_SIZE=20',
  'TRADES_PORT=3200',
  'GLOBAL_MIGRATION_ENABLED=true',
  'EBAY_CLIENT_SECRET="marketplace-secret"',
  'API_KEY="api-secret"',
  'MULTILINE_PRIVATE="first line\nTRADES_VAULT_ADDRESS=embedded-secret-text\nlast line"',
  'COMMUNITY_DATA_FILE="/var/lib/globaldroptrade-api/existing-community.json"',
  ''
 ].join('\n');
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});
const options=(extra={})=>({provider,artifact:artifact('AutomaticGroupVault'),deploymentReport,original,release,confirmations:1,...extra});
const stagedArgs=(prepared,extra={})=>options({stagedEnv:prepared.env,stage:prepared.report,...extra});
const evidence=()=>({active:{version:1,chainId:97,vaultAddress:target.target},frontend:{version:1,chainId:97,vaultAddress:target.target,indexSha256:'ab'.repeat(32),servedIndexSha256:'ab'.repeat(32),expectedIndexSha256:'ab'.repeat(32),verified:true}});

test('derives the fresh target from canonical initcode, preserves integrations and never reads the previous target',async()=>{
 const allowed=new Set([target.target,deploymentReport.queue]);let broadcasts=0;
 const readOnly=proxy(provider,{
  getCode:async(address,block)=>{assert.ok(allowed.has(getAddress(address)),'Unexpected contract code read');return provider.getCode(address,block);},
  call:async tx=>{assert.ok(allowed.has(getAddress(tx.to)),'Unexpected contract state read');return provider.call(tx);},
  broadcastTransaction:async()=>{broadcasts++;throw Error('No broadcasting during connection');}
 });
 const claimed={...deploymentReport,contractAddress:addresses[9],owner:addresses[9],queue:addresses[9],runtimeHash:'0x'+'ff'.repeat(32),verified:false,siteConnected:true,accountsMigrated:true};
 const prepared=await prepareZeroStartConnection(options({provider:readOnly,deploymentReport:claimed}));
 const before=parseEnv(original),after=parseEnv(prepared.env);
 for(const key of ['TRADES_RPC_URL','EBAY_CLIENT_SECRET','API_KEY','MULTILINE_PRIVATE','COMMUNITY_DATA_FILE','TRADES_CONFIRMATIONS','TRADES_LOG_PAGE_SIZE'])assert.equal(after[key],before[key]);
 assert.ok(prepared.env.startsWith(original));
 assert.equal(after.TRADES_CHAIN_ID,'97');assert.equal(after.TRADES_VAULT_ADDRESS,target.target);assert.equal(after.TRADES_START_BLOCK,String(deploymentReport.block));assert.equal(after.TRADES_PORT,'3115');
 assert.equal(after.GLOBAL_MIGRATION_ENABLED,'false');
 assert.equal(prepared.report.target,target.target);assert.equal(prepared.report.owner,addresses[0]);assert.equal(prepared.report.siteConnected,false);
 assert.equal(prepared.report.proofMethod,'canonical-creation-and-current-state');assert.equal(prepared.report.emptyAtInitialization,true);assert.equal(prepared.report.historicalStateVerified,false);
 assert.equal(prepared.report.runtimeHash,deploymentReport.runtimeHash);assert.equal(prepared.report.transactionsSent,0);assert.equal(broadcasts,0);
 assert.equal((await checkZeroStartConnection(stagedArgs(prepared,{provider:readOnly,deploymentReport:claimed}))).target,target.target);
 assert.equal(await provider.getTransactionCount(wallet.address),1);
});

test('connects an already used fresh target through an RPC that prunes historical contract state',async()=>{
 await (await token.mint(addresses[1],parseEther('100'))).wait();
 await (await token.connect(signers[1]).approve(target.target,parseEther('100'))).wait();
 await (await target.connect(signers[1]).deposit(token.target,parseEther('100'),ZeroAddress)).wait();
 assert.equal((await target.users(addresses[1])).registered,true);assert.ok((await target.accounts(addresses[1],token.target)).principal>0n);
 const currentMember=Array.from(await target.users(addresses[1])),currentAccount=Array.from(await target.accounts(addresses[1],token.target));
 const pruned=proxy(provider,{
  getCode:async(address,block)=>{if(typeof block==='number'&&block<=deploymentReport.block)throw Error('historical trie pruned');return provider.getCode(address,block);},
  call:async tx=>{if(typeof tx.blockTag==='number'&&tx.blockTag<=deploymentReport.block)throw Error('historical trie pruned');return provider.call(tx);}
 });
 const prepared=await prepareZeroStartConnection(options({provider:pruned}));
 assert.equal(prepared.report.emptyAtInitialization,true);assert.equal(prepared.report.historicalStateVerified,false);
 assert.equal(Object.hasOwn(prepared.report,'emptyAtDeployment'),false);
 assert.equal((await checkZeroStartConnection(stagedArgs(prepared,{provider:pruned}))).target,target.target);
 const published=await publishZeroStartConnection(stagedArgs(prepared,{provider:pruned,current:prepared.env,...evidence()}));
 assert.equal(published.siteConnected,true);assert.equal(published.dailyAutomationActive,false);assert.equal(published.historicalStateVerified,false);
 assert.deepEqual(Array.from(await target.users(addresses[1])),currentMember);assert.deepEqual(Array.from(await target.accounts(addresses[1],token.target)),currentAccount);
 assert.equal(await provider.getTransactionCount(wallet.address),1);
});

test('rejects changed original or staged environment before making any RPC calls',async()=>{
 const prepared=await prepareZeroStartConnection(options());let calls=0;
 const unused=proxy(provider,{send:async()=>{calls++;throw Error('RPC must not be used');}});
 await assert.rejects(checkZeroStartConnection(stagedArgs(prepared,{provider:unused,original:original+'NEW_API_KEY=changed\n'})),/ZERO_START_ORIGINAL_ENV_CHANGED/);
 await assert.rejects(checkZeroStartConnection(stagedArgs(prepared,{provider:unused,stagedEnv:prepared.env.replace('rpc-secret','changed-rpc-secret')})),/ZERO_START_STAGED_ENV_CHANGED/);
 await assert.rejects(publishZeroStartConnection(stagedArgs(prepared,{provider:unused,current:prepared.env+'API_KEY=changed\n',...evidence()})),/ZERO_START_INSTALLED_ENV_MISMATCH/);
 assert.equal(calls,0);
});

test('rejects changed deployment proof, staged identity, current code and current owner',async()=>{
 const prepared=await prepareZeroStartConnection(options());
 const wrongInitcode=proxy(provider,{getTransaction:async hash=>{const tx=await provider.getTransaction(hash);return {...tx,data:tx.data+'00'};}});
 await assert.rejects(prepareZeroStartConnection(options({provider:wrongInitcode})),/ZERO_START_TRANSACTION_MISMATCH/);
 const wrongChain=proxy(provider,{send:async method=>{assert.equal(method,'eth_chainId');return '0x38';}});
 await assert.rejects(prepareZeroStartConnection(options({provider:wrongChain})),/TESTNET_ONLY/);
 const wrongReceipt=proxy(provider,{getTransactionReceipt:async hash=>({...await provider.getTransactionReceipt(hash),blockHash:'0x'+'00'.repeat(32)})});
 await assert.rejects(prepareZeroStartConnection(options({provider:wrongReceipt})),/ZERO_START_RECEIPT_NOT_FINAL/);
 await assert.rejects(checkZeroStartConnection(stagedArgs(prepared,{stage:{...prepared.report,target:addresses[2]}})),/ZERO_START_STAGED_IDENTITY_CHANGED/);
 const changedCode=proxy(provider,{getCode:async(address,block)=>{const code=await provider.getCode(address,block);return getAddress(address)===target.target?'0x5f'+code.slice(4):code;}});
 await assert.rejects(checkZeroStartConnection(stagedArgs(prepared,{provider:changedCode})),/ZERO_START_STAGED_IDENTITY_CHANGED/);
 await (await target.transferOwnership(addresses[2])).wait();await (await target.connect(signers[2]).acceptOwnership()).wait();
 await assert.rejects(checkZeroStartConnection(stagedArgs(prepared)),/ZERO_START_CURRENT_OWNER_MISMATCH/);
 assert.equal(await provider.getTransactionCount(wallet.address),1);
});

test('requires matching installed config and frontend evidence, then emits only filtered public fields',async()=>{
 const prepared=await prepareZeroStartConnection(options()),proof=evidence();
 const legacyEnv=prepared.env+'GLOBAL_MIGRATION_ENABLED=true\n',legacyStage={...prepared.report,stagedEnvHash:createHash('sha256').update(legacyEnv).digest('hex')};
 await assert.rejects(publishZeroStartConnection(stagedArgs(prepared,{current:legacyEnv,stagedEnv:legacyEnv,stage:legacyStage,...proof})),/ZERO_START_LEGACY_MIGRATION_MUST_BE_DISABLED/);
 await assert.rejects(publishZeroStartConnection(stagedArgs(prepared,{current:prepared.env,...proof,active:{...proof.active,vaultAddress:addresses[3]}})),/ZERO_START_ACTIVE_CONFIG_MISMATCH/);
 await assert.rejects(publishZeroStartConnection(stagedArgs(prepared,{current:prepared.env,...proof,frontend:{...proof.frontend,verified:false}})),/ZERO_START_FRONTEND_EVIDENCE_REQUIRED/);
 await assert.rejects(publishZeroStartConnection(stagedArgs(prepared,{current:prepared.env,...proof,frontend:{...proof.frontend,servedIndexSha256:'cd'.repeat(32)}})),/ZERO_START_FRONTEND_HASH_MISMATCH/);
 const published=await publishZeroStartConnection(stagedArgs(prepared,{current:prepared.env,...proof}));
 assert.equal(published.siteConnected,true);assert.equal(published.target,target.target);assert.equal(published.communityDataPreserved,true);assert.equal(published.transactionsSent,0);
 const serialized=JSON.stringify(published);
 for(const secret of ['rpc-secret','marketplace-secret','api-secret','https://rpc.example.invalid','originalEnvHash','stagedEnvHash','COMMUNITY_DATA_FILE'])assert.equal(serialized.includes(secret),false);
 assert.equal(await provider.getTransactionCount(wallet.address),1);
});

test('reconnecting the same target retains its current data and existing community configuration',async()=>{
 const first=await prepareZeroStartConnection(options());
 await (await target.connect(signers[1]).register(ZeroAddress)).wait();
 const second=await prepareZeroStartConnection(options({original:first.env}));
 assert.equal(second.env,first.env);assert.equal(parseEnv(second.env).COMMUNITY_DATA_FILE,parseEnv(original).COMMUNITY_DATA_FILE);
 const reenabled=first.env+'GLOBAL_MIGRATION_ENABLED=true\n',disabledAgain=await prepareZeroStartConnection(options({original:reenabled}));
 assert.ok(disabledAgain.env.startsWith(reenabled));assert.equal(parseEnv(disabledAgain.env).GLOBAL_MIGRATION_ENABLED,'false');
 assert.equal((await target.users(addresses[1])).registered,true);
 assert.equal((await checkZeroStartConnection(stagedArgs(second,{original:first.env}))).target,target.target);
 assert.equal(await provider.getTransactionCount(wallet.address),1);
});
