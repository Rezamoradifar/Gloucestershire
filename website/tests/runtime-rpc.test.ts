import {describe,it,expect,vi} from 'vitest';
import {readEventPage} from '../src/adaptive-event-logs';
import type {BrowserProvider,Log} from 'ethers';

describe('restricted wallet RPC historical event scans',()=>{
 it('reduces an overlarge log range to a supported window instead of failing',async()=>{
  const getLogs=vi.fn(async({fromBlock,toBlock}:{fromBlock:number;toBlock:number})=>{
   if(toBlock-fromBlock+1>10)throw Error('query returned more than allowed range');
   return [{blockNumber:toBlock}] as unknown as Log[];
  });
  const provider={getLogs} as unknown as BrowserProvider;
  const result=await readEventPage(provider,{address:'0x1111111111111111111111111111111111111111',topics:[]},200,300,64);
  expect(result.first).toBe(293); // 64 -> 32 -> 16 -> 8
  expect(getLogs).toHaveBeenCalledTimes(4);
  expect(result.logs[0].blockNumber).toBe(300);
 });
 it('reports a specific unsupported provider error on a one-block failure',async()=>{
  const provider={getLogs:vi.fn(async()=>{throw Error('eth_getLogs disabled');})} as unknown as BrowserProvider;
  await expect(readEventPage(provider,{address:'0x1111111111111111111111111111111111111111',topics:[]},4,4))
   .rejects.toThrow('Historical events are unavailable');
 });
 it('rejects reversed block windows and never sends a query',async()=>{
  const getLogs=vi.fn();
  const provider={getLogs} as unknown as BrowserProvider;
  await expect(readEventPage(provider,{address:'0x1111111111111111111111111111111111111111',topics:[]},10,9))
    .rejects.toThrow('Invalid history block window');
  expect(getLogs).not.toHaveBeenCalled();
 });
});
