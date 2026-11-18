import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {combinedCycle, initializeWorkerKey} from '../scripts/run-v3-unified-worker.mjs';

function hooks(options = {}) {
  const events = [];
  const run = (name, result) => async () => { events.push(name); return result; };
  return {events, args:{hasAccrual:false, hasVolume:false,
    recoverVolume:run('recover',{status:'VOLUME_CONFIRMED'}), checkVolume:run('gate',{}),
    accrue:run('accrue',{state:'IDLE_CHECKPOINT_RECORDED'}), volume:run('volume',{status:'NO_DUE_VOLUME'}),...options}};
}

test('the common gate resolves pending work before another transaction', async () => {
  for (const [a,v,expected] of [[false,true,['recover']], [true,false,['gate','accrue']], [false,false,['gate','accrue','volume']]]) {
    const {events,args} = hooks({hasAccrual:a,hasVolume:v});
    await combinedCycle(args);
    assert.deepEqual(events,expected);
  }
  const {events,args} = hooks({hasAccrual:true,hasVolume:true});
  await assert.rejects(combinedCycle(args), /CONFLICTING_PENDING/);
  assert.deepEqual(events,[]);
});
test('an uncertain accrual or canonicality failure prevents another signature', async () => {
  const {events,args}=hooks({accrue:async()=>({state:'RECEIPT_NOT_OBSERVED'})});
  await combinedCycle(args);
  assert.deepEqual(events,['gate']);
  args.checkVolume=async()=>{throw Error('UNIFIED_CONFIRMED_BLOCK_CHANGED')};
  await assert.rejects(combinedCycle(args), /BLOCK_CHANGED/);
  assert.deepEqual(events,['gate']);
});
test('a worker restart retains its private signer and rejects replaced credentials', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unified-worker-'));
  const key=path.join(dir,'keeper-key');
  try {
    const address=initializeWorkerKey(key);
    assert.match(address,/^0x[0-9a-f]{40}$/i);
    assert.equal(initializeWorkerKey(key),address);
    assert.equal(fs.statSync(key).mode & 0o777,0o600);
    fs.chmodSync(key,0o644);
    assert.throws(()=>initializeWorkerKey(key),/CREDENTIAL_INVALID/);
    fs.symlinkSync(key,key+'-link');
    assert.throws(()=>initializeWorkerKey(key+'-link'));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
