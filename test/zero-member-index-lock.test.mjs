import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const moduleFile=fileURLToPath(new URL('../scripts/repair-zero-member-index.mjs',import.meta.url));
const run=(file,fd)=>spawnSync(process.execPath,['--input-type=module','-e',`import {assertZeroMemberIndexRunLock} from ${JSON.stringify(moduleFile)};try{assertZeroMemberIndexRunLock(process.argv[1]);process.stdout.write('LOCK_HELD');}catch(error){process.stdout.write(error.message);process.exitCode=1;}`,file],{encoding:'utf8',stdio:['ignore','pipe','pipe','ignore','ignore','ignore',fd]});
const unlocked=file=>spawnSync('flock',['-n',file,'true'],{stdio:'ignore'}).status===0;

test('inherited FD6 acquires the exact private run lock and retains exclusivity through its original descriptor',{skip:process.getuid?.()!==0},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zero-member-index-lock-')),file=path.join(dir,'run.lock');let fd;
 try{
  fd=fs.openSync(file,'a+',0o600);const result=run(file,fd);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'LOCK_HELD');
  assert.equal(unlocked(file),false,'The shared open-file-description remains locked after the confirming child exits');
  fs.closeSync(fd);fd=undefined;assert.equal(unlocked(file),true);
 }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(dir,{recursive:true,force:true});}
});

test('an unlocked matching FD6 cannot authorize repair while another open-file-description holds the lock',{skip:process.getuid?.()!==0},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zero-member-index-lock-')),file=path.join(dir,'run.lock');let fd,holder;
 try{
  fd=fs.openSync(file,'a+',0o600);
  holder=spawn('python3',['-u','-c','import fcntl,sys; f=open(sys.argv[1],"a+"); fcntl.flock(f,fcntl.LOCK_EX); print("READY",flush=True); sys.stdin.read()',file],{stdio:['pipe','pipe','pipe']});
  await new Promise((resolve,reject)=>{holder.stdout.once('data',data=>data.toString().includes('READY')?resolve():reject(Error('LOCK_FIXTURE_NOT_READY')));holder.once('error',reject);holder.once('exit',code=>reject(Error('LOCK_FIXTURE_EXITED_'+code)));});
  const result=run(file,fd);assert.equal(result.status,1);assert.equal(result.stdout,'MEMBER_INDEX_REPAIR_HELD_RUN_LOCK_REQUIRED');assert.equal(unlocked(file),false);
 }finally{if(holder){holder.stdin.end();await new Promise(resolve=>holder.once('exit',resolve));}if(fd!==undefined)fs.closeSync(fd);fs.rmSync(dir,{recursive:true,force:true});}
});

test('a replaced inode, symlink or public run-lock file or directory never authorizes repair',{skip:process.getuid?.()!==0},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zero-member-index-lock-')),file=path.join(dir,'run.lock');let fd;
 try{
  fd=fs.openSync(file,'a+',0o600);fs.renameSync(file,file+'.old');fs.writeFileSync(file,'',{mode:0o600});
  assert.equal(run(file,fd).stdout,'MEMBER_INDEX_REPAIR_HELD_RUN_LOCK_REQUIRED');
  fs.unlinkSync(file);fs.symlinkSync(file+'.old',file);assert.equal(run(file,fd).stdout,'MEMBER_INDEX_REPAIR_HELD_RUN_LOCK_REQUIRED');
  fs.unlinkSync(file);fs.renameSync(file+'.old',file);fs.chmodSync(file,0o644);assert.equal(run(file,fd).stdout,'MEMBER_INDEX_REPAIR_HELD_RUN_LOCK_REQUIRED');
  fs.chmodSync(file,0o600);fs.chmodSync(dir,0o750);assert.equal(run(file,fd).stdout,'MEMBER_INDEX_REPAIR_HELD_RUN_LOCK_REQUIRED');fs.chmodSync(dir,0o700);
  fs.symlinkSync(dir,dir+'-alias');assert.equal(run(path.join(dir+'-alias','run.lock'),fd).stdout,'MEMBER_INDEX_REPAIR_HELD_RUN_LOCK_REQUIRED');
 }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(dir+'-alias',{force:true});fs.rmSync(dir,{recursive:true,force:true});}
});
