import {toBeHex,type Contract,type Eip1193Provider,type Provider} from 'ethers';
import {V3_INDEPENDENT_READER_COUNT,v3ReadSession} from './v3-chain';
import {historyRangeLimited,historyTooDense,historyUnavailable,queryV3HistoryRange,type V3HistoryAnchor,type V3HistoryCategory,type V3HistoryItem} from './v3-history';
import type {V3SiteReleaseConfig} from './v3-site-config';

export type V3HistoryQuery={text:string;category:V3HistoryCategory|'all';start?:number;end?:number};
type BlockRange={from:number;to:number};
export type V3SearchProgress={anchor:V3HistoryAnchor;range:BlockRange;scanned:number;items:V3HistoryItem[]};
const blockWindow=16000;

async function checkAnchor(provider:Provider,anchor:V3HistoryAnchor,signal:AbortSignal){
 signal.throwIfAborted();
 const block=await provider.getBlock(anchor.block).catch(()=>null);
 if(!block?.hash)throw Error(historyUnavailable);
 if(block.hash.toLowerCase()!==anchor.hash.toLowerCase())throw Error('The confirmed history block changed. Refresh history.');
}

// Convert UTC time boundaries to canonical block boundaries even when
// individual event timestamps are unavailable. BNB blocks have ordered timestamps.
async function searchRange(provider:Provider,anchor:V3HistoryAnchor,query:V3HistoryQuery,signal:AbortSignal):Promise<BlockRange>{
 let from=anchor.firstBlock,to=anchor.block;
 if(/^0x[0-9a-f]{64}$/i.test(query.text)){
  signal.throwIfAborted();
  const receipt=await provider.getTransactionReceipt(query.text).catch(()=>{throw Error(historyUnavailable);});
  // Some readers prune receipts. A missing receipt still permits a full indexed log search.
  if(receipt){
   if(receipt.hash.toLowerCase()!==query.text.toLowerCase()||!Number.isSafeInteger(receipt.blockNumber))
    throw Error(historyUnavailable);
   if(receipt.blockNumber<from||receipt.blockNumber>to)return {from,to:from-1};
   const block=await provider.getBlock(receipt.blockNumber).catch(()=>null);
   if(!block?.hash||block.hash.toLowerCase()!==receipt.blockHash.toLowerCase())throw Error(historyUnavailable);
   from=to=receipt.blockNumber;
  }
 }
 async function lowerBound(target:number,lo:number,hi:number){
  let upper=hi+1;
  while(lo<upper){
   signal.throwIfAborted();
   const mid=lo+Math.floor((upper-lo)/2);
   const block=await provider.getBlock(mid).catch(()=>null);
   if(!block?.hash||block.number!==mid||!Number.isSafeInteger(block.timestamp)||block.timestamp<=0)throw Error(historyUnavailable);
   if(block.timestamp<target)lo=mid+1;
   else upper=mid;
  }
  return lo;
 }
 if(query.start!==undefined)from=await lowerBound(query.start,from,to);
 if(query.end!==undefined && from<=to)to=await lowerBound(query.end,from,to)-1;
 return {from,to};
}

// Manager and escrow events are indexed by request ID, not by beneficiary.
// Read only this wallet's on-chain request index at the verified search anchor.
async function withdrawalTopics(vault:Contract,wallet:string,blockTag:number,signal:AbortSignal){
 const options={blockTag},ids=new Set<string>();
 const count=Number(await vault.userWithdrawalCount(wallet,options).catch(()=>{throw Error(historyUnavailable);}));
 if(!Number.isSafeInteger(count)||count<0||count>1000000)throw Error('Invalid withdrawal request count.');
 for(let start=0;start<count;start+=8){
  signal.throwIfAborted();
  const batch=await Promise.all(Array.from({length:Math.min(8,count-start)},(_,i)=>
   vault.userWithdrawalId(wallet,start+i,options) as Promise<bigint>)).catch(()=>{throw Error(historyUnavailable);});
  for(const id of batch){
   const value=toBeHex(id,32);
   if(ids.has(value))throw Error('Duplicate wallet withdrawal request.');
   ids.add(value);
  }
 }
 return ids;
}

// Stream confirmed matches newest first. Fail over at the first unfinished
// block, rechecking the same anchor on the replacement source.
export async function searchV3History(walletProvider:Eip1193Provider,wallet:string,config:V3SiteReleaseConfig,
 query:V3HistoryQuery,signal:AbortSignal,onProgress:(progress:V3SearchProgress)=>void,initialAnchor:V3HistoryAnchor|null=null){
 const text=query.text.trim().toLowerCase();
 if([query.start,query.end].some(t=>t!==undefined&&(!Number.isSafeInteger(t)||t<0))||
   (query.start!==undefined&&query.end!==undefined&&query.start>=query.end))throw Error('Choose a valid UTC date range.');
 let anchor=initialAnchor,range:BlockRange|null=null,cursor:number|undefined;
 let ownedRequests:Set<string>|undefined;
 let nextReader=0;
 while(nextReader<=V3_INDEPENDENT_READER_COUNT){
  signal.throwIfAborted();
  const session=await v3ReadSession(walletProvider,wallet,config,false,nextReader).catch(()=>{throw Error(historyUnavailable);});
  let closed=false;
  const close=()=>{if(!closed){closed=true;session.provider.destroy();}};
  signal.addEventListener('abort',close,{once:true});
  try{
   signal.throwIfAborted();
   anchor=anchor??{block:session.block.number,hash:session.block.hash!,firstBlock:session.deploymentBlock};
   if(anchor.firstBlock!==session.deploymentBlock||anchor.block>session.block.number)throw Error('History anchor or deployment block is no longer verified.');
   await checkAnchor(session.provider,anchor,signal);
   if(!range){
    const selected=await searchRange(session.provider,anchor,{...query,text},signal);
    await checkAnchor(session.provider,anchor,signal);
    range=selected;
    cursor=range.to;
    onProgress({anchor,range,scanned:0,items:[]});
   }
   if(range.from<=range.to&&(query.category==='all'||query.category==='withdrawals')&&!ownedRequests)
    ownedRequests=await withdrawalTopics(session.vault,wallet,anchor.block,signal);
   let limit=blockWindow,span=limit;
   while(cursor!==undefined && cursor>=range.from){
    signal.throwIfAborted();
    const from=Math.max(range.from,cursor-span+1);
    try{
     const page=await queryV3HistoryRange(session.provider,config.address,wallet,anchor,{from,to:cursor},
      config.unified?.network,query.category,signal,ownedRequests);
     const items=page.items.filter(item=>(query.category==='all'||item.category===query.category)&&
      (!text||[item.transaction,item.title,item.detail].some(value=>value.toLowerCase().includes(text))));
     cursor=from-1;
     onProgress({anchor,range,scanned:range.to-cursor,items});
     if(span<limit)span=Math.min(span*2,limit);
    }catch(error){
     if(error instanceof Error&&[historyTooDense,historyRangeLimited].includes(error.message)&&from<cursor){
      span=Math.ceil((cursor-from+1)/2);
      if(error.message===historyRangeLimited)limit=span;
      continue;
     }
     throw error;
    }
   }
   return;
  }catch(error){
   signal.throwIfAborted();
   if(!(error instanceof Error)||error.message!==historyUnavailable||session.readerIndex>=V3_INDEPENDENT_READER_COUNT)throw error;
   nextReader=session.readerIndex+1;
  }finally{
   signal.removeEventListener('abort',close);
   close();
  }
 }
 throw Error(historyUnavailable);
}
