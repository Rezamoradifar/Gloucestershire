import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {test} from 'node:test';
import {keccak256} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {makeRpcFallbackEnv,verifyRpcFallback,selectRpcFallbacks} from '../scripts/configure-testnet-rpc-fallbacks.mjs';

const vault='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
const runtime='0x6001600055',runtimeHash=keccak256(runtime);
const checkpointHash='0x'+'ab'.repeat(32);
const options={runtimeHash,deploymentBlock:100,checkpointBlock:140,checkpointHash};
const config={chainId:97,address:vault,rpcUrl:'https://private.example/keep-secret',
 rpcUrls:['https://private.example/keep-secret'],confirmations:3};
const candidate1='https://data-seed-prebsc-1-s1.bnbchain.org:8545';
const candidate2='https://data-seed-prebsc-2-s1.bnbchain.org:8545';
const candidate3='https://bsc-testnet-rpc.publicnode.com';
function probeFor(url,status={}){
 return async (source,method,params)=>{
  if(source!==url)throw Error('wrong rpc URL');
  if(status.transport)throw Error('Private URL https://secret.example/key');
  if(method==='eth_chainId')return status.chain??'0x61';
  if(method==='eth_blockNumber')return '0xc8';
  if(method==='eth_getBlockByNumber')return {number:'0x8c',hash:status.hash??checkpointHash};
  if(method==='eth_getCode')return status.codeMissing?'0x':
    status.archive===false&&params[1]!=='latest'?'0x':runtime;
  if(method==='eth_getLogs')return [];
  if(method==='eth_call')return status.archive===false?'0x':'0x'+('0'.repeat(64));
  throw Error('unexpected read '+method);
 };
}

test('configures up to three fallbacks and preserves private primary and all unrelated settings',()=>{
 const original='TRADES_CHAIN_ID=97\nTRADES_VAULT_ADDRESS='+vault+
  '\nTRADES_RPC_URL=https://private.example/keep-secret\nTRADES_RPC_URLS=\'["https://old.example"]\'\nTRADES_PORT=3115\n';
 const changed=makeRpcFallbackEnv(original,[candidate1,candidate2,candidate3]);
 const c=readConfig(parseEnv(changed));
 assert.equal(c.rpcUrl,'https://private.example/keep-secret');
 assert.equal(c.address,vault);assert.equal(c.chainId,97);
 assert.deepEqual(c.rpcUrls,[c.rpcUrl,candidate1,candidate2,candidate3]);
 assert.equal((changed.match(/^TRADES_RPC_URLS=/gm)||[]).length,1);
 assert.match(changed,/TRADES_PORT=3115/);
 assert.ok(!changed.includes('https://old.example'));
 assert.throws(()=>makeRpcFallbackEnv(original,[]),/SELECTION_INVALID/);
 assert.throws(()=>makeRpcFallbackEnv(original,Array(4).fill(candidate1)),/SELECTION_INVALID/);
});
test('a safe public testnet node is selectable even without archive history, with a truthful label',async()=>{
 const result=await verifyRpcFallback(candidate1,{...options,probe:probeFor(candidate1,{archive:false})});
 assert.deepEqual(result,{recent:true,archive:false,reason:'RECENT_READS_ONLY'});
 const archived=await verifyRpcFallback(candidate1,{...options,probe:probeFor(candidate1,{archive:true})});
 assert.deepEqual(archived,{recent:true,archive:true,reason:'FULL_HISTORY_VERIFIED'});
});
test('wrong chain, wrong runtime, canonical mismatch and transport failures cannot be accepted',async()=>{
 const cases=[
  [{chain:'0x38'},'WRONG_CHAIN'],
  [{hash:'0x'+'cd'.repeat(32)},'CHECKPOINT_MISMATCH'],
  [{codeMissing:true},'RUNTIME_MISMATCH']
 ];
 for(const [opts,reason] of cases){
  const r=await verifyRpcFallback(candidate1,{...options,probe:probeFor(candidate1,opts)});
  assert.equal(r.recent,false);assert.equal(r.reason,reason);
 }
 await assert.rejects(verifyRpcFallback(candidate1,{...options,probe:probeFor(candidate1,{transport:true})}));
});
test('selects only verified existing and official fallbacks, prefers archive, never logs addresses',async()=>{
 const events=[];
 const responses=new Map([
  [candidate1,{archive:false}],
  [candidate2,{archive:true}],
  [candidate3,{chain:'0x38'}]
 ]);
 const results=await selectRpcFallbacks({config,...options,
  probe:async(url,method,params)=>probeFor(url,responses.get(url))(url,method,params),
  report:entry=>events.push(entry)});
 assert.deepEqual(results.selected,[candidate2,candidate1]);
 assert.equal(results.archives,1);
 assert.equal(results.checked,3);
 assert.equal(events[2].status,'WRONG_CHAIN');
 assert.ok(events.every(row=>Object.keys(row).sort().join(',')==='candidate,status'));
 assert.doesNotMatch(JSON.stringify(events),/private\.example|secret|publicnode/);
});
test('configuration module cannot directly sign, reset worker state or restart a financial timer',()=>{
 const source=fs.readFileSync('scripts/configure-testnet-rpc-fallbacks.mjs','utf8');
 for(const term of ['sendTransaction(','broadcastTransaction(','new Wallet(','writePrivateJson(','journalTransaction(','systemctl stop','systemctl restart','fs.rmSync(','fs.unlinkSync(stateFile)'])
  assert.equal(source.includes(term),false,term);
 assert.match(source,/apiRestartRequired:true,workerUnchanged:true,transactionsSent:0/);
 assert.match(source,/import\.meta\.url===invoked/);
});
