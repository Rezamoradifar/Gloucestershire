import {randomBytes,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {mkdir,open,lstat,rename,unlink,link} from 'node:fs/promises';
import path from 'node:path';
import {isIP} from 'node:net';
import {getAddress,verifyMessage,ZeroAddress} from 'ethers';
import {createDailyActivityState,dailyActivityIdentity,dailyActivityMessage,validateDailyActivityRecord,readDailyActivity,validateDailyActivityPolicy,createDailyActivityReader,dailyActivityChallengeLifetimeMs,dailyActivityWindowSeconds,dailyActivityMaximumFileBytes} from '../scripts/daily-activity.mjs';

const fail=(status,message)=>Object.assign(Error(message),{status});
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const safe=value=>Number.isSafeInteger(value)&&value>0;
const mutationQueues=new Map();

// This is opt-in only: the reverse proxy must overwrite this header, and the
// API must be reachable solely by trusted local processes. Never trust XFF or
// Cloudflare headers here. Missing/malformed values retain the shared limit.
export function activityPeer(req,trustProxy=false){
 const peer=req.socket?.remoteAddress||'unknown';
 if(trustProxy&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)){
  const forwarded=req.headers['x-global-client-ip'];
  if(typeof forwarded==='string'&&isIP(forwarded))return forwarded.toLowerCase();
 }
 return peer;
}

async function syncDirectory(directory){const handle=await open(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{await handle.sync();}finally{await handle.close();}}
async function persist(file,value,{initialize=false}={}){
 const data=JSON.stringify(value);
 if(Buffer.byteLength(data)>dailyActivityMaximumFileBytes)throw fail(503,'Activity history needs maintenance. Existing check-ins have been preserved.');
 const temp=file+'.'+randomUUID()+'.tmp';let handle;
 try{
  handle=await open(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  await handle.writeFile(data,'utf8');await handle.sync();await handle.close();handle=null;
  if(initialize){try{await link(temp,file);}catch(error){if(error.code!=='EEXIST')throw error;}await unlink(temp);}
  else await rename(temp,file);
  await syncDirectory(path.dirname(file));
 }finally{if(handle)await handle.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

// The systemd service is the single history writer. Requests (including
// multiple handler instances in this process) serialize their durable writes.
export async function createDailyActivity({file,chainId,contract,origin='https://globaldroptrade.com',provider,vault,policy=null,now=Date.now,confirmations=3,trustProxy=false}){
 const identity=dailyActivityIdentity({chainId,vaultAddress:contract,origin});
 if(typeof file!=='string'||!path.isAbsolute(file)||!Number.isSafeInteger(confirmations)||confirmations<1||confirmations>64)throw Error('DAILY_ACTIVITY_CONFIGURATION_INVALID');
 file=path.resolve(file);
 if(!provider||!vault||typeof provider.getNetwork!=='function')throw Error('DAILY_ACTIVITY_PROVIDER_REQUIRED');
 if(policy){policy=validateDailyActivityPolicy(policy,identity);if(path.resolve(policy.historyFile)!==path.resolve(file))throw Error('DAILY_ACTIVITY_HISTORY_TARGET_MISMATCH');}
 const directory=path.dirname(file);await mkdir(directory,{recursive:true,mode:0o700});
 const directoryStat=await lstat(directory);
 if(!directoryStat.isDirectory()||(directoryStat.mode&0o077)!==0||directoryStat.uid!==process.getuid?.())throw Error('DAILY_ACTIVITY_PRIVATE_DIRECTORY_REQUIRED');
 try{readDailyActivity({file,...identity});}catch(error){if(error.code!=='ENOENT')throw error;await persist(file,createDailyActivityState(identity),{initialize:true});readDailyActivity({file,...identity});}
 const challenges=new Map(),rates=new Map();
 function prune(){
  const current=now();
  for(const [key,value] of challenges)if(value.expiresAt<=current)challenges.delete(key);
  for(const [key,value] of rates)if(value.expires<=current)rates.delete(key);
 }
 function rate(key,limit,windowMs=60000){
  prune();if(!rates.has(key)&&rates.size>=5000){
   const expiry=Math.min(...Array.from(rates.values(),entry=>entry.expires));
   throw Object.assign(fail(429,'Too many activity requests. Try again shortly.'),{retryAfterSeconds:Math.max(1,Math.ceil((expiry-now())/1000)),rateScope:'capacity'});
  }
  const value=rates.get(key)||{count:0,expires:now()+windowMs};value.count++;rates.set(key,value);
  if(value.count>limit)throw Object.assign(fail(429,'Too many activity requests. Try again shortly.'),{retryAfterSeconds:Math.max(1,Math.ceil((value.expires-now())/1000)),rateScope:key.startsWith('wallet:')?'wallet':'connection'});
 }
 function originAllowed(req){
  const sent=req.headers.origin;
  const allowed=new Set([origin]);if(origin==='https://globaldroptrade.com')allowed.add('https://www.globaldroptrade.com');
  if(sent!==undefined&&(typeof sent!=='string'||!allowed.has(sent)))throw fail(403,'This request belongs to a different website.');
  if(sent===undefined&&req.headers['sec-fetch-site']==='cross-site')throw fail(403,'This request belongs to a different website.');
 }
 async function body(req,keys){
  let size=0;const parts=[];
  for await(const chunk of req){size+=chunk.length;if(size>4096)throw fail(413,'Activity request is too large.');parts.push(chunk);}
  let value;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw fail(400,'Invalid activity request.');}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw fail(400,'Invalid activity request.');
  return value;
 }
 function wallet(value){try{const address=getAddress(value);if(address===ZeroAddress)throw Error();return address;}catch{throw fail(400,'Enter a valid wallet address.');}}
 async function currentBlock(){
  const network=await provider.getNetwork();
  if(Number(network.chainId)!==chainId||getAddress(await vault.getAddress())!==identity.vaultAddress)throw Error('DAILY_ACTIVITY_TARGET_MISMATCH');
  const head=await provider.getBlockNumber(),number=head-confirmations;
  if(!safe(number))throw Error('DAILY_ACTIVITY_CANONICAL_BLOCK_UNAVAILABLE');
  const value=await provider.getBlock(number),seconds=Math.floor(now()/1000);
  if(!value||value.number!==number||!safe(value.timestamp)||!hash(value.hash)||value.timestamp>seconds+30||value.timestamp<seconds-300)throw Error('DAILY_ACTIVITY_CANONICAL_BLOCK_UNAVAILABLE');
  return {number:value.number,hash:value.hash.toLowerCase(),timestamp:value.timestamp};
 }
 async function registered(who,at){if(!(await vault.users(who,{blockTag:at.number}))?.registered)throw fail(409,'Register this wallet on the connected contract before checking in.');}
 function mutate(action){
  const previous=mutationQueues.get(file)||Promise.resolve();
  const result=previous.then(async()=>{
   const state=readDailyActivity({file,...identity}),value=await action(state);
   if(value.changed)await persist(file,state);
   return {state,...value};
  });
  const tail=result.catch(()=>{});mutationQueues.set(file,tail);void tail.finally(()=>{if(mutationQueues.get(file)===tail)mutationQueues.delete(file);});
  return result;
 }
 async function status(who,state=readDailyActivity({file,immutable:true,...identity})){
  const currentTime=now(),seconds=Math.floor(currentTime/1000);
  const eligible=createDailyActivityReader({provider,state,...identity});
  const evidence=await eligible.evidence(who,seconds+1);
  const latest=state.records.filter(row=>row.wallet===who&&row.receivedAt<=currentTime).sort((a,b)=>b.block.timestamp-a.block.timestamp||b.receivedAt-a.receivedAt)[0];
  const activeUntil=evidence?evidence.block.timestamp+dailyActivityWindowSeconds:null;
  return {version:1,...identity,wallet:who,windowSeconds:dailyActivityWindowSeconds,requirementEnabled:Boolean(policy),activationTimestamp:policy?.activationTimestamp??null,requirementActive:Boolean(policy&&seconds>=policy.activationTimestamp),activityCurrent:Boolean(activeUntil&&activeUntil>seconds),lastCheckInAt:latest?.block.timestamp??null,activeUntil,nextCheckInAt:latest?latest.block.timestamp+3600:null,checkedAt:new Date(currentTime).toISOString()};
 }
 return async function handle(req,res){
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/daily-activity/'))return false;
  const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  try{
   originAllowed(req);prune();
   const route=url.pathname.slice('/api/daily-activity/'.length),peer=activityPeer(req,trustProxy);
   rate('peer:'+peer,600);
   if(route==='status'&&req.method==='GET'){const who=wallet(url.searchParams.get('wallet'));send(200,await status(who));return true;}
   if(route==='challenge'&&req.method==='POST'){
    const input=await body(req,['wallet']),who=wallet(input.wallet);rate('wallet:'+who,12,3600000);
    if(challenges.size>=1000)throw fail(429,'Too many pending activity requests. Try again shortly.');
    const at=await currentBlock();await registered(who,at);
    const issuedAt=now(),challenge={...identity,wallet:who,nonce:randomBytes(24).toString('hex'),issuedAt,expiresAt:issuedAt+dailyActivityChallengeLifetimeMs,issuedBlock:at};
    const message=dailyActivityMessage(challenge);challenges.set(challenge.nonce,challenge);
    send(200,{...challenge,message,windowSeconds:dailyActivityWindowSeconds});return true;
   }
   if(route==='check-in'&&req.method==='POST'){
    const input=await body(req,['nonce','signature']);
    const challenge=challenges.get(input.nonce);challenges.delete(input.nonce);
    if(!challenge||challenge.expiresAt<=now())throw fail(401,'Activity request expired or was already used. Try checking in again.');
    let signer;try{signer=verifyMessage(dailyActivityMessage(challenge),input.signature);}catch{throw fail(401,'The activity signature is invalid.');}
    if(signer!==challenge.wallet)throw fail(401,'The activity signature does not match your wallet.');
    const at=await currentBlock();await registered(challenge.wallet,at);
    const issued=await provider.getBlock(challenge.issuedBlock.number);
    if(issued?.hash?.toLowerCase()!==challenge.issuedBlock.hash||issued?.timestamp!==challenge.issuedBlock.timestamp)throw fail(409,'The chain changed while checking in. Please try again.');
    const result=await mutate(async state=>{
     const receivedAt=now();if(receivedAt>=challenge.expiresAt)throw fail(401,'Activity request expired. Try checking in again.');
     if(state.records.some(row=>row.nonce===challenge.nonce))throw fail(401,'This activity request was already recorded.');
     // Repeated clicks cannot flood the durable history or erase older proof.
     const previous=state.records.filter(row=>row.wallet===challenge.wallet).sort((a,b)=>b.block.timestamp-a.block.timestamp)[0];
     if(previous&&at.timestamp-previous.block.timestamp<3600&&at.timestamp>=previous.block.timestamp){
      const previousBlock=await provider.getBlock(previous.block.number);
      if(!previousBlock)throw Error('DAILY_ACTIVITY_CANONICAL_BLOCK_UNAVAILABLE');
      if(previousBlock.hash?.toLowerCase()===previous.block.hash&&previousBlock.timestamp===previous.block.timestamp)return {changed:false,alreadyRecorded:true};
     }
     if(state.records.length>=100000)throw fail(503,'Activity history needs maintenance. Existing check-ins have been preserved.');
     const record=validateDailyActivityRecord({...challenge,block:at,receivedAt,signature:input.signature},identity);
     state.records.push(record);return {changed:true,alreadyRecorded:false};
    });
    send(result.changed?201:200,{...await status(challenge.wallet),recorded:true,alreadyRecorded:result.alreadyRecorded});return true;
   }
   if(['status','challenge','check-in'].includes(route)){res.setHeader('Allow',route==='status'?'GET':'POST');throw fail(405,'This activity method is not supported.');}
   throw fail(404,'Activity route not found.');
  }catch(error){
   const retry=error.status===429&&Number.isSafeInteger(error.retryAfterSeconds)&&error.retryAfterSeconds>0&&error.retryAfterSeconds<=3600?error.retryAfterSeconds:null;
   if(retry)res.setHeader('Retry-After',String(retry));
   send(error.status||503,{error:error.status?error.message:'Daily activity is temporarily unavailable. Your previous check-ins are preserved.',...(retry?{retryAfterSeconds:retry,rateScope:error.rateScope}:{})});
  }
  return true;
 };
}
