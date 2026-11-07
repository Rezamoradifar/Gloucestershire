import fs from 'node:fs';
import path from 'node:path';
import {keccak256,toUtf8Bytes} from 'ethers';
import {validateDailyActivityPolicy,createDailyActivityReader} from './daily-activity.mjs';

const defaultPolicyFile='/etc/globaldroptrade/daily-activity-policy.json';
function privatePolicy(file){
 if(!path.isAbsolute(file))throw Error('DAILY_ACTIVITY_POLICY_PATH_REQUIRED');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const stat=fs.fstatSync(fd);
  // Entrypoints require root on the server; matching the executing worker also
  // permits isolated non-root tests without weakening deployed ownership.
  if(!stat.isFile()||stat.uid!==(process.getuid?.()??0)||stat.nlink!==1||(stat.mode&0o077)!==0||stat.size>16384)throw Error('DAILY_ACTIVITY_PRIVATE_POLICY_REQUIRED');
  return fs.readFileSync(fd,'utf8');
 }finally{fs.closeSync(fd);}
}

// The independent policy never rewrites the earning schedule or its journal.
// Once a journal has seen an enabled gate, removing it cannot silently restore
// unrestricted rewards. A running plan also detects policy changes before send.
export async function loadDailyActivityGate({provider,chainId,vaultAddress,state,save=()=>{},env=process.env,policyFile=defaultPolicyFile}){
 const explicit=env.GLOBAL_DAILY_ACTIVITY_POLICY;
 const file=explicit||policyFile;
 if(!explicit&&!fs.existsSync(file)){
  if(state?.activityPolicyBinding)throw Error('DAILY_ACTIVITY_POLICY_MISSING');
  return undefined;
 }
 let original;
 try{original=privatePolicy(file);}catch(error){
  if(error.code==='ENOENT')throw Error('DAILY_ACTIVITY_POLICY_MISSING');throw error;
 }
 let raw;try{raw=JSON.parse(original);}catch{throw Error('DAILY_ACTIVITY_POLICY_INVALID');}
 const policy=validateDailyActivityPolicy(raw,{chainId,vaultAddress,origin:raw.origin});
 const binding=keccak256(toUtf8Bytes(JSON.stringify({version:1,chainId:policy.chainId,vaultAddress:policy.vaultAddress,origin:policy.origin,
  windowSeconds:policy.windowSeconds,activationTimestamp:policy.activationTimestamp,historyFile:policy.historyFile})));
 if(state?.activityPolicyBinding&&state.activityPolicyBinding!==binding)throw Error('DAILY_ACTIVITY_POLICY_CHANGED');
 // Load the complete signed history before remembering the enabled gate.
 // An unavailable or corrupt history never becomes an empty eligible set.
 const read=createDailyActivityReader({provider,file:policy.historyFile,chainId:policy.chainId,vaultAddress:policy.vaultAddress,origin:policy.origin});
 const assertCurrent=()=>{
  let current;try{current=privatePolicy(file);}catch{throw Error('DAILY_ACTIVITY_POLICY_CHANGED');}
  if(current!==original)throw Error('DAILY_ACTIVITY_POLICY_CHANGED');
 };
 assertCurrent();
 if(state&&!state.activityPolicyBinding){state.activityPolicyBinding=binding;save();}
 return Object.freeze({binding,activationTimestamp:policy.activationTimestamp,assertCurrent,
  async eligible(member,{start,end}){
   assertCurrent();
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start)throw Error('DAILY_ACTIVITY_PERIOD_INVALID');
   if(start<policy.activationTimestamp)return true;
   return read(member,end);
  }});
}
