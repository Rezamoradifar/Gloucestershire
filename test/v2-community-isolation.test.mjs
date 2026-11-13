import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Wallet} from 'ethers';
import {createCommunity} from '../server/community.mjs';

const V2='0xA98D8d3709f5D3730BAD5d76C334731784e7CF07';
const OLD='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
const origin='https://globaldroptrade.com';
test('new V2 support and announcements have separate storage, exact wallet signatures and zero old tickets',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'global-v2-isolated-support-'));
 const oldFile=path.join(folder,'old.json'),v2File=path.join(folder,'new-v2.json');
 const owner=Wallet.createRandom(),member=Wallet.createRandom();
 const old=await createCommunity({file:oldFile,owner:async()=>owner.address,chainId:97,contract:OLD,origin});
 const v2=await createCommunity({file:v2File,owner:async()=>owner.address,chainId:97,
  contract:V2,origin,prefix:'/api/v2/community/'});
 const server=http.createServer(async(req,res)=>{
  if(await v2(req,res))return;
  if(await old(req,res))return;
  res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'unknown'}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const request=async(route,method='GET',body,token='')=>{
  const response=await fetch(base+route,{method,headers:{
   ...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})
  },body:body?JSON.stringify(body):undefined});
  return {status:response.status,value:await response.json()};
 };
 const authenticate=async(wallet,basePath)=>{
  const first=await request(basePath+'challenge','POST',{wallet:wallet.address});
  assert.equal(first.status,200);
  const text=first.value.message;
  const session=await request(basePath+'session','POST',{nonce:first.value.nonce,signature:await wallet.signMessage(text)});
  assert.equal(session.status,200);return {token:session.value.token,message:text};
 };
 try{
  const oldSession=await authenticate(member,'/api/community/');
  assert.ok(oldSession.message.includes(OLD));
  const oldTicket=await request('/api/community/tickets','POST',{title:'Old test',
   message:'This legacy ticket must never show in V2.'},oldSession.token);
  assert.equal(oldTicket.status,201);
  const newSession=await authenticate(member,'/api/v2/community/');
  assert.ok(newSession.message.includes(V2));
  assert.equal(newSession.message.includes(OLD),false);
  const initial=await request('/api/v2/community/tickets','GET',undefined,newSession.token);
  assert.equal(initial.status,200);
  assert.equal(initial.value.items.length,0);
  const created=await request('/api/v2/community/tickets','POST',{title:'V2 request',
   message:'A new V2-only wallet-auth support ticket.'},newSession.token);
  assert.equal(created.status,201);
  const v2List=await request('/api/v2/community/tickets','GET',undefined,newSession.token);
  assert.equal(v2List.value.items.length,1);
  assert.equal(v2List.value.items[0].title,'V2 request');
  const oldList=await request('/api/community/tickets','GET',undefined,oldSession.token);
  assert.equal(oldList.value.items.length,1);
  assert.equal(oldList.value.items[0].title,'Old test');
  const withOldToken=await request('/api/v2/community/tickets','GET',undefined,oldSession.token);
  assert.equal(withOldToken.status,401);
  const withV2Token=await request('/api/community/tickets','GET',undefined,newSession.token);
  assert.equal(withV2Token.status,401);
  const unauth=await request('/api/v2/community/tickets','GET');
  assert.equal(unauth.status,401);
  const unauthorized=await request('/api/v2/community/announcements','POST',
   {title:'Forged admin message',message:'Should be rejected.'},newSession.token);
  assert.equal(unauthorized.status,403);
  const admin=await authenticate(owner,'/api/v2/community/');
  const announcement=await request('/api/v2/community/announcements','POST',
   {title:'Official V2 news',message:'New contract only, chain 97.'},admin.token);
  assert.equal(announcement.status,201);
  const feed=await request('/api/v2/community/announcements');
  assert.equal(feed.status,200);
  assert.equal(feed.value.items.length,1);
  const oldFeed=await request('/api/community/announcements');
  assert.equal(oldFeed.value.items.length,0);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  await fs.rm(folder,{recursive:true,force:true});
 }
});
