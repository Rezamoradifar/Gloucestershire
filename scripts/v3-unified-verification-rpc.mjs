import {FetchRequest, JsonRpcProvider} from 'ethers';
import {setTimeout as delay} from 'node:timers/promises';
import {Agent} from 'node:https';
import fs from 'node:fs';
import {readZeroArchiveCandidate} from './zero-archive-candidate.mjs';

const publicNode = 'https://bsc-testnet-rpc.publicnode.com';
const dRpc = 'https://bsc-testnet.drpc.org';
const onFinality = 'https://bnb-testnet.api.onfinality.io/public';
const deploymentRpc = 'https://bsc-testnet-dataseed.bnbchain.org';
const preBsc = 'https://bsc-prebsc-dataseed.bnbchain.org';
const bnbChainReaders = [deploymentRpc, preBsc, 'https://bsc-testnet.bnbchain.org'];
const deploymentHosts = new Set(bnbChainReaders.map(url => new URL(url).hostname));
const allowedPrimary = new Set([publicNode, deploymentRpc]);
const transportCodes = new Set([
  'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET', 'ECONNREFUSED',
  'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);

// Return only known codes from the transport. An RPC message can contain the
// entire request and must not be written into the install journal.
export function transportReason(error) {
  if (!error || typeof error !== 'object') return null;
  if (Array.isArray(error.errors) && error.errors.length) {
    const reasons = error.errors.map(transportReason);
    return reasons.every(Boolean) ? [...new Set(reasons)].join('+') : null;
  }
  if (transportCodes.has(error.code)) return error.code;
  if (error.code === 'PRIVATE_RPC_REDIRECT') return 'REDIRECT';
  if (error.code === 'SERVER_ERROR') {
    const status = error.response?.statusCode;
    if (Number.isInteger(status) && (status === 401 || status === 403 || status === 408 || status === 429 || (status >= 500 && status < 600))) {
      return 'HTTP_' + status;
    }
  }
  // Some gateways return an explicit throttle as JSON-RPC in an HTTP 200.
  // Contract errors and every other RPC response keep their original meaning.
  if (error.code === 'UNKNOWN_ERROR') {
    const inner = error.error ?? error.info?.error;
    if ((inner?.code === -32029 || inner?.code === -32005 || inner?.code === 429) && /too many requests|rate limit/i.test(inner.message)) {
      return 'RPC_RATE_LIMIT';
    }
  }
  return !error.code && error.cause !== error ? transportReason(error.cause) : null;
}

let rpcAgent;
export function createUnifiedRpcProvider(url, timeout = 15000, privateReader = false, verificationSignal) {
  // Bound sockets per origin and honor the service's HTTPS proxy settings.
  rpcAgent ??= new Agent({keepAlive: true, maxSockets: 4, proxyEnv: process.env});
  const request = new FetchRequest(url);
  const getUrl = FetchRequest.createGetUrlFunc({agent: rpcAgent});
  let turn = Promise.resolve(), nextStart = 0;
  request.getUrlFunc = async (req, signal) => {
    // Getters at a pinned block may issue a dozen simultaneous requests.
    // Space public read starts while allowing previous responses to finish in parallel.
    if (verificationSignal && !privateReader) {
      const myTurn = turn.then(async () => {
        verificationSignal.throwIfAborted();
        const remaining = Math.ceil(nextStart - performance.now());
        if (remaining > 0) await delay(remaining, undefined, {signal:verificationSignal});
        nextStart = performance.now() + 150;
      });
      turn = myTurn.catch(() => {});
      await myTurn;
      verificationSignal.throwIfAborted();
    }
    const response = await getUrl(req, signal);
    if (privateReader && response.statusCode >= 300 && response.statusCode < 400) {
      throw Object.assign(Error('Private RPC redirected'), {code:'PRIVATE_RPC_REDIRECT'});
    }
    return response;
  };
  request.timeout = timeout;
  request.retryFunc = async () => false;
  return new JsonRpcProvider(request, 97, {staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1});
}

function managedArchiveRpc() {
  if (process.getuid?.() !== 0) return null;
  const directory = '/etc/globaldroptrade';
  const file = directory + '/archive-rpc-url';
  try {
    const dir = fs.lstatSync(directory, {throwIfNoEntry:false});
    if (!dir) return null;
    if (!dir.isDirectory() || dir.uid !== 0 || (dir.mode & 0o022)) throw Error('Unsafe RPC directory');
    if (!fs.lstatSync(file, {throwIfNoEntry:false})) return null;
    return readZeroArchiveCandidate(file).url;
  } catch {
    console.error('UNIFIED_VERIFICATION_PRIVATE_RPC_CONFIG_IGNORED');
    return null;
  }
}

// Each attempt runs the entire verification on one RPC. A proof mismatch is final.
export async function withUnifiedReadRpc(preferred, phase, read, createProvider = createUnifiedRpcProvider,
    {readPrivateRpc = managedArchiveRpc, wait = delay} = {}) {
  if (!allowedPrimary.has(preferred)) throw Error('UNIFIED_VERIFICATION_RPC_NOT_ALLOWED');
  const independent = phase === 'existing-proof' || phase === 'pre-deploy-check';
  const managed = readPrivateRpc();
  const endpoints = new Set([managed, preferred, preBsc, publicNode, dRpc, onFinality, ...bnbChainReaders].filter(url =>
    url && !(independent && deploymentHosts.has(new URL(url).hostname.replace(/\.$/, '')))));
  // The existing-proof command is retried by the install shell. In build phases
  // retry the read here so a brief outage does not discard a completed build.
  const rounds = ['pre-build', 'post-build', 'primary-build'].includes(phase) ? 2 : 1;
  let backoff = 10000;
  for (let round = 0; round < rounds; round++) {
    if (round > 0) {
      console.error('UNIFIED_VERIFICATION_RPC_RETRY phase=' + phase);
      await wait(backoff);
    }
    for (const url of endpoints) {
      const isPrivate = url === managed;
      const attempt = new AbortController();
      let provider;
      try {
        provider = createProvider(url, undefined, isPrivate, attempt.signal);
        if (isPrivate && await provider.send('eth_chainId', []) !== '0x61') throw Error('UNIFIED_TESTNET_CHAIN_REQUIRED');
        return await read(provider);
      } catch (error) {
        const reason = transportReason(error);
        if (!reason) {
          // Ethers may attach the entire credential-bearing request to an error.
          if (isPrivate) throw Error(/^UNIFIED_[A-Z0-9_]{1,100}$/.test(error?.message)
            ? error.message : 'UNIFIED_PRIVATE_RPC_VERIFICATION_FAILED');
          throw error;
        }
        if (reason === 'HTTP_429') {
          const retryAfter = error.response?.headers?.['retry-after'];
          if (typeof retryAfter === 'string' && /^\d{1,6}$/.test(retryAfter)) {
            backoff = Math.max(backoff, Math.min(30000, Number(retryAfter) * 1000));
          }
        }
        console.error('UNIFIED_VERIFICATION_RPC_UNREACHABLE phase=' + phase + ' endpoint=' + (isPrivate ? 'managed-archive' : url) + ' reason=' + reason);
      } finally {
        attempt.abort();
        provider?.destroy();
      }
    }
  }
  throw Error('UNIFIED_VERIFICATION_RPC_UNAVAILABLE');
}
