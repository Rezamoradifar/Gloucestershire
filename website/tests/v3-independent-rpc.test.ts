import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Interface,keccak256} from 'ethers';
import {V3_TEST_TOKEN} from '../src/v3-site-config';

const calls=vi.hoisted(()=>({readers:0,destroyed:0,browserReaders:0,slow:false}));
vi.mock('ethers',async(importOriginal)=>{
 const real=await importOriginal<typeof import('ethers')>();
 class JsonRpcProvider {
  constructor(){calls.readers++;}
  async send(){if(!calls.slow)throw Error('RPC_UNAVAILABLE');return '0x61';}
  async getBlockNumber(){if(calls.slow)await delayRead();return 11;}
  async getBlock(){return {number:8,hash:'0x'+'c'.repeat(64)};}
  async getCode(){await delayRead();return '0x1234';}
  async getTransactionReceipt(){return {status:1,blockNumber:3,contractAddress:config.address};}
  async call({data}:{data:string}){
   const iface=new Interface(V3_ABI),fn=iface.getFunction(data.slice(0,10))!;
   const values:Record<string,unknown>={
    asset:V3_TEST_TOKEN,feeReceiver:'0x74015dedf36677485793f1714ec7bd4893907b26',
    MANAGER_ROLE:'0x'+'d'.repeat(64),FEE_WALLET_1:V3_DEPOSIT_FEE_1,
    FEE_WALLET_2:V3_DEPOSIT_FEE_2,OPERATIONS_WALLET:V3_OPERATIONS,
    DEPOSIT_FEE_EACH_BPS:1000n,ACCRUAL_PERIOD:3600n,hasRole:true
   };
   return iface.encodeFunctionResult(fn,[values[fn.name]]);
  }
  destroy(){calls.destroyed++;}
 }
 class BrowserProvider {
  constructor(){calls.browserReaders++;}
  async getBlockNumber(){throw Error('WALLET_RPC_UNAVAILABLE');}
  destroy(){}
 }
 return {...real,JsonRpcProvider,BrowserProvider};
});
import {V3_ABI,V3_DEPOSIT_FEE_1,V3_DEPOSIT_FEE_2,V3_OPERATIONS,v3ReadSession} from '../src/v3-chain';

const delayRead=()=>new Promise(resolve=>setTimeout(resolve,7_000));
const wallet='0x1000000000000000000000000000000000000001';
const walletProvider={request:vi.fn(async({method}:{method:string})=>
 method==='eth_chainId'?'0x61':method==='eth_accounts'?[wallet]:undefined)};
const config={address:'0x2000000000000000000000000000000000000002',
 runtimeHash:keccak256('0x1234'),deploymentTx:'0x'+'2'.repeat(64)};

beforeEach(()=>{calls.readers=0;calls.destroyed=0;calls.browserReaders=0;calls.slow=false;walletProvider.request.mockClear();});

describe('independent V3 RPC session',()=>{
 it('fails closed when independent readers are unavailable and never selects the wallet provider',async()=>{
  await expect(v3ReadSession(walletProvider as any,wallet,config,true))
   .rejects.toThrow('independently verified V3 BNB Testnet RPC is unavailable');
  expect(calls.readers).toBe(4);
  expect(calls.destroyed).toBe(4);
  expect(calls.browserReaders).toBe(0);
 });
 it('retains wallet-provider fallback for read-only callers without the independent requirement',async()=>{
  await expect(v3ReadSession(walletProvider as any,wallet,config))
   .rejects.toThrow('Verified V3 BNB Testnet reads unavailable');
  expect(calls.readers).toBe(4);
  expect(calls.browserReaders).toBe(1);
 });
 it('completes successive healthy reads when total verification takes over twelve seconds',async()=>{
  vi.useFakeTimers();
  calls.slow=true;
  try{
   const result=v3ReadSession(walletProvider as any,wallet,config,true);
   await vi.advanceTimersByTimeAsync(14_001);
   const session=await result;
   expect(session.readerIndex).toBe(0);
   expect(session.block.number).toBe(8);
   expect(calls.readers).toBe(1);
   expect(calls.destroyed).toBe(0);
   session.provider.destroy();
  }finally{vi.useRealTimers();}
 });
});
