import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {
 validateV2ReadRequest,createV2ReadGateway,V2_RPC_VAULT,V2_RPC_TOKEN,
 V2_RPC_DEPLOY_BLOCK
} from '../server/v2-read-rpc.mjs';

const request=(method,params=[])=>({jsonrpc:'2.0',id:17,method,params});
const tag='0x'+V2_RPC_DEPLOY_BLOCK.toString(16);
const reverts=fn=>assert.throws(fn,/Invalid V2 read request/);

test('V2 read gateway accepts only the intended contract, token and bounded block/log reads',()=>{
 for(const m of ['eth_chainId','eth_blockNumber'])assert.equal(validateV2ReadRequest(request(m)).method,m);
 assert.equal(validateV2ReadRequest(request('eth_getCode',[V2_RPC_VAULT,'latest'])).method,'eth_getCode');
 assert.equal(validateV2ReadRequest(request('eth_call',[{to:V2_RPC_TOKEN,data:'0x70a08231'},'latest'])).method,'eth_call');
 assert.equal(validateV2ReadRequest(request('eth_getBlockByNumber',[tag,false])).method,'eth_getBlockByNumber');
 assert.equal(validateV2ReadRequest(request('eth_getLogs',[{
  address:V2_RPC_VAULT,fromBlock:tag,toBlock:'0x'+(V2_RPC_DEPLOY_BLOCK+1799).toString(16)
 }])).method,'eth_getLogs');
});

test('V2 read gateway refuses signing, sending, arbitrary contracts and unsafe query windows',()=>{
 for(const method of ['eth_sendTransaction','eth_sendRawTransaction','personal_sign','eth_sign','eth_subscribe','debug_traceTransaction'])
  reverts(()=>validateV2ReadRequest(request(method,[])));
 reverts(()=>validateV2ReadRequest(request('eth_getCode',['0x4C0F6141b18971db4b14e45c0bE8CddB09febc14','latest'])));
 reverts(()=>validateV2ReadRequest(request('eth_call',[{to:V2_RPC_VAULT,data:'0x12',from:'0x1111111111111111111111111111111111111111'},'latest'])));
 reverts(()=>validateV2ReadRequest(request('eth_getLogs',[{
  address:V2_RPC_VAULT,fromBlock:tag,toBlock:'0x'+(V2_RPC_DEPLOY_BLOCK+1800).toString(16)
 }])));
 reverts(()=>validateV2ReadRequest([request('eth_chainId')]));
});

async function invokeGateway(gateway,body,method='POST'){
 const req=Readable.from([Buffer.from(JSON.stringify(body))]);
 req.url='/api/v2/rpc';req.method=method;req.socket={remoteAddress:'127.0.0.1'};
 const res={headers:{},status:200,payload:'',
  setHeader(key,value){this.headers[key.toLowerCase()]=value;},
  writeHead(code){this.status=code;return this;},
  end(value=''){this.payload=String(value);}
 };
 const matched=await gateway(req,res);
 return {matched,status:res.status,body:JSON.parse(res.payload),headers:res.headers};
}

test('V2 gateway exposes no signer or arbitrary proxy features',async()=>{
 let upstreamCalls=0;
 const gateway=createV2ReadGateway({sources:['https://example.org'],fetcher:async()=>{
  upstreamCalls++;throw Error('not available');
 }});
 const denied=await invokeGateway(gateway,request('eth_sendRawTransaction',['0x1234']));
 assert.equal(denied.status,400);
 assert.equal(upstreamCalls,0);
 const method=await invokeGateway(gateway,request('eth_chainId'), 'GET');
 assert.equal(method.status,405);
 assert.equal(upstreamCalls,0);
 assert.equal(method.headers['cache-control'],'no-store');
});

test('V2 gateway fails closed when upstream identity/code cannot be established',async()=>{
 const gateway=createV2ReadGateway({sources:['https://example.org'],fetcher:async(_url,{body})=>{
  const {method}=JSON.parse(body);
  return {ok:true,async json(){return {jsonrpc:'2.0',id:1,result:method==='eth_chainId'?'0x61':'0x6000'};}};
 }});
 const response=await invokeGateway(gateway,request('eth_blockNumber'));
 assert.equal(response.status,503);
 assert.equal(response.body.error.code,-32000);
});
