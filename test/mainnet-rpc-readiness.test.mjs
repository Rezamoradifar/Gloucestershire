import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Interface} from 'ethers';
import {spawnSync} from 'node:child_process';
import {inspectMainnetHistory,mainnetReadinessFailure} from '../scripts/mainnet-rpc-readiness.mjs';
const config=JSON.parse(fs.readFileSync('config.mainnet.json'));
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const checkpoint={number:199997,hash:hash(199997),timestamp:199997};
const abi=new Interface(['function decimals() view returns(uint8)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']);
function fixture(overrides={}){
 const reads=[];let afterLogs=false;
 const p={getNetwork:async()=>({chainId:overrides.chain??56n}),
 getBlock:async number=>({number,hash:hash(overrides.reorg&&afterLogs?number+1:number),timestamp:number}),
 getCode:async(address,block)=>{reads.push({method:'code',block});if(overrides.missingHistory)throw Object.assign(Error('private RPC details'),{code:'CALL_EXCEPTION'});return '0x1234';},
 call:async r=>{const f=abi.parseTransaction(r);reads.push({method:f.name,block:r.blockTag});return abi.encodeFunctionResult(f.name,f.name==='decimals'?[18n]:[1n,100000000n,1n,overrides.substituteLatest?199997n:BigInt(r.blockTag-1),1n]);},
 getLogs:async filter=>{reads.push({method:'logs',filter});if(overrides.logsFail)throw Object.assign(Error('private RPC details'),{code:'SERVER_ERROR'});afterLogs=true;return [];}};
 for(const name of ['getSigner','broadcastTransaction','sendTransaction'])p[name]=()=>{throw Error('WRITE_FORBIDDEN');};
 return {provider:p,reads};
}
test('chain 56 history proof queries past state and a bounded canonical log window without signing',async()=>{
 const f=fixture(),r=await inspectMainnetHistory({...f,config,checkpoint});
 assert.equal(r.requiredRetentionSeconds,86400);assert.equal(r.historical.block,checkpoint.number-86400);assert.equal(r.futureVaultHistoryVerified,false);assert.equal(r.fullArchiveRetentionGuaranteed,false);
 assert.ok(f.reads.filter(x=>x.method==='latestRoundData').every(x=>x.block===r.historical.block));
 assert.equal(f.reads.find(x=>x.method==='logs').filter.toBlock-r.historical.block,9);
 assert.doesNotMatch(JSON.stringify(r),/private RPC/);
});
test('testnet endpoints, absent historical state and latest-state substitution block readiness',async()=>{
 await assert.rejects(inspectMainnetHistory({...fixture({chain:97n}),config,checkpoint}),/MAINNET_CHAIN_56_REQUIRED/);
 await assert.rejects(inspectMainnetHistory({...fixture({missingHistory:true}),config,checkpoint}));
 await assert.rejects(inspectMainnetHistory({...fixture({substituteLatest:true}),config,checkpoint}),/LATEST_SUBSTITUTED/);
});
test('log failures and changed canonical checkpoints cannot pass',async()=>{
 await assert.rejects(inspectMainnetHistory({...fixture({logsFail:true}),config,checkpoint}));
 await assert.rejects(inspectMainnetHistory({...fixture({reorg:true}),config,checkpoint}),/CANONICAL|CHECKPOINT/);
});
test('CLI rejects deployment actions and never prints secret provider input',()=>{
 const r=spawnSync(process.execPath,['scripts/mainnet-rpc-readiness.mjs','deploy'],{encoding:'utf8',timeout:15000});
 assert.equal(r.status,1);const report=JSON.parse(r.stdout.trim().split('\n').at(-1));assert.equal(report.transactionsSent,0);assert.equal(report.keysRead,false);assert.equal(report.readyToDeploy,false);assert.equal(r.stderr,'');
});

test('historical unsupported errors are actionable without exposing private provider details',()=>{
 const r=mainnetReadinessFailure({code:'UNKNOWN_ERROR',message:'https://private.invalid/secret',info:{error:{code:-32000,message:'not supported https://private.invalid/secret'}}},'HISTORICAL_RPC_PROBE');
 assert.equal(r.blocker,'MAINNET_HISTORICAL_RPC_UNSUPPORTED');assert.equal(r.rpcCode,-32000);assert.equal(r.errorCode,'UNKNOWN_ERROR');assert.equal(r.transactionsSent,0);assert.doesNotMatch(JSON.stringify(r),/https|secret/);
});
