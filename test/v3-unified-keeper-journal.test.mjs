import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {openUnifiedJournal} from '../scripts/v3-unified-keeper-journal.mjs';

const hash='0x'+'ab'.repeat(32);
const record={status:'PREPARED',chainId:97,hash,nonce:7};
const withDirectory=async fn=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unified-journal-test-'));
 try{await fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
};

test('journal serializes one keeper and blocks reuse after uncertain broadcast',()=>withDirectory(dir=>{
 const first=openUnifiedJournal(dir);
 assert.equal(first.read(),null);
 assert.throws(()=>openUnifiedJournal(dir),/LOCK_EXISTS/);
 first.prepare(record);
 assert.equal(first.read().status,'PREPARED');
 first.close();
 const second=openUnifiedJournal(dir);
 assert.throws(()=>second.prepare({...record,nonce:8}),/NEEDS_REVIEW/);
 assert.throws(()=>second.markBroadcast('0x'+'cd'.repeat(32)),/STATE_MISMATCH/);
 second.markBroadcast(hash);
 assert.equal(second.read().status,'BROADCAST');
 second.markConfirmed(hash);
 assert.equal(second.read().status,'CONFIRMED');
 assert.throws(()=>second.prepare({...record,nonce:8}),/NEEDS_REVIEW/);
 assert.equal(second.read().nonce,7);
 second.close();
}));

test('journal rejects shared directories, symlinks, and unsafe records',()=>withDirectory(dir=>{
 fs.chmodSync(dir,0o755);
 assert.throws(()=>openUnifiedJournal(dir),/DIRECTORY_NOT_PRIVATE/);
 fs.chmodSync(dir,0o700);
 const link=dir+'-link';
 try{
  fs.symlinkSync(dir,link);
  assert.throws(()=>openUnifiedJournal(link),/DIRECTORY_NOT_PRIVATE/);
 }finally{fs.unlinkSync(link);}
 const journal=openUnifiedJournal(dir);
 fs.writeFileSync(path.join(dir,'pending.json'),JSON.stringify(record),{mode:0o644});
 assert.throws(()=>journal.read(),/RECORD_NOT_PRIVATE/);
 fs.chmodSync(path.join(dir,'pending.json'),0o600);
 fs.writeFileSync(path.join(dir,'pending.json'),JSON.stringify({...record,chainId:56}));
 assert.throws(()=>journal.read(),/RECORD_INVALID/);
 journal.close();
}));


test('kernel releases the lock on SIGKILL and preserves the prepared intent',()=>withDirectory(async dir=>{
 const moduleUrl=new URL('../scripts/v3-unified-keeper-journal.mjs',import.meta.url).href;
 const code=`import {openUnifiedJournal} from ${JSON.stringify(moduleUrl)};
  const journal=openUnifiedJournal(process.argv[1]);
  journal.prepare(JSON.parse(process.argv[2]));
  process.send('locked');
  setInterval(()=>{},60000);`;
 const child=spawn(process.execPath,['--input-type=module','-e',code,dir,JSON.stringify(record)],
  {stdio:['ignore','ignore','inherit','ipc']});
 const exited=once(child,'exit');
 try{
  const [state]=await Promise.race([once(child,'message'),exited]);
  assert.equal(state,'locked');
  assert.throws(()=>openUnifiedJournal(dir),/LOCK_EXISTS/);
 }finally{child.kill('SIGKILL');await exited;}
 const next=openUnifiedJournal(dir);
 try{
  assert.deepEqual(next.read(),record);
  assert.throws(()=>fs.openSync(path.join(dir,'keeper.lock'),'wx'),{code:'EEXIST'});
 }finally{next.close();}
}));

test('existing legacy PID lock is preserved for inspection',()=>withDirectory(dir=>{
 const legacy=path.join(dir,'keeper.lock');
 fs.writeFileSync(legacy,'1234',{mode:0o600});
 assert.throws(()=>openUnifiedJournal(dir),/LEGACY_KEEPER_LOCK_EXISTS/);
 assert.equal(fs.readFileSync(legacy,'utf8'),'1234');
}));
