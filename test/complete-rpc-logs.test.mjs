import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspect} from 'node:util';
import {createServer} from 'node:http';
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {getCompleteLogs,sanitizeCompleteLogDiagnostic,isCompleteLogTransportTimeout} from '../scripts/complete-rpc-logs.mjs';

const address='0x1111111111111111111111111111111111111111';
const topic='0x'+'ab'.repeat(32),hash=n=>'0x'+(n+1).toString(16).padStart(64,'0');
const log=(block,index=0,data='0x1234')=>({address,topics:[topic],blockNumber:block,blockHash:hash(block),transactionHash:hash(10000+block),index,data,removed:false});
const filter=(fromBlock=1,toBlock=100)=>({address,topics:[topic],fromBlock,toBlock});
const rpc=(code,message,extra={})=>Object.assign(Error(message),{code:'UNKNOWN_ERROR',info:{error:{code,message}},...extra});
const rangeError=()=>rpc(-32602,'You can make eth_getLogs requests with up to a 10 block range. private URL https://private.invalid/key');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function harness({limit=Infinity,records=[],throwFor,delayMs=0}={}){
 const calls=[],headers=[];let active=0,maxActive=0;
 const provider={getBlock:async number=>{headers.push(number);return {number,hash:hash(number)};},getLogs:async value=>{
  calls.push(structuredClone(value));active++;maxActive=Math.max(maxActive,active);
  try{
   if(delayMs)await delay(delayMs);
   if(throwFor){const error=throwFor(value,calls.length);if(error)throw error;}
   if(value.toBlock-value.fromBlock+1>limit)throw rangeError();
   return records.filter(row=>row.blockNumber>=value.fromBlock&&row.blockNumber<=value.toBlock).map(row=>structuredClone(row));
  }finally{active--;}
 }};
 return {provider,calls,headers,get active(){return active;},get maxActive(){return maxActive;}};
}

async function httpHarness(replyLogs){
 const calls=[];
 const hex=value=>'0x'+value.toString(16);
 const block=number=>({number:hex(number),hash:hash(number),parentHash:hash(number-1),timestamp:'0x1',nonce:'0x0000000000000000',difficulty:'0x0',gasLimit:'0x1c9c380',gasUsed:'0x0',miner:'0x'+'00'.repeat(20),extraData:'0x',transactions:[],baseFeePerGas:'0x0'});
 const server=createServer(async(request,response)=>{
  const chunks=[];for await(const chunk of request)chunks.push(chunk);
  const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  let status=200,body;
  if(payload.method==='eth_chainId')body={jsonrpc:'2.0',id:payload.id,result:'0x61'};
  else if(payload.method==='eth_getBlockByNumber')body={jsonrpc:'2.0',id:payload.id,result:block(Number(payload.params[0]))};
  else if(payload.method==='eth_getLogs'){
   const value={...payload.params[0],fromBlock:Number(payload.params[0].fromBlock),toBlock:Number(payload.params[0].toBlock)};calls.push(value);
   const reply=await replyLogs(value,payload.id);status=reply.status??200;body=reply.body;
   if(Object.hasOwn(reply,'records'))body={jsonrpc:'2.0',id:payload.id,result:reply.records.map(row=>({...row,blockNumber:hex(row.blockNumber),logIndex:hex(row.index),transactionIndex:'0x0',index:undefined}))};
  }else body={jsonrpc:'2.0',id:payload.id,error:{code:-32601,message:'Unsupported test method'}};
  response.writeHead(status,{'content-type':'application/json'});response.end(typeof body==='string'?body:JSON.stringify(body));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const providers=[];
 return {calls,provider({timeout}={}){const request=new FetchRequest('http://127.0.0.1:'+server.address().port+'/private-test-secret');request.retryFunc=async()=>false;if(timeout!==undefined)request.timeout=timeout;const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});providers.push(provider);return provider;},async close(){for(const provider of providers)await provider.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

for(const code of [-32602,-32600])test('actual ethers HTTP 400 JSON-RPC '+code+' range errors yield complete 500 and 1000 block windows',async()=>{
 const records=[log(1),log(10),log(11),log(500),log(1000)],h=await httpHarness((value,id)=>value.toBlock-value.fromBlock+1>10?{status:400,body:{jsonrpc:'2.0',id,error:{code,message:'Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range. https://private.invalid/http-body-secret'}}}:{records:records.filter(row=>row.blockNumber>=value.fromBlock&&row.blockNumber<=value.toBlock)});
 try{
  for(const end of [500,1000]){
   const start=h.calls.length,requests=[],provider=h.provider(),rows=await getCompleteLogs({provider,filter:filter(1,end),onRequest:value=>requests.push(value)}),calls=h.calls.slice(start);
   assert.deepEqual(rows.map(row=>row.blockNumber),records.filter(row=>row.blockNumber<=end).map(row=>row.blockNumber));
   assert.equal(calls[0].toBlock,end);assert.equal(calls.length,1+end/10);assert.equal(requests.length,calls.length);
   const coverage=new Array(end).fill(0);for(const value of calls.slice(1)){assert.equal(value.address,address);assert.deepEqual(value.topics,[topic]);assert.ok(value.toBlock-value.fromBlock+1<=10);for(let n=value.fromBlock;n<=value.toBlock;n++)coverage[n-1]++;}assert.ok(coverage.every(count=>count===1));
   const offset=h.calls.length;await getCompleteLogs({provider,filter:filter(end+1,end+100)});assert.ok(h.calls.slice(offset).every(value=>value.toBlock-value.fromBlock+1<=10));
  }
 }finally{await h.close();}
});

for(const code of [-32005,-32600])test('actual ethers HTTP 400 JSON-RPC '+code+' result limits retain complete child coverage',async()=>{
 const h=await httpHarness((value,id)=>value.toBlock>value.fromBlock?{status:400,body:{jsonrpc:'2.0',id,error:{code,message:'query returned more than 10000 results; private-body-secret'}}}:{records:[log(value.fromBlock)]});
 try{assert.deepEqual((await getCompleteLogs({provider:h.provider(),filter:filter(1,4)})).map(row=>row.blockNumber),[1,2,3,4]);assert.equal(h.calls.filter(value=>value.fromBlock===value.toBlock).length,4);}finally{await h.close();}
});

test('HTTP error envelopes fail closed for authentication, quota, pruning, malformed bodies and unbound messages',async()=>{
 const rangeMessage='up to a 10 block range; https://private.invalid/http-body-secret';
 const envelope=(code,message=rangeMessage)=>({jsonrpc:'2.0',id:1,error:{code,message}});
 const scenarios=[
  {status:401,body:envelope(429),reason:'AUTHENTICATION_REQUIRED',rpcCode:429},
  {status:403,body:envelope(-32602),reason:'AUTHENTICATION_REQUIRED',rpcCode:-32602},
  {status:429,body:envelope(-32602),reason:'RATE_LIMITED',rpcCode:-32602,attempts:3},
  {status:400,body:envelope(429),reason:'RATE_LIMITED',rpcCode:429,attempts:3},
  {status:400,body:envelope(-32000,'invalid API key; '+rangeMessage),reason:'AUTHENTICATION_REQUIRED',rpcCode:-32000},
  {status:400,body:envelope(-32000,'missing trie node; '+rangeMessage),reason:'HISTORICAL_STATE_UNAVAILABLE',rpcCode:-32000},
  {status:400,body:envelope(-32602,'too many requests; '+rangeMessage),reason:'RATE_LIMITED',rpcCode:-32602},
  {status:400,body:envelope(-32005,'rate limit exceeded; '+rangeMessage),reason:'RATE_LIMITED',rpcCode:-32005},
  {status:400,body:envelope(-32005,'limit exceeded; private-body-secret'),reason:'RATE_LIMITED',rpcCode:-32005},
  {status:400,body:envelope(-32600,'Invalid Request; private-body-secret'),reason:'INVALID_REQUEST',rpcCode:-32600},
  {status:400,body:envelope(-32600,'invalid API key; '+rangeMessage),reason:'AUTHENTICATION_REQUIRED',rpcCode:-32600},
  {status:400,body:envelope(-32600,'too many requests; '+rangeMessage),reason:'RATE_LIMITED',rpcCode:-32600},
  {status:400,body:envelope(-32600,'missing trie node; '+rangeMessage),reason:'HISTORICAL_STATE_UNAVAILABLE',rpcCode:-32600},
  {status:400,body:envelope(-32042),rpcCode:-32042},
  ...[
   '<html>private-body-secret '+rangeMessage+'</html>',
   '{"error":{"code":-32602,"message":"'+rangeMessage+'"}',
   [envelope(-32602)],
   {...envelope(-32602),result:[]},
   {...envelope(-32602),jsonrpc:'1.0'},
   envelope('-32602'),
   envelope('-32600'),
   {error:{code:-32602}},
   envelope(-32602,''),
   envelope(-32602,rangeMessage+'x'.repeat(8192)),
   JSON.stringify(envelope(-32602))+' '.repeat(65536),
   envelope(-2147483649),
   envelope(1.25)
  ].map(body=>({status:400,body,rpcCode:null}))
 ];
 let scenario;const h=await httpHarness(()=>scenario);
 try{
  for(scenario of scenarios){
   const start=h.calls.length,waits=[];
   await assert.rejects(getCompleteLogs({provider:h.provider(),filter:filter(1,100),waitForRetry:async value=>waits.push(value)}),error=>{
    assert.equal(error.message,'COMPLETE_LOG_QUERY_FAILED');assert.equal(error.logProbeDiagnostic.errorCode,'SERVER_ERROR');assert.equal(error.logProbeDiagnostic.httpStatus,scenario.status);assert.equal(error.logProbeDiagnostic.rpcCode,scenario.rpcCode);if(scenario.reason)assert.equal(error.logProbeDiagnostic.reason,scenario.reason);
    assert.doesNotMatch(inspect(error,{depth:10,showHidden:true}),/private|secret|https?:\/\//);assert.equal(Object.hasOwn(error,'cause'),false);return true;
   });
   const calls=h.calls.slice(start);assert.equal(calls.length,scenario.attempts??1);assert.ok(calls.every(value=>value.fromBlock===1&&value.toBlock===100));assert.deepEqual(waits,scenario.attempts===3?[250,750]:[]);
  }
 }finally{await h.close();}
 const body=JSON.stringify(envelope(-32602));
 const selected=harness({throwFor:()=>Object.assign(Error('private outer '+rangeMessage),{code:'SERVER_ERROR',info:{responseStatus:'400 Bad Request',responseBody:body,error:{code:-32602,message:'invalid argument'}}})});
 await assert.rejects(getCompleteLogs({provider:selected.provider,filter:filter(1,100)}),error=>error.logProbeDiagnostic.rpcCode===-32602);assert.equal(selected.calls.length,1,'A code from one error must not bind a range message from another error');
 const fallback=harness({limit:10,throwFor:value=>value.toBlock-value.fromBlock+1>10?Object.assign(Error('private outer'),{code:'SERVER_ERROR',response:{statusCode:400,get bodyText(){return body;}}}):null});
 assert.deepEqual(await getCompleteLogs({provider:fallback.provider,filter:filter(1,100)}),[]);assert.equal(fallback.calls.length,11);
});

test('recognized block limits yield every log with unchanged filters, ordered nonoverlapping coverage and cached provider limits',async()=>{
 const h=harness({limit:10,records:[log(1),log(10),log(11),log(50),log(100),log(110),log(200)],delayMs:2}),original=filter(1,100),copy=structuredClone(original),requests=[];
 const rows=await getCompleteLogs({provider:h.provider,filter:original,onRequest:value=>requests.push(value)});
 assert.deepEqual(rows.map(row=>row.blockNumber),[1,10,11,50,100]);assert.deepEqual(original,copy);assert.equal(requests.length,h.calls.length);assert.ok(h.maxActive<=4&&h.maxActive>1);
 const successful=h.calls.filter(row=>row.toBlock-row.fromBlock+1<=10),coverage=new Array(100).fill(0);
 for(const row of successful){assert.equal(row.address,address);assert.deepEqual(row.topics,[topic]);for(let block=row.fromBlock;block<=row.toBlock;block++)coverage[block-1]++;}
 assert.ok(coverage.every(value=>value===1));
 const offset=h.calls.length;
 assert.deepEqual((await getCompleteLogs({provider:h.provider,filter:filter(101,200)})).map(row=>row.blockNumber),[110,200]);
 assert.ok(h.calls.slice(offset).every(row=>row.toBlock-row.fromBlock+1<=10),'Learned limit must prevent another failing 100-block request');
});

test('known result-size limits split completely while a single-block limit remains a failure',async()=>{
 const h=harness({records:[log(1),log(2),log(3),log(4)],throwFor:value=>value.toBlock>value.fromBlock?rpc(-32005,'query returned more than 10000 results'):null});
 assert.deepEqual((await getCompleteLogs({provider:h.provider,filter:filter(1,4)})).map(row=>row.blockNumber),[1,2,3,4]);
 const blocked=harness({throwFor:()=>rpc(-32005,'query returned more than 10000 results')});
 await assert.rejects(getCompleteLogs({provider:blocked.provider,filter:filter(1,1)}),error=>error.message==='COMPLETE_LOG_QUERY_FAILED'&&error.logProbeDiagnostic.reason==='RESULT_LIMIT');
 assert.equal(blocked.calls.length,1);
});

test('empty child ranges use only the logical window anchor instead of reading every empty child header',async()=>{
 const h=harness({limit:10});assert.deepEqual(await getCompleteLogs({provider:h.provider,filter:filter(1,100)}),[]);
 assert.deepEqual(h.headers,[100,100]);assert.ok(h.calls.length>1);
});

test('ambiguous quota errors, authentication, timeouts and pruned history never trigger subdivision',async()=>{
 const errors=[rpc(-32005,'limit exceeded'),rpc(-32602,'invalid argument with private key'),rpc(-32000,'invalid API key private secret'),Object.assign(Error('private request timeout; block range limit 10'),{code:'TIMEOUT'}),rpc(-32000,'missing trie node; private archive URL')];
 for(const original of errors){
  const h=harness({throwFor:()=>original});
  await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,100)}),error=>{assert.equal(error.message,'COMPLETE_LOG_QUERY_FAILED');assert.equal(error.logProbeDiagnostic.requests,1);assert.doesNotMatch(inspect(error),/private|secret|https:\/\//);assert.equal(Object.hasOwn(error,'cause'),false);return true;});
  assert.equal(h.calls.length,1);
 }
});

test('confirmed 429 responses retry the identical range twice with bounded backoff and never return partial success',async()=>{
 const waits=[],h=harness({records:[log(3)],throwFor:(_,count)=>count<=2?rpc(429,'private quota response',{info:{responseStatus:'429 Too Many Requests',error:{code:429,message:'private response'}}}):null});
 assert.deepEqual((await getCompleteLogs({provider:h.provider,filter:filter(1,10),waitForRetry:async ms=>waits.push(ms)})).map(row=>row.blockNumber),[3]);
 assert.deepEqual(waits,[250,750]);assert.equal(h.calls.length,3);assert.deepEqual(h.calls,[h.calls[0],h.calls[0],h.calls[0]]);
 const blocked=harness({throwFor:()=>rpc(429,'private quota response')});
 await assert.rejects(getCompleteLogs({provider:blocked.provider,filter:filter(1,10),waitForRetry:async()=>{}}),error=>error.logProbeDiagnostic.reason==='RATE_LIMITED'&&error.logProbeDiagnostic.requests===3);assert.equal(blocked.calls.length,3);
});

test('actual ethers transport timeouts can retry the same log request twice only when explicitly enabled',async()=>{
 let failures=0;
 const h=await httpHarness(async()=>{if(failures++<2)await delay(350);return {records:[log(3)]};});
 try{
  const waits=[],attempts=[],original=filter(1,10),copy=structuredClone(original);
  const rows=await getCompleteLogs({provider:h.provider({timeout:100}),filter:original,maxTimeoutRetries:2,waitForRetry:async ms=>waits.push(ms),onRequest:value=>attempts.push(value)});
  assert.deepEqual(rows.map(row=>row.blockNumber),[3]);assert.deepEqual(waits,[500,1500]);assert.equal(attempts.length,3);assert.equal(h.calls.length,3);assert.deepEqual(h.calls,[h.calls[0],h.calls[0],h.calls[0]]);assert.deepEqual(original,copy);
 }finally{await h.close();}
});

test('timeout retry is opt-in, limited to the failed child, serial when requested and bounded by the request budget',async()=>{
 const timeout=()=>Object.assign(Error('private request timed out at https://private.invalid/key'),{code:'TIMEOUT'});
 const disabled=harness({throwFor:()=>timeout()}),disabledWaits=[];
 await assert.rejects(getCompleteLogs({provider:disabled.provider,filter:filter(1,10),waitForRetry:async ms=>disabledWaits.push(ms)}),error=>error.logProbeDiagnostic.reason==='TIMEOUT'&&error.logProbeDiagnostic.requests===1);
 assert.equal(disabled.calls.length,1);assert.deepEqual(disabledWaits,[]);
 let failures=0;const waits=[],h=harness({limit:10,records:[log(1),log(20),log(100)],delayMs:2,throwFor:value=>value.fromBlock===11&&failures++<2?timeout():null});
 assert.deepEqual((await getCompleteLogs({provider:h.provider,filter:filter(1,100),maxTimeoutRetries:2,maxConcurrency:1,waitForRetry:async ms=>waits.push(ms)})).map(row=>row.blockNumber),[1,20,100]);
 const repeated=h.calls.filter(value=>value.fromBlock===11);assert.equal(repeated.length,3);assert.deepEqual(repeated,[repeated[0],repeated[0],repeated[0]]);assert.ok(h.calls.filter(value=>value.fromBlock===1&&value.toBlock===10).length===1);assert.equal(h.maxActive,1);assert.deepEqual(waits,[500,1500]);
 const budget=harness({throwFor:()=>timeout()}),counts=[];
 await assert.rejects(getCompleteLogs({provider:budget.provider,filter:filter(1,10),maxTimeoutRetries:2,maxRequests:2,waitForRetry:async()=>{},onRequest:value=>counts.push(value)}),error=>error.message==='COMPLETE_LOG_REQUEST_BUDGET_EXCEEDED'&&error.logProbeDiagnostic.requests===2);
 assert.equal(budget.calls.length,2);assert.equal(counts.length,2);
});

test('timeout exhaustion and mixed 429 attempts share a strict three-attempt ceiling without subdivision',async()=>{
 const timeout=()=>Object.assign(Error('private transport timeout'),{code:'TIMEOUT'});
 for(const retries of [1,2]){
  const waits=[],h=harness({throwFor:()=>timeout()});
  await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,100),maxTimeoutRetries:retries,waitForRetry:async ms=>waits.push(ms)}),error=>error.logProbeDiagnostic.errorCode==='TIMEOUT'&&error.logProbeDiagnostic.reason==='TIMEOUT'&&error.logProbeDiagnostic.requests===1+retries);
  assert.equal(h.calls.length,1+retries);assert.ok(h.calls.every(value=>value.fromBlock===1&&value.toBlock===100));assert.deepEqual(waits,[500,1500].slice(0,retries));
 }
 const waits=[],mixed=harness({throwFor:(_,count)=>count===1?rpc(429,'quota response'):timeout()});
 await assert.rejects(getCompleteLogs({provider:mixed.provider,filter:filter(1,10),maxTimeoutRetries:2,waitForRetry:async ms=>waits.push(ms)}),error=>error.logProbeDiagnostic.requests===3);
 assert.equal(mixed.calls.length,3);assert.deepEqual(waits,[250,1500]);
});

test('timeout-labelled auth, quota, historical and application failures never enter timeout retries, and canonical reads remain hard failures',async()=>{
 const errors=[
  [Object.assign(Error('Unauthorized private request timeout'),{code:'TIMEOUT'}),'AUTHENTICATION_REQUIRED'],
  [Object.assign(Error('Rate limit exceeded; private timeout'),{code:'TIMEOUT'}),'RATE_LIMITED'],
  [Object.assign(Error('Missing trie node; private request timeout'),{code:'TIMEOUT'}),'HISTORICAL_STATE_UNAVAILABLE'],
  [Object.assign(Error('Header not found; private request timeout'),{code:'TIMEOUT'}),'HISTORICAL_STATE_UNAVAILABLE'],
  [Object.assign(Error('private request timeout'),{code:'TIMEOUT',info:{error:{code:-32600,message:'private request timeout'}}}),'TIMEOUT'],
  [Object.assign(Error('private request timeout'),{code:'TIMEOUT',info:{responseStatus:'400 Bad Request'}}),'TIMEOUT'],
  [Object.assign(Error('private request timeout'),{code:'SERVER_ERROR'}),'TIMEOUT']
 ];
 for(const [original,reason]of errors){
  const waits=[],h=harness({throwFor:()=>original});
  await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,100),maxTimeoutRetries:2,waitForRetry:async ms=>waits.push(ms)}),error=>{assert.equal(error.logProbeDiagnostic.requests,1);assert.equal(error.logProbeDiagnostic.reason,reason);assert.doesNotMatch(inspect(error),/private|secret|https?:\/\//);return true;});
  assert.equal(h.calls.length,1);assert.deepEqual(waits,[]);
 }
 const h=harness(),waits=[];let headers=0;
 h.provider.getBlock=async()=>{headers++;throw Object.assign(Error('private canonical timeout'),{code:'TIMEOUT'});};
 await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,100),maxTimeoutRetries:2,waitForRetry:async ms=>waits.push(ms)}),error=>error.message==='COMPLETE_LOG_CANONICAL_READ_FAILED'&&error.logProbeDiagnostic.operation==='getBlock');
 assert.equal(headers,1);assert.equal(h.calls.length,0);assert.deepEqual(waits,[]);
});

test('the exported transport-timeout predicate returns only a boolean and refuses application errors and private details',()=>{
 const timeout=extra=>Object.freeze(Object.assign(Error('private transport timeout at https://private.invalid/key'),{code:'TIMEOUT',...extra}));
 const cases=[
  [timeout(),true],
  [timeout({message:'private missing trie node; timeout'}),false],
  [timeout({message:'private header not found; timeout'}),false],
  [timeout({message:'private unauthorized timeout'}),false],
  [timeout({message:'private rate limit timeout'}),false],
  [timeout({info:{error:{code:-32600,message:'private transport timeout'}}}),false],
  [timeout({info:{error:{code:429,message:'private transport timeout'}}}),false],
  [timeout({info:{responseStatus:'400 Bad Request'}}),false],
  [timeout({response:{status:403}}),false],
  [timeout({code:'SERVER_ERROR'}),false],
  [Error('private timeout'),false],[null,false],[undefined,false],['TIMEOUT',false],
  [{code:'TIMEOUT',get info(){throw Error('private property details');}},false]
 ];
 const results=cases.map(([error,expected])=>{const result=isCompleteLogTransportTimeout(error);assert.equal(typeof result,'boolean');assert.equal(result,expected);return result;});
 assert.doesNotMatch(JSON.stringify(results),/private|secret|https?:\/\//);
});

test('retry and concurrency bounds reject invalid controls before contacting the provider',async()=>{
 for(const options of [{maxTimeoutRetries:-1},{maxTimeoutRetries:3},{maxTimeoutRetries:1.5},{maxTimeoutRetries:'2'},{maxConcurrency:0},{maxConcurrency:5},{maxConcurrency:1.5},{maxConcurrency:'1'}]){
  const h=harness();await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,10),...options}),/COMPLETE_LOG_REQUEST_LIMIT_REQUIRED/);assert.equal(h.calls.length,0);assert.equal(h.headers.length,0);
 }
});

test('a failed parallel child waits for all in-flight reads and discards every partial result',async()=>{
 const h=harness({limit:10,records:[log(1),log(20),log(30)],delayMs:3,throwFor:value=>value.fromBlock===11?rpc(-32601,'private unavailable method'):null});
 await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,100)}),error=>error.logProbeDiagnostic.reason==='METHOD_UNAVAILABLE');
 assert.equal(h.active,0);assert.ok(h.maxActive<=4);const completed=h.calls.length;await delay(10);assert.equal(h.calls.length,completed);
});

test('the request budget counts every attempt and never yields a partially read logical page',async()=>{
 const h=harness({limit:10,records:[log(1),log(20)]}),counts=[];
 await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,100),maxRequests:3,onRequest:value=>counts.push(value)}),error=>error.message==='COMPLETE_LOG_REQUEST_BUDGET_EXCEEDED'&&error.logProbeDiagnostic.reason==='REQUEST_BUDGET_EXCEEDED');
 assert.equal(h.calls.length,3);assert.equal(counts.length,3);assert.equal(h.active,0);
});

test('window and returned-log canonical hashes remain mandatory',async()=>{
 const h=harness({records:[log(1)]});let reads=0;
 h.provider.getBlock=async number=>({number,hash:number===10&&++reads>1?hash(999):hash(number)});
 await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,10)}),/COMPLETE_LOG_CANONICAL_MISMATCH/);
 const wrong=harness({records:[{...log(1),blockHash:hash(999)}]});await assert.rejects(getCompleteLogs({provider:wrong.provider,filter:filter(1,10)}),/COMPLETE_LOG_CANONICAL_MISMATCH/);
});

test('consistent duplicates are deduplicated, conflicting duplicates and out-of-scope log records are rejected',async()=>{
 const duplicated=harness({records:[log(1),log(1)]});assert.equal((await getCompleteLogs({provider:duplicated.provider,filter:filter(1,10)})).length,1);
 const conflict=harness({records:[log(1),log(1,0,'0xabcd')]});await assert.rejects(getCompleteLogs({provider:conflict.provider,filter:filter(1,10)}),/COMPLETE_LOG_CONFLICTING_DUPLICATE/);
 for(const change of [{address:'0x2222222222222222222222222222222222222222'},{topics:[hash(999)]},{removed:true},{index:-1},{transactionHash:'private secret'},{data:'private secret'}]){
  const h=harness({records:[{...log(1),...change}]});await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,10)}),/COMPLETE_LOG_RESPONSE_INVALID/);
 }
});

test('diagnostics never retain raw exceptions or trust provider-supplied diagnostic objects',async()=>{
 const source=rpc(-32602,'private URL https://private.invalid/secret');source.logProbeDiagnostic={url:'https://private.invalid/secret'};
 const h=harness({throwFor:()=>source});await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(1,100)}),error=>{assert.doesNotMatch(inspect(error),/private|secret|https:\/\//);assert.equal(error.logProbeDiagnostic.rpcCode,-32602);return true;});
 const value=sanitizeCompleteLogDiagnostic({operation:'private',fromBlock:'private',toBlock:Infinity,errorCode:'private',rpcCode:'secret',httpStatus:9999,reason:'private',requests:'secret'});
 assert.deepEqual(value,{operation:'eth_getLogs',fromBlock:null,toBlock:null,errorCode:null,rpcCode:null,httpStatus:null,reason:'UNKNOWN',requests:null});
 assert.equal(sanitizeCompleteLogDiagnostic({reason:'INVALID_REQUEST',url:'https://private.invalid/secret'}).reason,'INVALID_REQUEST');
});

test('invalid or unconstrained filters fail before contacting the provider',async()=>{
 for(const change of [{fromBlock:'latest'},{toBlock:1001},{address:[]},{topics:[]},{topics:[null]},{blockHash:hash(1)}]){
  const h=harness();await assert.rejects(getCompleteLogs({provider:h.provider,filter:{...filter(1,100),...change}}),/COMPLETE_LOG_FILTER_REQUIRED/);assert.equal(h.calls.length,0);assert.equal(h.headers.length,0);
 }
});

test('the actual connection probe covers a limited provider completely and preserves fatal canonical validation',async()=>{
 const fs=await import('node:fs');
 const {BrowserProvider,ContractFactory,parseEther}=await import('ethers');
 const {default:ganache}=await import('ganache');
 const {prepareZeroStartConnection}=await import('../scripts/connect-zero-start.mjs');
 const {retryableDailyReadFailure}=await import('../scripts/zero-start-automation.mjs');
 const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
 const fast=JSON.parse(fs.readFileSync('config/fresh-fast-testnet.json'));
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:12,unlockedAccounts:[fast.owner,fast.deployer]},miner:{blockGasLimit:30000000}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const proxy=overrides=>new Proxy(provider,{get(object,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});
 try{
  for(const account of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[account,'0x'+parseEther('10').toString(16)]});
  await rpc.request({method:'evm_setAccountNonce',params:[fast.deployer,'0x10']});
  const signer=await provider.getSigner(0),operator=await provider.getSigner(fast.deployer),addresses=await Promise.all(Array.from({length:12},async(_,i)=>(await provider.getSigner(i)).getAddress()));
  const deploy=async(name,args,from=signer)=>{const a=artifact(name),contract=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,from).deploy(...args);await contract.waitForDeployment();return contract;};
  const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]);
  const release={...fast,token:token.target,bnbFeed:feed.target,tokenFeed:feed.target,partners:addresses.slice(0,7),operations:addresses[11]};
  const vault=await deploy('FastTestnetVault',[release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations],operator);
  for(let i=0;i<30;i++)await rpc.request({method:'evm_mine',params:[]});
  const options={artifact:artifact('FastTestnetVault'),release,deploymentReport:{hash:vault.deploymentTransaction().hash},original:'TRADES_CHAIN_ID=97\nTRADES_RPC_URL=https://private.invalid/credential\nTRADES_VAULT_ADDRESS='+vault.target+'\nTRADES_PORT=3115\nTRADES_CONFIRMATIONS=3\nGLOBAL_MIGRATION_ENABLED=false\n',confirmations:3};
  const calls=[];
  const limited=proxy({getLogs:async value=>{calls.push(value);if(value.toBlock-value.fromBlock+1>10)throw rangeError();return provider.getLogs(value);}});
  const prepared=await prepareZeroStartConnection({...options,provider:limited});assert.equal(prepared.report.currentState.settlementLogProbe.status,'supported');assert.ok(calls.length>1);assert.equal(prepared.report.transactionsSent,0);
  const unavailable=proxy({getLogs:async()=>{throw rpcError();}});
  function rpcError(){return Object.assign(Error('private credential at https://private.invalid/key'),{code:'UNKNOWN_ERROR',info:{error:{code:-32602,message:'private invalid argument'}}});}
  await assert.rejects(prepareZeroStartConnection({...options,provider:unavailable}),error=>{assert.equal(error.message,'ZERO_START_SETTLEMENT_LOG_RPC_REQUIRED');assert.equal(error.logProbeDiagnostic.rpcCode,-32602);assert.doesNotMatch(inspect(error),/https|credential|private\.invalid/);return true;});
  const corrupted=proxy({getLogs:async value=>[{address:vault.target,topics:[vault.interface.getEvent('SaleSettled').topicHash],data:'0x',blockNumber:value.fromBlock,blockHash:hash(999),transactionHash:hash(998),index:0,removed:false}]});
  await assert.rejects(prepareZeroStartConnection({...options,provider:corrupted}),error=>{assert.equal(error.message,'COMPLETE_LOG_CANONICAL_MISMATCH');assert.equal(retryableDailyReadFailure(error,{transactions:{}}),false);return true;});
  const invalid=proxy({getLogs:async()=>({private:'invalid response'})});
  await assert.rejects(prepareZeroStartConnection({...options,provider:invalid}),error=>{assert.equal(error.message,'COMPLETE_LOG_RESPONSE_INVALID');assert.equal(retryableDailyReadFailure(error,{transactions:{}}),false);return true;});
 }finally{await provider.destroy();await rpc.disconnect();}
});


test('an explicit small span covers every block despite opaque errors on larger requests',async()=>{
 const h=harness({records:[log(1),log(10),log(11),log(499),log(500)],throwFor:r=>r.toBlock-r.fromBlock+1>10?Object.assign(Error('opaque failure'),{code:'SERVER_ERROR'}):null});
 const result=await getCompleteLogs({provider:h.provider,filter:filter(1,500),maxBlockSpan:10});
 assert.deepEqual(result.map(x=>x.blockNumber),[1,10,11,499,500]);
 assert.equal(h.calls.length,50);
 assert.ok(h.calls.every(x=>x.toBlock-x.fromBlock+1<=10));
 const covered=h.calls.flatMap(x=>Array.from({length:x.toBlock-x.fromBlock+1},(_,i)=>x.fromBlock+i)).sort((a,b)=>a-b);
 assert.deepEqual(covered,Array.from({length:500},(_,i)=>i+1));
 for(const maxBlockSpan of [0,1001,1.5])await assert.rejects(getCompleteLogs({provider:h.provider,filter:filter(),maxBlockSpan}),/REQUEST_LIMIT/);
});
