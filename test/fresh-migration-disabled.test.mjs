import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createMigrationService} from '../server/migration-service.mjs';
import {createApiServer} from '../server/trades-api.mjs';

const target='0x1111111111111111111111111111111111111111';
const legacy='0x3333333333333333333333333333333333333333';
const hash='0x'+'a'.repeat(64);
const config={chainId:97,address:target,rpcUrl:'http://127.0.0.1:1'};
const routes=['connection','status','inventory','discover','verify?hash='+hash,'stability?hash='+hash,'unknown'];
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
const request=async(base,route)=>{const response=await fetch(base+route,{headers:{Connection:'close'}});return {status:response.status,body:await response.json()};};

test('fresh migration disable blocks every legacy endpoint without provider or index reads and preserves current API routes',async()=>{
 let touches=0;
 const provider=new Proxy({}, {get(){touches++;throw Error('Unexpected legacy provider access');}});
 const forbidden=()=>{touches++;throw Error('Unexpected legacy index access');};
 const migration=createMigrationService(config,{allowLegacy:false,provider,seedReader:forbidden,connectionReader:forbidden});
 let feedReads=0;
 const feed={configured:true,publicConfig:{version:1,chainId:97,vaultAddress:target},get:async()=>{feedReads++;return {status:'live',chainId:97,contract:target,trades:[]};}};
 const server=createApiServer(feed,{migration,marketplace:async()=>false});
 const base=await listen(server);
 try{
  for(const route of routes){
   const result=await request(base,'/api/migration/'+route);
   assert.equal(result.status,503,route);
   assert.deepEqual(result.body,{error:'TESTNET_MIGRATION_SERVICE_UNAVAILABLE'});
  }
  assert.deepEqual(await request(base,'/api/config'),{status:200,body:feed.publicConfig});
  assert.equal((await request(base,'/api/health')).body.configured,true);
  assert.equal((await request(base,'/api/trades')).body.contract,target);
  assert.equal(feedReads,1);
  assert.equal((await request(base,'/unrelated')).status,404);
  assert.equal(touches,0);
 }finally{migration.close();await close(server);}
});

test('migration service retains its existing enabled default for legacy installations',async()=>{
 const migration=createMigrationService(config,{artifact:{abi:[]},provider:new Proxy({}, {get(){throw Error('Unexpected RPC read');}}),policy:{source:legacy},connectionReader:()=>({chainId:97,source:legacy,target,hash})});
 const server=createApiServer({configured:true,publicConfig:{version:1,chainId:97,vaultAddress:target}},{migration,marketplace:async()=>false});
 const base=await listen(server);
 try{assert.deepEqual(await request(base,'/api/migration/connection'),{status:200,body:{source:legacy,target,hash,chainId:97}});}
 finally{migration.close();await close(server);}
});

test('actual API entrypoint honors GLOBAL_MIGRATION_ENABLED=false and serves the fresh target with no RPC requests',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'global-fresh-migration-disabled-'));
 let rpcRequests=0,child,output='';
 const rpc=http.createServer(async(req,res)=>{rpcRequests++;for await(const _ of req){}res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"RPC_MUST_NOT_BE_USED"}');});
 const rpcUrl=await listen(rpc);
 const reservation=http.createServer();await listen(reservation);const port=reservation.address().port;await close(reservation);
 try{
  child=spawn(process.execPath,['server/trades-api.mjs'],{
   cwd:fileURLToPath(new URL('..',import.meta.url)),
   env:{...process.env,TRADES_CHAIN_ID:'97',TRADES_VAULT_ADDRESS:target,TRADES_RPC_URL:rpcUrl,TRADES_PORT:String(port),COMMUNITY_DATA_FILE:path.join(directory,'community.json'),GLOBAL_MIGRATION_ENABLED:'false'},
   stdio:['ignore','pipe','pipe']
  });
  await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('API startup timed out: '+output)),10000);
   child.stdout.on('data',data=>{output+=data;if(output.includes('API listening on')){clearTimeout(timeout);resolve();}});
   child.stderr.on('data',data=>{output+=data;});
   child.once('exit',code=>{clearTimeout(timeout);reject(Error('API exited before startup: '+code+' '+output));});
  });
  const base='http://127.0.0.1:'+port;
  for(const route of routes){const response=await request(base,'/api/migration/'+route);assert.equal(response.status,503);assert.equal(response.body.error,'TESTNET_MIGRATION_SERVICE_UNAVAILABLE');}
  assert.deepEqual(await request(base,'/api/config'),{status:200,body:{version:1,chainId:97,vaultAddress:target}});
  const health=await request(base,'/api/health');assert.equal(health.status,200);assert.equal(health.body.configured,true);
  assert.equal(rpcRequests,0,'Disabled legacy routes must not query the old or current RPC');
 }finally{
  if(child&&child.exitCode===null){
   child.kill('SIGTERM');
   await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
  }
  await close(rpc);await fs.rm(directory,{recursive:true,force:true});
 }
});
