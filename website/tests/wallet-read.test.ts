import {afterEach,describe,expect,it,vi} from 'vitest';
import {readWalletSelection} from '../src/wallet-read';

afterEach(()=>vi.useRealTimers());
describe('bounded read-only wallet selection',()=>{
 it('returns account and network information without requesting wallet approval',async()=>{
  const accounts=['0x1000000000000000000000000000000000000001'];
  const provider={request:vi.fn(async({method}:{method:string})=>method==='eth_accounts'?accounts:'0x61')};
  expect(await readWalletSelection(provider)).toEqual({accounts,chainId:'0x61'});
  expect(provider.request.mock.calls.map(([call])=>call.method)).toEqual(['eth_accounts','eth_chainId']);
 });
 it.each(['eth_accounts','eth_chainId'])('releases a stalled %s read and permits a fresh retry',async method=>{
  vi.useFakeTimers();let complete!:(value:unknown)=>void;
  const provider={request:vi.fn(async({method:requestMethod}:{method:string})=>
   requestMethod===method?new Promise(done=>{complete=done;}):requestMethod==='eth_accounts'?[]:'0x61')};
  const pending=expect(readWalletSelection(provider)).rejects.toThrow('Open your wallet and retry');
  await vi.advanceTimersByTimeAsync(8_001);await pending;
  expect(vi.getTimerCount()).toBe(0);
  complete(method==='eth_accounts'?[]:'0x61');
  provider.request.mockImplementation(async({method:requestMethod})=>requestMethod==='eth_accounts'?[]:'0x61');
  expect(await readWalletSelection(provider)).toEqual({accounts:[],chainId:'0x61'});
  expect(vi.getTimerCount()).toBe(0);
 });
});
