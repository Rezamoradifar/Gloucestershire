import {getAddress, isAddress, ZeroAddress} from 'ethers';
import {decodeV3HistoryLogs, type V3HistoryAnchor, type V3RawHistoryLog} from './v3-history';
import type {V3HistoryQuery, V3SearchProgress} from './v3-history-search';
import {V3_TEST_TOKEN, type V3SiteReleaseConfig} from './v3-site-config';
import type {V3Withdrawal} from './v3-chain';
import {v3WithdrawalFee} from './v3-withdrawal-form';
import type {V3WithdrawalAnchor, V3WithdrawalPage} from './v3-withdrawal-history';

type Range = {from:number; to:number};
type HistoryRequest = {wallet:string; config:V3SiteReleaseConfig; signal:AbortSignal; fetcher?:typeof fetch};
type Header = {version:number;chainId:number;wallet:string;vault:string;network:string;token:string;anchor:V3HistoryAnchor};
const whole=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const same=(a:unknown,b:string)=>typeof a==='string'&&isAddress(a)&&getAddress(a)===getAddress(b);
const maxWindow=16000;
export class HistoryServerError extends Error {}
function verify(ok:unknown):asserts ok{
 if(!ok)throw new HistoryServerError('The history server returned inconsistent records. Refresh to retry.');
}
async function read(endpoint:string,request:HistoryRequest,anchor:V3WithdrawalAnchor|null,params:URLSearchParams){
 const {wallet,config,signal,fetcher=fetch}=request;
 params.set('wallet',getAddress(wallet));params.set('vault',getAddress(config.address));
 if(anchor){params.set('anchor',String(anchor.block));params.set('hash',anchor.hash);}
 let response:Response;
 try{
  response=await fetcher('/api/v3/'+endpoint+'?'+params,{
   signal:AbortSignal.any([signal,AbortSignal.timeout(60000)]),cache:'no-store',redirect:'error',
   headers:{Accept:'application/json'}
  });
 }catch{
  signal.throwIfAborted();
  throw new HistoryServerError('The history server is unreachable. Retry to load confirmed records.');
 }
 signal.throwIfAborted();
 if(!response.ok){
  if(response.status===409)throw new HistoryServerError('The confirmed history block changed. Refresh history.');
  if(response.status===429)throw new HistoryServerError('The history server is busy. Retry shortly.');
  throw new HistoryServerError('The server could not verify this account history. Retry shortly.');
 }
 let data:unknown;
 try{data=await response.json();}catch{throw new HistoryServerError('The history server returned an unreadable response. Retry shortly.');}
 signal.throwIfAborted();
 verify(data&&typeof data==='object');
 const v=data as Header;
 verify(v.version===1&&v.chainId===97&&same(v.vault,config.address)&&same(v.wallet,wallet)&&
  same(v.token,V3_TEST_TOKEN)&&config.unified?.network&&same(v.network,config.unified.network));
 verify(v.anchor&&whole(v.anchor.firstBlock)&&whole(v.anchor.block)&&v.anchor.firstBlock<=v.anchor.block&&hash(v.anchor.hash));
 if(anchor)verify(v.anchor.block===anchor.block&&v.anchor.hash.toLowerCase()===anchor.hash.toLowerCase()&&
  (!('firstBlock' in anchor)||anchor.firstBlock===v.anchor.firstBlock));
 return v;
}

type ServerLog=V3RawHistoryLog&{timestamp:number};
type HistoryWire=Header&{range:Range;logs:ServerLog[];requestIds:string[]};
async function history(request:HistoryRequest,query:V3HistoryQuery|null,anchor:V3HistoryAnchor|null,window?:Range){
 const params=new URLSearchParams();
 if(window){
  params.set('from',String(window.from));params.set('to',String(window.to));
  if(query&&query.category!=='all')params.set('category',query.category);
 }else if(query){
  if(hash(query.text.trim()))params.set('tx',query.text.trim().toLowerCase());
  if(query.start!==undefined)params.set('start',String(query.start));
  if(query.end!==undefined)params.set('end',String(query.end));
 }
 const v=await read('member-history',request,anchor,params) as HistoryWire;
 verify(v.range&&whole(v.range.from)&&whole(v.range.to)&&
  v.range.from>=v.anchor.firstBlock&&v.range.from<=v.anchor.block+1&&
  v.range.to>=v.anchor.firstBlock-1&&v.range.to<=v.anchor.block&&v.range.from<=v.range.to+1);
 verify(Array.isArray(v.logs)&&v.logs.length<=10000&&Array.isArray(v.requestIds)&&v.requestIds.length<=v.logs.length&&v.requestIds.every(hash));
 if(!window){
  verify(v.logs.length===0&&v.requestIds.length===0);
  if(!query||(!hash(query.text.trim())&&query.start===undefined&&query.end===undefined))
   verify(v.range.from===v.anchor.firstBlock&&v.range.to===v.anchor.block);
 }else verify(v.range.from>=window.from&&v.range.to===window.to&&v.range.from<=v.range.to);
 const times=new Map<number,number>();
 for(const log of v.logs){
  verify(log&&typeof log==='object'&&isAddress(log.address)&&hash(log.transactionHash)&&hash(log.blockHash)&&
   whole(log.blockNumber)&&log.blockNumber>=v.range.from&&log.blockNumber<=v.range.to&&whole(log.index)&&
   whole(log.timestamp)&&log.timestamp>0&&log.timestamp<=8640000000000&&
   Array.isArray(log.topics)&&log.topics.length>0&&log.topics.length<=4&&log.topics.every(hash)&&
   typeof log.data==='string'&&/^0x(?:[0-9a-f]{2})*$/i.test(log.data)&&!log.removed);
  verify(log.blockNumber!==v.anchor.block||log.blockHash.toLowerCase()===v.anchor.hash.toLowerCase());
  verify(!times.has(log.blockNumber)||times.get(log.blockNumber)===log.timestamp);
  times.set(log.blockNumber,log.timestamp);
 }
 const ids=new Set(v.requestIds.map(id=>id.toLowerCase()));
 verify(ids.size===v.requestIds.length);
 let decoded;
 try{decoded=decodeV3HistoryLogs(v.logs,getAddress(v.vault),getAddress(v.wallet),getAddress(v.network),v.range,ids);}
 catch{throw new HistoryServerError('The history server returned events that do not reconcile for this wallet. Refresh to retry.');}
 for(const item of decoded.items)item.timestamp=times.get(item.block);
 return {anchor:v.anchor,range:v.range,items:decoded.items};
}

export async function readServerHistoryPage(request:HistoryRequest,page:number,anchor:V3HistoryAnchor|null,to?:number){
 const selected=anchor??(await history(request,null,null)).anchor;
 const end=to??selected.block;
 verify(whole(end)&&end>=selected.firstBlock&&end<=selected.block);
 const result=await history(request,null,selected,{from:Math.max(selected.firstBlock,end-1999),to:end});
 return {anchor:result.anchor,page,...result.range,items:result.items};
}

export async function searchServerHistory(request:HistoryRequest,query:V3HistoryQuery,
 onProgress:(p:V3SearchProgress)=>void,anchor:V3HistoryAnchor|null){
 const text=query.text.trim().toLowerCase();
 const bootstrap=await history(request,query,anchor);
 const range=bootstrap.range;
 onProgress({anchor:bootstrap.anchor,range,scanned:0,items:[]});
 let to=range.to;
 while(to>=range.from){
  request.signal.throwIfAborted();
  const result=await history(request,query,bootstrap.anchor,{from:Math.max(range.from,to-maxWindow+1),to});
  const items=result.items.filter(item=>(query.category==='all'||item.category===query.category)&&
   (query.start===undefined||item.timestamp!>=query.start)&&(query.end===undefined||item.timestamp!<query.end)&&
   (!text||[item.transaction,item.title,item.detail].some(value=>value.toLowerCase().includes(text))));
  to=result.range.from-1;
  onProgress({anchor:bootstrap.anchor,range,scanned:range.to-to,items});
 }
}

const uint256=(v:unknown):bigint=>{
 verify(typeof v==='string'&&/^(?:0|[1-9]\d{0,77})$/.test(v));
 const n=BigInt(v);verify(n<(1n<<256n));return n;
};
type RequestWire={id:number;beneficiary:string;positionId:number;gross:string;fee:string;requestedAt:number;status:number;kind:number;
 allocation?:{personal:string;referral:string;network:string;principal:string}};
export async function readServerWithdrawals(request:HistoryRequest,page:number,anchor:V3WithdrawalAnchor|null):Promise<V3WithdrawalPage>{
 const v=await read('member-withdrawals',request,anchor,new URLSearchParams({page:String(page)})) as Header&{page:number;total:number;items:RequestWire[]};
 verify(v.page===page&&whole(page)&&whole(v.total)&&(page===0||page*20<v.total)&&
  Array.isArray(v.items)&&v.items.length===Math.min(20,Math.max(0,v.total-page*20)));
 const ids=new Set<number>();
 const items:V3Withdrawal[]=v.items.map(r=>{
  verify(r&&whole(r.id)&&!ids.has(r.id)&&same(r.beneficiary,request.wallet)&&getAddress(r.beneficiary)!==ZeroAddress&&
   whole(r.positionId)&&whole(r.requestedAt)&&r.requestedAt>0&&r.requestedAt<=8640000000000&&whole(r.status)&&r.status<=5&&r.kind===4);
  ids.add(r.id);
  const gross=uint256(r.gross),fee=uint256(r.fee);verify(gross>0n&&fee<=gross);
  const {allocation:raw,...row}=r;
  verify(raw);
  const allocation={personal:uint256(raw.personal),referral:uint256(raw.referral),network:uint256(raw.network),principal:uint256(raw.principal)};
  const earnings=allocation.personal+allocation.referral+allocation.network;
  verify(earnings+allocation.principal===gross&&v3WithdrawalFee(earnings,false,true)+v3WithdrawalFee(allocation.principal,true)===fee);
  return {...row,gross,fee,allocation};
 });
 return {page,total:v.total,anchor:v.anchor,items};
}
