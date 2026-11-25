import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {FetchRequest, toUtf8Bytes} from 'ethers';
import {createUnifiedRpcProvider, withUnifiedReadRpc as verifyWithConfiguredRpc} from '../scripts/v3-unified-verification-rpc.mjs';

const primary = 'https://bsc-testnet-rpc.publicnode.com';
const alternate = 'https://bsc-prebsc-dataseed.bnbchain.org';
const dRpc = 'https://bsc-testnet.drpc.org';
const last = 'https://bnb-testnet.api.onfinality.io/public';
const official = 'https://bsc-testnet-dataseed.bnbchain.org';
const backup = 'https://bsc-testnet.bnbchain.org';
const privateUrl = 'https://archive.example.invalid/testnet/private-credential?token=private-value';

// Unit tests must not open the operator's real credential when run as root.
function withUnifiedReadRpc(preferred, phase, read, createProvider, options) {
  return verifyWithConfiguredRpc(preferred, phase, read, createProvider, {readPrivateRpc: () => null, ...options});
}

function trackProviders() {
  const opened = [], closed = [];
  function createProvider(url) {
    opened.push(url);
    return {url, destroy() { closed.push(url); }};
  }
  return {opened, closed, createProvider};
}

function connectionTimeout() {
  const ipv4 = Object.assign(new Error('connect ETIMEDOUT'), {code:'ETIMEDOUT'});
  const ipv6 = Object.assign(new Error('connect ENETUNREACH'), {code:'ENETUNREACH'});
  return new AggregateError([ipv4, ipv6], 'Multiple address attempts failed');
}

test('ethers retries the failed JSON-RPC read against the other endpoint', async (t) => {
  const requests = [];
  const transport = async request => {
    assert.equal(request.timeout, 15000);
    const {id, method} = JSON.parse(Buffer.from(request.body).toString());
    requests.push([request.url, method]);
    if (request.url === primary) throw connectionTimeout();
    assert.equal(request.url, alternate);
    return {statusCode:200, statusMessage:'OK', headers:{},
      body:toUtf8Bytes(JSON.stringify({jsonrpc:'2.0', id, result:'0x61'}))};
  };
  t.mock.method(FetchRequest, 'createGetUrlFunc', ({agent}) => {
    assert.equal(agent.maxSockets, 4);
    assert.equal(agent.options.proxyEnv, process.env);
    return transport;
  });
  const chain = await withUnifiedReadRpc(primary, 'post-build', provider => provider.send('eth_chainId', []));
  assert.equal(chain, '0x61');
  assert.deepEqual(requests, [[primary,'eth_chainId'], [alternate,'eth_chainId']]);
});

test('a 403 during the primary build restarts verification on the next public reader', async t => {
  const requests = [];
  const log = t.mock.method(console, 'error', () => {});
  t.mock.method(FetchRequest, 'createGetUrlFunc', () => async request => {
    const {id, method} = JSON.parse(Buffer.from(request.body).toString());
    requests.push([request.url, method]);
    if (request.url === official && method === 'eth_blockNumber') {
      return {statusCode:403, statusMessage:'Forbidden', headers:{'content-type':'text/html'},
        body:toUtf8Bytes('<html><h1>403 Forbidden</h1></html>')};
    }
    const result = method === 'eth_chainId' ? '0x61' : '0x123';
    return {statusCode:200, statusMessage:'OK', headers:{},
      body:toUtf8Bytes(JSON.stringify({jsonrpc:'2.0', id, result}))};
  });
  const block = await withUnifiedReadRpc(official, 'pre-build', async provider => {
    assert.equal(await provider.send('eth_chainId', []), '0x61');
    return provider.send('eth_blockNumber', []);
  });
  assert.equal(block, '0x123');
  assert.deepEqual(requests, [
    [official, 'eth_chainId'], [official, 'eth_blockNumber'],
    [alternate, 'eth_chainId'], [alternate, 'eth_blockNumber'],
  ]);
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [
    ['UNIFIED_VERIFICATION_RPC_UNREACHABLE phase=pre-build endpoint=' + official + ' reason=HTTP_403'],
  ]);
});

test('a transport failure on the fixed worker provider does not replay a submission', async t => {
  const requests = [];
  t.mock.method(FetchRequest, 'createGetUrlFunc', ({agent}) => async request => {
    assert.equal(request.timeout, 12000);
    assert.equal(agent.options.proxyEnv, process.env);
    const {method} = JSON.parse(Buffer.from(request.body).toString());
    requests.push([request.url, method]);
    throw connectionTimeout();
  });
  const provider = createUnifiedRpcProvider(official, 12000);
  try {
    await assert.rejects(provider.send('eth_sendRawTransaction', ['0x00']));
    assert.deepEqual(requests, [[official, 'eth_sendRawTransaction']]);
  } finally {
    provider.destroy();
  }
});

test('concurrent public verification requests are paced on the wire', async t => {
  const starts = [];
  t.mock.method(FetchRequest, 'createGetUrlFunc', () => async req => {
    starts.push(performance.now());
    const {id} = JSON.parse(Buffer.from(req.body).toString());
    return {statusCode:200, headers:{}, statusMessage:'OK',
      body:toUtf8Bytes(JSON.stringify({jsonrpc:'2.0', id, result:'0x123'}))};
  });
  const blocks = await withUnifiedReadRpc(official, 'post-build', p =>
    Promise.all(Array.from({length:4}, () => p.send('eth_blockNumber', []))));
  assert.deepEqual(blocks, Array(4).fill('0x123'));
  assert.equal(starts.length, 4);
  assert.ok(starts[3] - starts[0] >= 400, 'Four public reads should span roughly 450 ms or more');
});

test('outstanding public reads do not leave the abandoned endpoint after transport failover', async t => {
  const requests = [];
  t.mock.method(console, 'error', () => {});
  t.mock.method(FetchRequest, 'createGetUrlFunc', () => async req => {
    requests.push(req.url);
    if (req.url === official) throw connectionTimeout();
    const {id} = JSON.parse(Buffer.from(req.body).toString());
    return {statusCode:200, headers:{}, statusMessage:'OK',
      body:toUtf8Bytes(JSON.stringify({jsonrpc:'2.0', id, result:'0x61'}))};
  });
  let attempts = 0;
  const result = await withUnifiedReadRpc(official, 'post-build', p => {
    if (attempts++ === 0) return Promise.all(Array.from({length:12}, () => p.send('eth_blockNumber', [])));
    return p.send('eth_chainId', []);
  });
  assert.equal(result, '0x61');
  await delay(200);
  assert.deepEqual(requests, [official, alternate]);
});

test('returns the verified result on the preferred RPC and closes it', async () => {
  const {opened, closed, createProvider} = trackProviders();
  const result = await withUnifiedReadRpc(primary, 'post-build', async () => 'verified', createProvider);
  assert.equal(result, 'verified');
  assert.deepEqual(opened, [primary]);
  assert.deepEqual(closed, [primary]);
});

test('a nested TCP failure late in verification restarts the full proof read on the fallback', async () => {
  const {opened, closed, createProvider} = trackProviders(), steps = [];
  const result = await withUnifiedReadRpc(primary, 'post-build', async ({url}) => {
    steps.push([url,'chain'],[url,'receipt']);
    if (url === primary) throw new Error('fetch failed', {cause:connectionTimeout()});
    steps.push([url,'code'],[url,'canonical block']);
    return 'verified';
  }, createProvider);
  assert.equal(result, 'verified');
  assert.deepEqual(steps, [[primary,'chain'],[primary,'receipt'],[alternate,'chain'],
    [alternate,'receipt'],[alternate,'code'],[alternate,'canonical block']]);
  assert.deepEqual(opened, [primary, alternate]);
  assert.deepEqual(closed, [primary, alternate]);
});

test('retries HTTP throttling and transient upstream errors', async () => {
  for (const statusCode of [429, 503]) {
    const {opened, closed, createProvider} = trackProviders();
    const result = await withUnifiedReadRpc(primary, 'post-build', async ({url}) => {
      if (url === primary) throw Object.assign(new Error('HTTP request failed'),
        {code:'SERVER_ERROR',response:{statusCode}});
      return url;
    }, createProvider);
    assert.equal(result, alternate);
    assert.deepEqual(opened, [primary, alternate]);
    assert.deepEqual(closed, [primary, alternate]);
  }
});

test('wrong chain, mismatched receipt or runtime and execution reverts stop verification', async () => {
  for (const error of [
    new Error('UNIFIED_TESTNET_CHAIN_REQUIRED'),
    new Error('UNIFIED_DEPLOYMENT_RECEIPT_MISMATCH'),
    new Error('UNIFIED_COMPONENT_RUNTIME_MISMATCH'),
    Object.assign(new Error('execution reverted'), {code:'CALL_EXCEPTION'}),
    new AggregateError([connectionTimeout(), new Error('UNIFIED_COMPONENT_RUNTIME_MISMATCH')],
      'Mixed proof and transport failure'),
  ]) {
    const {opened, closed, createProvider} = trackProviders();
    await assert.rejects(withUnifiedReadRpc(primary, 'post-build', async () => {
      throw error;
    }, createProvider), e => e.message.includes(error.message));
    assert.deepEqual(opened, [primary]);
    assert.deepEqual(closed, [primary]);
  }
});

test('a fallback must pass all proof checks and an unapproved RPC is never queried', async () => {
  const {opened, closed, createProvider} = trackProviders();
  await assert.rejects(withUnifiedReadRpc('https://untrusted.invalid', 'post-build',
    async () => 'verified', createProvider), /UNIFIED_VERIFICATION_RPC_NOT_ALLOWED/);
  assert.deepEqual(opened, []);
  await assert.rejects(withUnifiedReadRpc(primary, 'post-build', async ({url}) => {
    if (url === primary) throw connectionTimeout();
    throw new Error('UNIFIED_DEPLOYMENT_RECEIPT_MISMATCH');
  }, createProvider), /UNIFIED_DEPLOYMENT_RECEIPT_MISMATCH/);
  assert.deepEqual(opened, [primary, alternate]);
  assert.deepEqual(closed, [primary, alternate]);
});

test('exhausted independent proof readers leave verification failed and never use the deployment RPC', async () => {
  const {opened, closed, createProvider} = trackProviders();
  await assert.rejects(withUnifiedReadRpc(primary, 'existing-proof', async () => {
    throw connectionTimeout();
  }, createProvider), /UNIFIED_VERIFICATION_RPC_UNAVAILABLE/);
  assert.deepEqual(opened, [primary, dRpc, last]);
  assert.deepEqual(closed, opened);
});

test('the build can start on the worker RPC and redo its reads on independent providers', async t => {
  const {opened, closed, createProvider} = trackProviders();
  const log = t.mock.method(console, 'error', () => {});
  const result = await withUnifiedReadRpc(official, 'pre-build', async ({url}) => {
    if (url === official) throw new Error('sensitive request contents', {cause:connectionTimeout()});
    if (url === alternate) throw Object.assign(new Error('sensitive rate limit response'), {
      code:'SERVER_ERROR', response:{statusCode:429},
    });
    return url;
  }, createProvider);
  assert.equal(result, primary);
  assert.deepEqual(opened, [official, alternate, primary]);
  assert.deepEqual(closed, opened);
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [
    ['UNIFIED_VERIFICATION_RPC_UNREACHABLE phase=pre-build endpoint=' + official + ' reason=ETIMEDOUT+ENETUNREACH'],
    ['UNIFIED_VERIFICATION_RPC_UNREACHABLE phase=pre-build endpoint=' + alternate + ' reason=HTTP_429'],
  ]);
});

test('a brief outage across all build readers restarts the full callback after backoff', async t => {
  const {opened, closed, createProvider} = trackProviders();
  let calls = 0, backoff = 0;
  const log = t.mock.method(console, 'error', () => {});
  const result = await withUnifiedReadRpc(official, 'post-build', async ({url}) => {
    calls++;
    if (calls === 1) throw Object.assign(Error('HTTP throttle'), {
      code:'SERVER_ERROR', response:{statusCode:429, headers:{'retry-after':'90'}},
    });
    if (calls <= 6) throw Object.assign(new Error('upstream throttle'), {
      code:'UNKNOWN_ERROR', error:{code:-32029, message:'Too Many Requests'},
    });
    return url;
  }, createProvider, {wait: async ms => { backoff = ms; }});
  assert.equal(result, official);
  assert.deepEqual(opened, [official, alternate, primary, dRpc, last, backup, official]);
  assert.equal(backoff, 30000);
  assert.deepEqual(closed, opened);
  assert.ok(log.mock.calls.some(call => call.arguments[0].includes('reason=RPC_RATE_LIMIT')));
  assert.ok(log.mock.calls.some(call => call.arguments[0] === 'UNIFIED_VERIFICATION_RPC_RETRY phase=post-build'));
});

test('the complete verified read uses the root-managed archive before any public endpoint', async () => {
  for (const phase of ['pre-build', 'post-build', 'worker-check', 'existing-proof']) {
    const calls = [];
    const createProvider = (url, timeout, privateReader) => ({
      send: async (method, args) => { calls.push([url, method, args, privateReader]); return '0x61'; },
      destroy: () => calls.push('closed'),
    });
    const result = await withUnifiedReadRpc(official, phase, async () => {
      calls.push('verified on same provider'); return 123;
    }, createProvider, {readPrivateRpc: () => privateUrl});
    assert.equal(result, 123);
    assert.deepEqual(calls, [[privateUrl, 'eth_chainId', [], true], 'verified on same provider', 'closed']);
  }
});

test('a private reader on another chain stops before executing the callback', async () => {
  const opened = [];
  await assert.rejects(withUnifiedReadRpc(primary, 'post-build', () => assert.fail('Must not read'),
    url => { opened.push(url); return {send: async () => '0x38', destroy() {}}; },
    {readPrivateRpc: () => privateUrl}), /UNIFIED_TESTNET_CHAIN_REQUIRED/);
  assert.deepEqual(opened, [privateUrl]);
});

test('private credentials are redacted from nested transport and fatal proof errors', async t => {
  const log = t.mock.method(console, 'error', () => {});
  const createProvider = url => ({url, send:async () => '0x61', destroy() {}});
  const options = {readPrivateRpc: () => privateUrl};
  const result = await withUnifiedReadRpc(primary, 'pre-build', async ({url}) => {
    if (url === privateUrl) throw new Error('Network request ' + url, {
      cause:Object.assign(Error(url), {code:'SERVER_ERROR', response:{statusCode:401, url}}),
    });
    return url;
  }, createProvider, options);
  assert.equal(result, primary);
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [
    ['UNIFIED_VERIFICATION_RPC_UNREACHABLE phase=pre-build endpoint=managed-archive reason=HTTP_401'],
  ]);
  for (const [message, expected] of [[privateUrl, 'UNIFIED_PRIVATE_RPC_VERIFICATION_FAILED'],
    ['UNIFIED_COMPONENT_RUNTIME_MISMATCH', 'UNIFIED_COMPONENT_RUNTIME_MISMATCH']]) {
    let attempts = 0;
    await assert.rejects(withUnifiedReadRpc(official, 'post-build', async () => {
      attempts++;
      throw Object.assign(Error(message, {cause:Error(privateUrl)}), {request:{url:privateUrl}});
    }, createProvider, options), error => error.message === expected && !error.cause && !error.request);
    assert.equal(attempts, 1);
  }
});

test('private transport never follows a redirect or logs its URL', async t => {
  const calls = [];
  const log = t.mock.method(console, 'error', () => {});
  t.mock.method(FetchRequest, 'createGetUrlFunc', () => async req => {
    calls.push(req.url);
    if (req.url === privateUrl) return {statusCode:307, statusMessage:'Temporary Redirect',
      headers:{location:'https://wrong.example.invalid/redirected'}, body:new Uint8Array()};
    const {id} = JSON.parse(Buffer.from(req.body).toString());
    return {statusCode:200, statusMessage:'OK', headers:{}, body:toUtf8Bytes(JSON.stringify({jsonrpc:'2.0', id, result:'0x61'}))};
  });
  const chain = await withUnifiedReadRpc(primary, 'pre-build', p => p.send('eth_chainId', []),
    createUnifiedRpcProvider, {readPrivateRpc: () => privateUrl});
  assert.equal(chain, '0x61');
  assert.deepEqual(calls, [privateUrl, primary]);
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [
    ['UNIFIED_VERIFICATION_RPC_UNREACHABLE phase=pre-build endpoint=managed-archive reason=REDIRECT'],
  ]);
});

test('an independent proof cannot use a deployment host through the managed archive alias', async () => {
  for (const host of [official, alternate, backup]) {
    const {opened, createProvider} = trackProviders();
    const url = await withUnifiedReadRpc(official, 'existing-proof', async p => p.url, createProvider,
      {readPrivateRpc: () => host + './?key=hidden'});
    assert.equal(url, primary);
    assert.deepEqual(opened, [primary]);
  }
});

test('an unprivileged process leaves the root archive file unopened', async t => {
  t.mock.method(process, 'getuid', () => 1000);
  t.mock.method(fs, 'lstatSync', () => assert.fail('Must not inspect managed configuration'));
  const {opened, createProvider} = trackProviders();
  assert.equal(await verifyWithConfiguredRpc(primary, 'pre-build', async p => p.url, createProvider), primary);
  assert.deepEqual(opened, [primary]);
});

test('unsafe managed directory is ignored without reading a credential', async t => {
  t.mock.method(process, 'getuid', () => 0);
  const allowedDir = '/etc/globaldroptrade';
  t.mock.method(fs, 'lstatSync', path => {
    assert.equal(path, allowedDir);
    return {isDirectory: () => true, uid:0, mode:0o777};
  });
  const log = t.mock.method(console, 'error', () => {});
  const {opened, createProvider} = trackProviders();
  assert.equal(await verifyWithConfiguredRpc(primary, 'pre-build', async p => p.url, createProvider), primary);
  assert.deepEqual(opened, [primary]);
  assert.equal(log.mock.calls[0].arguments[0], 'UNIFIED_VERIFICATION_PRIVATE_RPC_CONFIG_IGNORED');
});

test('the fixed testnet credential is read with file ownership and permission checks', async t => {
  t.mock.method(process, 'getuid', () => 0);
  const dir = '/etc/globaldroptrade', file = dir + '/archive-rpc-url';
  const bytes = Buffer.from(privateUrl + '\n');
  t.mock.method(fs, 'lstatSync', path => {
    assert.ok(path === dir || path === file);
    return {isDirectory: () => path === dir, uid:0, mode:path === dir ? 0o755 : 0o600};
  });
  const fd = 12345;
  t.mock.method(fs, 'openSync', (path, flags) => {
    assert.equal(path, file);
    assert.equal(flags, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    return fd;
  });
  const stat = {isFile: () => true, size:bytes.length, uid:0, mode:0o600};
  t.mock.method(fs, 'fstatSync', n => { assert.equal(n, fd); return stat; });
  const read = t.mock.method(fs, 'readFileSync', n => { assert.equal(n, fd); return bytes; });
  const close = t.mock.method(fs, 'closeSync', n => assert.equal(n, fd));
  const log = t.mock.method(console, 'error', () => {});
  const factory = url => ({url, send:async () => '0x61', destroy() {}});
  assert.equal(await verifyWithConfiguredRpc(primary, 'post-build', p => p.url, factory), privateUrl);
  stat.mode = 0o644;
  assert.equal(await verifyWithConfiguredRpc(primary, 'post-build', p => p.url, factory), primary);
  stat.mode = 0o600; stat.uid = 1000;
  assert.equal(await verifyWithConfiguredRpc(primary, 'post-build', p => p.url, factory), primary);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(close.mock.callCount(), 3);
  assert.deepEqual(log.mock.calls.map(c => c.arguments[0]), [
    'UNIFIED_VERIFICATION_PRIVATE_RPC_CONFIG_IGNORED', 'UNIFIED_VERIFICATION_PRIVATE_RPC_CONFIG_IGNORED',
  ]);
});
