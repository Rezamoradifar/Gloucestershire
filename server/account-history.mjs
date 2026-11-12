// Confirmed, paginated on-chain account timeline. No private key or financial writes.
import {Contract,FetchRequest,Interface,JsonRpcProvider,ZeroAddress,formatUnits,getAddress,isAddress,zeroPadValue} from 'ethers';
import {getCompleteLogs} from '../scripts/complete-rpc-logs.mjs';

const vaultAbi=[
 'event Registered(address indexed user,address indexed referrer)',
 'event Deposited(address indexed user,address indexed asset,uint256 indexed position,uint256 amount,uint256 usd,uint256 feeEach)',
 'event Reinvested(address indexed user,address indexed asset,uint256 amount,uint256 position)',
 'event ProfitCredited(address indexed user,address indexed asset,uint256 amount,bytes32 indexed id)',
 'event Withdrawal(address indexed user,address indexed asset,uint256 gross,uint256 fee,bool principal)',
 'event Funded(address indexed sender,address indexed asset,uint256 amount,bool feeReserve)',
 'event OwnerCapitalWithdrawn(address indexed owner,address indexed asset,address indexed recipient,uint256 amount)',
 'event CustomerStatus(address indexed user,bool active,bool vipKyc)',
 'event NetworkRewardEarned(address indexed user,uint256 indexed group,uint8 stage,uint256 volumeUsd,uint256 rewardUsd)',
 'event SaleSettled(bytes32 indexed id,address indexed seller,address indexed asset,uint256 grossProfit,uint256 salesUsd,bytes32 evidenceHash)'
];
const queueAbi=[
 'event Requested(uint256 indexed id,address indexed user,address indexed asset,uint256 gross,uint256 fee,uint256 dueAt)',
 'function vault() view returns(address)',
 'function requests(uint256) view returns(address user,address asset,uint256 gross,uint256 fee,uint256 dueAt,uint8 status)'
];
const vaultInterface=new Interface(vaultAbi),queueInterface=new Interface(queueAbi);
const personalEvents=['Registered','Deposited','Reinvested','ProfitCredited','Withdrawal','Funded',
 'OwnerCapitalWithdrawn','CustomerStatus','NetworkRewardEarned'];
const vaultTopics=personalEvents.map(name=>vaultInterface.getEvent(name).topicHash);
const saleTopic=vaultInterface.getEvent('SaleSettled').topicHash;
const requestedTopic=queueInterface.getEvent('Requested').topicHash;
const statusValues=['pending','paid','cancelled','approved'];
const maxLogIndex=4294967295;
// Keep each HTTP page small enough for limited public RPC providers and nginx deadlines.
// Older history remains reachable by a stable (block:log-index) cursor.
export const historyScanWindowBlocks=500;
export const historyScanWindowsPerRequest=2;

function fail(code){const e=Error(code);e.code=code;throw e;}
function safeNumber(value){return Number.isSafeInteger(value)&&value>=0;}
export function parseHistoryQuery(params){
 const keys=[...params.keys()];
 if(keys.some(key=>!['wallet','before','limit'].includes(key))||new Set(keys).size!==keys.length)fail('ACCOUNT_HISTORY_BAD_REQUEST');
 let wallet;
 try{wallet=getAddress(params.get('wallet'));if(wallet===ZeroAddress)throw Error();}catch{fail('ACCOUNT_HISTORY_BAD_REQUEST');}
 const limitText=params.get('limit')??'30',limit=Number(limitText);
 if(!/^(?:[1-9][0-9]?)$/.test(limitText)||!Number.isSafeInteger(limit)||limit>50)fail('ACCOUNT_HISTORY_BAD_REQUEST');
 const before=params.get('before');
 if(before!==null&&!/^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)$/.test(before))fail('ACCOUNT_HISTORY_BAD_REQUEST');
 return {wallet,limit,before};
}
export function parseHistoryCursor(before,confirmedHead,first){
 if(!safeNumber(confirmedHead)||!safeNumber(first)||first>confirmedHead)fail('ACCOUNT_HISTORY_CURSOR_INVALID');
 if(before==null)return {block:confirmedHead,index:maxLogIndex};
 const [part,indexText]=before.split(':'),block=Number(part),index=Number(indexText);
 if(!safeNumber(block)||!safeNumber(index)||block<first||block>confirmedHead||index>maxLogIndex)fail('ACCOUNT_HISTORY_CURSOR_INVALID');
 return {block,index};
}
export function beforeHistoryCursor(item,cursor){
 return item.blockNumber<cursor.block||(item.blockNumber===cursor.block&&item.logIndex<cursor.index);
}
function eventRow(log,parsed,head,token,decimals,timestamp,source){
 const args=parsed.args,name=parsed.name;
 const assetValue=args.asset??null;
 let asset=null;
 if(assetValue!==null){
  const address=getAddress(assetValue);
  if(address===ZeroAddress)asset='BNB';
  else if(address===token)asset='USDT';
  else fail('ACCOUNT_HISTORY_UNKNOWN_ASSET');
 }
 const unit=value=>formatUnits(value,asset==='BNB'?18:decimals);
 let label,amount=null,fee=null,detail=null,requestId=null,queueStatus=null,positionId=null;
 if(source==='queue'){
  if(name!=='Requested')fail('ACCOUNT_HISTORY_EVENT_INVALID');
  label='Withdrawal requested';amount=unit(args.gross);fee=unit(args.fee);
  requestId=args.id.toString();
  detail='Request recorded only; payment requires approval and sufficient vault cash.';
 }else{
  switch(name){
   case 'Registered':label='Account registered';break;
   case 'Deposited':
    label='Deposit recorded';amount=unit(args.amount);fee=unit(args.feeEach*2n);positionId=args.position.toString();
    detail='Recorded principal; 10% goes to each fee wallet and the remainder to operations.';break;
   case 'Reinvested':
    label='Profit reinvested';amount=unit(args.amount);positionId=args.position.toString();
    detail='Recorded profit converted to a new position; not a new external deposit.';break;
   case 'ProfitCredited':
    label='Profit credited';amount=unit(args.amount);
    detail='Accounting credit only. This is not a payment to the external wallet.';break;
   case 'Withdrawal':
    label=args.principal?'Principal paid':'Profit paid';amount=unit(args.gross);fee=unit(args.fee);
    detail='Withdrawal executed; net amount equals gross minus fee.';break;
   case 'Funded':
    label=args.feeReserve?'Fee reserve funded':'Reward budget funded';amount=unit(args.amount);break;
   case 'OwnerCapitalWithdrawn':
    label='Treasury cash withdrawn';amount=unit(args.amount);
    detail='Treasury transfer; user accounting claims remain outstanding.';break;
   case 'CustomerStatus':
    label='Customer status changed';detail='Active: '+Boolean(args.active)+', VIP/KYC: '+Boolean(args.vipKyc);break;
   case 'NetworkRewardEarned':
    label='Network stage achieved';asset=null;amount=null;
    detail='Nominal milestone: '+formatUnits(args.rewardUsd,18)+' USD; the related ledger credit is listed separately and must not be double-counted.';break;
   case 'SaleSettled':
    label='Sales profit settled';amount=unit(args.grossProfit);
    detail='Sales settlement; the associated profit ledger credit is listed separately.';break;
   default:fail('ACCOUNT_HISTORY_EVENT_INVALID');
  }
 }
 const index=log.index??log.logIndex;
 if(!safeNumber(index)||!safeNumber(log.blockNumber)||!safeNumber(timestamp))fail('ACCOUNT_HISTORY_EVENT_INVALID');
 return {
  id:log.transactionHash.toLowerCase()+':'+index,
  transactionHash:log.transactionHash,blockNumber:log.blockNumber,logIndex:index,
  timestamp:new Date(timestamp*1000).toISOString(),confirmations:head-log.blockNumber+1,
  label,kind:name,asset,amount,fee,detail,positionId,requestId,queueStatus,
  source,confirmed:true
 };
}
export async function readAccountHistoryPage({provider,config,wallet,before=null,limit=30,maxWindows=historyScanWindowsPerRequest,
 metadata}){
 if(!provider||!config?.rpcUrl&&!metadata||!isAddress(config.address)||![56,97].includes(config.chainId)||
  !safeNumber(config.startBlock)||config.startBlock<0||!safeNumber(config.confirmations)||
  config.confirmations<1||!safeNumber(limit)||limit<1||limit>50||
  !safeNumber(maxWindows)||maxWindows<1||maxWindows>20)fail('ACCOUNT_HISTORY_CONFIGURATION_REQUIRED');
 wallet=getAddress(wallet);
 if(wallet===ZeroAddress)fail('ACCOUNT_HISTORY_BAD_REQUEST');
 if(Number(await provider.send('eth_chainId',[]))!==config.chainId)fail('ACCOUNT_HISTORY_WRONG_CHAIN');
 const code=await provider.getCode(config.address);
 if(code==='0x')fail('ACCOUNT_HISTORY_VAULT_UNAVAILABLE');
 const head=await provider.getBlockNumber(),confirmedHead=head-Math.max(3,config.confirmations);
 if(confirmedHead<config.startBlock)return {version:1,chainId:config.chainId,vaultAddress:config.address,
  wallet,confirmedThrough:confirmedHead,scannedFrom:null,scannedTo:null,items:[],nextCursor:null};
 const checkpoint=await provider.getBlock(confirmedHead);
 if(!checkpoint||checkpoint.number!==confirmedHead)fail('ACCOUNT_HISTORY_CHECKPOINT_REQUIRED');
 const cursor=parseHistoryCursor(before,confirmedHead,config.startBlock);
 let token,decimals,queueAddress,queue;
 if(metadata){
  token=getAddress(metadata.token);decimals=Number(metadata.decimals);
  queueAddress=getAddress(metadata.queueAddress);queue=metadata.queue??null;
 }else{
  const vault=new Contract(config.address,[
   'function usdt() view returns(address)',
   'function tokenDecimals() view returns(uint8)',
   'function withdrawalQueue() view returns(address)'
  ],provider);
  [token,decimals,queueAddress]=await Promise.all([
   vault.usdt({blockTag:confirmedHead}),vault.tokenDecimals({blockTag:confirmedHead}),
   vault.withdrawalQueue({blockTag:confirmedHead})
  ]);
  token=getAddress(token);decimals=Number(decimals);queueAddress=getAddress(queueAddress);
  queue=new Contract(queueAddress,queueAbi,provider);
  if(getAddress(await queue.vault({blockTag:confirmedHead}))!==getAddress(config.address))fail('ACCOUNT_HISTORY_QUEUE_MISMATCH');
 }
 if(!safeNumber(decimals)||decimals>18||token===ZeroAddress||queueAddress===ZeroAddress||
  await provider.getCode(queueAddress)==='0x')fail('ACCOUNT_HISTORY_METADATA_INVALID');
 const userTopic=zeroPadValue(wallet,32),all=[],seen=new Set(),blocks=new Map();
 let remaining=cursor.block,scannedTo=null,scannedFrom=null;
 for(let count=0;count<maxWindows&&remaining>=config.startBlock;count++){
  const high=remaining,low=Math.max(config.startBlock,high-historyScanWindowBlocks+1);
  scannedTo??=high;scannedFrom=low;
  const [personal,sales,requests]=await Promise.all([
   getCompleteLogs({provider,filter:{address:config.address,topics:[vaultTopics,userTopic],fromBlock:low,toBlock:high}}),
   getCompleteLogs({provider,filter:{address:config.address,topics:[saleTopic,null,userTopic],fromBlock:low,toBlock:high}}),
   getCompleteLogs({provider,filter:{address:queueAddress,topics:[requestedTopic,null,userTopic],fromBlock:low,toBlock:high}})
  ]);
  for(const [log,source] of [...personal.map(item=>[item,'vault']),...sales.map(item=>[item,'vault']),...requests.map(item=>[item,'queue'])]){
   const idx=log.index??log.logIndex,id=log.transactionHash.toLowerCase()+':'+idx;
   if(seen.has(id))continue;
   seen.add(id);
   const parsed=(source==='queue'?queueInterface:vaultInterface).parseLog(log);
   if(!parsed)fail('ACCOUNT_HISTORY_EVENT_INVALID');
   if(!blocks.has(log.blockNumber))blocks.set(log.blockNumber,await provider.getBlock(log.blockNumber));
   const block=blocks.get(log.blockNumber);
   if(!block||block.hash?.toLowerCase()!==log.blockHash.toLowerCase())fail('ACCOUNT_HISTORY_REORG');
   const row=eventRow(log,parsed,head,token,decimals,block.timestamp,source);
   if(beforeHistoryCursor(row,cursor))all.push(row);
  }
  remaining=low-1;
  if(all.length>limit)break;
 }
 all.sort((a,b)=>b.blockNumber-a.blockNumber||b.logIndex-a.logIndex);
 const items=all.slice(0,limit);
 // A cursor includes log index so event-rich blocks never lose their tail.
 const nextCursor=all.length>limit&&items.length?
  items.at(-1).blockNumber+':'+items.at(-1).logIndex:
  remaining>=config.startBlock?remaining+':'+maxLogIndex:null;
 for(const item of items){
  if(item.source!=='queue')continue;
  const requestId=BigInt(item.requestId);
  const q=metadata?.queueRequest?
   await metadata.queueRequest(requestId,confirmedHead):
   await queue.requests(requestId,{blockTag:confirmedHead});
  if(getAddress(q.user)!==wallet||getAddress(q.asset)!==(item.asset==='BNB'?ZeroAddress:token)||
   !safeNumber(Number(q.status))||Number(q.status)>=statusValues.length)fail('ACCOUNT_HISTORY_QUEUE_INCONSISTENT');
  item.queueStatus=statusValues[Number(q.status)];
 }
 const final=await provider.getBlock(confirmedHead);
 if(final?.hash!==checkpoint.hash)fail('ACCOUNT_HISTORY_REORG');
 return {
  version:1,chainId:config.chainId,vaultAddress:getAddress(config.address),wallet,
  confirmedThrough:confirmedHead,scannedFrom,scannedTo,items,nextCursor
 };
}
export function createAccountHistory(config,{providers,metadata}={}){
 const urls=config.rpcUrls?.length?config.rpcUrls:[config.rpcUrl].filter(Boolean);
 const owned=!providers;
 const candidates=providers||(config.address&&urls.length?urls.map(url=>{
  const request=new FetchRequest(url);request.timeout=15000;
  return new JsonRpcProvider(request,config.chainId,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 }):[]);
 const pending=new Map();
 return {
  async get(params){
   const args=parseHistoryQuery(params);
   if(!candidates.length)fail('ACCOUNT_HISTORY_NOT_CONFIGURED');
   const key=args.wallet+':'+(args.before??'latest')+':'+args.limit;
   if(pending.has(key))return pending.get(key);
   if(pending.size>=3)fail('ACCOUNT_HISTORY_BUSY');
   // Race complete verified pages, never mix log subsets from different RPC histories.
   // Bound shared expensive reads: duplicate requests share one pending promise.
   const work=Promise.any(candidates.map(provider=>readAccountHistoryPage({
    provider,config,...args,maxWindows:historyScanWindowsPerRequest,metadata
   }))).catch(()=>fail('ACCOUNT_HISTORY_UNAVAILABLE'));
   pending.set(key,work);
   try{return await work;}finally{if(pending.get(key)===work)pending.delete(key);}
  },
  close(){if(owned)for(const candidate of candidates)candidate.destroy();}
 };
}
