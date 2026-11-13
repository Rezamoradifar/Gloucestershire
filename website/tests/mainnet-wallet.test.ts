import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const address='0x1111111111111111111111111111111111111111';
const target='0x2222222222222222222222222222222222222222';
const mobile=vi.hoisted(()=>({enable:vi.fn(),disconnect:vi.fn(),request:vi.fn()}));
const init=vi.hoisted(()=>vi.fn());
vi.mock('@walletconnect/ethereum-provider',()=>({EthereumProvider:{init}}));
let wallet:typeof import('../src/wallet')|undefined;
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();wallet=undefined;
 vi.stubEnv('VITE_CHAIN_ID','56');vi.stubEnv('VITE_VAULT_ADDRESS',target);vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID','1'.repeat(32));
 vi.stubGlobal('window',{location:{origin:'https://globaldroptrade.com'}});
 mobile.enable.mockResolvedValue([address]);mobile.disconnect.mockResolvedValue(undefined);mobile.request.mockResolvedValue([address]);init.mockResolvedValue(mobile);
});
afterEach(async()=>{await wallet?.wallets.disconnect();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('BNB mainnet wallet configuration',()=>{
 it('refuses mainnet runtime configuration in the V2-only testnet release',async()=>{
  vi.stubEnv('VITE_CHAIN_ID','');vi.stubEnv('VITE_VAULT_ADDRESS','');
  const fetcher=vi.fn(async()=>Response.json({version:1,chainId:56,vaultAddress:target}));vi.stubGlobal('fetch',fetcher);
  const config=await import('../src/config');
  await expect(config.loadRuntimeConfig()).rejects.toThrow(/approved isolated V2 testnet/i);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(init).not.toHaveBeenCalled();
 });
 it('adds and selects only mainnet in the SafePal browser when that network is missing',async()=>{
  const request=vi.fn().mockResolvedValue([address]);vi.stubGlobal('window',{safepalProvider:{request}});
  wallet=await import('../src/wallet');await wallet.wallets.connect('injected');request.mockClear();request.mockRejectedValueOnce({code:4902});
  await wallet.switchWalletNetwork();
  expect(request.mock.calls.map(([call])=>call.method)).toEqual(['wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain']);
  expect(request.mock.calls.every(([call])=>call.params[0].chainId==='0x38')).toBe(true);
  expect(request.mock.calls[1][0].params[0]).toMatchObject({chainName:'BNB Smart Chain',nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},rpcUrls:['https://bsc-dataseed.bnbchain.org'],blockExplorerUrls:['https://bscscan.com']});
 });
 it('rejects a testnet wallet before requesting a mainnet signer or contract read',async()=>{
  const request=vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x61':[address]);vi.stubGlobal('window',{safepalProvider:{request}});
  wallet=await import('../src/wallet');await wallet.wallets.connect('injected');request.mockClear();
  const {session}=await import('../src/chain');await expect(session(address)).rejects.toThrow('different network');
  expect(request).toHaveBeenCalledExactlyOnceWith({method:'eth_chainId'});
 });
});
