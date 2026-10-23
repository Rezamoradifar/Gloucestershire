import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,getAddress,parseEther} from 'ethers';
import {zeroStartRelease} from '../scripts/deploy-zero-start.mjs';
import {getZeroStartProfile,parseZeroStartProfileArgs} from '../scripts/zero-start-profile.mjs';
import {prepareZeroStartConnection,checkZeroStartConnection,publishZeroStartConnection} from '../scripts/connect-zero-start.mjs';

const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
const fastProfile=getZeroStartProfile(true);
const proxy=(target,overrides)=>new Proxy(target,{get(object,name){if(Object.hasOwn(overrides,name))return overrides[name];const value=Reflect.get(object,name);return typeof value==='function'?value.bind(object):value;}});
let rpc,provider,operator,signers,addresses,token,release,oldRelease,deploymentReport,oldDeploymentReport,target,snapshot,original;
before(async()=>{
 rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12,unlockedAccounts:[fastProfile.release.deployer,fastProfile.release.owner]},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 await rpc.request({method:'evm_setAccountBalance',params:[fastProfile.release.deployer,'0x'+parseEther('100').toString(16)]});
 operator=await provider.getSigner(fastProfile.release.deployer);
 signers=await Promise.all(Array.from({length:12},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const deploy=async(name,args,signer=signers[0])=>{const a=artifact(name),c=await new ContractFactory(a.abi,a.bytecode||'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 token=await deploy('MockToken',[18]);const feed=await deploy('MockFeed',[100000000n]);
 const settings={token:token.target,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
 release={...fastProfile.release,...settings};
 const args=c=>[c.owner,c.token,c.bnbFeed,c.tokenFeed,c.age,c.partners,c.operations];
 target=await deploy('FastTestnetVault',args(release),operator);
 deploymentReport={hash:target.deploymentTransaction().hash};
 oldRelease={...zeroStartRelease,...settings};
 const oldTarget=await deploy('AutomaticGroupVault',args(oldRelease),operator);
 oldDeploymentReport={hash:oldTarget.deploymentTransaction().hash};
 for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
 original=[
  'TRADES_RPC_URL="https://rpc.example.invalid/private?key=rpc-secret"','TRADES_CHAIN_ID=97',
  'TRADES_VAULT_ADDRESS='+oldTarget.target,'TRADES_START_BLOCK=1','TRADES_CONFIRMATIONS=1',
  'TRADES_LOG_PAGE_SIZE=20','TRADES_PORT=3200','GLOBAL_MIGRATION_ENABLED=true',
  'API_KEY="api-secret"','MULTILINE_PRIVATE="first line\nTRADES_ZERO_START_PROFILE=embedded-secret\nlast line"',
  'COMMUNITY_DATA_FILE="/var/lib/globaldroptrade-api/existing-community.json"',''
 ].join('\n');
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
});
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});});
after(async()=>{await provider?.destroy();await rpc?.disconnect();});
const options=(extra={})=>({provider,artifact:artifact('FastTestnetVault'),deploymentReport,original,release,confirmations:1,...extra});
const stagedArgs=(prepared,extra={})=>options({stagedEnv:prepared.env,stage:prepared.report,...extra});
const evidence=()=>({active:{version:1,chainId:97,vaultAddress:target.target},frontend:{version:1,chainId:97,vaultAddress:target.target,indexSha256:'ab'.repeat(32),servedIndexSha256:'ab'.repeat(32),expectedIndexSha256:'ab'.repeat(32),verified:true}});

test('selects a separate fast namespace only with one explicit flag',()=>{
 const saved=process.env.TRADES_ZERO_START_PROFILE;process.env.TRADES_ZERO_START_PROFILE='global-fresh-fast-test-v1';
 try{
  assert.equal(parseZeroStartProfileArgs(['prepare','/tmp/stage']).profile.fast,false);
  const selected=parseZeroStartProfileArgs(['prepare','/tmp/stage','--fast-testnet']);
  assert.deepEqual(selected.args,['prepare','/tmp/stage']);assert.equal(selected.profile.fast,true);
  assert.equal(selected.profile.deploymentDir,'/var/lib/globaldroptrade/fresh-fast-testnet-v1');
  assert.equal(selected.profile.connectionLockDir,'/var/lib/globaldroptrade/fresh-fast-testnet-connection');
  assert.equal(selected.profile.artifactName,'FastTestnetVault');
  assert.throws(()=>parseZeroStartProfileArgs(['--fast-testnet','--fast-testnet']),/ZERO_START_DUPLICATE_PROFILE_FLAG/);
 }finally{if(saved===undefined)delete process.env.TRADES_ZERO_START_PROFILE;else process.env.TRADES_ZERO_START_PROFILE=saved;}
});

test('connects only the canonical fast target, preserves secrets, and sends no transactions',async()=>{
 const nonce=await provider.getTransactionCount(release.deployer),allowed=new Set([target.target,getAddress(await target.withdrawalQueue())]);let broadcasts=0;
 const readOnly=proxy(provider,{
  getCode:async(address,block)=>{assert.ok(allowed.has(getAddress(address)));return provider.getCode(address,block);},
  call:async tx=>{assert.ok(allowed.has(getAddress(tx.to)));return provider.call(tx);},
  broadcastTransaction:async()=>{broadcasts++;throw Error('Connection must remain read only');}
 });
 const forged={...deploymentReport,releaseId:zeroStartRelease.releaseId,contractAddress:addresses[8],owner:addresses[8],initialServerReporter:false,accountsMigrated:true};
 const prepared=await prepareZeroStartConnection(options({provider:readOnly,deploymentReport:forged}));
 assert.equal(prepared.report.target,target.target);assert.equal(prepared.report.releaseId,release.releaseId);
 for(const proof of [prepared.report,prepared.report.identity]){
  assert.equal(proof.testMode,true);assert.equal(proof.initialServerReporter,true);assert.equal(proof.fastTestnetVersion,1);
 }
 assert.equal(prepared.report.emptyAtInitialization,true);assert.equal(prepared.report.accountsMigrated,false);assert.equal(prepared.report.historicalStateVerified,false);
 assert.equal(prepared.report.initialStateProof.importsUserData,false);assert.equal(prepared.report.transactionsSent,0);
 const settings=parseEnv(prepared.env),before=parseEnv(original);
 assert.ok(prepared.env.startsWith(original));assert.equal(settings.TRADES_ZERO_START_PROFILE,release.releaseId);
 assert.equal(settings.TRADES_VAULT_ADDRESS,target.target);assert.equal(settings.GLOBAL_MIGRATION_ENABLED,'false');
 for(const key of ['TRADES_RPC_URL','API_KEY','MULTILINE_PRIVATE','COMMUNITY_DATA_FILE'])assert.equal(settings[key],before[key]);
 assert.equal((await checkZeroStartConnection(stagedArgs(prepared,{provider:readOnly}))).target,target.target);
 const published=await publishZeroStartConnection(stagedArgs(prepared,{provider:readOnly,current:prepared.env,...evidence()}));
 assert.equal(published.siteConnected,true);assert.equal(published.testMode,true);assert.equal(published.initialServerReporter,true);assert.equal(published.fastTestnetVersion,1);
 assert.equal(published.dailyAutomationActive,false);assert.equal(published.accountsMigrated,false);
 for(const secret of ['rpc-secret','api-secret','embedded-secret','originalEnvHash','stagedEnvHash','COMMUNITY_DATA_FILE'])assert.equal(JSON.stringify(published).includes(secret),false);
 assert.equal(await provider.getTransactionCount(release.deployer),nonce);assert.equal(broadcasts,0);
});

test('rejects the old artifact, old creation transaction and cross-profile staged reports',async()=>{
 const prepared=await prepareZeroStartConnection(options());
 await assert.rejects(prepareZeroStartConnection(options({artifact:artifact('AutomaticGroupVault')})),/ZERO_START_ARTIFACT_MISMATCH/);
 await assert.rejects(prepareZeroStartConnection(options({deploymentReport:oldDeploymentReport})),/ZERO_START_TRANSACTION_MISMATCH/);
 await assert.rejects(prepareZeroStartConnection(options({artifact:artifact('AutomaticGroupVault'),release:oldRelease})),/ZERO_START_TRANSACTION_MISMATCH/);
 await assert.rejects(checkZeroStartConnection(stagedArgs(prepared,{artifact:artifact('AutomaticGroupVault'),release:oldRelease,deploymentReport:oldDeploymentReport})),/ZERO_START_STAGED_IDENTITY_CHANGED/);
 for(const key of ['releaseId','testMode','initialServerReporter','fastTestnetVersion']){
  const stage={...prepared.report,[key]:key==='releaseId'?oldRelease.releaseId:false};
  await assert.rejects(checkZeroStartConnection(stagedArgs(prepared,{stage})),/ZERO_START_STAGED_IDENTITY_CHANGED/);
 }
});

test('rechecks the fast marker and current operator role before cutover',async()=>{
 const prepared=await prepareZeroStartConnection(options());
 for(const method of ['FAST_TESTNET_VERSION','reporters']){
  const selector=target.interface.getFunction(method).selector;
  const wrongCapability=proxy(provider,{call:async tx=>tx.data.startsWith(selector)?'0x'+'00'.repeat(32):provider.call(tx)});
  await assert.rejects(checkZeroStartConnection(stagedArgs(prepared,{provider:wrongCapability})),/ZERO_START_CURRENT_FAST_TESTNET_CAPABILITY_MISMATCH/);
 }
 const changed=prepared.env+'TRADES_ZERO_START_PROFILE='+zeroStartRelease.releaseId+'\n';
 const stage={...prepared.report,stagedEnvHash:createHash('sha256').update(changed).digest('hex')};
 await assert.rejects(publishZeroStartConnection(stagedArgs(prepared,{current:changed,stagedEnv:changed,stage,...evidence()})),/ZERO_START_INSTALLED_PROFILE_MISMATCH/);
});

test('an explicit return to the default profile replaces the fast marker and keeps prior user data',async()=>{
 const first=await prepareZeroStartConnection(options());
 await (await target.connect(signers[1]).register(ZeroAddress)).wait();
 const again=await prepareZeroStartConnection(options({original:first.env}));
 assert.equal(again.env,first.env);assert.equal((await target.users(addresses[1])).registered,true);
 const restored=await prepareZeroStartConnection(options({original:again.env,artifact:artifact('AutomaticGroupVault'),release:oldRelease,deploymentReport:oldDeploymentReport}));
 assert.equal(parseEnv(restored.env).TRADES_ZERO_START_PROFILE,zeroStartRelease.releaseId);
 assert.equal(restored.report.releaseId,zeroStartRelease.releaseId);assert.equal(Object.hasOwn(restored.report,'initialServerReporter'),false);
 assert.equal(parseEnv(restored.env).COMMUNITY_DATA_FILE,parseEnv(original).COMMUNITY_DATA_FILE);
 assert.equal((await target.users(addresses[1])).registered,true);
});
