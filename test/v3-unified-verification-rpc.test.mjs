import assert from 'node:assert/strict';
import test from 'node:test';
import {FetchRequest, toUtf8Bytes} from 'ethers';
import {createUnifiedRpcProvider, withUnifiedReadRpc} from '../scripts/v3-unified-verification-rpc.mjs';

const primary = 'https://bsc-testnet-rpc.publicnode.com';
const alternate = 'https://bsc-testnet.drpc.org';
const last = 'https://bnb-testnet.api.onfinality.io/public';
const official = 'https://bsc-testnet-dataseed.bnbchain.org';

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
    [primary, 'eth_chainId'], [primary, 'eth_blockNumber'],
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
  assert.deepEqual(opened, [primary, alternate, last]);
  assert.deepEqual(closed, opened);
});

test('the build can start on the worker RPC and redo its reads on independent providers', async t => {
  const {opened, closed, createProvider} = trackProviders();
  const log = t.mock.method(console, 'error', () => {});
  const result = await withUnifiedReadRpc(official, 'pre-build', async ({url}) => {
    if (url === official) throw new Error('sensitive request contents', {cause:connectionTimeout()});
    if (url === primary) throw Object.assign(new Error('sensitive rate limit response'), {
      code:'SERVER_ERROR', response:{statusCode:429},
    });
    return url;
  }, createProvider);
  assert.equal(result, alternate);
  assert.deepEqual(opened, [official, primary, alternate]);
  assert.deepEqual(closed, opened);
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [
    ['UNIFIED_VERIFICATION_RPC_UNREACHABLE phase=pre-build endpoint=' + official + ' reason=ETIMEDOUT+ENETUNREACH'],
    ['UNIFIED_VERIFICATION_RPC_UNREACHABLE phase=pre-build endpoint=' + primary + ' reason=HTTP_429'],
  ]);
});

test('a brief outage across all build readers restarts the full callback after backoff', async t => {
  const {opened, closed, createProvider} = trackProviders();
  let calls = 0;
  const log = t.mock.method(console, 'error', () => {});
  const result = await withUnifiedReadRpc(official, 'post-build', async ({url}) => {
    calls++;
    if (calls <= 4) throw Object.assign(new Error('upstream throttle'), {
      code:'UNKNOWN_ERROR', error:{code:-32029, message:'Too Many Requests'},
    });
    return url;
  }, createProvider);
  assert.equal(result, official);
  assert.deepEqual(opened, [official, primary, alternate, last, official]);
  assert.deepEqual(closed, opened);
  assert.ok(log.mock.calls.some(call => call.arguments[0].includes('reason=RPC_RATE_LIMIT')));
  assert.ok(log.mock.calls.some(call => call.arguments[0] === 'UNIFIED_VERIFICATION_RPC_RETRY phase=post-build'));
});
