import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {AbiCoder,Interface,ZeroAddress,keccak256} from 'ethers';
import {mainnetPreparationPolicy,planMainnet,prepareMainnet,parseMainnetPreparationArgs,readMainnetPreparationRpc} from '../scripts/server-mainnet.mjs';

const config=()=>JSON.parse(fs.readFileSync('config.mainnet.json'));
const artifact=()=>JSON.parse(fs.readFileSync('artifacts/AutomaticGroupVault.json'));
const script=fileURLToPath(new URL('../scripts/server-mainnet.mjs',import.meta.url));
const clone=value=>structuredClone(value),checkpointHash='0x'+'12'.repeat(32);
const metadata=new Interface(['function description() view returns(string)','function decimals() view returns(uint8)','function symbol() view returns(string)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']);
function fixture(options={}){
 const c=config(),trace=[];let headers=0,networks=0;
 const provider={
  getNetwork:async()=>{trace.push({method:'getNetwork'});return {chainId:options.chainId??56n};},
  getBlockNumber:async()=>103,
  getBlock:async number=>{headers++;trace.push({method:'getBlock',number});return options.header?.(headers,number)??{number,hash:checkpointHash,timestamp:4000};},
  getCode:async(address,blockTag)=>{trace.push({method:'getCode',address,blockTag});return options.code??'0x1234';},
  getFeeData:async()=>({gasPrice:options.gasPrice??1000000000n}),
  estimateGas:async request=>{trace.push({method:'estimateGas',request});return options.gas??4000000n;},
  call:async request=>{
   const name=metadata.parseTransaction({data:request.data}).name,token=request.to.toLowerCase()===c.usdt.toLowerCase();
   trace.push({method:'call',name,blockTag:request.blockTag,to:request.to});let result;
   if(name==='description')result=[options.description??(request.to.toLowerCase()===c.bnbUsdFeed.toLowerCase()?'BNB / USD':'USDT / USD')];
   if(name==='decimals')result=[token?(options.tokenDecimals??18n):(options.feedDecimals??8n)];
   if(name==='symbol')result=[options.symbol??'USDT'];
   if(name==='latestRoundData')result=options.round??[1n,100000000n,3990n,3990n,1n];
   return metadata.encodeFunctionResult(name,result);
  }
 };
 for(const method of ['getSigner','broadcastTransaction','sendTransaction','getTransactionCount'])provider[method]=async()=>{throw Error('MAINNET_WRITE_FORBIDDEN');};
 return {provider,trace};
}

test('offline mainnet plan uses the approved owner and current ordinary fresh constructor without selecting a signer',async()=>{
 const c=config(),a=artifact(),result=await planMainnet(c,a);
 assert.equal(result.report.readyToDeploy,false);assert.equal(result.report.status,'offline-plan');assert.equal(result.report.simulationFrom,null);
 assert.deepEqual([result.report.signerOpened,result.report.keysRead,result.report.transactionsSigned,result.report.transactionsSent],[false,false,0,0]);
 assert.equal(result.report.chainId,56);assert.equal(result.report.artifact,'AutomaticGroupVault');assert.equal(result.report.artifactHash,mainnetPreparationPolicy.artifactHash);
 assert.equal(result.report.economics.periodSeconds,86400);assert.equal(result.report.economics.withdrawalApprovalRequired,true);assert.equal(result.report.trustModel.ownerMayWithdrawAllLiquidAssets,true);
 assert.ok(result.report.blockers.includes('MAINNET_RPC_PREFLIGHT_REQUIRED'));assert.ok(result.report.blockers.includes('MAINNET_RECIPIENT_CONFIRMATION_REQUIRED'));
 const encoded='0x'+result.request.data.slice(2+a.evm.bytecode.object.length),decoded=AbiCoder.defaultAbiCoder().decode(['address','address','address','address','uint256','address[]','address'],encoded);
 assert.equal(decoded[0],mainnetPreparationPolicy.owner);assert.equal(decoded[1],c.usdt);assert.equal(decoded[2],c.bnbUsdFeed);assert.equal(decoded[3],c.usdtUsdFeed);assert.equal(decoded[4],3600n);assert.deepEqual([...decoded[5]],c.partners);assert.equal(decoded[6],c.dropshippingWallet);
 assert.equal(result.report.unsignedDeployment.initcodeHash,keccak256(result.request.data));assert.equal(result.report.unsignedDeployment.value,'0');assert.equal(result.request.to,undefined);
 assert.doesNotMatch(JSON.stringify(result.report),/privateKey|rawSigned|testMode|FAST_TESTNET/);
});

test('read-only RPC preparation binds live production assets and metadata to one canonical checkpoint and gas estimate',async()=>{
 const {provider,trace}=fixture(),result=await prepareMainnet(provider,config(),artifact(),mainnetPreparationPolicy.owner);
 assert.equal(result.report.status,'rpc-preflight-passed');assert.equal(result.report.readyToDeploy,false);assert.equal(result.report.independentCanonicalProof,false);
 assert.deepEqual(result.report.checkpoint,{block:100,blockHash:checkpointHash,timestamp:4000,observedHead:103,confirmations:3});
 assert.equal(result.cost,4800000000000000n);assert.equal(result.report.unsignedDeployment.from,mainnetPreparationPolicy.owner);assert.equal(result.report.unsignedDeployment.maximumGasCostWei,'4800000000000000');
 assert.equal(result.report.contracts.length,3);assert.equal(result.report.feeds.length,2);assert.ok(result.report.feeds.every(feed=>feed.ageSeconds==='10'&&feed.maxOracleAge===3600));
 assert.ok(trace.filter(entry=>['getCode','call'].includes(entry.method)).every(entry=>entry.blockTag===100));
 const request=trace.find(entry=>entry.method==='estimateGas').request;assert.equal(request.from,mainnetPreparationPolicy.owner);assert.equal(request.value,0);assert.equal(request.to,undefined);
 assert.equal(result.report.transactionsSent,0);assert.equal(result.report.signerOpened,false);assert.ok(result.report.blockers.includes('MAINNET_CONNECTION_AND_WORKER_ACTIVATION_REQUIRED'));
});

test('stale owners, test profiles, mock assets and other artifacts are rejected before an RPC call',async()=>{
 const changes=[{initialOwner:'0xeBfbE2348a0edD7D643ffA441cF6F7B1F2425Be5'},{chainId:97},{dailyPeriodSeconds:3600},{maxOracleAge:86400},{testMode:false},{initialServerReporter:false},{artifact:'FastTestnetVault'},{usdt:'0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89'},{partners:[...config().partners.slice(0,6),config().partners[0]]},{dropshippingWallet:ZeroAddress}];
 for(const change of changes){let called=false;const provider={getNetwork:async()=>{called=true;throw Error('RPC_MUST_NOT_START');}};await assert.rejects(prepareMainnet(provider,{...config(),...change},artifact(),mainnetPreparationPolicy.owner));assert.equal(called,false);}
 for(const name of ['DropshippingVault','FastTestnetVault']){let called=false;const provider={getNetwork:async()=>{called=true;}};await assert.rejects(prepareMainnet(provider,config(),JSON.parse(fs.readFileSync('artifacts/'+name+'.json')),mainnetPreparationPolicy.owner),/ORDINARY_FRESH_ARTIFACT/);assert.equal(called,false);}
 await assert.rejects(prepareMainnet(fixture().provider,config(),artifact()),/SIMULATION_FROM/);
});

test('network, asset metadata, oracle validity and gas bounds remain blocking',async()=>{
 const cases=[
  [{chainId:97n},/CHAIN_56/],[{code:'0x'},/PRODUCTION_CODE/],[{tokenDecimals:6n},/TOKEN_METADATA/],[{symbol:'TESTUSDT18'},/TOKEN_METADATA/],
  [{feedDecimals:18n},/ORACLE/],[{description:'Mock Feed'},/ORACLE/],[{round:[0n,100n,3990n,3990n,1n]},/ORACLE/],
  [{round:[2n,-1n,3990n,3990n,2n]},/ORACLE/],[{round:[2n,100n,1n,1n,2n]},/ORACLE/],[{round:[2n,100n,4001n,4001n,2n]},/ORACLE/],
  [{round:[2n,100n,3990n,3990n,1n]},/ORACLE/],[{gas:0n},/GAS_ESTIMATE/],[{gasPrice:0n},/GAS_ESTIMATE/],[{gasPrice:100000000000n},/GAS_SAFETY_LIMIT/]
 ];
 for(const [options,expected]of cases)await assert.rejects(prepareMainnet(fixture(options).provider,config(),artifact(),mainnetPreparationPolicy.owner),expected);
 const {provider}=fixture();let calls=0;provider.getNetwork=async()=>({chainId:++calls===1?56n:97n});
 await assert.rejects(prepareMainnet(provider,config(),artifact(),mainnetPreparationPolicy.owner),/CHECKPOINT_CHANGED/);
 await assert.rejects(prepareMainnet(fixture({header:(count,number)=>({number,hash:count===1?checkpointHash:'0x'+'34'.repeat(32),timestamp:4000})}).provider,config(),artifact(),mainnetPreparationPolicy.owner),/CHECKPOINT_CHANGED/);
});

test('private mainnet RPC input is explicit, private, stable HTTPS and never exposes its URL through metadata',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'global-mainnet-rpc-')),file=path.join(directory,'rpc-url'),url='https://archive.invalid/secret-mainnet-key?token=private-token';
 try{
  fs.writeFileSync(file,url+'\n',{mode:0o600});const selected=readMainnetPreparationRpc(file);assert.equal(selected.url,url);assert.equal(selected.proof.kind,'private');assert.match(selected.proof.urlSha256,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(selected.proof),/secret|private-token|https/);selected.assertCurrent();
  fs.writeFileSync(file,url+'2\n');assert.throws(selected.assertCurrent,/FILE_CHANGED/);
  for(const content of ['http://archive.invalid/key\n','https://user:password@archive.invalid/key\n',url+'\n'+url+'\n',url+'#fragment\n',Buffer.from([255])]){
   fs.writeFileSync(file,content);assert.throws(()=>readMainnetPreparationRpc(file),error=>{assert.equal(error.message,'MAINNET_PRIVATE_RPC_FILE_REQUIRED');assert.doesNotMatch(error.message,/secret|password|https/);return true;});
  }
  fs.writeFileSync(file,url);fs.chmodSync(file,0o644);assert.throws(()=>readMainnetPreparationRpc(file),/PRIVATE_RPC_FILE/);fs.chmodSync(file,0o600);
  const link=path.join(directory,'link');fs.symlinkSync(file,link);assert.throws(()=>readMainnetPreparationRpc(link),/PRIVATE_RPC_FILE/);
  assert.throws(()=>readMainnetPreparationRpc('relative-file'),/PRIVATE_RPC_FILE/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('CLI parsing rejects deployment and ambiguous input before creating files or contacting an RPC',()=>{
 assert.deepEqual(parseMainnetPreparationArgs([]),{action:'plan',from:undefined,rpcFile:undefined});
 assert.throws(()=>parseMainnetPreparationArgs(['deploy']),/DEPLOYMENT_DISABLED/);
 for(const args of [['prepare'],['prepare','--from',ZeroAddress],['plan','--rpc-file','/tmp/mainnet-rpc'],['prepare','--from',mainnetPreparationPolicy.owner,'--from',mainnetPreparationPolicy.owner],['prepare','--from',mainnetPreparationPolicy.owner,'--rpc-file','https://private.invalid/secret'],['unknown']])assert.throws(()=>parseMainnetPreparationArgs(args));
});

test('offline CLI and rejected deployment preserve existing signer journals and never treat preparation as activation',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'global-mainnet-cli-')),legacy=path.join(directory,'.mainnet-server'),secret='PRIVATE_KEY_SENTINEL_DO_NOT_READ',journal='SIGNED_JOURNAL_SENTINEL_DO_NOT_READ';
 try{
  fs.mkdirSync(legacy,{mode:0o700});fs.writeFileSync(path.join(legacy,'deployer.key'),secret,{mode:0o600});fs.writeFileSync(path.join(legacy,'deployment-signed.json'),journal,{mode:0o600});
  const env={...process.env,BSC_MAINNET_RPC:'https://private.invalid/ambient-secret'};
  const stopped=spawnSync(process.execPath,[script,'deploy'],{cwd:directory,env,encoding:'utf8',timeout:5000});
  assert.equal(stopped.status,1);assert.match(stopped.stdout,/DEPLOYMENT_DISABLED_PREPARATION_ONLY/);assert.equal(fs.existsSync(path.join(directory,'.mainnet-preparation')),false);assert.doesNotMatch(stopped.stdout+stopped.stderr,/SENTINEL|ambient-secret|https/);
  const planned=spawnSync(process.execPath,[script,'plan','--from',mainnetPreparationPolicy.owner],{cwd:directory,env,encoding:'utf8',timeout:5000});
  assert.equal(planned.status,0,planned.stderr);assert.match(planned.stdout,/MAINNET_UNSIGNED_FRESH_PLAN_PREPARED/);assert.doesNotMatch(planned.stdout+planned.stderr,/SENTINEL|ambient-secret|https/);
  const report=JSON.parse(fs.readFileSync(path.join(directory,'.mainnet-preparation','unsigned-plan-public.json')));assert.equal(report.readyToDeploy,false);assert.equal(report.signerOpened,false);assert.equal(report.keysRead,false);assert.equal(report.transactionsSent,0);assert.equal(report.status,'offline-plan');
  assert.equal(fs.statSync(path.join(directory,'.mainnet-preparation')).mode&0o777,0o700);assert.equal(fs.statSync(path.join(directory,'.mainnet-preparation','unsigned-plan-public.json')).mode&0o777,0o600);
  assert.equal(fs.readFileSync(path.join(legacy,'deployer.key'),'utf8'),secret);assert.equal(fs.readFileSync(path.join(legacy,'deployment-signed.json'),'utf8'),journal);
  const invalid=path.join(directory,'rpc-url');fs.writeFileSync(invalid,'http://private.invalid/mainnet-secret\n',{mode:0o600});
  const rejected=spawnSync(process.execPath,[script,'prepare','--from',mainnetPreparationPolicy.owner,'--rpc-file',invalid],{cwd:directory,env,encoding:'utf8',timeout:5000});
  assert.equal(rejected.status,1);assert.match(rejected.stdout,/MAINNET_PRIVATE_RPC_FILE_REQUIRED/);assert.doesNotMatch(rejected.stdout+rejected.stderr,/mainnet-secret|ambient-secret|SENTINEL|https?/);
  const failed=JSON.parse(fs.readFileSync(path.join(directory,'.mainnet-preparation','preflight-public.json')));assert.equal(failed.status,'blocked');assert.equal(failed.readyToDeploy,false);assert.equal(failed.transactionsSent,0);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
