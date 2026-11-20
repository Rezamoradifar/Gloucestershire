import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Interface,ZeroAddress,keccak256} from 'ethers';
import type {V3SiteReleaseConfig} from '../src/v3-site-config';

const state=vi.hoisted(()=>({readers:[] as number[],destroyed:[] as number[],
 failures:new Set<number>(),hanging:new Set<number>(),wrongRuntime:new Set<number>(),wrongAnchor:new Set<number>(),
 verificationDelay:new Map<number,number>(),accountDelay:new Map<number,number>(),
 walletChanged:false,changeWalletOnFailure:false,browserReaders:0,reads:[] as {reader:number;method:string}[]}));
vi.mock('../src/v3-site-config',async original=>({
 ...(await original<typeof import('../src/v3-site-config')>()),V3_HOURLY_TEST:true
}));
vi.mock('ethers',async original=>{
 const real=await original<typeof import('ethers')>();
 class JsonRpcProvider{
  readonly index:number;
  constructor(){this.index=state.readers.length;state.readers.push(this.index);}
  async send(method:string){
   if(method==='eth_chainId')return '0x61';
   if(method==='eth_getBlockByNumber')return {hash:state.wrongAnchor.has(this.index)?'0x'+'f'.repeat(64):blockHash(this.index)};
   throw Error('Unexpected RPC method '+method);
  }
  async getBlockNumber(){await delay(state.verificationDelay.get(this.index)??0);return 103+this.index;}
  async getBlock(){return {number:100+this.index,timestamp:1_000+this.index,hash:blockHash(this.index)};}
  async getCode(){return state.wrongRuntime.has(this.index)?'0x5678':'0x1234';}
  async getTransactionReceipt(){return {status:1,blockNumber:3,contractAddress:config.address};}
  async getBalance(){return BigInt(this.index+1);}
  async call({data}:{data:string}){
   const iface=new Interface([...V3_ABI,...V3_TEST_TOKEN_ABI]),fn=iface.getFunction(data.slice(0,10))!;
   state.reads.push({reader:this.index,method:fn.name});
   if(fn.name==='effectiveDailyBps')await delay(state.accountDelay.get(this.index)??0);
   if(fn.name==='effectiveDailyBps'&&state.hanging.has(this.index))return new Promise<string>(()=>{});
   if(fn.name==='effectiveDailyBps'&&state.failures.has(this.index)){
    if(state.changeWalletOnFailure)state.walletChanged=true;
    throw Object.assign(Error('RPC rate limit after identity verification'),{code:429});
   }
   const values:Record<string,unknown[]>={
    asset:[V3_TEST_TOKEN],feeReceiver:['0x74015dedf36677485793f1714ec7bd4893907b26'],
    MANAGER_ROLE:['0x'+'d'.repeat(64)],FUNDER_ROLE:['0x'+'e'.repeat(64)],
    FEE_WALLET_1:[V3_DEPOSIT_FEE_1],FEE_WALLET_2:[V3_DEPOSIT_FEE_2],OPERATIONS_WALLET:[V3_OPERATIONS],
    DEPOSIT_FEE_EACH_BPS:[1000n],ACCRUAL_PERIOD:[3600n],SINGLE_CAPITAL_VERSION:[1n],hasRole:[true],
    reinvestmentBook:[config.unified!.book],networkPlan:[config.unified!.network],vault:[config.address],
    users:[ZeroAddress,true,false,false,999n,0n,false,0n,0n,0n,0n,0n,0n],
    isEligible:[false],positionCount:[0n],userWithdrawalCount:[0n],withdrawalCount:[0n],
    memberCount:[1n],profitWithdrawalCap:[0n],paused:[false],cashStatus:[0n,0n,0n,0n,0n],
    tierOf:[0n],balanceOf:[BigInt((this.index+1)*100)],allowance:[0n],networkAvailable:[0n],
    networkReserved:[0n],cumulativeNetwork:[0n],qualifiedDirects:[0n],
    reinvestmentPositionPlusOne:[0n],effectiveDailyBps:[50n],qualifiedVolume:[0n],upgradeTerms:[0n,0n,50n]
   };
   if(!values[fn.name])throw Error('Missing RPC fixture '+fn.name);
   return iface.encodeFunctionResult(fn,values[fn.name]);
  }
  destroy(){state.destroyed.push(this.index);}
 }
 class BrowserProvider{constructor(){state.browserReaders++;throw Error('Wallet read fallback is prohibited for unified accounts.');}}
 return {...real,JsonRpcProvider,BrowserProvider};
});
import {V3_ABI,V3_TEST_TOKEN_ABI,V3_DEPOSIT_FEE_1,V3_DEPOSIT_FEE_2,V3_OPERATIONS,readV3Snapshot} from '../src/v3-chain';
import {V3_TEST_TOKEN} from '../src/v3-site-config';

const wallet='0x1000000000000000000000000000000000000001';
const config:V3SiteReleaseConfig={address:'0x2000000000000000000000000000000000000002',
 runtimeHash:keccak256('0x1234'),deploymentTx:'0x'+'2'.repeat(64),
 unified:{book:'0x3000000000000000000000000000000000000003',bookRuntimeHash:keccak256('0x1234'),
  network:'0x4000000000000000000000000000000000000004',networkRuntimeHash:keccak256('0x1234'),singleCapital:true}};
const blockHash=(index:number)=>'0x'+String(index+1).repeat(64);
const delay=(milliseconds:number)=>milliseconds>0?new Promise(resolve=>setTimeout(resolve,milliseconds)):Promise.resolve();
const walletProvider={request:vi.fn(async({method}:{method:string})=>
 method==='eth_chainId'?'0x61':method==='eth_accounts'?(state.walletChanged?[]:[wallet]):undefined)};

beforeEach(()=>{
 state.readers=[];state.destroyed=[];state.failures.clear();state.hanging.clear();state.wrongRuntime.clear();state.wrongAnchor.clear();
 state.verificationDelay.clear();state.accountDelay.clear();
 state.reads=[];state.walletChanged=false;state.changeWalletOnFailure=false;state.browserReaders=0;
 walletProvider.request.mockClear();
});

describe('complete verified account snapshot fallback',()=>{
 it('restarts all account reads on the next verified RPC after a late rate limit',async()=>{
  state.failures.add(0);
  const result=await readV3Snapshot(walletProvider,wallet,config);
  expect(result.walletTestTokenBalance).toBe(200n);
  expect(result.gasWei).toBe(2n);
  expect(result.block).toBe(101);
  expect(result.ledger.block).toBe(101);
  expect(result.hash).toBe(blockHash(1));
  for(const reader of [0,1]){
   expect(state.reads).toContainEqual({reader,method:'users'});
   expect(state.reads).toContainEqual({reader,method:'balanceOf'});
   expect(state.reads).toContainEqual({reader,method:'asset'});
  }
  expect(state.destroyed).toEqual([0,1]);
  expect(state.browserReaders).toBe(0);
 });
 it('stops a stalled account at the total refresh deadline without starting another source',async()=>{
  vi.useFakeTimers();state.hanging.add(0);
  try{
   const pending=expect(readV3Snapshot(walletProvider,wallet,config)).rejects.toThrow('V3_ACCOUNT_READ_TIMEOUT');
   await vi.advanceTimersByTimeAsync(120_001);
   await pending;
   expect(state.readers).toEqual([0]);
   expect(state.destroyed).toEqual([0]);
   expect(state.browserReaders).toBe(0);
  }finally{vi.useRealTimers();}
 });
 it('allows a healthy fallback after a slow first source consumes its verification timeout',async()=>{
  vi.useFakeTimers();state.verificationDelay.set(0,65_000);
  try{
   const start=Date.now(),pending=readV3Snapshot(walletProvider,wallet,config);
   await vi.advanceTimersByTimeAsync(60_001);
   const result=await pending;
   expect(Date.now()-start).toBeLessThan(120_000);
   expect(result.block).toBe(101);
   expect(result.walletTestTokenBalance).toBe(200n);
   expect(state.readers).toEqual([0,1]);
   expect(state.destroyed).toEqual([0,1]);
   await vi.advanceTimersByTimeAsync(5_000);
   expect(result.block).toBe(101);
   expect(state.readers).toEqual([0,1]);
  }finally{vi.useRealTimers();}
 });
 it('shares the deadline across verification and late account failure before a hanging fallback',async()=>{
  vi.useFakeTimers();
  state.verificationDelay.set(0,40_000);state.accountDelay.set(0,40_000);state.failures.add(0);
  state.verificationDelay.set(1,90_000);
  try{
   const pending=expect(readV3Snapshot(walletProvider,wallet,config)).rejects.toThrow('V3_ACCOUNT_READ_TIMEOUT');
   await vi.advanceTimersByTimeAsync(119_999);
   expect(state.readers).toEqual([0,1]);
   expect(state.destroyed).toEqual([0]);
   await vi.advanceTimersByTimeAsync(2);await pending;
   expect(state.destroyed).toEqual([0,1]);
   await vi.advanceTimersByTimeAsync(60_000);
   expect(state.readers).toEqual([0,1]);
   expect(state.destroyed).toEqual([0,1]);
   expect(state.browserReaders).toBe(0);
  }finally{vi.useRealTimers();}
 });
 it('uses only the remaining total budget for account data and discards its late answer',async()=>{
  vi.useFakeTimers();state.verificationDelay.set(0,40_000);state.accountDelay.set(0,90_000);
  try{
   const pending=expect(readV3Snapshot(walletProvider,wallet,config)).rejects.toThrow('V3_ACCOUNT_READ_TIMEOUT');
   await vi.advanceTimersByTimeAsync(119_999);
   expect(state.destroyed).toEqual([]);
   await vi.advanceTimersByTimeAsync(2);await pending;
   expect(state.readers).toEqual([0]);expect(state.destroyed).toEqual([0]);
   await vi.advanceTimersByTimeAsync(10_000);
   expect(state.readers).toEqual([0]);expect(state.destroyed).toEqual([0]);
   expect(state.browserReaders).toBe(0);
  }finally{vi.useRealTimers();}
 });
 it('reverifies each fallback source and skips an RPC with different contract code',async()=>{
  state.failures.add(0);state.wrongRuntime.add(1);
  const result=await readV3Snapshot(walletProvider,wallet,config);
  expect(result.block).toBe(102);
  expect(result.walletTestTokenBalance).toBe(300n);
  expect(state.reads.some(read=>read.reader===1)).toBe(false);
  expect(state.destroyed).toEqual([0,1,2]);
 });
 it('never returns the partial snapshot when its confirmed block changes',async()=>{
  state.wrongAnchor.add(0);
  const result=await readV3Snapshot(walletProvider,wallet,config);
  expect(result.block).toBe(101);
  expect(result.walletTestTokenBalance).toBe(200n);
  expect(state.destroyed).toEqual([0,1]);
 });
 it('stops after all independent readers fail without falling back to wallet reads',async()=>{
  [0,1,2,3].forEach(index=>state.failures.add(index));
  await expect(readV3Snapshot(walletProvider,wallet,config)).rejects.toThrow('RPC rate limit');
  expect(state.readers).toEqual([0,1,2,3]);
  expect(state.destroyed).toEqual([0,1,2,3]);
  expect(state.browserReaders).toBe(0);
 });
 it('checks the wallet again before retrying and stops when authorization changes',async()=>{
  state.failures.add(0);state.changeWalletOnFailure=true;
  await expect(readV3Snapshot(walletProvider,wallet,config)).rejects.toThrow('Select the same connected wallet');
  expect(state.readers).toEqual([0]);
  expect(state.destroyed).toEqual([0]);
  expect(state.browserReaders).toBe(0);
 });
});
