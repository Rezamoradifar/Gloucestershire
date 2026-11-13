import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiServer} from '../server/trades-api.mjs';

test('V2 read routes coexist with immutable original API config',async()=>{
 const old='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
 const feed={configured:true,publicConfig:{version:1,chainId:97,vaultAddress:old},
  async get(){return {status:'live',trades:[]}}};
 let invoked=0;
 const gateway=async(req,res)=>{
  if(req.url!=='/api/v2/rpc')return false;
  invoked++;res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x61'}));return true;
 };
 const server=createApiServer(feed,{v2ReadGateway:gateway,marketplace:async()=>false,historyRelay:null,teamRelay:null});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const newRpc=await fetch(base+'/api/v2/rpc',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});
  assert.equal(newRpc.status,200);
  assert.equal((await newRpc.json()).result,'0x61');
  assert.equal(invoked,1);
  const cfg=await fetch(base+'/api/config');
  assert.equal(cfg.status,200);
  assert.deepEqual(await cfg.json(),feed.publicConfig);
  const health=await fetch(base+'/api/health');
  assert.equal(health.status,200);
  assert.equal((await health.json()).configured,true);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
