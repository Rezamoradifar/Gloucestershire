import {describe,expect,it,vi} from 'vitest';
import {Interface,parseEther} from 'ethers';
import {readServerHistoryPage,readServerWithdrawals,searchServerHistory} from '../src/v3-server-history';
import {V3_ABI} from '../src/v3-chain';
import {V3_TEST_TOKEN,type V3SiteReleaseConfig} from '../src/v3-site-config';
import type {V3SearchProgress} from '../src/v3-history-search';

const wallet='0x1111111111111111111111111111111111111111';
const vault='0x2222222222222222222222222222222222222222';
const network='0x3333333333333333333333333333333333333333';
const hash=(n:number)=>'0x'+n.toString(16).padStart(64,'0');
const config={address:vault,unified:{portfolio:true,network}} as V3SiteReleaseConfig;
const anchor={block:4101,firstBlock:100,hash:hash(4101)};
const identity={version:1,chainId:97,wallet,vault,network,token:V3_TEST_TOKEN,anchor};
const bootstrap={...identity,range:{from:100,to:4101},logs:[],requestIds:[]};
const iface=new Interface(V3_ABI);
function deposit(owner:string,n:number){
 return {address:vault,blockNumber:n,index:0,blockHash:hash(n),timestamp:1800000000,transactionHash:hash(7),
  ...iface.encodeEventLog(iface.getEvent('DepositRouted')!,[owner,0n,100n,10n,10n,80n])};
}
function fixture(fn:(params:URLSearchParams)=>unknown|Response){
 const fetcher=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
  const url=new URL(String(input),'https://globaldroptrade.com');
  expect(String(input)).toMatch(/^\/api\/v3\/member-(?:history|withdrawals)\?/);
  expect(options?.redirect).toBe('error');
  expect(url.searchParams.get('wallet')).toBe(wallet);expect(url.searchParams.get('vault')).toBe(vault);
  const out=await fn(url.searchParams);return out instanceof Response?out:Response.json(out);
 });
 return {wallet,config,signal:new AbortController().signal,fetcher};
}
describe('server-backed portfolio history',()=>{
 it('scans contiguous server-confirmed ranges even when the server narrows its request',async()=>{
  const ranges:number[][]=[],req=fixture(p=>{
   if(!p.has('from'))return bootstrap;
   const from=Number(p.get('from')),to=Number(p.get('to'));
   expect(p.get('hash')).toBe(anchor.hash);expect(p.get('category')).toBe('deposits');
   ranges.push([from,to]);const start=Math.max(from,to-1700);
   return {...identity,range:{from:start,to},logs:start===100?[deposit(wallet,201)]:[],requestIds:[]};
  });
  const updates:V3SearchProgress[]=[];
  await searchServerHistory(req,{text:'deposit',category:'deposits'},v=>updates.push(v),null);
  expect(ranges).toEqual([[100,4101],[100,2400],[100,699]]);
  expect(updates.at(-1)?.scanned).toBe(4002);
  expect(updates.flatMap(u=>u.items).map(i=>[i.block,i.timestamp,i.title])).toEqual([[201,1800000000,'Test-token deposit']]);
 });
 it('asks the server to narrow a full transaction ID and date bounds, and excludes other hashes',async()=>{
  const req=fixture(p=>{
   if(!p.has('from')){
    expect(p.get('tx')).toBe(hash(9));expect(p.get('start')).toBe('1799999999');expect(p.get('end')).toBe('1800000001');
    return {...bootstrap,range:{from:210,to:210}};
   }
   return {...identity,range:{from:210,to:210},requestIds:[],logs:[deposit(wallet,210)]};
  });
  let hit=false;
  await searchServerHistory(req,{text:hash(9),category:'all',start:1799999999,end:1800000001},v=>{hit||=!!v.items.length;},anchor);
  expect(req.fetcher).toHaveBeenCalledTimes(2);expect(hit).toBe(false);
 });
 it('uses the accepted end of the previous browse page, rejecting gaps and wrong owners',async()=>{
  const first=fixture(p=>p.has('from')?{...bootstrap,range:{from:3100,to:4101}}:bootstrap);
  const page=await readServerHistoryPage(first,0,null);expect(page.from).toBe(3100);
  const next=fixture(p=>{
   expect(p.get('to')).toBe('3099');
   return {...bootstrap,range:{from:1100,to:3099},logs:[deposit(network,3000)]};
  });
  await expect(readServerHistoryPage(next,1,page.anchor,page.from-1)).rejects.toThrow('wallet');
  await expect(readServerHistoryPage(fixture(()=>({...bootstrap,range:{from:2102,to:4100}})),0,anchor)).rejects.toThrow('inconsistent');
 });
 it('refuses changed wallet, confirmed block, network or missing times and surfaces server failures',async()=>{
  for(const patch of [{wallet:network},{chainId:56},{network:wallet},{anchor:{...anchor,hash:hash(42)}},
    {logs:[{...deposit(wallet,4000),timestamp:null}]}]){
   const req=fixture(()=>({...bootstrap,range:{from:2102,to:4101},...patch}));
   await expect(readServerHistoryPage(req,0,anchor)).rejects.toThrow('inconsistent');
  }
  const unavailable=fixture(()=>new Response('',{status:503}));
  await expect(readServerHistoryPage(unavailable,0,null)).rejects.toThrow('could not verify');
  expect(unavailable.fetcher).toHaveBeenCalledTimes(1);
 });
 it('returns precise funded combined requests and checks beneficiary, recorded sources, fees and total',async()=>{
  const wei=(n:string)=>parseEther(n).toString();
  const item={id:35,beneficiary:wallet,positionId:0,gross:wei('20'),fee:wei('3.2'),requestedAt:1800000000,kind:4,status:2,
   allocation:{personal:wei('8'),referral:wei('2'),network:'0',principal:wei('10')}};
  const req=fixture(p=>{
   expect(p.get('page')).toBe('1');expect(p.get('anchor')).toBe('4101');
   return {...identity,page:1,total:21,items:[item]};
  });
  const rows=await readServerWithdrawals(req,1,anchor);
  expect(rows.items[0].allocation?.principal).toBe(parseEther('10'));expect(rows.items[0].fee).toBe(parseEther('3.2'));
  for(const change of [{beneficiary:network},{allocation:undefined},{kind:0,allocation:undefined},{fee:'0'},{gross:'1e20'},{status:6}]){
   await expect(readServerWithdrawals(fixture(()=>({...identity,page:0,total:1,items:[{...item,...change}]})),0,null)).rejects.toThrow('inconsistent');
  }
 });
});
