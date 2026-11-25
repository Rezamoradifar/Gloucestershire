import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {combinedCycle, initializeWorkerKey, selectWorkerProvider} from '../scripts/run-v3-unified-worker.mjs';

test('worker installation reads verified balance without retaining its RPC', async () => {
  const check = {balance:10n, block:123};
  const result = await selectWorkerProvider('--check', 'proof', 'operator', 'profile', {
    createProvider:() => assert.fail('Installation selected a transaction provider'),
    async readOnly(preferred, phase, verify) {
      assert.equal(preferred, 'https://bsc-testnet-dataseed.bnbchain.org');
      assert.equal(phase, 'worker-check');
      return verify('read-only provider');
    },
    async verifyOperator(...args) {
      assert.deepEqual(args, ['read-only provider', 'proof', 'operator', 'profile']);
      return check;
    }
  });
  assert.deepEqual(result, check);
  assert.equal(result.provider, undefined);
});

test('timer selects one live public provider after completing its pre-signature checks', async () => {
  const opened = [], checked = [], closed = [];
  const result = await selectWorkerProvider('--tick', 'proof', 'operator', 'profile', {
    readOnly:() => assert.fail('A timer attempted to read private RPC settings'),
    createProvider(url, timeout) {
      assert.equal(timeout, 12000);
      opened.push(url);
      return {url, destroy:() => closed.push(url)};
    },
    async verifyOperator(provider, ...args) {
      assert.deepEqual(args, ['proof', 'operator', 'profile']);
      checked.push(provider.url);
      if (checked.length <= 3) throw Object.assign(new Error('throttled'), {code:'SERVER_ERROR', response:{statusCode:429}});
      return {balance:10n, block:123};
    }
  });
  assert.deepEqual(opened, ['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com',
    'https://bsc-testnet.bnbchain.org','https://bsc-prebsc-dataseed.bnbchain.org']);
  assert.deepEqual(checked, opened);
  assert.deepEqual(closed, opened.slice(0,-1));
  assert.equal(result.provider.url, opened.at(-1));
  assert.equal(result.balance, 10n);
  result.provider.destroy();
  assert.deepEqual(closed, opened);
});

test('invalid contract proof, paused vault or privileged worker stops timer provider selection', async () => {
  for (const reason of ['UNIFIED_COMPONENT_RUNTIME_MISMATCH','UNIFIED_WORKER_VAULT_PAUSED','UNIFIED_WORKER_PRIVILEGED_OPERATOR']) {
    let calls = 0, closed = 0;
    await assert.rejects(selectWorkerProvider('--tick', {}, 'operator', {}, {
      createProvider() { calls++; return {destroy:() => { closed++; }}; },
      async verifyOperator() { throw Error(reason); }
    }), error => error.message === reason);
    assert.equal(calls, 1);
    assert.equal(closed, 1);
  }
});

test('only exhausted pre-signature transports get the temporary start failure code', async () => {
  let opened = 0, closed = 0;
  await assert.rejects(selectWorkerProvider('--tick', {}, 'operator', {}, {
    createProvider() { opened++; return {destroy:() => { closed++; }}; },
    async verifyOperator() {
      throw Object.assign(Error('upstream request details'), {code:'SERVER_ERROR', response:{statusCode:403}});
    }
  }), error => error.code === 'UNIFIED_WORKER_PREFLIGHT_RPC_UNAVAILABLE' &&
                error.message === 'UNIFIED_WORKER_PREFLIGHT_HTTP_403');
  assert.equal(opened, 4);
  assert.equal(closed, opened);
});

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
