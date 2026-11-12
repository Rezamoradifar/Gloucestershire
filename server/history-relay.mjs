// Read-only, wallet-independent BNB Chain event history from verified server RPCs.
// Every page is wholly verified by one candidate. Never route these reads
// through a connected wallet, and never expose transport credentials.
import {Contract,FetchRequest,Interface,JsonRpcProvider,ZeroAddress,getAddress,isAddress,zeroPadValue} from 'ethers';
import {getCompleteLogs} from '../scripts/complete-rpc-logs.mjs';

const eventAbi=[
 'event Deposited(address indexed user,address indexed asset,uint256 indexed position,uint256 amount,uint256 usd,uint256 feeEach)',
 'event ProfitCredited(address indexed user,address indexed asset,uint256 amount,bytes32 indexed id)',
 'event Reinvested(address indexed user,address indexed asset,uint256 amount,uint256 position)',
 'event Withdrawal(address indexed user,address indexed asset,uint256 gross,uint256 fee,bool principal)',
 'event NetworkRewardEarned(address indexed user,uint256 indexed group,uint8 stage,uint256 volumeUsd,uint256 rewardUsd)'
];
const iface=new Interface(eventAbi);
const financeTopics=['Deposited','ProfitCredited','Reinvested','Withdrawal'].map(name=>iface.getEvent(name).topicHash);
const rewardTopic=iface.getEvent('NetworkRewardEarned').topicHash;
const integer=s=>typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s)&&Number.isSafeInteger(Number(s));
const fail=code=>{const error=Error(code);error.code=code;throw error;};
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
const MAX_SPAN=96;
export const historyRelayMaxSpan=MAX_SPAN;

export function parseHistoryRelayQuery(params){
 const keys=[...params.keys()];
 if(keys.some(key=>!['wallet','asset','scope','kind','from','to'].includes(key))||
  keys.length!==new Set(keys).size)fail('HISTORY_RELAY_BAD_REQUEST');
 let wallet,asset;
 try{
  wallet=getAddress(params.get('wallet'));asset=getAddress(params.get('asset'));
  if(wallet===ZeroAddress)throw Error();
 }catch{fail('HISTORY_RELAY_BAD_REQUEST');}
 const scope=params.get('scope'),kind=params.get('kind');
 if(!['wallet','global'].includes(scope)||!['finance','reward'].includes(kind)||
   (kind==='reward'&&scope!=='wallet'))fail('HISTORY_RELAY_BAD_REQUEST');
 const from=params.get('from'),to=params.get('to'),isHead=from===null&&to===null;
 if(!isHead&&(!integer(from)||!integer(to)||Number(from)>Number(to)||
   Number(to)-Number(from)+1>MAX_SPAN))fail('HISTORY_RELAY_BAD_REQUEST');
 return {wallet,asset,scope,kind,...(!isHead?{from:Number(from),to:Number(to)}:{})};
}
function makePageFilter(config,query){
 const topic=query.kind==='finance'?financeTopics:rewardTopic;
 const walletTopic=zeroPadValue(query.wallet,32);
 return {address:config.address,topics:query.kind==='reward'?
  [topic,walletTopic]:[topic,query.scope==='wallet'?walletTopic:null,zeroPadValue(query.asset,32)],
  fromBlock:query.from,toBlock:query.to};
}
export async function readHistoryRelaySnapshot({provider,config,query}){
 if(!provider||!config?.address||!isAddress(config.address)||![56,97].includes(config.chainId)||
  !Number.isSafeInteger(config.confirmations)||config.confirmations<1)fail('HISTORY_RELAY_CONFIG_INVALID');
 if(Number(await provider.send('eth_chainId',[]))!==config.chainId)fail('HISTORY_RELAY_WRONG_CHAIN');
 if(await provider.getCode(config.address)==='0x')fail('HISTORY_RELAY_VAULT_MISSING');
 const head=await provider.getBlockNumber(),confirmedHead=head-Math.max(3,config.confirmations);
 if(!Number.isSafeInteger(confirmedHead)||confirmedHead<0)fail('HISTORY_RELAY_HEAD_UNAVAILABLE');
 const checkpoint=await provider.getBlock(confirmedHead);
 if(!checkpoint||checkpoint.number!==confirmedHead||!hash(checkpoint.hash))fail('HISTORY_RELAY_HEAD_UNAVAILABLE');
 const base={version:1,chainId:config.chainId,vaultAddress:getAddress(config.address),
  wallet:query.wallet,asset:query.asset,scope:query.scope,kind:query.kind,confirmedHead};
 if(query.from===undefined)return {...base,first:null,last:null,logs:[]};
 if(query.to>confirmedHead)fail('HISTORY_RELAY_NOT_CONFIRMED');
 let token;
 const vault=new Contract(config.address,['function usdt() view returns(address)'],provider);
 token=getAddress(await vault.usdt({blockTag:confirmedHead}));
 if(query.asset!==ZeroAddress&&query.asset!==token)fail('HISTORY_RELAY_ASSET_MISMATCH');
 const at=await provider.getBlock(query.to);
 if(!at||at.number!==query.to||!hash(at.hash))fail('HISTORY_RELAY_CHECKPOINT_INVALID');
 const logs=await getCompleteLogs({provider,filter:makePageFilter(config,query),
  maxBlockSpan:MAX_SPAN,maxTimeoutRetries:1,maxRequests:64,maxConcurrency:2});
 if(logs.length>250)fail('HISTORY_RELAY_PAGE_TOO_LARGE');
 const timestampCache=new Map();
 const rows=[];
 for(const log of logs){
  let timestamp=timestampCache.get(log.blockNumber);
  if(timestamp===undefined){
   const block=await provider.getBlock(log.blockNumber);
   if(!block||block.hash?.toLowerCase()!==log.blockHash.toLowerCase()||
      !Number.isSafeInteger(block.timestamp)||block.timestamp<=0)fail('HISTORY_RELAY_REORG');
   timestamp=block.timestamp;timestampCache.set(log.blockNumber,timestamp);
  }
  const parsed=iface.parseLog(log);
  if(!parsed)fail('HISTORY_RELAY_EVENT_INVALID');
  const topicExpected=query.kind==='finance'?financeTopics:[rewardTopic];
  if(!topicExpected.includes(log.topics[0]))fail('HISTORY_RELAY_EVENT_INVALID');
  rows.push({address:log.address,transactionHash:log.transactionHash,
   blockHash:log.blockHash,blockNumber:log.blockNumber,index:log.index,
   topics:log.topics,data:log.data,timestamp});
 }
 const end=await provider.getBlock(confirmedHead),again=await provider.getBlock(query.to);
 if(end?.hash?.toLowerCase()!==checkpoint.hash.toLowerCase()||
  again?.hash?.toLowerCase()!==at.hash.toLowerCase())fail('HISTORY_RELAY_REORG');
 return {...base,first:query.from,last:query.to,logs:rows};
}
export function createHistoryRelay(config,{providers}={}){
 const urls=config.rpcUrls?.length?config.rpcUrls:[config.rpcUrl].filter(Boolean);
 const owned=!providers;
 const candidates=providers||(config.address&&urls.length?urls.map(url=>{
  const request=new FetchRequest(url);request.timeout=12000;
  return new JsonRpcProvider(request,config.chainId,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 }):[]);
 const inflight=new Map();
 return {
  async get(params){
   const query=parseHistoryRelayQuery(params);
   if(!candidates.length)fail('HISTORY_RELAY_RPC_UNAVAILABLE');
   const key=[query.wallet,query.asset,query.kind,query.scope,query.from??'head',query.to??'head'].join(':');
   if(inflight.has(key))return inflight.get(key);
   if(inflight.size>=3)fail('HISTORY_RELAY_BUSY');
   const job=(async()=>{
    for(let i=0;i<candidates.length;i+=2){
     try{
      // Only complete, independently checked pages can win.
      return await Promise.any(candidates.slice(i,i+2).map(provider=>
       readHistoryRelaySnapshot({provider,config,query})));
     }catch{ /* Retry only with the next verified candidate pair. */ }
    }
    fail('HISTORY_RELAY_RPC_UNAVAILABLE');
   })();
   inflight.set(key,job);
   try{return await job;}finally{if(inflight.get(key)===job)inflight.delete(key);}
  },
  close(){if(owned)for(const provider of candidates)provider.destroy();}
 };
}
