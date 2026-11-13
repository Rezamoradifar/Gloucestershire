// Owner-only, signer-free user audit. All data originates from the canonical
// contract and verified RPC logs. A browser never receives the server RPC URL,
// financial worker journal, signer, admin session token of another wallet,
// KYC documents or a fabricated all-time member total.
import {Contract,FetchRequest,Interface,JsonRpcProvider,ZeroAddress,getAddress} from 'ethers';
import {getCompleteLogs} from '../scripts/complete-rpc-logs.mjs';

const registry=new Interface(['event Registered(address indexed user,address indexed referrer)']);
const registeredTopic=registry.getEvent('Registered').topicHash;
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const int=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value));
const fail=(code)=>{const error=new Error(code);error.code=code;throw error;};
const wallet=value=>{try{return getAddress(value);}catch{fail('ADMIN_USERS_BAD_REQUEST');}};
export const REGISTRY_WINDOW=1024;
export const PROFILE_POSITION_PAGE=8;
const vaultAbi=[
 'function users(address) view returns(address referrer,bool registered,bool active,bool vipKyc,uint32 activeDirect,uint256 capitalUsd,uint256 salesUsd)',
 'function accounts(address,address) view returns(uint256 principal,uint256 profit,uint256 externalDeposited,uint256 nextWithdrawal)',
 'function positionCount(address) view returns(uint256)',
 'function positionOf(address,uint256) view returns((address asset,uint256 principal,uint256 capitalUsd,uint256 unlockAt,uint16 penaltyBps))',
 'function tierOf(address) view returns(uint8)',
 'function dailyTargetBps(address) view returns(uint16)',
 'function networkBranchCount(address) view returns(uint256)',
 'function qualifiedDirects(address) view returns(uint256)',
 'function usdt() view returns(address)',
 'function tokenDecimals() view returns(uint8)',
 'function profitWithdrawalCap(address,address) view returns(uint256)',
 'function cumulativeReinvested(address,address) view returns(uint256)',
 'function withdrawalQueue() view returns(address)'
];
const queueAbi=[
 'function vault() view returns(address)',
 'function userRequestCount(address) view returns(uint256)',
 'function userRequestId(address,uint256) view returns(uint256)',
 'function requests(uint256) view returns(address user,address asset,uint256 gross,uint256 fee,uint256 dueAt,uint8 status)',
 'function principalRequests(uint256) view returns(bool exists,uint256 position)',
 'function APPROVAL_VERSION() view returns(uint256)'
];
const units=value=>BigInt(value).toString();
function positiveNumber(value,maximum,reason){
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<0||n>maximum)fail(reason);
 return n;
}
const fields=(search,allowed)=>{
 const keys=[...search.keys()];
 if(keys.some(key=>!allowed.includes(key))||keys.length!==new Set(keys).size)fail('ADMIN_USERS_BAD_REQUEST');
};
export function parseAdminUsersQuery(route,search){
 if(route==='head'){fields(search,[]);return {kind:'head'};}
 if(!['registrations','user','withdrawals'].includes(route))fail('ADMIN_USERS_BAD_REQUEST');
 fields(search,route==='registrations'?['head','hash','from','to']:route==='user'?['head','hash','wallet','offset']:['head','hash','wallet','page']);
 if(!int(search.get('head'))||!hash(search.get('hash')))fail('ADMIN_USERS_BAD_REQUEST');
 const head=Number(search.get('head')),blockHash=search.get('hash').toLowerCase();
 if(route==='registrations'){
  const from=search.get('from'),to=search.get('to');
  if(!int(from)||!int(to)||Number(from)>Number(to)||Number(to)>head||Number(to)-Number(from)+1>REGISTRY_WINDOW)
   fail('ADMIN_USERS_BAD_REQUEST');
  return {kind:'registrations',head,blockHash,from:Number(from),to:Number(to)};
 }
 const who=wallet(search.get('wallet'));
 if(who===ZeroAddress)fail('ADMIN_USERS_BAD_REQUEST');
 const field=route==='user'?'offset':'page',raw=search.get(field)??'0';
 if(!int(raw)||Number(raw)>1000000)fail('ADMIN_USERS_BAD_REQUEST');
 return {kind:route,head,blockHash,wallet:who,[field]:Number(raw)};
}
async function verifiedAnchor(provider,config,query){
 if(Number(await provider.send('eth_chainId',[]))!==config.chainId)fail('ADMIN_USERS_WRONG_CHAIN');
 if((await provider.getCode(config.address))==='0x')fail('ADMIN_USERS_CONTRACT_UNAVAILABLE');
 const observed=await provider.getBlockNumber();
 const final=observed-Math.max(3,config.confirmations);
 if(!Number.isSafeInteger(final)||final<config.startBlock)fail('ADMIN_USERS_HEAD_UNAVAILABLE');
 const number=query.kind==='head'?final:query.head;
 if(number>final||number<config.startBlock)fail('ADMIN_USERS_HEAD_NOT_CONFIRMED');
 const block=await provider.getBlock(number);
 if(!block||block.number!==number||!hash(block.hash)||
    query.kind!=='head'&&block.hash.toLowerCase()!==query.blockHash)
  fail('ADMIN_USERS_CHECKPOINT_MISMATCH');
 return {head:number,blockHash:block.hash};
}
async function verifiedRegistrations(provider,config,query,base){
 if(query.from<config.startBlock||query.to>base.confirmedHead)fail('ADMIN_USERS_BAD_REQUEST');
 const logs=await getCompleteLogs({provider,filter:{
  address:config.address,topics:[registeredTopic],fromBlock:query.from,toBlock:query.to
 },maxBlockSpan:128,maxRequests:64,maxConcurrency:3,maxTimeoutRetries:1});
 if(logs.length>256)fail('ADMIN_USERS_WINDOW_TOO_DENSE');
 const anchors=new Map();
 const records=[],identities=new Set();
 for(const log of logs){
  if(log.removed||log.address.toLowerCase()!==config.address.toLowerCase()||
     log.topics[0]?.toLowerCase()!==registeredTopic.toLowerCase()||
     log.blockNumber<query.from||log.blockNumber>query.to||
     !hash(log.blockHash)||!hash(log.transactionHash)||!Number.isSafeInteger(log.index))
   fail('ADMIN_USERS_EVENT_INVALID');
  let parsed;try{parsed=registry.parseLog(log);}catch{fail('ADMIN_USERS_EVENT_INVALID');}
  if(parsed?.name!=='Registered')fail('ADMIN_USERS_EVENT_INVALID');
  const id=log.transactionHash.toLowerCase()+':'+log.index;
  if(identities.has(id))fail('ADMIN_USERS_DUPLICATE_EVENT');
  identities.add(id);
  if(!anchors.has(log.blockNumber)){
   const block=await provider.getBlock(log.blockNumber);
   if(!block||block.hash?.toLowerCase()!==log.blockHash.toLowerCase())fail('ADMIN_USERS_EVENT_REORG');
   anchors.set(log.blockNumber,block.hash);
  }else if(anchors.get(log.blockNumber).toLowerCase()!==log.blockHash.toLowerCase())
   fail('ADMIN_USERS_EVENT_REORG');
  records.push({wallet:getAddress(parsed.args.user),referrer:getAddress(parsed.args.referrer),
   transactionHash:log.transactionHash,logIndex:log.index,blockNumber:log.blockNumber});
 }
 records.sort((a,b)=>b.blockNumber-a.blockNumber||b.logIndex-a.logIndex);
 return {...base,kind:'registrations',from:query.from,to:query.to,events:records,
  complete:query.from===config.startBlock,source:'verified_contract_logs'};
}
async function verifiedUser(provider,config,query,base){
 const vault=new Contract(config.address,vaultAbi,provider),at={blockTag:base.confirmedHead};
 const [user,tier,target,qualified,branchCount,positionCount,token,decimals]=await Promise.all([
  vault.users(query.wallet,at),vault.tierOf(query.wallet,at),vault.dailyTargetBps(query.wallet,at),
  vault.qualifiedDirects(query.wallet,at),vault.networkBranchCount(query.wallet,at),
  vault.positionCount(query.wallet,at),vault.usdt(at),vault.tokenDecimals(at)
 ]);
 const count=positiveNumber(positionCount,1000000,'ADMIN_USERS_POSITIONS_UNAVAILABLE');
 const asset=getAddress(token),precision=Number(decimals);
 if(asset===ZeroAddress||!Number.isInteger(precision)||precision<0||precision>18)
  fail('ADMIN_USERS_ASSET_INVALID');
 const result={...base,kind:'user',wallet:query.wallet,
  profile:{registered:Boolean(user.registered),active:Boolean(user.active),kycVerified:Boolean(user.vipKyc),
   referrer:getAddress(user.referrer),activeDirect:units(user.activeDirect),
   registeredDirect:units(branchCount),qualifiedDirect:units(qualified),
   capitalUsd:units(user.capitalUsd),salesUsd:units(user.salesUsd),
   tier:Number(tier),dailyTargetBps:Number(target)},
  positionCount:count,positionOffset:query.offset,positions:[],assets:[],
  source:'contract_state_at_confirmed_block'};
 for(const [symbol,address,dec] of [['BNB',ZeroAddress,18],['USDT',asset,precision]]){
  const [account,cap,reinvested]=await Promise.all([
   vault.accounts(query.wallet,address,at),vault.profitWithdrawalCap(query.wallet,address,at),
   vault.cumulativeReinvested(query.wallet,address,at)
  ]);
  result.assets.push({symbol,address,decimals:dec,principal:units(account.principal),profit:units(account.profit),
   externalDeposited:units(account.externalDeposited),nextWithdrawal:units(account.nextWithdrawal),
   withdrawalCap:units(cap),reinvested:units(reinvested)});
 }
 for(let i=query.offset;i<Math.min(count,query.offset+PROFILE_POSITION_PAGE);i++){
  const p=await vault.positionOf(query.wallet,i,at);
  const positionAsset=getAddress(p.asset);
  if(positionAsset!==ZeroAddress&&positionAsset!==asset)fail('ADMIN_USERS_ASSET_INVALID');
  result.positions.push({id:i,symbol:positionAsset===ZeroAddress?'BNB':'USDT',principal:units(p.principal),
   capitalUsd:units(p.capitalUsd),unlockAt:units(p.unlockAt),penaltyBps:Number(p.penaltyBps)});
 }
 return result;
}
async function verifiedWithdrawals(provider,config,query,base){
 const vault=new Contract(config.address,vaultAbi,provider),at={blockTag:base.confirmedHead};
 let address;
 try{address=getAddress(await vault.withdrawalQueue(at));}
 catch(error){
  if(error?.code==='CALL_EXCEPTION'||error?.code==='BAD_DATA')
   return {...base,kind:'withdrawals',wallet:query.wallet,supported:false,source:'queue_not_supported'};
  throw error;
 }
 if(address===ZeroAddress)return {...base,kind:'withdrawals',wallet:query.wallet,supported:false,source:'queue_not_configured'};
 if(await provider.getCode(address,base.confirmedHead)==='0x')fail('ADMIN_USERS_QUEUE_INVALID');
 const queue=new Contract(address,queueAbi,provider);
 if(getAddress(await queue.vault(at))!==getAddress(config.address))fail('ADMIN_USERS_QUEUE_INVALID');
 const total=positiveNumber(await queue.userRequestCount(query.wallet,at),1000000,'ADMIN_USERS_QUEUE_INVALID');
 const positions=[];
 for(let i=query.page*8;i<Math.min(total,(query.page+1)*8);i++){
  const id=await queue.userRequestId(query.wallet,BigInt(total-1-i),at);
  const row=await queue.requests(id,at);
  if(getAddress(row.user)!==query.wallet||BigInt(row.gross)<BigInt(row.fee)||Number(row.status)>3)
   fail('ADMIN_USERS_QUEUE_INVALID');
  positions.push({id:units(id),asset:getAddress(row.asset),gross:units(row.gross),
   fee:units(row.fee),net:units(BigInt(row.gross)-BigInt(row.fee)),
   dueAt:units(row.dueAt),status:Number(row.status)});
 }
 return {...base,kind:'withdrawals',wallet:query.wallet,supported:true,queueAddress:address,
  page:query.page,total,requests:positions,
  note:'Queue state is not a transaction receipt; verify payment separately.',source:'verified_contract_queue'};
}
export async function readAdminUsers({provider,config,query}){
 if(!provider||!config?.address||![56,97].includes(config.chainId)||!Number.isSafeInteger(config.startBlock)||
   !Number.isSafeInteger(config.confirmations)||config.confirmations<1)fail('ADMIN_USERS_CONFIG_INVALID');
 const anchor=await verifiedAnchor(provider,config,query);
 const base={version:1,chainId:config.chainId,vaultAddress:getAddress(config.address),
  deploymentBlock:config.startBlock,confirmedHead:anchor.head,blockHash:anchor.blockHash};
 let response;
 if(query.kind==='head')response={...base,kind:'head',source:'verified_contract_rpc'};
 else if(query.kind==='registrations')response=await verifiedRegistrations(provider,config,query,base);
 else if(query.kind==='user')response=await verifiedUser(provider,config,query,base);
 else response=await verifiedWithdrawals(provider,config,query,base);
 const again=await provider.getBlock(anchor.head);
 if(again?.hash?.toLowerCase()!==anchor.blockHash.toLowerCase())fail('ADMIN_USERS_REORG');
 return response;
}
export function createAdminUsers(config,{providers}={}){
 const urls=config.rpcUrls?.length?config.rpcUrls:[config.rpcUrl].filter(Boolean);
 const owned=!providers;
 const candidates=providers||(urls.map(url=>{
  const req=new FetchRequest(url);req.timeout=15000;
  return new JsonRpcProvider(req,config.chainId,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 }));
 const inflight=new Map();
 return {
  async get(route,params){
   const query=parseAdminUsersQuery(route,params);
   const key=route+':'+params.toString();
   if(inflight.has(key))return inflight.get(key);
   if(inflight.size>=4)fail('ADMIN_USERS_BUSY');
   const task=(async()=>{
    for(let i=0;i<candidates.length;i+=2){
     try{return await Promise.any(candidates.slice(i,i+2).map(provider=>readAdminUsers({provider,config,query})));}
     catch{ /* The entire response must be proven on one verified RPC candidate. */ }
    }
    fail('ADMIN_USERS_RPC_UNAVAILABLE');
   })();
   inflight.set(key,task);
   try{return await task;}finally{if(inflight.get(key)===task)inflight.delete(key);}
  },
  close(){if(owned)for(const provider of candidates)provider.destroy();}
 };
}
