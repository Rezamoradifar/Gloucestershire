import {beforeEach,describe,expect,it,vi} from 'vitest';

const calls=vi.hoisted(()=>({readers:0,destroyed:0,browserReaders:0}));
vi.mock('ethers',async(importOriginal)=>{
 const real=await importOriginal<typeof import('ethers')>();
 class JsonRpcProvider {
  constructor(){calls.readers++;}
  async send(){throw Error('RPC_UNAVAILABLE');}
  destroy(){calls.destroyed++;}
 }
 class BrowserProvider {
  constructor(){calls.browserReaders++;}
  async getBlockNumber(){throw Error('WALLET_RPC_UNAVAILABLE');}
  destroy(){}
 }
 return {...real,JsonRpcProvider,BrowserProvider};
});
import {v3ReadSession} from '../src/v3-chain';

const wallet='0x1000000000000000000000000000000000000001';
const walletProvider={request:vi.fn(async({method}:{method:string})=>
 method==='eth_chainId'?'0x61':method==='eth_accounts'?[wallet]:undefined)};
const config={address:'0x2000000000000000000000000000000000000002',
 runtimeHash:'0x'+'1'.repeat(64),deploymentTx:'0x'+'2'.repeat(64)};

beforeEach(()=>{calls.readers=0;calls.destroyed=0;calls.browserReaders=0;walletProvider.request.mockClear();});

describe('independent V3 RPC session',()=>{
 it('fails closed when independent readers are unavailable and never selects the wallet provider',async()=>{
  await expect(v3ReadSession(walletProvider as any,wallet,config,true))
   .rejects.toThrow('independently verified V3 BNB Testnet RPC is unavailable');
  expect(calls.readers).toBe(2);
  expect(calls.destroyed).toBe(2);
  expect(calls.browserReaders).toBe(0);
 });
 it('retains wallet-provider fallback for read-only callers without the independent requirement',async()=>{
  await expect(v3ReadSession(walletProvider as any,wallet,config))
   .rejects.toThrow('Verified V3 BNB Testnet reads unavailable');
  expect(calls.readers).toBe(2);
  expect(calls.browserReaders).toBe(1);
 });
});
