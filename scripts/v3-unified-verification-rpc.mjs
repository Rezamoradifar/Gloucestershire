import {FetchRequest, JsonRpcProvider} from 'ethers';
import {setTimeout as delay} from 'node:timers/promises';
import {Agent} from 'node:https';

const publicNode = 'https://bsc-testnet-rpc.publicnode.com';
const dRpc = 'https://bsc-testnet.drpc.org';
const onFinality = 'https://bnb-testnet.api.onfinality.io/public';
const allowedPrimary = new Set([publicNode, 'https://bsc-testnet-dataseed.bnbchain.org']);
const transportCodes = new Set([
  'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET', 'ECONNREFUSED',
  'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);

// Return only known codes from the transport. An RPC message can contain the
// entire request and must not be written into the install journal.
function transportReason(error) {
  if (!error || typeof error !== 'object') return null;
  if (Array.isArray(error.errors) && error.errors.length) {
    const reasons = error.errors.map(transportReason);
    return reasons.every(Boolean) ? [...new Set(reasons)].join('+') : null;
  }
  if (transportCodes.has(error.code)) return error.code;
  if (error.code === 'SERVER_ERROR') {
    const status = error.response?.statusCode;
    if (Number.isInteger(status) && (status === 403 || status === 408 || status === 429 || (status >= 500 && status < 600))) {
      return 'HTTP_' + status;
    }
  }
  // Some gateways return an explicit throttle as JSON-RPC in an HTTP 200.
  // Contract errors and every other RPC response keep their original meaning.
  if (error.code === 'UNKNOWN_ERROR') {
    const inner = error.error ?? error.info?.error;
    if ((inner?.code === -32029 || inner?.code === 429) && /too many requests|rate limit/i.test(inner.message)) {
      return 'RPC_RATE_LIMIT';
    }
  }
  return !error.code && error.cause !== error ? transportReason(error.cause) : null;
}

let rpcAgent;
export function createUnifiedRpcProvider(url, timeout = 15000) {
  // Bound sockets per origin and honor the service's HTTPS proxy settings.
  rpcAgent ??= new Agent({keepAlive: true, maxSockets: 4, proxyEnv: process.env});
  const request = new FetchRequest(url);
  request.getUrlFunc = FetchRequest.createGetUrlFunc({agent: rpcAgent});
  request.timeout = timeout;
  request.retryFunc = async () => false;
  return new JsonRpcProvider(request, 97, {staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1});
}

// Each attempt runs the entire verification on one RPC. A proof mismatch is final.
export async function withUnifiedReadRpc(preferred, phase, read, createProvider = createUnifiedRpcProvider) {
  if (!allowedPrimary.has(preferred)) throw Error('UNIFIED_VERIFICATION_RPC_NOT_ALLOWED');
  const endpoints = new Set([preferred, publicNode, dRpc, onFinality]);
  // The existing-proof command is retried by the install shell. In build phases
  // retry the read here so a brief outage does not discard a completed build.
  const rounds = phase === 'pre-build' || phase === 'post-build' ? 2 : 1;
  for (let round = 0; round < rounds; round++) {
    if (round > 0) {
      console.error('UNIFIED_VERIFICATION_RPC_RETRY phase=' + phase);
      await delay(2000);
    }
    for (const url of endpoints) {
      const provider = createProvider(url);
      try {
        return await read(provider);
      } catch (error) {
        const reason = transportReason(error);
        if (!reason) throw error;
        console.error('UNIFIED_VERIFICATION_RPC_UNREACHABLE phase=' + phase + ' endpoint=' + url + ' reason=' + reason);
      } finally {
        provider.destroy();
      }
    }
  }
  throw Error('UNIFIED_VERIFICATION_RPC_UNAVAILABLE');
}
