import assert from 'node:assert/strict';
import test from 'node:test';
import {FetchRequest, toUtf8Bytes} from 'ethers';
import {withUnifiedReadRpc} from '../scripts/v3-unified-verification-rpc.mjs';

const primary = 'https://bsc-testnet-rpc.publicnode.com';
const alternate = 'https://bnb-testnet.api.onfinality.io/public';

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
  const originalTransport = new FetchRequest(primary).getUrlFunc;
  t.after(() => FetchRequest.registerGetUrl(originalTransport));
  const requests = [];
  FetchRequest.registerGetUrl(async request => {
    const {id, method} = JSON.parse(Buffer.from(request.body).toString());
    requests.push([request.url, method]);
    if (request.url === primary) throw connectionTimeout();
    assert.equal(request.url, alternate);
    return {statusCode:200, statusMessage:'OK', headers:{},
      body:toUtf8Bytes(JSON.stringify({jsonrpc:'2.0', id, result:'0x61'}))};
  });
  const chain = await withUnifiedReadRpc(primary, 'post-build', provider => provider.send('eth_chainId', []));
  assert.equal(chain, '0x61');
  assert.deepEqual(requests, [[primary,'eth_chainId'], [alternate,'eth_chainId']]);
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

test('exhausted read endpoints leave verification failed and release all providers', async () => {
  const {opened, closed, createProvider} = trackProviders();
  await assert.rejects(withUnifiedReadRpc(primary, 'post-build', async () => {
    throw connectionTimeout();
  }, createProvider), /UNIFIED_VERIFICATION_RPC_UNAVAILABLE/);
  assert.deepEqual(opened, [primary, alternate]);
  assert.deepEqual(closed, [primary, alternate]);
});
