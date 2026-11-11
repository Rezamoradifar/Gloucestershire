import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {mkdtemp,rm,readFile,writeFile,chmod} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Wallet,getAddress} from 'ethers';
import {createDailyActivity} from '../server/daily-activity.mjs';
import {createDailyActivityReader,readDailyActivity,validateDailyActivityState,validateDailyActivityPolicy,createDailyActivityState} from '../scripts/daily-activity.mjs';

async function fixture(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'global-daily-activity-')),file=path.join(dir,'daily-activity.json');
 const vaultAddress=Wallet.createRandom().address,alice=Wallet.createRandom(),bob=Wallet.createRandom(),stranger=Wallet.createRandom();
 const identity={chainId:97,vaultAddress,origin:'https://globaldroptrade.com'};
 const start=1800000000,baseBlock=5000,blocks=new Map();let clock=start*1000,chain=97,corruptBlock=null;
 function current(){const delta=Math.floor(clock/1000)-start,number=baseBlock+delta;const value={number,hash:'0x'+number.toString(16).padStart(64,'0'),timestamp:Math.floor(clock/1000)-3};blocks.set(number,value);return value;}
 const provider={getNetwork:async()=>({chainId:BigInt(chain)}),getBlockNumber:async()=>current().number+3,getBlock:async number=>{current();const b=blocks.get(number);return b&&number===corruptBlock?{...b,hash:'0x'+'f'.repeat(64)}:b;}};
 const vault={getAddress:async()=>vaultAddress,users:async who=>({registered:[alice.address,bob.address].includes(getAddress(who))})};
 const policy={version:1,...identity,windowSeconds:86400,activationTimestamp:start+86400,historyFile:file};
 let server,base;
 async function startServer(options={}){
  const handler=await createDailyActivity({file,...identity,contract:vaultAddress,provider,vault,policy,now:()=>clock,...options});
  server=http.createServer((req,res)=>{void handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}/api/daily-activity/`;
 }
 async function stopServer(){if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
 async function call(route,method='GET',body,headers={}){
  const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Origin:identity.origin,...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,headers:response.headers,data:await response.json()};
 }
 async function challenge(wallet=alice){const result=await call('challenge','POST',{wallet:wallet.address});assert.equal(result.status,200);return result.data;}
 async function checkIn(wallet=alice){const c=await challenge(wallet);return call('check-in','POST',{nonce:c.nonce,signature:await wallet.signMessage(c.message)});}
 await startServer();
 return {dir,file,identity,alice,bob,stranger,provider,vault,policy,start,baseBlock,call,challenge,checkIn,startServer,stopServer,advance:seconds=>{clock+=seconds*1000;},setChain:value=>{chain=value;},reorg:number=>{corruptBlock=number;},now:()=>clock,async cleanup(){await stopServer();await rm(dir,{recursive:true,force:true});}};
}

test('signed check-ins persist a canonical time, expose a future gate, and do not transfer funds',async()=>{
 const f=await fixture();try{
  const result=await f.checkIn();assert.equal(result.status,201);assert.equal(result.data.activityCurrent,true);assert.equal(result.data.requirementEnabled,true);assert.equal(result.data.requirementActive,false);assert.equal(result.data.activationTimestamp,f.policy.activationTimestamp);assert.equal(result.data.recorded,true);
  assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(result.data.activeUntil,result.data.lastCheckInAt+86400);
  const history=readDailyActivity({file:f.file,...f.identity});assert.equal(history.records.length,1);assert.equal(history.records[0].receivedAt,f.now());assert.equal(history.records[0].block.timestamp,f.start-3);
  assert.equal(fs.statSync(f.file).mode&0o777,0o600);assert.equal(history.records[0].wallet,f.alice.address);
  const eligible=createDailyActivityReader({file:f.file,...f.identity,provider:f.provider});
  assert.equal(await eligible(f.alice.address,f.start+1),true);assert.equal(await eligible(f.bob.address,f.start+1),false);
  // A receipt after the cutoff cannot exploit an earlier finalized block.
  assert.equal(await eligible(f.alice.address,f.start),false);
  assert.equal(await eligible(f.alice.address,f.start-3+86400),true);
  assert.equal(await eligible(f.alice.address,f.start-3+86401),false);
  const publicStatus=await f.call('status?wallet='+f.alice.address);assert.equal(publicStatus.status,200);assert.equal(publicStatus.data.activityCurrent,true);assert.equal(publicStatus.data.signature,undefined);assert.equal(publicStatus.data.records,undefined);
 }finally{await f.cleanup();}
});

test('rejects nonce replay, wrong signers, expired signatures, unknown origins and caller timestamps',async()=>{
 const f=await fixture();try{
  const first=await f.challenge(),signature=await f.alice.signMessage(first.message);
  assert.equal((await f.call('check-in','POST',{nonce:first.nonce,signature})).status,201);
  assert.equal((await f.call('check-in','POST',{nonce:first.nonce,signature})).status,401);
  const wrong=await f.challenge();assert.equal((await f.call('check-in','POST',{nonce:wrong.nonce,signature:await f.bob.signMessage(wrong.message)})).status,401);
  const expired=await f.challenge();f.advance(301);assert.equal((await f.call('check-in','POST',{nonce:expired.nonce,signature:await f.alice.signMessage(expired.message)})).status,401);
  assert.equal((await f.call('challenge','POST',{wallet:f.alice.address},{Origin:'https://untrusted.invalid'})).status,403);
  assert.equal((await f.call('challenge','POST',{wallet:f.alice.address,timestamp:1})).status,400);
  const forged=await f.challenge();assert.equal((await f.call('check-in','POST',{nonce:forged.nonce,signature:await f.alice.signMessage(forged.message),receivedAt:1})).status,400);
  assert.equal(readDailyActivity({file:f.file,...f.identity}).records.length,1);
 }finally{await f.cleanup();}
});

test('expired unused challenges do not exhaust the pending challenge limit',async()=>{
 const f=await fixture();try{
  const expired=await f.challenge();
  // More than the pending capacity, each after the previous challenge and
  // wallet rate window have expired. No signatures or history writes occur.
  for(let i=0;i<1000;i++){
   f.advance(3601);
   await f.challenge();
  }
  const old=await f.call('check-in','POST',{nonce:expired.nonce,signature:await f.alice.signMessage(expired.message)});
  assert.equal(old.status,401);
  assert.equal(readDailyActivity({file:f.file,...f.identity}).records.length,0);
 }finally{await f.cleanup();}
});

test('wallet rate limit returns an accurate retry time without extending its window',async()=>{
 const f=await fixture();try{
  // Each request is consumed with an authentic signature before another is
  // issued. Repeated unauthenticated requests must not exhaust this quota.
  for(let i=0;i<12;i++)await f.checkIn();
  const limited=await f.call('challenge','POST',{wallet:f.alice.address});
  assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'3600');
  assert.equal(limited.data.retryAfterSeconds,3600);assert.equal(limited.data.rateScope,'wallet');
  f.advance(300);
  const repeated=await f.call('challenge','POST',{wallet:f.alice.address});
  assert.equal(repeated.status,429);assert.equal(repeated.headers.get('retry-after'),'3300');
  f.advance(3300);assert.equal((await f.call('challenge','POST',{wallet:f.alice.address})).status,200);
 }finally{await f.cleanup();}
});

test('concurrent unauthenticated challenge retries share one request and cannot exhaust the wallet quota',async()=>{
 const f=await fixture();try{
  const replies=await Promise.all(Array.from({length:30},()=>f.call('challenge','POST',{wallet:f.alice.address})));
  assert.ok(replies.every(row=>row.status===200));
  assert.equal(new Set(replies.map(row=>row.data.nonce)).size,1);
  const c=replies[0].data;
  const saved=await f.call('check-in','POST',{nonce:c.nonce,signature:await f.alice.signMessage(c.message)});
  assert.equal(saved.status,201);
  assert.equal((await f.call('challenge','POST',{wallet:f.alice.address})).status,200);
 }finally{await f.cleanup();}
});

test('invalid signature cannot consume another wallet challenge and a valid signature is accepted only once',async()=>{
 const f=await fixture();try{
  const c=await f.challenge();
  const wrong=await f.call('check-in','POST',{nonce:c.nonce,signature:await f.bob.signMessage(c.message)});
  assert.equal(wrong.status,401);
  const again=await f.challenge();assert.equal(again.nonce,c.nonce);
  const signature=await f.alice.signMessage(c.message);
  const results=await Promise.all(Array.from({length:2},()=>f.call('check-in','POST',{nonce:c.nonce,signature})));
  assert.deepEqual(results.map(row=>row.status).sort(),[201,401]);
  assert.equal(readDailyActivity({file:f.file,...f.identity}).records.length,1);
 }finally{await f.cleanup();}
});

test('registered identity and configured chain are checked before accepting activity',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('challenge','POST',{wallet:f.stranger.address})).status,409);
  f.setChain(56);assert.equal((await f.call('challenge','POST',{wallet:f.alice.address})).status,503);
  f.setChain(97);const challenge=await f.challenge();f.setChain(56);
  assert.equal((await f.call('check-in','POST',{nonce:challenge.nonce,signature:await f.alice.signMessage(challenge.message)})).status,503);
  assert.equal(readDailyActivity({file:f.file,...f.identity}).records.length,0);
  const state=createDailyActivityState(f.identity);assert.throws(()=>validateDailyActivityState(state,{...f.identity,chainId:56}),/TARGET_MISMATCH/);
  assert.throws(()=>validateDailyActivityPolicy({...f.policy,activationTimestamp:0},f.identity),/POLICY_INVALID/);
 }finally{await f.cleanup();}
});

test('concurrent writes preserve every wallet and a restart preserves unpaid historical proof',async()=>{
 const f=await fixture();try{
  const a=await f.challenge(f.alice),b=await f.challenge(f.bob);
  const responses=await Promise.all([[a,f.alice],[b,f.bob]].map(async([c,w])=>f.call('check-in','POST',{nonce:c.nonce,signature:await w.signMessage(c.message)})));
  assert.deepEqual(responses.map(r=>r.status),[201,201]);
  const old=createDailyActivityReader({file:f.file,...f.identity,provider:f.provider});
  f.advance(25*3600);const renewed=await f.checkIn(f.alice);assert.equal(renewed.status,201);
  const renewedReader=createDailyActivityReader({file:f.file,...f.identity,provider:f.provider});
  assert.equal(await old(f.alice.address,Math.floor(f.now()/1000)+1),false); // Fixed worker snapshot.
  assert.equal(await renewedReader(f.alice.address,f.start+1),true); // Old unpaid period survives renewal.
  assert.equal(await renewedReader(f.bob.address,f.start+1),true);
  await f.stopServer();await f.startServer();
  const persisted=await f.call('status?wallet='+f.alice.address);assert.equal(persisted.data.activityCurrent,true);assert.equal(persisted.data.requirementActive,true);
  assert.equal(readDailyActivity({file:f.file,...f.identity}).records.length,3);
 }finally{await f.cleanup();}
});

test('repeated clicks retain history without renewing its timestamp or duplicating proof',async()=>{
 const f=await fixture();try{
  const first=await f.checkIn();f.advance(10);const repeated=await f.checkIn();
  assert.equal(repeated.status,200);assert.equal(repeated.data.alreadyRecorded,true);assert.equal(repeated.data.activeUntil,first.data.activeUntil);assert.equal(readDailyActivity({file:f.file,...f.identity}).records.length,1);
  f.advance(3601);const renewed=await f.checkIn();assert.equal(renewed.status,201);assert.equal(readDailyActivity({file:f.file,...f.identity}).records.length,2);
 }finally{await f.cleanup();}
});

test('a reorg or tampered private history fails closed before eligibility is returned',async()=>{
 const f=await fixture();try{
  await f.checkIn();const state=readDailyActivity({file:f.file,...f.identity});
  const reader=createDailyActivityReader({state,...f.identity,provider:f.provider});f.reorg(f.baseBlock);
  await assert.rejects(reader(f.alice.address,f.start+1),/BLOCK_REORG/);
  assert.equal((await f.call('status?wallet='+f.alice.address)).status,503);
  const tampered=structuredClone(state);tampered.records[0].wallet=f.bob.address;await writeFile(f.file,JSON.stringify(tampered),{mode:0o600});
  assert.throws(()=>readDailyActivity({file:f.file,...f.identity}),/SIGNATURE_INVALID/);
  await writeFile(f.file,JSON.stringify(state));await chmod(f.file,0o644);assert.throws(()=>readDailyActivity({file:f.file,...f.identity}),/PRIVATE_HISTORY/);
 }finally{await f.cleanup();}
});

test('a fixed history snapshot rereads canonical evidence for later guards and validates each expected timestamp',async()=>{
 const f=await fixture();try{
  await f.checkIn();const state=readDailyActivity({file:f.file,...f.identity});let reads=0;
  const provider={getBlock:async number=>{reads++;return f.provider.getBlock(number);}};
  const reader=createDailyActivityReader({state,...f.identity,provider});
  assert.deepEqual(await Promise.all([reader(f.alice.address,f.start+1),reader(f.alice.address,f.start+1)]),[true,true]);
  assert.equal(reads,1); // Concurrent reads share the response, not its verdict.
  f.reorg(f.baseBlock);await assert.rejects(reader(f.alice.address,f.start+1),/BLOCK_REORG/);
  assert.equal(reads,2);
  f.reorg(null);assert.equal(await reader(f.alice.address,f.start+1),true);assert.equal(reads,3);
  const tampered=structuredClone(state);tampered.records[0].block.timestamp++;
  const wrongTime=createDailyActivityReader({state:tampered,...f.identity,provider});
  await assert.rejects(wrongTime(f.alice.address,f.start+1),/BLOCK_REORG/);
 }finally{await f.cleanup();}
});

test('a disabled payout requirement can collect activity without claiming the gate is active',async()=>{
 const f=await fixture();try{
  await f.stopServer();await f.startServer({policy:null});
  const result=await f.checkIn();assert.equal(result.data.recorded,true);assert.equal(result.data.requirementEnabled,false);assert.equal(result.data.requirementActive,false);assert.equal(result.data.activationTimestamp,null);
  const stored=JSON.parse(await readFile(f.file,'utf8'));assert.equal(stored.records.length,1);
 }finally{await f.cleanup();}
});

test('cached validation cannot be poisoned by caller mutations and notices disk replacement or unsafe modes',async()=>{
 const f=await fixture();try{
  await f.checkIn();
  const first=readDailyActivity({file:f.file,...f.identity});first.records.length=0;first.vaultAddress=f.bob.address;
  const second=readDailyActivity({file:f.file,...f.identity});assert.equal(second.records.length,1);assert.equal(second.vaultAddress,f.identity.vaultAddress);
  const immutable=readDailyActivity({file:f.file,immutable:true,...f.identity});assert.equal(Object.isFrozen(immutable),true);assert.equal(Object.isFrozen(immutable.records[0].block),true);
  assert.throws(()=>{immutable.records[0].wallet=f.bob.address;},TypeError);
  await chmod(f.file,0o640);assert.throws(()=>readDailyActivity({file:f.file,...f.identity}),/PRIVATE_HISTORY/);await chmod(f.file,0o600);
  const tampered=structuredClone(second);tampered.records[0].nonce='ff'.repeat(24);await writeFile(f.file,JSON.stringify(tampered));
  assert.throws(()=>readDailyActivity({file:f.file,...f.identity}),/SIGNATURE_INVALID/);
 }finally{await f.cleanup();}
});
