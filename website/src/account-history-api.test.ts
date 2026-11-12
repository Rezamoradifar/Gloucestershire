import {describe,expect,it} from 'vitest';
import {fetchAccountHistory,mergeHistoryEntries,parseAccountHistoryPage,type HistoryEntry} from './account-history-api';

const wallet='0x2222222222222222222222222222222222222222';
const vault='0x1111111111111111111111111111111111111111';
const hash=(n:number)=>'0x'+n.toString(16).padStart(64,'0');
const row=(n:number,block:number):HistoryEntry=>({
 id:hash(n).toLowerCase()+':'+n,transactionHash:hash(n),blockNumber:block,logIndex:n,
 timestamp:'2026-11-12T12:00:00.000Z',confirmations:5,label:'Profit credited',
 kind:'ProfitCredited',asset:'USDT',amount:'0.500000000000000001',fee:null,
 detail:'Accounting credit only. This is not a payment to the external wallet.',
 positionId:null,requestId:null,queueStatus:null,source:'vault',confirmed:true
});
const page=(items:HistoryEntry[]=[],nextCursor:string|null=null)=>({
 version:1,chainId:97,vaultAddress:vault,wallet,confirmedThrough:100,
 scannedFrom:1,scannedTo:100,items,nextCursor
});
const parse=(value:unknown)=>parseAccountHistoryPage(value,{wallet,chainId:97,vaultAddress:vault});

describe('verified account history',()=>{
 it('explains missing server route and sanitized RPC archive or rate-limit errors',async()=>{
  const request={wallet,chainId:97,vaultAddress:vault};
  const unavailable=async()=>new Response(JSON.stringify({error:'temporarily unavailable',reason:'RATE_LIMITED'}),{status:503});
  await expect(fetchAccountHistory({...request,fetcher:unavailable as typeof fetch})).rejects.toThrow(/rate-limited/);
  const archive=async()=>new Response(JSON.stringify({reason:'ARCHIVE_REQUIRED'}),{status:503});
  await expect(fetchAccountHistory({...request,fetcher:archive as typeof fetch})).rejects.toThrow(/archive-capable/);
  const missing=async()=>new Response('{}',{status:404});
  await expect(fetchAccountHistory({...request,fetcher:missing as typeof fetch})).rejects.toThrow(/not installed/);
 });

 it('accepts a valid page with exact token precision and linked receipt',()=>{
  const entry=row(1,90);
  expect(parse(page([entry],'89:4294967295')).items[0]).toEqual(entry);
 });
 it('rejects wrong contract, wallet, chain, duplicate logs and unconfirmed events',()=>{
  const item=row(1,90);
  expect(()=>parse({...page([item]),vaultAddress:'0x3333333333333333333333333333333333333333'})).toThrow();
  expect(()=>parse({...page([item]),chainId:56})).toThrow();
  expect(()=>parse({...page([item]),wallet:'0x3333333333333333333333333333333333333333'})).toThrow();
  expect(()=>parse(page([item,item]))).toThrow();
  expect(()=>parse(page([{...item,confirmed:false} as unknown as HistoryEntry]))).toThrow();
  expect(()=>parse(page([{...item,asset:'BTC'} as unknown as HistoryEntry]))).toThrow();
  expect(()=>parse(page([{...item,amount:'not-a-number'}]))).toThrow();
  expect(()=>parse({...page([item]),nextCursor:'../etc/passwd'})).toThrow();
 });
 it('merges older pages without reordering or replaying transaction events',()=>{
  const recent=row(3,95),older=row(2,91),earliest=row(1,84);
  expect(mergeHistoryEntries([recent,older],[older,earliest]).map(x=>x.id))
   .toEqual([recent.id,older.id,earliest.id]);
 });
 it('requests bounded older pages and rejects HTTP errors without pretending history is empty',async()=>{
  const item=row(2,91),calls:string[]=[];
  const mock=async(input:RequestInfo|URL)=>{calls.push(String(input));return new Response(JSON.stringify(page([item],null)),{status:200,
   headers:{'Content-Type':'application/json'}});};
  const result=await fetchAccountHistory({wallet,chainId:97,vaultAddress:vault,before:'95:4',limit:30,fetcher:mock as typeof fetch});
  expect(result.items).toHaveLength(1);
  expect(calls[0]).toContain('before=95%3A4');
  const bad=async()=>new Response('{}',{status:503});
  await expect(fetchAccountHistory({wallet,chainId:97,vaultAddress:vault,fetcher:bad as typeof fetch})).rejects.toThrow(/unavailable/);
 });
});
