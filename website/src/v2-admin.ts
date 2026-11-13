// V2-only administrative reads and separately authorized signing actions.
// Identity documents are never placed on-chain or sent to a public API.
import {BrowserProvider,Contract,ZeroAddress,getAddress,isAddress,id,type Eip1193Provider} from 'ethers';
import {V2_ADDRESS,V2_VAULT_ABI,v2Session,type V2Account,type V2Position,type V2Withdrawal} from './v2-chain';

const abi=[...V2_VAULT_ABI,
 'function setVipKyc(address,bool)',
 'function rejectWithdrawal(uint256,bytes32)',
 'function GUARDIAN_ROLE() view returns(bytes32)',
 'function setSuspended(address,bool)'
];
export const V2_APPROVAL_REASONS=[
 {code:'TERMS_NOT_MET',label:'Withdrawal conditions not satisfied'},
 {code:'DUPLICATE_REQUEST',label:'Duplicate request'},
 {code:'COMPLIANCE_REVIEW',label:'Manual compliance review required'},
 {code:'INVALID_REQUEST',label:'Invalid request details'},
 {code:'OTHER_REVIEW',label:'Other documented reason'}
] as const;
export type V2RejectCode=(typeof V2_APPROVAL_REASONS)[number]['code'];
export type V2AdminCustomer={
 wallet:string;registered:boolean;eligible:boolean;kyc:boolean;suspended:boolean;
 referrer:string;lastCheckIn:number;capitalUsd:bigint;block:number;
 positionsTotal:number;positions:V2Position[];
 withdrawalsTotal:number;withdrawals:V2Withdrawal[];
 accounts:V2Account[];
};
export async function readV2AdminCustomer(walletProvider:Eip1193Provider,manager:string,subject:string):Promise<V2AdminCustomer>{
 if(!isAddress(subject))throw Error('Enter a valid V2 customer wallet.');
 const target=getAddress(subject);
 const {vault,block,options}=await v2Session(walletProvider,manager);
 const [kycRole,withdrawalRole]=await Promise.all([vault.KYC_ADMIN_ROLE(options),vault.WITHDRAWAL_APPROVER_ROLE(options)]);
 const [kycGranted,withdrawGranted]=await Promise.all([vault.hasRole(kycRole,manager,options),vault.hasRole(withdrawalRole,manager,options)]);
 if(!kycGranted&&!withdrawGranted)throw Error('Only an on-chain V2 administrator may open detailed customer files.');
 const [user,eligible,positionCount,withdrawalCount,token,decimals]=await Promise.all([
  vault.users(target,options),vault.isEligible(target,options),
  vault.positionCount(target,options),vault.userWithdrawalCount(target,options),
  vault.usdt(options),vault.tokenDecimals(options)
 ]);
 const totalPositions=Number(positionCount),totalWithdrawals=Number(withdrawalCount);
 if(!Number.isSafeInteger(totalPositions)||!Number.isSafeInteger(totalWithdrawals)||
    totalPositions<0||totalWithdrawals<0)throw Error('V2_CUSTOMER_INDEX_INVALID');
 const addresses=[ZeroAddress,getAddress(token)];
 const assets=await Promise.all(addresses.map(async(asset,i)=>{
  const [a,cap,principal,profit,cash,unfunded]=await Promise.all([
   vault.accounts(target,asset,options),vault.profitWithdrawalCap(target,asset,options),
   vault.principalLiability(asset,options),vault.profitLiability(asset,options),
   vault.assetBalance(asset,options),vault.unfundedPrincipal(asset,options)
  ]);
  return {symbol:i===0?'BNB':'USDT',address:asset,decimals:i===0?18:Number(decimals),
   principal:BigInt(a.principal),profit:BigInt(a.profit),
   deposited:BigInt(a.externalDeposited),reinvested:BigInt(a.reinvested),
   nextRequestAt:Number(a.nextRequestAt),requestPending:Boolean(a.requestPending),
   cap:BigInt(cap),contractPrincipal:BigInt(principal),contractProfit:BigInt(profit),
   cash:BigInt(cash),unfunded:BigInt(unfunded)} as V2Account;
 }));
 const positions=await Promise.all(Array.from({length:Math.min(10,totalPositions)},async(_,i)=>{
  const p=await vault.positionOf(target,i,options);
  return {id:i,asset:getAddress(p.asset),principal:BigInt(p.principal),capitalUsd:BigInt(p.capitalUsd),
   openedAt:Number(p.openedAt),lastSettlementAt:Number(p.lastSettlementAt),reserved:BigInt(p.reserved)};
 }));
 const withdrawIds=await Promise.all(Array.from({length:Math.min(10,totalWithdrawals)},async(_,i)=>{
  return BigInt(await vault.userWithdrawalId(target,totalWithdrawals-1-i,options));
 }));
 const withdrawals=await Promise.all(withdrawIds.map(async id=>{
  const q=await vault.withdrawalOf(id,options);
  return {id:Number(id),user:getAddress(q.user),asset:getAddress(q.asset),
   gross:BigInt(q.gross),fee:BigInt(q.fee),positionId:Number(q.positionId),
   requestedAt:Number(q.requestedAt),status:Number(q.status),principal:Boolean(q.principal)} as V2Withdrawal;
 }));
 return {wallet:target,registered:Boolean(user.registered),eligible:Boolean(eligible),
  kyc:Boolean(user.vipKyc),suspended:Boolean(user.suspended),referrer:getAddress(user.referrer),
  lastCheckIn:Number(user.lastCheckIn),capitalUsd:BigInt(user.capitalUsd),
  block:block.number,positionsTotal:totalPositions,withdrawalsTotal:totalWithdrawals,
  positions,withdrawals,accounts:assets};
}
export type V2ManagerAction=
 | {kind:'kyc';user:string;verified:boolean}
 | {kind:'suspend';user:string;suspended:boolean}
 | {kind:'approve';requestId:number}
 | {kind:'reject';requestId:number;reason:V2RejectCode};

export async function sendV2ManagerAction(walletProvider:Eip1193Provider,manager:string,action:V2ManagerAction){
 const {provider,vault,options}=await v2Session(walletProvider,manager);
 const contract=new Contract(V2_ADDRESS,abi,provider);
 let functionName:string,parameters:unknown[],role:bigint|string;
 if(action.kind==='kyc'){
  if(!isAddress(action.user))throw Error('KYC wallet invalid.');
  role=await vault.KYC_ADMIN_ROLE(options);
  functionName='setVipKyc';parameters=[getAddress(action.user),action.verified];
 }else if(action.kind==='suspend'){
  if(!isAddress(action.user))throw Error('Security review wallet invalid.');
  role=await contract.GUARDIAN_ROLE(options);
  functionName='setSuspended';parameters=[getAddress(action.user),action.suspended];
 }else{
  if(!Number.isSafeInteger(action.requestId)||action.requestId<0)throw Error('Request ID invalid.');
  role=await vault.WITHDRAWAL_APPROVER_ROLE(options);
  if(action.kind==='approve'){
   functionName='approveWithdrawal';parameters=[action.requestId];
  }else{
   if(!V2_APPROVAL_REASONS.some(r=>r.code===action.reason))
    throw Error('Choose a documented rejection code.');
   functionName='rejectWithdrawal';
   parameters=[action.requestId,id('GLOBAL_V2_WITHDRAWAL_REJECTION:'+action.reason)];
  }
 }
 if(!(await contract.hasRole(role,manager,options)))
  throw Error('Connected wallet does not have the required V2 contract role.');
 const signer=await new BrowserProvider(walletProvider).getSigner(manager);
 const writable=contract.connect(signer) as Contract;
 await writable.getFunction(functionName).staticCall(...parameters);
 const sent=await writable.getFunction(functionName)(...parameters);
 const receipt=await sent.wait(3);
 if(!receipt||receipt.status!==1)throw Error('V2 administrator transaction not confirmed.');
 return receipt.hash as string;
}
