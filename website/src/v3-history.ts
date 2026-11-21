import {getAddress,Interface,zeroPadValue,type Eip1193Provider,type Log,type Provider} from 'ethers';
import {V3_ABI,V3_INDEPENDENT_READER_COUNT,v3ReadSession} from './v3-chain';
import {formatV3Amount} from './v3-format';
import {V3_TEST_TOKEN,type V3SiteReleaseConfig} from './v3-site-config';

const events=new Interface(V3_ABI);
const firstAccount=['DepositRouted','DailyClaimAccrued','ReferralClaimAccrued',
 'NetworkClaimAccrued','ProfitReinvested','CheckIn','StatusChanged',
 'RewardGroupCreated','RewardBranchesAdded','NetworkRewardPrepared','NetworkRewardEarned','CyclePrepared','CycleEarned'];
const secondAccount=['WithdrawalRequested','WithdrawalPaid','NetworkVolumeQueued'];
const networkFirst=['RewardGroupCreated','RewardBranchesAdded','NetworkRewardPrepared','NetworkRewardEarned','CyclePrepared','CycleEarned'];
const networkSecond=['NetworkVolumeQueued'];
const tokenEvents=new Interface(['event Approval(address indexed owner,address indexed spender,uint256 value)']);
const windowSize=2000;
const maxEvents=200;
// Keep retries bounded: public BNB RPCs differ in maximum getLogs range.
const maxLogRequests=64;
const historyUnavailable='Unable to load the complete activity for these blocks. Please retry or use the block explorer.';
const topic=(name:string)=>events.getEvent(name)!.topicHash;
const hash=(value:string)=>/^0x[0-9a-f]{64}$/i.test(value);
const amount=(value:bigint)=>formatV3Amount(value)+' USDT';
const number=(value:bigint)=>(value+1n).toString();

export type V3HistoryAnchor={block:number;hash:string;firstBlock:number};
export type V3HistoryCategory='deposits'|'earnings'|'withdrawals'|'account';
export type V3HistoryItem={key:string;block:number;transaction:string;index:number;
 title:string;detail:string;value:string|null;category:V3HistoryCategory};
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
 anchor:V3HistoryAnchor,page:number,networkContract?:string):Promise<V3HistoryPage>{
 const address=getAddress(contract),who=getAddress(wallet);
 const network=networkContract?getAddress(networkContract):null;
 if(network&&(network===address||network===V3_TEST_TOKEN))throw Error('Invalid unified network history contract.');
 if(!hash(anchor.hash))throw Error('Invalid V3 history block hash.');
 const {from,to}=v3HistoryRange(anchor.block,page,anchor.firstBlock);
 const blockAtAnchor=async()=>{try{return await provider.getBlock(anchor.block);}catch{throw Error(historyUnavailable);}};
 const anchorBlock=await blockAtAnchor();
 if(!anchorBlock?.hash||anchorBlock.hash.toLowerCase()!==anchor.hash.toLowerCase())
  throw Error('The confirmed history block changed. Refresh history.');
 const account=zeroPadValue(who,32);
 let requests=0;
 const scan=async(logAddress:string,topics:(string|string[]|null)[],start:number,end:number):Promise<Log[]>=>{
  if(++requests>maxLogRequests)throw Error(historyUnavailable);
  let logs:Log[];
  try{logs=await provider.getLogs({address:logAddress,fromBlock:start,toBlock:end,topics});}
  catch(error){
   if(!isLogRangeLimit(error)||start===end)throw Error(historyUnavailable);
   const middle=start+Math.floor((end-start)/2);
   const earlier=await scan(logAddress,topics,start,middle);
   const later=await scan(logAddress,topics,middle+1,end);
   if(earlier.length+later.length>maxEvents)
    throw Error('Too many events in this range. Open the contract explorer for this block range.');
   return [...earlier,...later];
  }
  if(logs.length>maxEvents)throw Error('Too many events in this range. Open the contract explorer for this block range.');
  return logs;
 };
 // Sequential requests avoid multiplying rate pressure while preserving the
 // same complete, non-overlapping block range for both indexed filters.
 const vaultFirst=network?firstAccount.filter(name=>!networkFirst.includes(name)):firstAccount;
 const vaultSecond=network?secondAccount.filter(name=>!networkSecond.includes(name)):secondAccount;
 const first=await scan(address,[vaultFirst.map(topic),account],from,to);
 const second=await scan(address,[vaultSecond.map(topic),null,account],from,to);
 const approvals=await scan(V3_TEST_TOKEN,[tokenEvents.getEvent('Approval')!.topicHash,account,zeroPadValue(address,32)],from,to);
 const networkFirstLogs=network?await scan(network,[networkFirst.map(topic),account],from,to):[];
 const networkSecondLogs=network?await scan(network,[networkSecond.map(topic),null,account],from,to):[];
 if(first.length+second.length+approvals.length+networkFirstLogs.length+networkSecondLogs.length>maxEvents)
  throw Error('Too many events in this range. Open the contract explorer for this block range.');
 const seen=new Set<string>();
 const items=[...first,...second,...approvals,...networkFirstLogs,...networkSecondLogs].map((log:Log):V3HistoryItem=>{
  const logAddress=getAddress(log.address);
  if(log.removed||(logAddress!==address&&logAddress!==V3_TEST_TOKEN&&logAddress!==network)||!hash(log.transactionHash)||
   !Number.isSafeInteger(log.blockNumber)||log.blockNumber<from||log.blockNumber>to||
   !Number.isSafeInteger(log.index)||log.index<0)throw Error('Invalid V3 history event.');
  const parsed=(logAddress===V3_TEST_TOKEN?tokenEvents:events).parseLog({topics:log.topics,data:log.data});
  const allowed=logAddress===V3_TEST_TOKEN?['Approval']:logAddress===network?[...networkFirst,...networkSecond]:[...vaultFirst,...vaultSecond];
  if(!parsed||!allowed.includes(parsed.name))
   throw Error('Unexpected V3 history event.');
  const a=parsed.args;
  const eventWallet=parsed.name==='Approval'?a.owner:parsed.name==='NetworkVolumeQueued'?a.source:
   parsed.name==='ReferralClaimAccrued'?a.upline:parsed.name==='WithdrawalPaid'?a.beneficiary:a.user;
  if(getAddress(eventWallet)!==who||(parsed.name==='Approval'&&getAddress(a.spender)!==address))
   throw Error('V3 history wallet mismatch.');
  const key=log.transactionHash.toLowerCase()+':'+log.index;
  if(seen.has(key))throw Error('Duplicate V3 history event.');
  seen.add(key);
  let title='',detail='',value:string|null=null;
  let category:V3HistoryCategory='account';
  switch(parsed.name){
   case 'DepositRouted':{
    const gross=BigInt(a.amount),fee1=BigInt(a.fee1),fee2=BigInt(a.fee2),operations=BigInt(a.operations);
    if(fee1!==gross/10n||fee2!==gross/10n||fee1+fee2+operations!==gross)
     throw Error('V3 deposit routing does not reconcile.');
    category='deposits';title='Test-token deposit';detail='Position #'+number(BigInt(a.positionId))+' · Routed to designated wallets';value=amount(gross);break;
   }
   case 'DailyClaimAccrued':{
    const daily=BigInt(a.personal),compound=BigInt(a.compounded),total=BigInt(a.total);
    if(daily+compound!==total)throw Error('V3 daily claim does not reconcile.');
    category='earnings';title='Daily claim recorded';detail='Position #'+number(BigInt(a.positionId))+' · Daily '+amount(daily)+' · Profit-on-profit '+amount(compound);value=amount(total);break;
   }
   case 'ReferralClaimAccrued':category='earnings';title='Referral claim recorded';detail='Level '+a.level.toString()+' · Claim, not a wallet payment';value=amount(BigInt(a.amount));break;
   case 'NetworkClaimAccrued':category='earnings';title='Network claim recorded';detail='Group #'+number(BigInt(a.group))+' · Claim, not a wallet payment';value=amount(BigInt(a.amount));break;
   case 'ProfitReinvested':category='earnings';title='Profit reinvested';detail='Position #'+number(BigInt(a.fromPosition))+' to #'+number(BigInt(a.newPositionId));value=amount(BigInt(a.amount));break;
   case 'CheckIn':title='Account check-in';detail='Confirmed eligibility action';break;
   case 'StatusChanged':title=Boolean(a.suspended)?'Account suspended':'Account suspension lifted';detail='Contract account status changed';break;
   case 'Approval':title=BigInt(a.value)===0n?'Test-token approval reset':'Test-token approval';detail='Spending permission for this V3 contract; this is not a deposit';value=amount(BigInt(a.value));break;
   case 'NetworkVolumeQueued':title='Network volume queued';detail='Network job #'+number(BigInt(a.job))+' · Processing can continue separately';value=formatV3Amount(BigInt(a.usd))+' test USD';break;
   case 'RewardGroupCreated':title='Network reward group created';detail='Group #'+number(BigInt(a.group))+' · '+a.branches.length+' branches';break;
   case 'RewardBranchesAdded':title='Network branches added';detail='Group #'+number(BigInt(a.group))+' · '+a.branches.length+' branches';break;
   case 'CyclePrepared':title='Reward cycle prepared';detail='Group #'+number(BigInt(a.group))+' · Cycle '+number(BigInt(a.cycle));value=formatV3Amount(BigInt(a.preparedUsd))+' test USD volume';break;
   case 'CycleEarned':category='earnings';title='Reward cycle completed';detail='Group #'+number(BigInt(a.group))+' · Cycle '+number(BigInt(a.cycle));value=amount(BigInt(a.rewardUsd));break;
   case 'NetworkRewardPrepared':title='Network reward prepared';detail='Group #'+number(BigInt(a.group))+' · Stage '+number(BigInt(a.stage))+' · Not a wallet payment';value=formatV3Amount(BigInt(a.preparedUsd))+' test USD volume';break;
   case 'NetworkRewardEarned':category='earnings';title='Network milestone completed';detail='Group #'+number(BigInt(a.group))+' · Stage '+number(BigInt(a.stage))+' · Included in the network claim';value=formatV3Amount(BigInt(a.rewardUsd))+' test USD';break;
   case 'WithdrawalRequested':category='withdrawals';title='Withdrawal requested';detail='Request #'+number(BigInt(a.id))+' · Approval and funding are separate';value=amount(BigInt(a.gross));break;
   case 'WithdrawalPaid':category='withdrawals';title='Withdrawal paid';detail='Request #'+number(BigInt(a.id))+' · Net tokens transferred to this wallet';value=amount(BigInt(a.net));break;
  }
  return {key,block:log.blockNumber,transaction:log.transactionHash,index:log.index,title,detail,value,category};
 }).sort((a,b)=>b.block-a.block||b.index-a.index);
 const recheck=await blockAtAnchor();
 if(!recheck?.hash||recheck.hash.toLowerCase()!==anchor.hash.toLowerCase())
  throw Error('The history block changed while loading. Refresh history.');
 return {anchor,page,from,to,items};
}

export async function readV3HistoryPage(walletProvider:Eip1193Provider,wallet:string,
 config:V3SiteReleaseConfig,page:number,anchor:V3HistoryAnchor|null){
 // Keep one anchor and never mix partial results across sources. A fresh source
 // must independently verify the deployment and agree on the anchor block.
 let selected=anchor;
 let nextReader=0;
 while(nextReader<=V3_INDEPENDENT_READER_COUNT){
  let session:Awaited<ReturnType<typeof v3ReadSession>>;
  try{session=await v3ReadSession(walletProvider,wallet,config,false,nextReader);}
  catch{throw Error(historyUnavailable);}
  try{
   selected=selected??{block:session.block.number,hash:session.block.hash!,firstBlock:session.deploymentBlock};
   if(selected.block>session.block.number||selected.firstBlock!==session.deploymentBlock)
    throw Error('History anchor or deployment block is no longer verified.');
   return await queryV3HistoryWindow(session.provider,config.address,wallet,selected,page,config.unified?.network);
  }catch(error){
   if(!(error instanceof Error)||error.message!==historyUnavailable||session.readerIndex>=V3_INDEPENDENT_READER_COUNT)throw error;
   nextReader=session.readerIndex+1;
  }finally{session.provider.destroy();}
 }
 throw Error(historyUnavailable);
}
