import {beforeEach,describe,expect,it,vi} from 'vitest';
import {parseEther,type Eip1193Provider} from 'ethers';

const mock=vi.hoisted(()=>({readSession:vi.fn()}));
vi.mock('../src/v3-chain',()=>({v3ReadSession:mock.readSession}));
import {diagnoseV3Wallet} from '../src/v3-wallet-diagnostic';

const address='0x1000000000000000000000000000000000000001';
const other='0x2000000000000000000000000000000000000002';
const config={address:other,runtimeHash:'0x'+'1'.repeat(64),deploymentTx:'0x'+'2'.repeat(64)};
const destroy=vi.fn(),balance=vi.fn();
const request=vi.fn(async({method}:{method:string;params?:unknown[]})=>{
 if(method==='eth_chainId')return '0x61';
 if(method==='eth_accounts')return [address];
 if(method==='eth_getBalance')return '0x'+parseEther('0.5').toString(16);
 throw Error('UNEXPECTED_METHOD');
});
const provider={request} as Eip1193Provider;

beforeEach(()=>{
 vi.clearAllMocks();
 request.mockImplementation(async({method})=>{
  if(method==='eth_chainId')return '0x61';
  if(method==='eth_accounts')return [address];
  if(method==='eth_getBalance')return '0x'+parseEther('0.5').toString(16);
  throw Error('UNEXPECTED_METHOD');
 });
 balance.mockResolvedValue(parseEther('0.6'));
 mock.readSession.mockResolvedValue({provider:{getBalance:balance,destroy},block:{number:12345}});
});

describe('read-only V3 wallet diagnostics',()=>{
 it('compares the selected wallet balance with an independently verified block',async()=>{
  const result=await diagnoseV3Wallet(provider,address,config);
  expect(result).toEqual({wallet:{status:'ok',chainId:97,accountMatches:true,testBNB:'0.5'},
   independent:{status:'ok',block:12345,testBNB:'0.6'}});
  expect(mock.readSession).toHaveBeenCalledWith(provider,address,config,true);
  expect(balance).toHaveBeenCalledWith(address,12345);
  expect(destroy).toHaveBeenCalledOnce();
  expect(new Set(request.mock.calls.map(([arg])=>arg.method))).toEqual(new Set(['eth_chainId','eth_accounts','eth_getBalance']));
 });
 it('rejects an incorrect network without querying its balance',async()=>{
  request.mockImplementation(async({method})=>method==='eth_chainId'?'0x38':[address]);
  const result=await diagnoseV3Wallet(provider,address,config);
  expect(result.wallet).toEqual({status:'wrong_network',chainId:56,accountMatches:true,testBNB:null});
  expect(mock.readSession).not.toHaveBeenCalled();
  expect(request.mock.calls.some(([arg])=>arg.method==='eth_getBalance')).toBe(false);
 });
 it('rejects a different selected account without reading it',async()=>{
  request.mockImplementation(async({method})=>method==='eth_chainId'?'0x61':[other]);
  const result=await diagnoseV3Wallet(provider,address,config);
  expect(result.wallet.status).toBe('account_mismatch');
  expect(result.wallet.accountMatches).toBe(false);
  expect(mock.readSession).not.toHaveBeenCalled();
 });
 it('reports independent RPC failure separately without exposing its message or URL',async()=>{
  mock.readSession.mockRejectedValue(Error('secret-rpc-url-or-key'));
  const result=await diagnoseV3Wallet(provider,address,config);
  expect(result.wallet.testBNB).toBe('0.5');
  expect(result.independent).toEqual({status:'unavailable',block:null,testBNB:null});
  expect(JSON.stringify(result)).not.toContain('secret-rpc-url-or-key');
 });
 it('reports an unavailable wallet balance without inventing zero',async()=>{
  request.mockImplementation(async({method})=>{
   if(method==='eth_chainId')return '0x61';
   if(method==='eth_accounts')return [address];
   throw Error('private-rpc-error');
  });
  const result=await diagnoseV3Wallet(provider,address,config);
  expect(result.wallet.status).toBe('unavailable');
  expect(result.wallet.testBNB).toBeNull();
  expect(result.independent.status).toBe('ok');
  expect(JSON.stringify(result)).not.toContain('private-rpc-error');
 });
 it('discards observations when the wallet changes during the check',async()=>{
  let calls=0;
  request.mockImplementation(async({method})=>{
   if(method==='eth_chainId')return '0x61';
   if(method==='eth_accounts')return ++calls===1?[address]:[other];
   if(method==='eth_getBalance')return '0x0';
   throw Error('UNEXPECTED_METHOD');
  });
  const result=await diagnoseV3Wallet(provider,address,config);
  expect(result.wallet.status).toBe('changed');
  expect(result.wallet.testBNB).toBeNull();
  expect(result.independent).toEqual({status:'unavailable',block:null,testBNB:null});
 });
});
