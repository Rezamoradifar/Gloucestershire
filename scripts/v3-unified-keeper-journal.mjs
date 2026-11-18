// Private, fail-closed journal for the experimental testnet keeper. A stale
// legacy lock or an unresolved record deliberately requires operator inspection.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const HASH=/^0x[0-9a-fA-F]{64}$/;
export function openUnifiedJournal(directory){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||path.resolve(directory)==='/')
  throw Error('UNIFIED_JOURNAL_PATH_REQUIRED');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const resolved=fs.realpathSync(directory),stat=fs.lstatSync(directory);
 if(resolved!==path.resolve(directory)||!stat.isDirectory()||stat.isSymbolicLink()||
    stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error('UNIFIED_JOURNAL_DIRECTORY_NOT_PRIVATE');
 const filename=path.join(directory,'pending.json');
 const syncDirectory=()=>{const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 // flock is attached to the inherited open file description. The parent keeps
 // it after the helper exits; the kernel releases it if the parent is killed.
 const lockName='keeper.flock';
 const fdFlags=fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW;
 const descriptor=fs.openSync(path.join(directory,lockName),fdFlags,0o600);
 try{
  const stat=fs.fstatSync(descriptor);
  if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||stat.nlink!==1)
   throw Error('UNIFIED_JOURNAL_LOCK_NOT_PRIVATE');
  const lock=spawnSync('/usr/bin/flock',['--exclusive','--nonblock','--conflict-exit-code','75','3'],
   {stdio:['ignore','ignore','ignore',descriptor]});
  if(lock.error||lock.status!==0)
   throw Error(lock.status===75?'UNIFIED_KEEPER_LOCK_EXISTS_INSPECT_BEFORE_RETRY':'UNIFIED_KERNEL_LOCK_FAILED');
  // Older binaries use O_EXCL on keeper.lock. A permanent marker prevents
  // them from running beside this version. Never replace a pre-existing PID file.
  const legacy=path.join(directory,'keeper.lock');
  try{fs.symlinkSync(lockName,legacy);syncDirectory();}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   if(!fs.lstatSync(legacy).isSymbolicLink()||fs.readlinkSync(legacy)!==lockName)
    throw Error('UNIFIED_LEGACY_KEEPER_LOCK_EXISTS_INSPECT_BEFORE_RETRY');
  }
 }catch(error){fs.closeSync(descriptor);throw error;}
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
  // Confirmation is not a durable cursor checkpoint and may be reorganized.
  // No existing record may be overwritten until the cycle reconciles it.
  if(old)throw Error('UNIFIED_PREVIOUS_TRANSACTION_NEEDS_REVIEW');
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
 function archiveConfirmed(hash){
  const current=read();
  if(current?.hash!==hash||current.status!=='CONFIRMED'||
     !['accrueDaily','accrueReinvestmentPage'].includes(current.method))
   throw Error('UNIFIED_JOURNAL_STATE_MISMATCH');
  fs.renameSync(filename,path.join(directory,'last-confirmed-accrual.json'));
  syncDirectory();
 }
 function close(){
  if(closed)return;
  closed=true;fs.closeSync(descriptor);
 }
 return {read,prepare,markBroadcast:hash=>transition(hash,'BROADCAST'),
  markConfirmed:hash=>transition(hash,'CONFIRMED'),archiveConfirmed,close};
}
