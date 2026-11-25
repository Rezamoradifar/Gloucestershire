import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {Wallet,toBeHex} from 'ethers';
import {createCommunity,createPortfolioCommunity} from '../server/community.mjs';
import {createApiServer} from '../server/trades-api.mjs';
import {createV3MemberHistory} from '../server/v3-member-history.mjs';
import {PORTFOLIO_PROFILE,PLAN_PORTFOLIO_PROFILE} from '../scripts/v3-unified-release-pins.mjs';

test('the portfolio API isolates sessions, threads and announcements by vault and rechecks current managers',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'global-portfolio-support-'));
 const wallets=Array.from({length:3},()=>Wallet.createRandom()),[member,manager,funder]=wallets;
 const vault='0x'+'11'.repeat(20),second='0x'+'22'.repeat(20),unknown='0x'+'33'.repeat(20);
 const proofs=[PORTFOLIO_PROFILE,PLAN_PORTFOLIO_PROFILE].map((profile,index)=>({
  status:profile.status,chainId:97,vault:index?second:vault,deploymentBlock:10,deploymentTx:toBeHex(index+1,32)
 }));
 const publicOrigin='https://globaldroptrade.com';
 let currentManager=manager.address,confirmedManager=manager.address,wrongChain=false,server,base;
 const provider={getBlock:async number=>({number,hash:toBeHex(number,32),timestamp:1000+number}),
  getTransactionReceipt:async()=>({blockHash:toBeHex(10,32)}),send:async()=>wrongChain?'0x38':'0x61',getBlockNumber:async()=>40};
 const reader=createV3MemberHistory({providers:[provider],proofs,verifyRelease:async(_,proof)=>({proof}),
  makeVault:address=>({MANAGER_ROLE:async()=>'manager',hasRole:async(role,wallet,at)=>
   address===vault&&role==='manager'&&wallet===(at.blockTag==='latest'?currentManager:confirmedManager)})});
 async function start(){
  server=createApiServer({publicConfig:{}},{memberHistory:reader,portfolioCommunity:createPortfolioCommunity(reader,{directory,origin:publicOrigin})});
  server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port+'/api/v3/community/';
 }
 async function stop(){server.closeAllConnections();await new Promise(done=>server.close(done));}
 const call=async(addr,route,method='GET',body,token)=>{
  const res=await fetch(base+addr+'/'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},
   body:body?JSON.stringify(body):undefined});
  return {status:res.status,data:await res.json()};
 };
 async function authenticate(signer,addr=vault){
  const challenge=await call(addr,'challenge','POST',{wallet:signer.address});
  assert.equal(challenge.status,200);assert.ok(challenge.data.message.includes('Contract: '+addr+'\nWallet: '+signer.address));
  const signed={nonce:challenge.data.nonce,signature:await signer.signMessage(challenge.data.message)};
  const other=addr===vault?second:vault;
  assert.equal((await call(other,'session','POST',signed)).status,401);
  const result=await call(addr,'session','POST',signed);assert.equal(result.status,200);
  assert.equal((await call(addr,'session','POST',signed)).status,401);return result.data.token;
 }
 try{
  await start();
  assert.equal((await call(unknown,'announcements')).status,404);
  assert.equal((await call(vault,'tickets?admin=1')).status,401);
  const [a,m,f,b]=await Promise.all([authenticate(member),authenticate(manager),authenticate(funder),authenticate(member,second)]);
  assert.equal((await call(vault,'notifications')).status,401);
  assert.equal((await call(vault,'notifications?admin=1','GET',undefined,f)).status,403);
  assert.equal((await call(second,'notifications','GET',undefined,a)).status,401);
  const create=await call(vault,'tickets','POST',{title:'Missing delivery',message:'Please check order 107.'},a);
  assert.equal(create.status,201);const thread='tickets/'+create.data.id;
  assert.equal((await call(vault,'tickets','GET',undefined,f)).data.total,0);
  assert.equal((await call(vault,thread,'GET',undefined,f)).status,403);
  assert.equal((await call(second,thread,'GET',undefined,a)).status,401);
  assert.equal((await call(second,thread,'GET',undefined,b)).status,404);
  assert.equal((await call(vault,'tickets?admin=1','GET',undefined,f)).status,403);
  assert.equal((await call(vault,'tickets?admin=1&status=open&q=delivery','GET',undefined,m)).data.total,1);
  assert.equal((await call(vault,thread+'?admin=1','POST',{message:'Staff'},a)).status,403);
  const ownCase=await call(vault,'tickets','POST',{title:'Manager question',message:'Account question'},m);
  const ownReply=await call(vault,'tickets/'+ownCase.data.id+'?admin=1','POST',{message:'Reviewed'},m);
  assert.equal(ownReply.data.messages[0].admin,false);assert.equal(ownReply.data.messages[1].admin,true);
  const reply=await call(vault,thread,'POST',{message:'The carrier has the parcel.'},m);assert.equal(reply.data.messages.at(-1).admin,true);
  await call(vault,thread,'POST',{status:'closed'},m);assert.equal((await call(vault,thread,'POST',{message:'Again'},a)).status,409);
  await call(vault,thread,'POST',{status:'open'},a);assert.equal((await call(vault,thread,'GET',undefined,a)).data.status,'open');
  assert.equal((await call(vault,'announcements','POST',{title:'x',message:'x'},f)).status,403);
  const note=await call(vault,'announcements','POST',{title:'Trading hours',message:'Open at noon UTC.'},m);assert.equal(note.status,201);
  const notice='announcements/'+note.data.id;
  assert.equal((await call(vault,'announcements')).data.items[0].title,'Trading hours');
  assert.equal((await call(second,'announcements')).data.total,0);
  assert.equal((await call(vault,notice,'PATCH',{title:'Updated hours',ifRevision:1},m)).data.revision,2);
  assert.equal((await call(vault,notice,'PATCH',{title:'Stale editor',ifRevision:1},m)).status,409);
  await call(vault,notice,'PATCH',{published:false,ifRevision:2},m);
  assert.equal((await call(vault,'announcements')).data.total,0);
  assert.equal((await call(vault,'announcements?admin=1','GET',undefined,m)).data.items[0].published,false);
  assert.equal((await call(vault,notice,'PATCH',{published:true,ifRevision:3},m)).status,200);
  const memberFeed=(await call(vault,'notifications','GET',undefined,a)).data;
  const managerFeed=(await call(vault,'notifications?admin=1','GET',undefined,m)).data;
  assert.equal(memberFeed.unread,3);assert.equal(managerFeed.unread,4);
  assert.equal(memberFeed.telegram,undefined);assert.equal(managerFeed.telegram.privateConfigured,false);
  assert.equal((await call(vault,'notifications','GET',undefined,f)).data.unread,1);
  assert.equal((await call(second,'notifications','GET',undefined,b)).data.unread,0);
  assert.equal((await call(vault,'notifications/read?admin=1','POST',{through:managerFeed.latest},f)).status,403);
  const hidden=managerFeed.items.find(r=>r.kind==='ticket-opened').seq;
  assert.equal((await call(vault,'notifications/read','POST',{through:hidden},a)).status,409);
  assert.equal((await call(vault,'notifications/read','POST',{through:memberFeed.latest},a)).status,200);
  assert.equal((await call(vault,'notifications?summary=1','GET',undefined,a)).data.unread,0);
  assert.equal((await call(vault,'notifications?admin=1','GET',undefined,m)).data.unread,4);
  assert.equal((await call(vault,notice+'/channel','POST',{},m)).status,409);
  currentManager=member.address;
  assert.equal((await call(vault,'notifications?admin=1','GET',undefined,m)).status,403);
  assert.equal((await call(vault,'tickets?admin=1','GET',undefined,m)).status,403);
  assert.equal((await call(vault,'tickets?admin=1','GET',undefined,a)).status,403);
  confirmedManager=member.address;assert.equal((await call(vault,'tickets?admin=1','GET',undefined,a)).status,200);
  wrongChain=true;assert.equal((await call(vault,'tickets?admin=1','GET',undefined,a)).status,503);
  assert.equal((await call(vault,'announcements')).status,200);wrongChain=false;
  await stop();await start();
  assert.equal((await call(vault,thread,'GET',undefined,a)).status,401);
  const fresh=await authenticate(member);
  assert.equal((await call(vault,thread,'GET',undefined,fresh)).data.messages[1].message,'The carrier has the parcel.');
  assert.equal((await call(vault,'announcements')).data.items[0].title,'Updated hours');
  assert.equal((await call(vault,'notifications','GET',undefined,fresh)).data.unread,0);
  for(let i=0;i<21;i++){
   const result=await call(vault,'announcements','POST',{title:'Notice '+i,message:'Published.'},fresh);assert.equal(result.status,201);
  }
  const older=await call(vault,'announcements?page=1');assert.equal(older.data.total,22);assert.equal(older.data.items.length,2);
  assert.equal(older.data.items[1].title,'Updated hours');
  const pack={posts:['welcome','notifications','private-support','history','network','service-updates'].map(key=>({key,title:key,message:'Member guide.'}))};
  assert.equal((await call(vault,'announcements/starter-pack','POST',pack,fresh)).data.published,6);
  assert.equal((await call(vault,'announcements/starter-pack','POST',pack,fresh)).data.published,0);
  assert.equal((await call(vault,'notifications','GET',undefined,fresh)).data.unread,27);
  const saved=JSON.parse(await readFile(path.join(directory,vault,'community.json'),'utf8'));assert.equal(saved.tickets.length,2);
  await assert.rejects(createCommunity({prefix:'/api/v3/community/'+unknown+'/',contract:vault,chainId:97,file:''}));
 }finally{if(server?.listening)await stop();reader.close();await rm(directory,{force:true,recursive:true});}
});
