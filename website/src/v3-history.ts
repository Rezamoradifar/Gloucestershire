import {getAddress,Interface,zeroPadValue,type Eip1193Provider,type Log,type Provider} from 'ethers';
import {V3_ABI,v3ReadSession} from './v3-chain';
import {formatV3Amount} from './v3-format';
import type {V3SiteReleaseConfig} from './v3-site-config';

const events=new Interface(V3_ABI);
const firstAccount=['DepositRouted','DailyClaimAccrued','ReferralClaimAccrued',
 'NetworkClaimAccrued','ProfitReinvested','CheckIn'];
const secondAccount=['WithdrawalRequested','WithdrawalPaid'];
const windowSize=2000;
const maxEvents=200;
// Keep retries bounded: public BNB RPCs differ in maximum getLogs range.
const maxLogRequests=64;
const historyUnavailable='Unable to load the complete activity for these blocks. Please retry or use the block explorer.';
const topic=(name:string)=>events.getEvent(name)!.topicHash;
const hash=(value:string)=>/^0x[0-9a-f]{64}$/i.test(value);
const amount=(value:bigint)=>formatV3Amount(value)+' TEST USDT';
const number=(value:bigint)=>(value+1n).toString();

export type V3HistoryAnchor={block:number;hash:string;firstBlock:number};
export type V3HistoryItem={key:string;block:number;transaction:string;index:number;
 title:string;detail:string;value:string|null};
export type V3HistoryPage={anchor:V3HistoryAnchor;page:number;from:number;to:number;items:V3HistoryItem[]};

export function v3HistoryRange(anchor:number,page:number,firstBlock=0){
 if(!Number.isSafeInteger(anchor)||anchor<0||!Number.isSafeInteger(firstBlock)||firstBlock<0||firstBlock>anchor||
  !Number.isSafeInteger(page)||page<0||page>500000)
  throw Error('Invalid V3 history page.');
 const to=anchor-page*windowSize;
 if(to<firstBlock)throw Error('No earlier V3 block range is available.');
 return {from:Math.max(firstBlock,to-windowSize+1),to};
}

// Ethers wraps JSON-RPC errors, so inspect only the error fields used for
// classification; never show raw RPC payloads, URLs, or provider messages.
function isLogRangeLimit(error:unknown){
 const pending:unknown[]=[error],visited=new Set<unknown>();
 const codes=new Set<number|string>();
 const messages:string[]=[];
 while(pending.length&&visited.size<12){
  const value=pending.shift();
  if(!value||typeof value!=='object'||visited.has(value))continue;
  visited.add(value);
  const entry=value as Record<string,unknown>;
  if(typeof entry.code==='number'||typeof entry.code==='string')codes.add(entry.code);
  if(typeof entry.message==='string')messages.push(entry.message.slice(0,1000));
  for(const key of ['error','info','cause'])if(entry[key])pending.push(entry[key]);
 }
 const text=messages.join(' ').toLowerCase();
 if(codes.has(429)||codes.has('429')||/rate[ -]?limit|too many requests|throttl/.test(text))return false;
 return codes.has(-32005)||codes.has('-32005')||
  /block range|range (?:is )?too (?:large|wide)|query returned more than|response size exceeded/.test(text);
}

// The RPC is queried for the connected wallet only, in a fixed, confirmed
// block range. The anchor is checked again so pagination cannot silently jump
// across a changed chain. Returned entries are events, never synthetic sales.
export async function queryV3HistoryWindow(provider:Provider,contract:string,wallet:string,
 anchor:V3HistoryAnchor,page:number):Promise<V3HistoryPage>{
 const address=getAddress(contract),who=getAddress(wallet);
 if(!hash(anchor.hash))throw Error('Invalid V3 history block hash.');
 const {from,to}=v3HistoryRange(anchor.block,page,anchor.firstBlock);
 const anchorBlock=await provider.getBlock(anchor.block);
 if(!anchorBlock?.hash||anchorBlock.hash.toLowerCase()!==anchor.hash.toLowerCase())
  throw Error('The confirmed history block changed. Refresh history.');
 const account=zeroPadValue(who,32);
 let requests=0;
 const scan=async(topics:(string|string[]|null)[],start:number,end:number):Promise<Log[]>=>{
  if(++requests>maxLogRequests)throw Error(historyUnavailable);
  let logs:Log[];
  try{logs=await provider.getLogs({address,fromBlock:start,toBlock:end,topics});}
  catch(error){
   if(!isLogRangeLimit(error)||start===end)throw Error(historyUnavailable);
   const middle=start+Math.floor((end-start)/2);
   const earlier=await scan(topics,start,middle);
   const later=await scan(topics,middle+1,end);
   if(earlier.length+later.length>maxEvents)
    throw Error('Too many events in this range. Open the contract explorer for this block range.');
   return [...earlier,...later];
  }
  if(logs.length>maxEvents)throw Error('Too many events in this range. Open the contract explorer for this block range.');
  return logs;
 };
 // Sequential requests avoid multiplying rate pressure while preserving the
 // same complete, non-overlapping block range for both indexed filters.
 const first=await scan([firstAccount.map(topic),account],from,to);
 const second=await scan([secondAccount.map(topic),null,account],from,to);
 if(first.length+second.length>maxEvents)
  throw Error('Too many events in this range. Open the contract explorer for this block range.');
 const seen=new Set<string>();
 const items=[...first,...second].map((log:Log):V3HistoryItem=>{
  if(log.removed||getAddress(log.address)!==address||!hash(log.transactionHash)||
   !Number.isSafeInteger(log.blockNumber)||log.blockNumber<from||log.blockNumber>to||
   !Number.isSafeInteger(log.index)||log.index<0)throw Error('Invalid V3 history event.');
  const parsed=events.parseLog({topics:log.topics,data:log.data});
  if(!parsed||![...firstAccount,...secondAccount].includes(parsed.name))
   throw Error('Unexpected V3 history event.');
  const a=parsed.args;
  const eventWallet=parsed.name==='ReferralClaimAccrued'?a.upline:
   parsed.name==='WithdrawalPaid'?a.beneficiary:a.user;
  if(getAddress(eventWallet)!==who)throw Error('V3 history wallet mismatch.');
  const key=log.transactionHash.toLowerCase()+':'+log.index;
  if(seen.has(key))throw Error('Duplicate V3 history event.');
  seen.add(key);
  let title='',detail='',value:string|null=null;
  switch(parsed.name){
   case 'DepositRouted':{
    const gross=BigInt(a.amount),fee1=BigInt(a.fee1),fee2=BigInt(a.fee2),operations=BigInt(a.operations);
    if(fee1!==gross/10n||fee2!==gross/10n||fee1+fee2+operations!==gross)
     throw Error('V3 deposit routing does not reconcile.');
    title='Test-token deposit';detail='Position #'+number(BigInt(a.positionId))+' · Routed to designated wallets';value=amount(gross);break;
   }
   case 'DailyClaimAccrued':{
    const daily=BigInt(a.personal),compound=BigInt(a.compounded),total=BigInt(a.total);
    if(daily+compound!==total)throw Error('V3 daily claim does not reconcile.');
    title='Daily claim recorded';detail='Position #'+number(BigInt(a.positionId))+' · Daily '+amount(daily)+' · Profit-on-profit '+amount(compound);value=amount(total);break;
   }
   case 'ReferralClaimAccrued':title='Referral claim recorded';detail='Level '+a.level.toString()+' · Claim, not a wallet payment';value=amount(BigInt(a.amount));break;
   case 'NetworkClaimAccrued':title='Network claim recorded';detail='Group #'+number(BigInt(a.group))+' · Claim, not a wallet payment';value=amount(BigInt(a.amount));break;
   case 'ProfitReinvested':title='Profit reinvested';detail='Position #'+number(BigInt(a.fromPosition))+' to #'+number(BigInt(a.newPositionId));value=amount(BigInt(a.amount));break;
   case 'CheckIn':title='Account check-in';detail='Confirmed eligibility action';break;
   case 'WithdrawalRequested':title='Withdrawal requested';detail='Request #'+number(BigInt(a.id))+' · Approval and funding are separate';value=amount(BigInt(a.gross));break;
   case 'WithdrawalPaid':title='Withdrawal paid';detail='Request #'+number(BigInt(a.id))+' · Net tokens transferred to this wallet';value=amount(BigInt(a.net));break;
  }
  return {key,block:log.blockNumber,transaction:log.transactionHash,index:log.index,title,detail,value};
 }).sort((a,b)=>b.block-a.block||b.index-a.index);
 const recheck=await provider.getBlock(anchor.block);
 if(!recheck?.hash||recheck.hash.toLowerCase()!==anchor.hash.toLowerCase())
  throw Error('The history block changed while loading. Refresh history.');
 return {anchor,page,from,to,items};
}

export async function readV3HistoryPage(walletProvider:Eip1193Provider,wallet:string,
 config:V3SiteReleaseConfig,page:number,anchor:V3HistoryAnchor|null){
 const session=await v3ReadSession(walletProvider,wallet,config);
 try{
  const selected=anchor??{block:session.block.number,hash:session.block.hash!,firstBlock:session.deploymentBlock};
  if(selected.block>session.block.number||selected.firstBlock!==session.deploymentBlock)
   throw Error('History anchor or deployment block is no longer verified.');
  return await queryV3HistoryWindow(session.provider,config.address,wallet,selected,page);
 }finally{session.provider.destroy();}
}
