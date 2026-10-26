import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {Wallet} from 'ethers';
import {createCommunity} from '../server/community.mjs';
test('private support, owner announcements, nonce replay, persistence and session expiry',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'global-community-')),file=path.join(dir,'community.json');
 const alice=Wallet.createRandom(),bob=Wallet.createRandom(),owner=Wallet.createRandom();let clock=Date.now(),currentOwner=owner.address;
 const handler=await createCommunity({file,chainId:97,contract:owner.address,owner:async()=>currentOwner,now:()=>clock});
 const server=http.createServer((req,res)=>void handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api/community/`;
 async function call(route,method='GET',body,token){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 async function login(wallet){const c=await call('challenge','POST',{wallet:wallet.address}),signature=await wallet.signMessage(c.data.message);const r=await call('session','POST',{nonce:c.data.nonce,signature});assert.equal(r.status,200);assert.equal((await call('session','POST',{nonce:c.data.nonce,signature})).status,401);return r.data.token;}
 try{
  const a=await login(alice),b=await login(bob),o=await login(owner);
  const created=await call('tickets','POST',{title:'Deposit question',message:'My private question'},a);assert.equal(created.status,201);const id=created.data.id;
  assert.equal((await call('tickets/'+id,'GET',undefined,b)).status,403);
  assert.deepEqual((await call('tickets','GET',undefined,b)).data.items,[]);
  assert.equal((await call('tickets?admin=1','GET',undefined,b)).status,403);
  assert.equal((await call('tickets?admin=1','GET',undefined,o)).data.items.length,1);
  assert.equal((await call('tickets/'+id,'POST',{message:'Support reply'},o)).data.messages[1].admin,true);
  await call('tickets/'+id,'POST',{status:'closed'},a);
  assert.equal((await call('tickets/'+id,'POST',{message:'Cannot reply yet'},a)).status,409);
  await call('tickets/'+id,'POST',{status:'open'},a);
  await Promise.all(['One','Two','Three'].map(message=>call('tickets/'+id,'POST',{message},a)));
  assert.equal((await call('tickets/'+id,'GET',undefined,a)).data.messages.length,5);
  assert.equal((await call('announcements','POST',{title:'Fake',message:'No'},b)).status,403);
  const announcement=await call('announcements','POST',{title:'News',message:'Published update'},o);assert.equal(announcement.status,201);
  assert.equal((await call('announcements')).data.items.length,1);
  await call('announcements/'+announcement.data.id,'DELETE',undefined,o);assert.equal((await call('announcements')).data.items.length,0);
  currentOwner=bob.address;assert.equal((await call('announcements','POST',{title:'Old owner',message:'Blocked'},o)).status,403);
  const saved=JSON.parse(await readFile(file,'utf8'));assert.equal(saved.tickets[0].messages.length,5);assert.equal(saved.announcements[0].published,false);
  clock+=3600001;assert.equal((await call('tickets','GET',undefined,a)).status,401);
  const c=await call('challenge','POST',{wallet:alice.address});clock+=300001;assert.equal((await call('session','POST',{nonce:c.data.nonce,signature:await alice.signMessage(c.data.message)})).status,401);
 }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

test('the full API serves ticket POST routes and persisted tickets survive a service restart',async()=>{
 const {createApiServer}=await import('../server/trades-api.mjs');
 const dir=await mkdtemp(path.join(os.tmpdir(),'global-support-restart-')),file=path.join(dir,'community.json'),alice=Wallet.createRandom(),owner=Wallet.createRandom();
 let server,base;
 const start=async()=>{
  const community=await createCommunity({file,chainId:97,contract:owner.address,owner:async()=>owner.address});
  server=createApiServer({configured:true,publicConfig:{chainId:97,vaultAddress:owner.address}},{community,marketplace:async()=>false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}/api/community/`;
 };
 const call=async(route,method='GET',body,token)=>{const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
 const login=async()=>{const challenge=await call('challenge','POST',{wallet:alice.address});const result=await call('session','POST',{nonce:challenge.data.nonce,signature:await alice.signMessage(challenge.data.message)});assert.equal(result.status,200);return result.data.token;};
 try{
  await start();const token=await login();const created=await call('tickets','POST',{title:'Persistent support',message:'Please check this account'},token);assert.equal(created.status,201);
  await new Promise(resolve=>server.close(resolve));await start();
  assert.equal((await call('tickets','GET',undefined,token)).status,401);
  const fresh=await login(),loaded=await call('tickets/'+created.data.id,'GET',undefined,fresh);assert.equal(loaded.status,200);assert.equal(loaded.data.messages[0].message,'Please check this account');
  const replied=await call('tickets/'+created.data.id,'POST',{message:'Follow-up after restart'},fresh);assert.equal(replied.status,200);assert.equal(replied.data.messages.length,2);
 }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
