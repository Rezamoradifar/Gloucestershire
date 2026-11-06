// Signed, target-bound activity history. Reading a history never records activity.
import fs from 'node:fs';
import path from 'node:path';
import {getAddress,verifyMessage,ZeroAddress} from 'ethers';

export const dailyActivityWindowSeconds=86400;
export const dailyActivityChallengeLifetimeMs=300000;
export const dailyActivityMaximumFileBytes=128*1024*1024;
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const safe=value=>Number.isSafeInteger(value)&&value>0;
const fail=code=>{throw Error(code);};
const address=value=>{try{const a=getAddress(value);if(a===ZeroAddress)throw Error();return a;}catch{return fail('DAILY_ACTIVITY_ADDRESS_INVALID');}};
const historyCache=new Map(),trustedHistories=new WeakSet(),walletIndexes=new WeakMap();
const fingerprint=stat=>['dev','ino','size','mtimeNs','ctimeNs','uid','gid','mode','nlink'].map(key=>String(stat[key])).join(':');
function freezeHistory(state){
 for(const row of state.records){Object.freeze(row.issuedBlock);Object.freeze(row.block);Object.freeze(row);}
 Object.freeze(state.records);Object.freeze(state);trustedHistories.add(state);return state;
}

export function dailyActivityIdentity({chainId,vaultAddress,origin='https://globaldroptrade.com'}){
 if(![56,97].includes(chainId))fail('DAILY_ACTIVITY_CHAIN_INVALID');
 let url;try{url=new URL(origin);}catch{fail('DAILY_ACTIVITY_ORIGIN_INVALID');}
 if(!['http:','https:'].includes(url.protocol)||url.origin!==origin||url.username||url.password)fail('DAILY_ACTIVITY_ORIGIN_INVALID');
 return {chainId,vaultAddress:address(vaultAddress),origin};
}

export function createDailyActivityState(identity){
 return {version:1,...dailyActivityIdentity(identity),windowSeconds:dailyActivityWindowSeconds,records:[]};
}

function block(value){
 if(!value||!safe(value.number)||!safe(value.timestamp)||!hash(value.hash))fail('DAILY_ACTIVITY_BLOCK_INVALID');
 return {number:value.number,hash:value.hash.toLowerCase(),timestamp:value.timestamp};
}

export function validateDailyActivityChallenge(value,identity){
 const target=dailyActivityIdentity(value);
 if(identity){const expected=dailyActivityIdentity(identity);if(Object.keys(expected).some(key=>target[key]!==expected[key]))fail('DAILY_ACTIVITY_TARGET_MISMATCH');}
 if(!/^[0-9a-f]{48}$/.test(value.nonce||'')||!safe(value.issuedAt)||!safe(value.expiresAt)||value.expiresAt-value.issuedAt!==dailyActivityChallengeLifetimeMs)fail('DAILY_ACTIVITY_CHALLENGE_INVALID');
 const issuedBlock=block(value.issuedBlock);
 if(issuedBlock.timestamp>Math.floor(value.issuedAt/1000)+30||issuedBlock.timestamp<Math.floor(value.issuedAt/1000)-300)fail('DAILY_ACTIVITY_CHALLENGE_BLOCK_STALE');
 return {...target,wallet:address(value.wallet),nonce:value.nonce,issuedAt:value.issuedAt,expiresAt:value.expiresAt,issuedBlock};
}

export function dailyActivityMessage(value){
 const c=validateDailyActivityChallenge(value);
 return [
  'GlobalDropTrade daily activity',`Origin: ${c.origin}`,`Chain: ${c.chainId}`,
  `Contract: ${c.vaultAddress}`,`Wallet: ${c.wallet}`,`Nonce: ${c.nonce}`,
  `Issued: ${new Date(c.issuedAt).toISOString()}`,`Expires: ${new Date(c.expiresAt).toISOString()}`,
  `Block: ${c.issuedBlock.number}`,`Block hash: ${c.issuedBlock.hash}`,`Block time: ${c.issuedBlock.timestamp}`,
  `Activity window: ${dailyActivityWindowSeconds} seconds`,
  'This signature records a daily check-in only. It does not authorize a transaction or transfer.'
 ].join('\n');
}

export function validateDailyActivityRecord(value,identity){
 const challenge=validateDailyActivityChallenge(value,identity),acceptedBlock=block(value.block);
 if(!safe(value.receivedAt)||value.receivedAt<challenge.issuedAt||value.receivedAt>=challenge.expiresAt)fail('DAILY_ACTIVITY_RECEIPT_TIME_INVALID');
 if(acceptedBlock.number<challenge.issuedBlock.number||acceptedBlock.timestamp<challenge.issuedBlock.timestamp||acceptedBlock.timestamp>Math.floor(value.receivedAt/1000)+30||acceptedBlock.timestamp<Math.floor(value.receivedAt/1000)-300)fail('DAILY_ACTIVITY_RECEIPT_BLOCK_INVALID');
 if(typeof value.signature!=='string'||!/^0x(?:[0-9a-f]{128}|[0-9a-f]{130})$/i.test(value.signature))fail('DAILY_ACTIVITY_SIGNATURE_INVALID');
 let signer;try{signer=verifyMessage(dailyActivityMessage(challenge),value.signature);}catch{fail('DAILY_ACTIVITY_SIGNATURE_INVALID');}
 if(signer!==challenge.wallet)fail('DAILY_ACTIVITY_SIGNATURE_INVALID');
 return {...challenge,block:acceptedBlock,receivedAt:value.receivedAt,signature:value.signature};
}

export function validateDailyActivityState(value,identity){
 const expected=dailyActivityIdentity(identity||value);
 if(value?.version!==1||value.windowSeconds!==dailyActivityWindowSeconds||!Array.isArray(value.records)||value.records.length>100000)fail('DAILY_ACTIVITY_HISTORY_INVALID');
 const actual=dailyActivityIdentity(value);
 if(Object.keys(expected).some(key=>actual[key]!==expected[key]))fail('DAILY_ACTIVITY_TARGET_MISMATCH');
 const nonces=new Set();
 const records=value.records.map(row=>{
  const record=validateDailyActivityRecord(row,expected);
  if(nonces.has(record.nonce))fail('DAILY_ACTIVITY_DUPLICATE_NONCE');
  nonces.add(record.nonce);return record;
 });
 return {version:1,...expected,windowSeconds:dailyActivityWindowSeconds,records};
}

export function validateDailyActivityPolicy(value,identity){
 const expected=dailyActivityIdentity(identity||value),actual=dailyActivityIdentity(value);
 if(value.version!==1||value.windowSeconds!==dailyActivityWindowSeconds||!safe(value.activationTimestamp)||typeof value.historyFile!=='string'||!path.isAbsolute(value.historyFile))fail('DAILY_ACTIVITY_POLICY_INVALID');
 if(Object.keys(expected).some(key=>actual[key]!==expected[key]))fail('DAILY_ACTIVITY_TARGET_MISMATCH');
 return {...value,...expected};
}

export function readDailyActivity({file,immutable=false,...identity}){
 if(typeof file!=='string'||!path.isAbsolute(file))fail('DAILY_ACTIVITY_HISTORY_PATH_REQUIRED');
 const directory=fs.lstatSync(path.dirname(file));
 if(!directory.isDirectory()||(directory.mode&0o022)!==0)fail('DAILY_ACTIVITY_PRIVATE_DIRECTORY_REQUIRED');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd,{bigint:true});
  if(!stat.isFile()||stat.nlink!==1n||stat.uid!==BigInt(directory.uid)||(stat.mode&0o077n)!==0n||stat.size>BigInt(dailyActivityMaximumFileBytes))fail('DAILY_ACTIVITY_PRIVATE_HISTORY_REQUIRED');
  const target=dailyActivityIdentity(identity),key=path.resolve(file)+'|'+JSON.stringify(target),mark=fingerprint(stat),cached=historyCache.get(key);
  if(cached?.mark===mark)return immutable?cached.state:structuredClone(cached.state);
  let value;try{value=JSON.parse(fs.readFileSync(fd,'utf8'));}catch{fail('DAILY_ACTIVITY_HISTORY_INVALID');}
  if(fingerprint(fs.fstatSync(fd,{bigint:true}))!==mark)fail('DAILY_ACTIVITY_HISTORY_CHANGED_DURING_READ');
  const state=freezeHistory(validateDailyActivityState(value,target));
  if(historyCache.size>=8)historyCache.delete(historyCache.keys().next().value);
  historyCache.set(key,{mark,state});
  return immutable?state:structuredClone(state);
 }finally{fs.closeSync(fd);}
}

// Hold one immutable history snapshot for a worker cycle. New check-ins never
// change the recipients of a plan that is already being processed.
export function createDailyActivityReader({provider,state,file,...identity}){
 let history;
 if(state&&trustedHistories.has(state)){
  const target=dailyActivityIdentity(identity),actual=dailyActivityIdentity(state);
  if(Object.keys(target).some(key=>target[key]!==actual[key]))fail('DAILY_ACTIVITY_TARGET_MISMATCH');
  history=state;
 }else history=state?freezeHistory(validateDailyActivityState(state,identity)):readDailyActivity({file,immutable:true,...identity});
 if(!provider||typeof provider.getBlock!=='function')fail('DAILY_ACTIVITY_PROVIDER_REQUIRED');
 let byWallet=walletIndexes.get(history);
 if(!byWallet){
  byWallet=new Map();
  for(const row of history.records){const records=byWallet.get(row.wallet)||[];records.push(row);byWallet.set(row.wallet,records);}
  for(const rows of byWallet.values())rows.sort((a,b)=>b.block.timestamp-a.block.timestamp||b.receivedAt-a.receivedAt);
  walletIndexes.set(history,byWallet);
 }
 const blocks=new Map();
 const canonical=async expected=>{
  // Share only an in-flight RPC read. Later transaction guards must see a
  // reorg, and every record must independently match the returned timestamp.
  const key=expected.number;
  if(!blocks.has(key))blocks.set(key,Promise.resolve().then(()=>provider.getBlock(key)));
  const pending=blocks.get(key);
  try{
   const current=await pending;
   if(!current)fail('DAILY_ACTIVITY_CANONICAL_BLOCK_UNAVAILABLE');
   if(current.number!==expected.number||current.hash?.toLowerCase()!==expected.hash||current.timestamp!==expected.timestamp)fail('DAILY_ACTIVITY_BLOCK_REORG');
   return true;
  }finally{if(blocks.get(key)===pending)blocks.delete(key);}
 };
 const evidence=async(wallet,periodEnd)=>{
  if(!safe(periodEnd))fail('DAILY_ACTIVITY_PERIOD_END_REQUIRED');
  for(const row of byWallet.get(address(wallet))||[]){
   if(row.block.timestamp<periodEnd-dailyActivityWindowSeconds||row.block.timestamp>=periodEnd||row.receivedAt>=periodEnd*1000)continue;
   await Promise.all([canonical(row.issuedBlock),canonical(row.block)]);return row;
  }
  return null;
 };
 const eligible=async(wallet,periodEnd)=>Boolean(await evidence(wallet,periodEnd));
 eligible.evidence=evidence;
 eligible.identity=Object.freeze(dailyActivityIdentity(history));
 eligible.recordCount=history.records.length;
 return eligible;
}
