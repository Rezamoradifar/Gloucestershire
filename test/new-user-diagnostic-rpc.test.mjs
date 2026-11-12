import assert from 'node:assert/strict';
import {test} from 'node:test';
import {keccak256} from 'ethers';
import {selectDiagnosticRpcUrls,verifyDiagnosticCandidate,withVerifiedDiagnosticRpc,
 classifyDiagnosticRpcFailure} from '../scripts/new-user-diagnostic-rpc.mjs';

const vault='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
const runtime='0x6001600055';
const runtimeHash=keccak256(runtime);
const block=n=>({number:n,hash:'0x'+n.toString(16).padStart(64,'0'),timestamp:1700000000+n});
function candidate({chain=97,archive=true,head=120,code=runtime,readsFail=false}={}){
 const state={destroyed:false,reads:0};
 return {
  state,
  async send(method){assert.equal(method,'eth_chainId');return '0x'+chain.toString(16);},
  async getBlockNumber(){return head;},
  async getBlock(number){state.reads++;if(number===10&&!archive)throw Error('missing trie node for historical state');return block(number);},
  async getCode(address,number){assert.equal(address.toLowerCase(),vault.toLowerCase());if(number===10&&!archive)throw Error('missing trie node at private rpc secret');return code;},
  destroy(){state.destroyed=true;}
 };
}
const config={chainId:97,rpcUrls:['https://private.example/key1','https://private.example/key2'],
 confirmations:3};
const options={expectedVault:vault,runtimeHash,deploymentBlock:10};

test('candidate list deduplicates and never silently uses an unknown public RPC',()=>{
 assert.deepEqual(selectDiagnosticRpcUrls({...config,rpcUrls:[config.rpcUrls[0],config.rpcUrls[0]]}),[config.rpcUrls[0]]);
 assert.throws(()=>selectDiagnosticRpcUrls({...config,chainId:56}),/RPC_CONFIG_REQUIRED/);
 assert.throws(()=>selectDiagnosticRpcUrls({...config,rpcUrls:[] ,rpcUrl:''}),/RPC_CONFIG_REQUIRED/);
});

test('full diagnostic retries historical failures on the second configured RPC and redacts URLs',async()=>{
 const first=candidate({archive:false}),second=candidate(),events=[];
 let readCount=0;
 const outcome=await withVerifiedDiagnosticRpc({config,...options,
  providerFactory:url=>url===config.rpcUrls[0]?first:second,
  onAttempt:event=>events.push(event),
  read:async(provider,head)=>{readCount++;assert.equal(provider,second);assert.equal(head.number,117);return {users:[{count:1}]};}
 });
 assert.equal(outcome.usedCandidate,2);
 assert.equal(readCount,1);
 assert.deepEqual(outcome.output,{users:[{count:1}]});
 assert.equal(outcome.statuses[0].reason,'HISTORICAL_STATE_UNAVAILABLE');
 assert.equal(outcome.statuses[1].status,'verified');
 assert.equal(first.state.destroyed,true);assert.equal(second.state.destroyed,true);
 assert.doesNotMatch(JSON.stringify(events),/private\.example|key1|key2|secret/);
});

test('a report failure retries the entire read instead of combining snapshots',async()=>{
 const first=candidate(),second=candidate();
 const touched=[];
 const result=await withVerifiedDiagnosticRpc({config,...options,
  providerFactory:url=>url===config.rpcUrls[0]?first:second,
  read:async(provider,head)=>{
   touched.push(provider);
   if(provider===first)throw Error('missing trie node at historical eth_call');
   return {fixedHead:head.number};
  }
 });
 assert.deepEqual(touched,[first,second]);
 assert.equal(result.usedCandidate,2);
 assert.equal(result.output.fixedHead,117);
});

test('wrong-chain or runtime mismatch aborts instead of quietly trusting a different history',async()=>{
 const wrong=candidate({chain:56}),second=candidate();
 await assert.rejects(withVerifiedDiagnosticRpc({config,...options,
  providerFactory:url=>url===config.rpcUrls[0]?wrong:second,read:()=>({})}),
 /NEW_USER_DIAGNOSTIC_RPC_WRONG_CHAIN/);
 assert.equal(second.state.reads,0);
 const corrupt=candidate({code:'0x6002600055'});
 await assert.rejects(verifyDiagnosticCandidate(corrupt,options),/NEW_USER_DIAGNOSTIC_RPC_RUNTIME_MISMATCH/);
});

test('all unavailable RPCs report safe structured reasons without leaking upstream credentials',async()=>{
 const entries=[];
 await assert.rejects(withVerifiedDiagnosticRpc({config,...options,
  providerFactory:()=>candidate({archive:false}),
  onAttempt:value=>entries.push(value),
  read:async()=>{throw Error('should not be called');}
 }),e=>{
  assert.equal(e.message,'NEW_USER_DIAGNOSTIC_NO_VERIFIED_ARCHIVE_RPC');
  assert.equal(e.statuses.length,2);
  assert.ok(e.statuses.every(x=>x.reason==='HISTORICAL_STATE_UNAVAILABLE'));
  assert.doesNotMatch(JSON.stringify(e.statuses),/private|secret|key1|key2/);
  return true;
 });
 assert.equal(classifyDiagnosticRpcFailure({code:'TIMEOUT',message:'private key'}),'TIMEOUT');
 assert.equal(classifyDiagnosticRpcFailure({code:'NETWORK_ERROR',message:'private key'}),'TRANSPORT_UNAVAILABLE');
});
