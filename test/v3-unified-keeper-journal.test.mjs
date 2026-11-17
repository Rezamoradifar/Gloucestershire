import assert from 'node:assert/strict';
import fs from 'node:fs';
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
