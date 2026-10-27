import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installHistoricalCallRetry} from '../scripts/complete-rpc-logs.mjs';
const params=[{to:'0x1111111111111111111111111111111111111111',data:'0x12345678'},'0x100'];
const timeout=()=>Object.assign(Error('private transport timeout'),{code:'TIMEOUT'});
test('historical calls retry the same parameters on one provider, with bounded backoff',async()=>{
 const calls=[],waits=[],provider={async send(method,args){assert.equal(this,provider);calls.push([method,structuredClone(args)]);if(calls.length<3){args[0].data='0xchanged';throw timeout();}return '0xresult';}};
 assert.equal(installHistoricalCallRetry(provider,{waitForRetry:async ms=>waits.push(ms)}),provider);
 installHistoricalCallRetry(provider);
 assert.equal(await provider.send('eth_call',params),'0xresult');
 assert.deepEqual(calls,Array.from({length:3},()=>['eth_call',params]));assert.deepEqual(waits,[500,1500]);assert.equal(params[0].data,'0x12345678');
});
test('a persistent historical timeout stops after exactly three attempts',async()=>{
 let attempts=0;const provider={async send(){attempts++;throw timeout();}};
 installHistoricalCallRetry(provider,{waitForRetry:async()=>{}});
 await assert.rejects(provider.send('eth_call',params),{code:'TIMEOUT'});assert.equal(attempts,3);
});
test('broadcasts, pending/latest calls, logs and RPC or HTTP failures never gain retries',async()=>{
 for(const [method,args,error]of [
  ['eth_sendRawTransaction',['private signed transaction'],timeout()],
  ['eth_sendTransaction',[{}],timeout()],['eth_call',[params[0],'latest'],timeout()],['eth_call',[params[0],'pending'],timeout()],['eth_getLogs',[{}],timeout()],
  ['eth_call',params,Object.assign(timeout(),{info:{error:{code:-32603,message:'missing trie node'}}})],
  ['eth_call',params,Object.assign(timeout(),{status:403})],
  ['eth_call',params,Object.assign(Error('execution reverted'),{code:'CALL_EXCEPTION'})]
 ]){
  let attempts=0;const provider={async send(){attempts++;throw error;}};
  installHistoricalCallRetry(provider,{waitForRetry:async()=>{throw Error('NO_BACKOFF_ALLOWED');}});
  await assert.rejects(provider.send(method,args),e=>e===error);assert.equal(attempts,1);
 }
});

test('real ethers historical contract calls recover transport timeouts without changing the block',async()=>{
 const http=await import('node:http'),{Contract,FetchRequest,JsonRpcProvider}=await import('ethers');
 const calls=[];const server=http.createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;
  const call=JSON.parse(text);calls.push(call);
  if(calls.length<3)return;
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,result:'0x'+(7n).toString(16).padStart(64,'0')}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const request=new FetchRequest(`http://127.0.0.1:${server.address().port}`);request.timeout=100;
 const provider=installHistoricalCallRetry(new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1}),{waitForRetry:async()=>{}});
 try{
  const contract=new Contract(params[0].to,['function value() view returns(uint256)'],provider);
  assert.equal(await contract.value({blockTag:256}),7n);assert.equal(calls.length,3);
  assert.ok(calls.every(call=>call.method==='eth_call'&&call.params[1]==='0x100'));assert.deepEqual(calls[0].params,calls[2].params);
 }finally{provider.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
