// Private, fail-closed journal for the experimental testnet keeper. A stale
// lock or an unresolved record deliberately requires operator inspection.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

const HASH=/^0x[0-9a-fA-F]{64}$/;
export function openUnifiedJournal(directory){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||path.resolve(directory)==='/')
  throw Error('UNIFIED_JOURNAL_PATH_REQUIRED');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const resolved=fs.realpathSync(directory),stat=fs.lstatSync(directory);
 if(resolved!==path.resolve(directory)||!stat.isDirectory()||stat.isSymbolicLink()||
    stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error('UNIFIED_JOURNAL_DIRECTORY_NOT_PRIVATE');
 const lock=path.join(directory,'keeper.lock'),filename=path.join(directory,'pending.json');
 let descriptor;
 try{descriptor=fs.openSync(lock,'wx',0o600);}catch(error){
  if(error?.code==='EEXIST')throw Error('UNIFIED_KEEPER_LOCK_EXISTS_INSPECT_BEFORE_RETRY');
  throw error;
 }
 fs.writeFileSync(descriptor,String(process.pid)+'\n');fs.fsyncSync(descriptor);
 const own=fs.fstatSync(descriptor);
 const syncDirectory=()=>{const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 syncDirectory();
 let closed=false;
 function read(){
  if(closed)throw Error('UNIFIED_JOURNAL_CLOSED');
  let file;
  try{file=fs.lstatSync(filename);}catch(error){if(error?.code==='ENOENT')return null;throw error;}
  if(!file.isFile()||file.isSymbolicLink()||file.uid!==process.getuid()||(file.mode&0o077)!==0||file.size>10000)
   throw Error('UNIFIED_JOURNAL_RECORD_NOT_PRIVATE');
  const value=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(!value||!['PREPARED','BROADCAST','CONFIRMED'].includes(value.status)||
     !HASH.test(String(value.hash))||value.chainId!==97||!Number.isSafeInteger(value.nonce)||value.nonce<0)
   throw Error('UNIFIED_JOURNAL_RECORD_INVALID');
  return value;
 }
 function write(value){
  const temporary=path.join(directory,'.pending-'+randomBytes(12).toString('hex'));
  let fd;
  try{
   fd=fs.openSync(temporary,'wx',0o600);
   fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
   fs.renameSync(temporary,filename);syncDirectory();
  }finally{
   if(fd!==undefined)fs.closeSync(fd);
   try{fs.unlinkSync(temporary);}catch(error){if(error?.code!=='ENOENT')throw error;}
  }
 }
 function prepare(record){
  const old=read();
  if(old&&old.status!=='CONFIRMED')throw Error('UNIFIED_PREVIOUS_TRANSACTION_NEEDS_REVIEW');
  if(!record||record.status!=='PREPARED'||record.chainId!==97||!HASH.test(String(record.hash))||
     !Number.isSafeInteger(record.nonce)||record.nonce<0)throw Error('UNIFIED_JOURNAL_RECORD_INVALID');
  write(record);
 }
 function transition(hash,status){
  const old=read();
  if(!old||old.hash.toLowerCase()!==String(hash).toLowerCase()||
    (status==='BROADCAST'&&old.status!=='PREPARED')||
    (status==='CONFIRMED'&&!['PREPARED','BROADCAST'].includes(old.status)))
   throw Error('UNIFIED_JOURNAL_STATE_MISMATCH');
  write({...old,status});
 }
 function close(){
  if(closed)return;
  closed=true;fs.closeSync(descriptor);
  const current=fs.lstatSync(lock);
  if(!current.isFile()||current.dev!==own.dev||current.ino!==own.ino)
   throw Error('UNIFIED_KEEPER_LOCK_CHANGED');
  fs.unlinkSync(lock);syncDirectory();
 }
 return {read,prepare,markBroadcast:hash=>transition(hash,'BROADCAST'),
  markConfirmed:hash=>transition(hash,'CONFIRMED'),close};
}
