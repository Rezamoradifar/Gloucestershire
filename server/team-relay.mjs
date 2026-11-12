// Public, signer-free referral tree relay. All membership edges are verified
// contract logs read on the server, never from an injected mobile-wallet RPC.
import {Contract,FetchRequest,Interface,JsonRpcProvider,ZeroAddress,getAddress,zeroPadValue} from 'ethers';
import {getCompleteLogs} from '../scripts/complete-rpc-logs.mjs';

const registered=new Interface(['event Registered(address indexed user,address indexed referrer)']);
const topic=registered.getEvent('Registered').topicHash;
const fail=code=>{const error=Error(code);error.code=code;throw error;};
const address=value=>{try{const a=getAddress(value);if(a===ZeroAddress)throw Error();return a;}catch{fail('TEAM_RELAY_BAD_REQUEST');}};
const integer=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value));
const hexHash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
export const TEAM_PAGE_SPAN=96;

export function parseTeamQuery(params){
 const keys=[...params.keys()];
 if(keys.length!==new Set(keys).size||keys.some(k=>!['parent','wallet','from','to','block','mode'].includes(k)))fail('TEAM_RELAY_BAD_REQUEST');
 const isMember=params.has('wallet'),isPage=params.has('parent');
 if(isMember===isPage)fail('TEAM_RELAY_BAD_REQUEST');
 if(isPage){
  if(params.has('block')||params.has('mode'))fail('TEAM_RELAY_BAD_REQUEST');
  const parent=address(params.get('parent'));
  const from=params.get('from'),to=params.get('to');
  if((from===null)!==(to===null))fail('TEAM_RELAY_BAD_REQUEST');
  if(from!==null&&(!integer(from)||!integer(to)||Number(from)>Number(to)||Number(to)-Number(from)+1>TEAM_PAGE_SPAN))
   fail('TEAM_RELAY_BAD_REQUEST');
  return {kind:'registrations',parent,...(from!==null?{from:Number(from),to:Number(to)}:{})};
 }
 if(params.has('from')||params.has('to')||(params.has('block')&&!integer(params.get('block')))||
  (params.has('mode')&&params.get('mode')!=='volume'))fail('TEAM_RELAY_BAD_REQUEST');
 return {kind:params.get('mode')==='volume'?'volume':'member',wallet:address(params.get('wallet')),...(params.has('block')?{block:Number(params.get('block'))}:{})};
}

// Read the exact contract's subtree volume accounting at one canonical block.
// Never return a partial or guessed sum when propagation is still pending.
const MAX_MEMBERS=4096,MAX_CONCURRENCY=4;
async function bounded(items,fn){
 const values=new Array(items.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(MAX_CONCURRENCY,items.length)},async()=>{
  while(cursor<items.length){const i=cursor++;values[i]=await fn(items[i]);}
 }));
 return values;
}
export async function verifiedVolumes(provider,address,wallet,block){
 const vault=new Contract(address,[
  'function volumeJobCount() view returns(uint256)',
  'function networkBranchCount(address) view returns(uint256)',
  'function networkBranch(address,uint256) view returns(address)',
  'function branchVolumeUsd(address,address) view returns(uint256)'
 ],provider);
 const at={blockTag:block};
 const jobs=Number(await vault.volumeJobCount(at));
 if(!Number.isSafeInteger(jobs)||jobs>MAX_MEMBERS)fail('TEAM_RELAY_INDEX_REQUIRED');
 // A pending propagation job makes the stored subtree balances incomplete.
 for(let start=0;start<jobs;start+=64) {
  // The original contract getter is required for pending-job identity checks.
  // No salary or reward amount is inferred from incomplete propagation.
  fail('TEAM_RELAY_PROPAGATION_PENDING');
 }
 const seen=new Set([wallet.toLowerCase()]),subtrees=[0n,0n,0n,0n],members=[0,0,0];
 let parents=[wallet],total=0;
 for(let depth=0;depth<4;depth++){
  const counts=await bounded(parents,async parent=>({parent,count:Number(await vault.networkBranchCount(parent,at))}));
  if(counts.some(row=>!Number.isSafeInteger(row.count)||row.count<0))fail('TEAM_RELAY_INDEX_REQUIRED');
  const number=counts.reduce((sum,row)=>sum+row.count,0);total+=number;
  if(total>MAX_MEMBERS)fail('TEAM_RELAY_INDEX_REQUIRED');
  const edges=counts.flatMap(({parent,count})=>Array.from({length:count},(_,i)=>({parent,index:i})));
  const rows=await bounded(edges,async({parent,index})=>{
   const child=getAddress(await vault.networkBranch(parent,index,at));
   return {child,volume:BigInt(await vault.branchVolumeUsd(parent,child,at))};
  });
  for(const row of rows){
   if(seen.has(row.child.toLowerCase()))fail('TEAM_RELAY_DUPLICATE_BRANCH');
   seen.add(row.child.toLowerCase());subtrees[depth]+=row.volume;
  }
  if(depth<3)members[depth]=rows.length;
  parents=rows.map(row=>row.child);
 }
 if(subtrees.some((value,i)=>i<3&&value<subtrees[i+1]))fail('TEAM_RELAY_VOLUME_INCONSISTENT');
 return members.map((count,i)=>({level:i+1,members:count,volume:(subtrees[i]-subtrees[i+1]).toString()}));
}

export async function readTeamSnapshot({provider,config,query}){
 if(!provider||!config?.address||![56,97].includes(config.chainId)||!Number.isSafeInteger(config.confirmations))fail('TEAM_RELAY_CONFIG_INVALID');
 if(Number(await provider.send('eth_chainId',[]))!==config.chainId)fail('TEAM_RELAY_WRONG_CHAIN');
 if(await provider.getCode(config.address)==='0x')fail('TEAM_RELAY_CONTRACT_MISSING');
 const head=await provider.getBlockNumber();
 const confirmedHead=head-Math.max(3,config.confirmations);
 const checkpoint=await provider.getBlock(confirmedHead);
 if(!Number.isSafeInteger(confirmedHead)||confirmedHead<0||!checkpoint||checkpoint.number!==confirmedHead||!hexHash(checkpoint.hash))
  fail('TEAM_RELAY_HEAD_UNAVAILABLE');
 const base={version:1,chainId:config.chainId,vaultAddress:getAddress(config.address),confirmedHead};
 if(query.kind==='registrations'&&query.from===undefined)return {...base,kind:'registrations',parent:query.parent,first:null,last:null,members:[]};
 const block=query.kind==='registrations'?query.to:(query.block??confirmedHead);
 if(block>confirmedHead)fail('TEAM_RELAY_NOT_CONFIRMED');
 const at=await provider.getBlock(block);
 if(!at||at.number!==block||!hexHash(at.hash))fail('TEAM_RELAY_CHECKPOINT_INVALID');
 let result;
 if(query.kind==='volume'){
  result={...base,kind:'volume',wallet:query.wallet,block,levels:await verifiedVolumes(provider,config.address,query.wallet,block)};
 }else if(query.kind==='member'){
  const vault=new Contract(config.address,[
   'function users(address) view returns(address referrer,bool registered,bool active,bool vipKyc,uint32 activeDirect,uint256 capitalUsd,uint256 salesUsd)'
  ],provider);
  const user=await vault.users(query.wallet,{blockTag:block});
  result={...base,kind:'member',wallet:query.wallet,block,
   profile:{referrer:getAddress(user.referrer),registered:Boolean(user.registered),active:Boolean(user.active),
    kyc:Boolean(user.vipKyc),activeDirect:String(user.activeDirect),capitalUsd:String(user.capitalUsd),salesUsd:String(user.salesUsd)}};
 }else{
  const logs=await getCompleteLogs({provider,filter:{
   address:config.address,topics:[topic,null,zeroPadValue(query.parent,32)],fromBlock:query.from,toBlock:query.to
  },maxBlockSpan:TEAM_PAGE_SPAN,maxTimeoutRetries:1,maxRequests:64,maxConcurrency:2});
  if(logs.length>250)fail('TEAM_RELAY_PAGE_TOO_LARGE');
  const members=[];
  for(const log of logs){
   if(log.address.toLowerCase()!==config.address.toLowerCase()||log.topics[0]?.toLowerCase()!==topic.toLowerCase()||
    !hexHash(log.blockHash)||!hexHash(log.transactionHash)||!Number.isSafeInteger(log.index)||
    log.blockNumber<query.from||log.blockNumber>query.to)fail('TEAM_RELAY_EVENT_INVALID');
   const parsed=registered.parseLog(log);
   if(!parsed||parsed.name!=='Registered'||getAddress(parsed.args.referrer)!==query.parent)fail('TEAM_RELAY_EVENT_INVALID');
   const anchor=await provider.getBlock(log.blockNumber);
   if(!anchor||anchor.hash?.toLowerCase()!==log.blockHash.toLowerCase())fail('TEAM_RELAY_REORG');
   members.push({address:getAddress(parsed.args.user),block:log.blockNumber,tx:log.transactionHash,index:log.index});
  }
  result={...base,kind:'registrations',parent:query.parent,first:query.from,last:query.to,members};
 }
 const [end,again]=await Promise.all([provider.getBlock(confirmedHead),provider.getBlock(block)]);
 if(end?.hash?.toLowerCase()!==checkpoint.hash.toLowerCase()||again?.hash?.toLowerCase()!==at.hash.toLowerCase())fail('TEAM_RELAY_REORG');
 return result;
}

export function createTeamRelay(config,{providers}={}){
 const urls=config.rpcUrls?.length?config.rpcUrls:[config.rpcUrl].filter(Boolean);
 const owned=!providers;
 const candidates=providers||(config.address&&urls.length?urls.map(url=>{
  const req=new FetchRequest(url);req.timeout=12000;
  return new JsonRpcProvider(req,config.chainId,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 }):[]);
 const inflight=new Map();
 return {
  async get(params){
   const query=parseTeamQuery(params);
   const key=[query.kind,query.parent??query.wallet,query.from??'head',query.to??'head',query.block??''].join(':');
   if(inflight.has(key))return inflight.get(key);
   if(inflight.size>=3)fail('TEAM_RELAY_BUSY');
   const task=(async()=>{
    for(let i=0;i<candidates.length;i+=2){
     try{return await Promise.any(candidates.slice(i,i+2).map(provider=>readTeamSnapshot({provider,config,query})));}
     catch{ /* Entire page must be verified by one RPC, no mixed candidate data. */ }
    }
    fail('TEAM_RELAY_RPC_UNAVAILABLE');
   })();
   inflight.set(key,task);
   try{return await task;}finally{if(inflight.get(key)===task)inflight.delete(key);}
  },
  close(){if(owned)for(const provider of candidates)provider.destroy();}
 };
}
