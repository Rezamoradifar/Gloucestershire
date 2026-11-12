import {describe,expect,it} from 'vitest';
import {acceptPublicConfig} from '../src/config';
import {parseVerifiedHistorySnapshot,requestVerifiedHistory} from '../src/server-event-history';
const wallet='0x2222222222222222222222222222222222222222';
const vault='0x1111111111111111111111111111111111111111';
const token='0x4444444444444444444444444444444444444444';
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
acceptPublicConfig({chainId:97,vaultAddress:vault});
const query={wallet,asset:token,scope:'wallet' as const,kind:'finance' as const};
const log={
 address:vault,transactionHash:hash(5),blockHash:hash(190),blockNumber:190,
 index:1,topics:[hash(4),hash(2)],data:'0x',timestamp:1700000190
};
const page=(rows=[log])=>({
 version:1,chainId:97,vaultAddress:vault,wallet,asset:token,
 kind:'finance',scope:'wallet',confirmedHead:200,first:188,last:196,logs:rows
});
describe('server-backed global history client',()=>{
 it('validates complete confirmed pages and refuses wrong wallet, chain, vault and forged log',()=>{
  expect(parseVerifiedHistorySnapshot(page(),{...query,from:188,to:196}).logs).toHaveLength(1);
  expect(()=>parseVerifiedHistorySnapshot({...page(),chainId:56},{...query,from:188,to:196})).toThrow();
  expect(()=>parseVerifiedHistorySnapshot({...page(),wallet:vault},{...query,from:188,to:196})).toThrow();
  expect(()=>parseVerifiedHistorySnapshot({...page(),vaultAddress:wallet},{...query,from:188,to:196})).toThrow();
  expect(()=>parseVerifiedHistorySnapshot(page([log,log]),{...query,from:188,to:196})).toThrow();
  expect(()=>parseVerifiedHistorySnapshot(page([{...log,blockNumber:210}]),{...query,from:188,to:196})).toThrow();
  expect(()=>parseVerifiedHistorySnapshot(page([{...log,transactionHash:'private'}]),{...query,from:188,to:196})).toThrow();
 });
 it('requests exactly the verified server route, not wallet eth_getLogs',async()=>{
  const calls:string[]=[];
  const fetcher=async (resource:RequestInfo|URL)=>{
   calls.push(String(resource));
   return new Response(JSON.stringify(page()),{status:200});
  };
  const result=await requestVerifiedHistory({...query,from:188,to:196,fetcher:fetcher as typeof fetch});
  expect(result.logs[0].timestamp).toBe(1700000190);
  expect(calls[0]).toContain('/api/event-history/window?');
  expect(calls[0]).toContain('from=188');
  expect(calls[0]).toContain('to=196');
 });
 it('distinguishes missing backend from unavailable server RPC without leaking secrets',async()=>{
  const missing=async()=>new Response('{}',{status:404});
  await expect(requestVerifiedHistory({...query,from:188,to:196,fetcher:missing as typeof fetch}))
   .rejects.toThrow(/not been installed/);
  const failed=async()=>new Response(JSON.stringify({error:'private rpc key'}),{status:503});
  await expect(requestVerifiedHistory({...query,from:188,to:196,fetcher:failed as typeof fetch}))
   .rejects.toThrow(/temporarily unavailable/);
 });
 it('refuses unbounded and malformed scans before contacting a server',async()=>{
  let count=0;
  const fetcher=async()=>{count++;return new Response('{}',{status:200});};
  await expect(requestVerifiedHistory({...query,from:0,to:250,fetcher:fetcher as typeof fetch}))
   .rejects.toThrow(/Invalid history server request/);
  await expect(requestVerifiedHistory({...query,kind:'reward',scope:'global',from:10,to:12,fetcher:fetcher as typeof fetch}))
   .rejects.toThrow(/Invalid history server request/);
  expect(count).toBe(0);
 });
});
