// Bounded, read-only event history for the NEW Global V2 Testnet only.
// Historic coverage is explicitly limited to a user-selected block window.
// Never attribute events from a different contract or report a bounded window
// as a complete lifetime ledger.
import {Interface,ZeroAddress,getAddress,isAddress,type Eip1193Provider} from 'ethers';
import {V2_ADDRESS,V2_EXPLORER,v2Session} from './v2-chain';

export const V2_DEPLOYMENT_BLOCK=142416836;
export const V2_MAX_LOG_WINDOW=1800;
export const V2_MAX_EVENTS_PER_WINDOW=1500;

export const V2_EVENT_ABI=[
 'event Registered(address indexed user,address indexed referrer)',
 'event CheckIn(address indexed user,uint256 at)',
 'event UserSuspended(address indexed user,bool suspended)',
 'event VipKycChanged(address indexed user,bool verified,address indexed administrator)',
 'event DepositRouted(address indexed user,address indexed asset,uint256 gross,uint256 fee1,uint256 fee2,uint256 operations)',
 'event PositionOpened(address indexed user,address indexed asset,uint256 indexed id,uint256 principal,uint256 capitalUsd,bool reinvest)',
 'event EarningsFunded(bytes32 indexed proof,address indexed source,address indexed asset,uint256 position,uint256 gross,uint256 total,uint256 periodEnd)',
 'event PersonalProfitCredited(address indexed user,address indexed asset,bytes32 indexed proof,uint256 amount)',
 'event ReferralProfitCredited(address indexed upline,address indexed source,bytes32 indexed proof,uint8 level,uint256 rateBps,address asset,uint256 amount)',
 'event WithdrawalRequested(uint256 indexed id,address indexed user,address indexed asset,bool principal,uint256 gross,uint256 fee)',
 'event WithdrawalApproved(uint256 indexed id,address indexed administrator)',
 'event WithdrawalResolved(uint256 indexed id,uint8 status,bytes32 reason)',
 'event Reinvested(address indexed user,address indexed asset,uint256 amount,uint256 newPosition)',
 'event PrincipalLiquidityFunded(address indexed sender,address indexed asset,uint256 amount)'
];
export const v2Events=new Interface(V2_EVENT_ABI);
export type V2LogLike={
 address:string;topics:readonly string[];data:string;blockNumber:number;transactionHash:string;index:number;
};
export type V2WalletEvent={
 key:string;block:number;tx:string;index:number;name:string;asset:string|null;
 amount:bigint|null;wallet:string;source:string|null;level:number|null;
 rateBps:number|null;proof:string|null;requestId:number|null;
 details:string;
};

function safeAddress(value:unknown){
 try{return getAddress(String(value));}catch{return ZeroAddress;}
}
function walletMatches(actual:string,expected:string){
 return actual.toLowerCase()===expected.toLowerCase();
}
export function decodeV2WalletEvents(logs:readonly V2LogLike[],selectedWallet:string){
 if(!isAddress(selectedWallet))throw Error('V2_HISTORY_WALLET_INVALID');
 const wallet=getAddress(selectedWallet);
 if(logs.length>V2_MAX_EVENTS_PER_WINDOW)
  throw Error('V2_HISTORY_TOO_MANY_EVENTS_REDUCE_WINDOW');
 const rows:V2WalletEvent[]=[];
 const unique=new Set<string>();
 for(const log of logs){
  if(!walletMatches(log.address,V2_ADDRESS)||!Number.isSafeInteger(log.blockNumber)||
   !Number.isSafeInteger(log.index)||log.index<0)continue;
  const key=log.transactionHash.toLowerCase()+':'+log.index;
  if(unique.has(key))continue;
  unique.add(key);
  let event;
  try{event=v2Events.parseLog({topics:[...log.topics],data:log.data});}catch{continue;}
  if(!event)continue;
  const a=event.args;
  let person=ZeroAddress,source:string|null=null,asset:string|null=null;
  let amount:bigint|null=null,level:number|null=null,rateBps:number|null=null;
  let proof:string|null=null,requestId:number|null=null,details='';
  switch(event.name){
   case 'Registered':person=safeAddress(a.user);source=safeAddress(a.referrer);details='Wallet registration';break;
   case 'CheckIn':person=safeAddress(a.user);details='Wallet-signed 24-hour activity check-in';break;
   case 'UserSuspended':person=safeAddress(a.user);details=a.suspended?'Account suspended by guardian':'Suspension lifted by guardian';break;
   case 'VipKycChanged':person=safeAddress(a.user);details=a.verified?'KYC approved by authorized admin':'KYC approval revoked';break;
   case 'DepositRouted':
    person=safeAddress(a.user);asset=safeAddress(a.asset);amount=BigInt(a.gross);
    details='Gross deposit routed to fee and operations wallets';break;
   case 'PositionOpened':
    person=safeAddress(a.user);asset=safeAddress(a.asset);amount=BigInt(a.principal);
    details=a.reinvest?'New reinvested position':'New external-deposit position';break;
   case 'PersonalProfitCredited':
    person=safeAddress(a.user);asset=safeAddress(a.asset);amount=BigInt(a.amount);
    proof=String(a.proof);details='Personal funded profit credited';break;
   case 'ReferralProfitCredited':
    person=safeAddress(a.upline);source=safeAddress(a.source);asset=safeAddress(a.asset);
    amount=BigInt(a.amount);level=Number(a.level);rateBps=Number(a.rateBps);
    proof=String(a.proof);details='Funded referral profit credited';break;
   case 'EarningsFunded':
    person=safeAddress(a.source);asset=safeAddress(a.asset);amount=BigInt(a.total);
    proof=String(a.proof);details='Funded settlement covering personal and eligible referral credits';break;
   case 'WithdrawalRequested':
    person=safeAddress(a.user);asset=safeAddress(a.asset);amount=BigInt(a.gross);
    requestId=Number(a.id);
    details=a.principal?'Principal withdrawal requested':'Profit withdrawal requested';break;
   case 'Reinvested':
    person=safeAddress(a.user);asset=safeAddress(a.asset);amount=BigInt(a.amount);
    details='Manual reinvestment';break;
   case 'PrincipalLiquidityFunded':
    person=safeAddress(a.sender);asset=safeAddress(a.asset);amount=BigInt(a.amount);
    details='Principal liquidity returned to vault';break;
   // Approval and resolved events are indexed by request ID, not recipient.
   // Do not incorrectly attribute them to a wallet without joining the queue.
   default:continue;
  }
  if(!walletMatches(person,wallet))continue;
  rows.push({key,block:log.blockNumber,tx:log.transactionHash,index:log.index,
   name:event.name,asset,amount,wallet,source,level,rateBps,proof,requestId,details});
 }
 return rows.sort((a,b)=>b.block-a.block||b.index-a.index);
}
export function v2Window(confirmedHead:number,offset=0){
 if(!Number.isSafeInteger(confirmedHead)||confirmedHead<V2_DEPLOYMENT_BLOCK||
  !Number.isSafeInteger(offset)||offset<0||offset>1_000_000)
  throw Error('V2_HISTORY_WINDOW_INVALID');
 const to=Math.max(V2_DEPLOYMENT_BLOCK,confirmedHead-offset*V2_MAX_LOG_WINDOW);
 const from=Math.max(V2_DEPLOYMENT_BLOCK,to-V2_MAX_LOG_WINDOW+1);
 return {from,to,hasOlder:from>V2_DEPLOYMENT_BLOCK,confirmedHead};
}
export async function readV2History(walletProvider:Eip1193Provider,requester:string,subject:string,offset=0){
 if(!isAddress(subject))throw Error('Invalid V2 customer wallet.');
 const {provider,vault,block,options}=await v2Session(walletProvider,requester);
 const same=walletMatches(subject,requester);
 if(!same){
  const roles=await Promise.all([vault.KYC_ADMIN_ROLE(options),vault.WITHDRAWAL_APPROVER_ROLE(options)]);
  const permitted=await Promise.all(roles.map(role=>vault.hasRole(role,requester,options)));
  if(!permitted.some(Boolean))throw Error('Only an authorized manager may inspect other members through this panel.');
 }
 const range=v2Window(block.number,offset);
 const logs=await provider.getLogs({address:V2_ADDRESS,fromBlock:range.from,toBlock:range.to});
 if(logs.length>V2_MAX_EVENTS_PER_WINDOW)throw Error('Too many logs in this block window. Use a smaller range.');
 return {...range,offset,wallet:getAddress(subject),events:decodeV2WalletEvents(logs,subject),
  coverage:'BOUNDED_BLOCK_WINDOW',source:'CHAIN_97_V2_ONCHAIN_LOGS',explorer:V2_EXPLORER};
}
