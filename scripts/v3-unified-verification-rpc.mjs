import {FetchRequest, JsonRpcProvider} from 'ethers';

const publicNode = 'https://bsc-testnet-rpc.publicnode.com';
const onFinality = 'https://bnb-testnet.api.onfinality.io/public';
const allowedPrimary = new Set([publicNode, 'https://bsc-testnet-dataseed.bnbchain.org']);
const transportCodes = new Set([
  'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET', 'ECONNREFUSED',
  'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);

function transportFailure(error) {
  if (!error || typeof error !== 'object') return false;
  if (Array.isArray(error.errors) && error.errors.length) return error.errors.every(transportFailure);
  if (transportCodes.has(error.code)) return true;
  if (error.code === 'SERVER_ERROR') {
    const status = error.response?.statusCode;
    return status === 408 || status === 429 || (status >= 500 && status < 600);
  }
  return !error.code && error.cause !== error && transportFailure(error.cause);
}

function makeReadProvider(url) {
  const request = new FetchRequest(url);
  request.timeout = 8000;
  request.retryFunc = async () => false;
  return new JsonRpcProvider(request, 97, {staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1});
}

// Each attempt runs the entire verification on one RPC. A proof mismatch is final.
export async function withUnifiedReadRpc(preferred, phase, read, createProvider = makeReadProvider) {
  if (!allowedPrimary.has(preferred)) throw Error('UNIFIED_VERIFICATION_RPC_NOT_ALLOWED');
  for (const url of new Set([preferred, publicNode, onFinality])) {
    const provider = createProvider(url);
    try {
      return await read(provider);
    } catch (error) {
      if (!transportFailure(error)) throw error;
      console.error('UNIFIED_VERIFICATION_RPC_UNREACHABLE phase=' + phase + ' endpoint=' + url);
    } finally {
      provider.destroy();
    }
  }
  throw Error('UNIFIED_VERIFICATION_RPC_UNAVAILABLE');
}
