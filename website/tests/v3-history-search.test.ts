import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Interface,parseEther,type Filter} from 'ethers';
import type {V3SiteReleaseConfig} from '../src/v3-site-config';
vi.mock('../src/v3-chain',async original=>({...await original<typeof import('../src/v3-chain')>(),v3ReadSession:vi.fn()}));
import {V3_ABI,V3_INDEPENDENT_READER_COUNT,v3ReadSession} from '../src/v3-chain';
import {searchV3History,type V3HistoryQuery,type V3SearchProgress} from '../src/v3-history-search';

const wallet='0x2222222222222222222222222222222222222222';
const config={address:'0x1111111111111111111111111111111111111111'} as V3SiteReleaseConfig;
const start=100,head=40100,epoch=1700000000;
const hash=(n:number)=>'0x'+n.toString(16).padStart(64,'0');
const time=(n:number)=>epoch+3*n;
const iface=new Interface(V3_ABI);
const mocked=vi.mocked(v3ReadSession);
const walletProvider={request:vi.fn()};
const base:V3HistoryQuery={text:'',category:'deposits'};

function deposit(n:number){
 return {...iface.encodeEventLog(iface.getEvent('DepositRouted')!,[wallet,0n,...[100,10,10,80].map(String).map(s=>parseEther(s))]),
  blockNumber:n,blockHash:hash(n),index:0,address:config.address,transactionHash:hash(80000+n),removed:false};
}
function source(index=0){
 const rows=[deposit(200),deposit(201),deposit(31000),deposit(40001)];
 const getLogs=vi.fn(async(filter:Filter)=>{
  const topics=filter.topics?.[0];
  return filter.address===config.address&&Array.isArray(topics)&&topics.includes(rows[0].topics[0])?
   rows.filter(row=>row.blockNumber>=Number(filter.fromBlock)&&row.blockNumber<=Number(filter.toBlock)):[];
 });
 const getBlock=vi.fn(async(n:number)=>({number:n,hash:hash(n),timestamp:time(n)}));
 const getTransactionReceipt=vi.fn(async(tx:string)=>{
  const found=rows.find(row=>row.transactionHash===tx);
  return found?{hash:tx,blockNumber:found.blockNumber,blockHash:found.blockHash}:null;
 });
 const provider={getLogs,getBlock,getTransactionReceipt,destroy:vi.fn()};
 return {provider,readerIndex:index,block:{number:head,hash:hash(head)},deploymentBlock:start,rows};
}
function run(query:V3HistoryQuery,progress:V3SearchProgress[],abort=new AbortController()){
 return searchV3History(walletProvider,wallet,config,query,abort.signal,p=>progress.push(p));
}
beforeEach(()=>mocked.mockReset());
describe('confirmed wallet history search',()=>{
 it('collects matching events back to deployment, newest first, with one verified session',async()=>{
  const src=source();mocked.mockResolvedValueOnce(src as never);
  const pages:V3SearchProgress[]=[];
  await run({...base,text:'deposit'},pages);
  expect(pages.flatMap(p=>p.items.map(i=>i.block))).toEqual([40001,31000,201,200]);
  expect(pages.at(-1)?.scanned).toBe(head-start+1);
  expect(src.provider.getLogs.mock.calls.map(([f])=>[f.fromBlock,f.toBlock])).toEqual([[24101,40100],[8101,24100],[100,8100]]);
  expect(mocked).toHaveBeenCalledTimes(1);expect(src.provider.destroy).toHaveBeenCalledOnce();
 });
 it('looks up an old exact transaction in one block and applies wallet event filters',async()=>{
  const src=source();mocked.mockResolvedValueOnce(src as never);
  const pages:V3SearchProgress[]=[];
  await run({...base,text:hash(80200)},pages);
  expect(pages.flatMap(p=>p.items.map(i=>i.block))).toEqual([200]);
  expect(src.provider.getTransactionReceipt).toHaveBeenCalledWith(hash(80200));
  expect(src.provider.getLogs).toHaveBeenCalledTimes(1);
  expect(src.provider.getLogs.mock.calls[0][0]).toMatchObject({fromBlock:200,toBlock:200});
 });
 it('locates manager-submitted status changes through the beneficiary’s indexed request IDs',async()=>{
  const src=source(),manager='0x3333333333333333333333333333333333333333';
  const approval={...deposit(200),...iface.encodeEventLog(iface.getEvent('WithdrawalApproved')!,[9n,manager])};
  const count=vi.fn().mockResolvedValue(1n),id=vi.fn().mockResolvedValue(9n);
  const withIndex={...src,vault:{userWithdrawalCount:count,userWithdrawalId:id}};
  src.provider.getLogs.mockImplementation(async f=>Array.isArray(f.topics?.[1])&&f.topics[1].includes(hash(9))?[approval]:[]);
  mocked.mockResolvedValueOnce(withIndex as never);
  const pages:V3SearchProgress[]=[];await run({category:'withdrawals',text:approval.transactionHash},pages);
  expect(pages.flatMap(p=>p.items.map(i=>[i.title,i.detail]))).toEqual([['Withdrawal approved','Request #10 · Manager approval']]);
  expect(count).toHaveBeenCalledWith(wallet,{blockTag:head});expect(id).toHaveBeenCalledWith(wallet,0,{blockTag:head});
 });
 it('scans wallet logs if a reader pruned the transaction receipt',async()=>{
  const src=source();src.provider.getTransactionReceipt.mockResolvedValue(null);
  mocked.mockResolvedValueOnce(src as never);
  const pages:V3SearchProgress[]=[];
  await run({...base,text:hash(80200)},pages);
  expect(pages.flatMap(p=>p.items.map(i=>i.block))).toEqual([200]);
  expect(pages.at(-1)?.scanned).toEqual(head-start+1);
 });
 it('limits RPC work to an inclusive start and exclusive end timestamp',async()=>{
  const src=source();mocked.mockResolvedValueOnce(src as never);
  const pages:V3SearchProgress[]=[];
  await run({...base,start:time(200),end:time(201)},pages);
  expect(pages.flatMap(p=>p.items.map(i=>i.block))).toEqual([200]);
  expect(src.provider.getLogs.mock.calls[0][0]).toMatchObject({fromBlock:200,toBlock:200});
 });
 it('retries an unfinished range without appending previously committed results twice',async()=>{
  const first=source(),second=source(1);
  const original=first.provider.getLogs.getMockImplementation()!;
  first.provider.getLogs.mockImplementation(async f=>Number(f.toBlock)<head?Promise.reject(Error('RPC unavailable')):original(f));
  mocked.mockResolvedValueOnce(first as never).mockResolvedValueOnce(second as never);
  const pages:V3SearchProgress[]=[];await run(base,pages);
  expect(second.provider.getLogs.mock.calls[0][0].toBlock).toBe(24100);
  expect(pages.flatMap(p=>p.items.map(i=>i.block))).toEqual([40001,31000,201,200]);
  expect(first.provider.destroy).toHaveBeenCalledOnce();expect(second.provider.destroy).toHaveBeenCalledOnce();
 });
 it('learns a provider block range limit and covers all remaining blocks once',async()=>{
  const src=source(),original=src.provider.getLogs.getMockImplementation()!;
  src.provider.getLogs.mockImplementation(async f=>{
   if(Number(f.toBlock)-Number(f.fromBlock)+1>1000)throw {code:-32005,message:'block range too large'};
   return original(f);
  });
  mocked.mockResolvedValueOnce(src as never);
  const pages:V3SearchProgress[]=[];await run(base,pages);
  expect(pages.flatMap(p=>p.items.map(i=>i.block))).toEqual([40001,31000,201,200]);
  expect(pages.at(-1)?.scanned).toBe(head-start+1);expect(mocked).toHaveBeenCalledOnce();
  expect(src.provider.getLogs.mock.calls.length).toBeLessThan(50);
 });
 it('reports incomplete coverage when an older range cannot be verified',async()=>{
  const src=source(V3_INDEPENDENT_READER_COUNT);const original=src.provider.getLogs.getMockImplementation()!;
  src.provider.getLogs.mockImplementation(async f=>Number(f.toBlock)<head?Promise.reject(Error('RPC unavailable')):original(f));
  mocked.mockResolvedValueOnce(src as never);
  const pages:V3SearchProgress[]=[];
  await expect(run(base,pages)).rejects.toThrow('Unable to load the complete activity');
  expect(pages.at(-1)?.scanned).toBe(16000);
 });
 it('cancels further requests and releases the active provider',async()=>{
  const src=source(),abort=new AbortController();mocked.mockResolvedValueOnce(src as never);
  await expect(searchV3History(walletProvider,wallet,config,base,abort.signal,p=>{if(p.scanned)abort.abort();})).rejects.toMatchObject({name:'AbortError'});
  expect(src.provider.getLogs).toHaveBeenCalledTimes(1);expect(src.provider.destroy).toHaveBeenCalledOnce();
 });
});
