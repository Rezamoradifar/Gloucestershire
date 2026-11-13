// Global V2 browser wallet connector: never load /api/config or the retired ABI.
// The V2 address and deployed runtime hash are pinned to the operator's verified
// BNB Testnet deployment. Any mismatch stops ALL account actions.
import {BrowserProvider,Contract,ZeroAddress,getAddress,isAddress,keccak256,formatUnits,type Eip1193Provider} from 'ethers';

export const V2_CHAIN_ID=97;
export const V2_ADDRESS=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
export const V2_CODE_HASH='0x3e1f99305bf7edbb12d4d9870124f84ece95bb23b6bf890470e94d06a336bf99';
export const V2_EXPLORER='https://testnet.bscscan.com';
export const V2_VAULT_ABI=[
 'function usdt() view returns(address)',
 'function tokenDecimals() view returns(uint8)',
 'function users(address) view returns(address referrer,bool registered,bool vipKyc,bool suspended,uint64 lastCheckIn,uint256 capitalUsd)',
 'function accounts(address,address) view returns(uint256 principal,uint256 profit,uint256 externalDeposited,uint256 reinvested,uint64 nextRequestAt,bool requestPending)',
 'function isEligible(address) view returns(bool)',
 'function quoteUsd(address,uint256) view returns(uint256)',
 'function memberCount() view returns(uint256)',
 'function memberAt(uint256) view returns(address)',
 'function positionCount(address) view returns(uint256)',
 'function positionOf(address,uint256) view returns(tuple(address asset,uint256 principal,uint256 capitalUsd,uint64 openedAt,uint64 lastSettlementAt,uint256 reserved))',
 'function userWithdrawalCount(address) view returns(uint256)',
 'function userWithdrawalId(address,uint256) view returns(uint256)',
 'function withdrawalCount() view returns(uint256)',
 'function withdrawalOf(uint256) view returns(tuple(address user,address asset,uint256 gross,uint256 fee,uint256 positionId,uint64 requestedAt,uint8 status,bool principal))',
 'function principalLiability(address) view returns(uint256)',
 'function profitLiability(address) view returns(uint256)',
 'function assetBalance(address) view returns(uint256)',
 'function unfundedPrincipal(address) view returns(uint256)',
 'function profitWithdrawalCap(address,address) view returns(uint256)',
 'function PROFIT_FEE_BPS() view returns(uint256)',
 'function WITHDRAWAL_COOLDOWN() view returns(uint256)',
 'function KYC_ADMIN_ROLE() view returns(bytes32)',
 'function WITHDRAWAL_APPROVER_ROLE() view returns(bytes32)',
 'function hasRole(bytes32,address) view returns(bool)',
 'function register(address)',
 'function checkIn()',
 'function reinvest(address,uint256)',
 'function requestWithdrawal(address,uint256,bool,uint256)',
 'function approveWithdrawal(uint256)',
 'function payWithdrawal(uint256)'
];

export type V2Asset='BNB'|'USDT';
export type V2Account={
 symbol:V2Asset;address:string;decimals:number;principal:bigint;profit:bigint;
 deposited:bigint;reinvested:bigint;nextRequestAt:number;requestPending:boolean;
 cap:bigint;contractPrincipal:bigint;contractProfit:bigint;cash:bigint;unfunded:bigint;
};
export type V2Position={
 id:number;asset:string;principal:bigint;capitalUsd:bigint;
 openedAt:number;lastSettlementAt:number;reserved:bigint;
};
export type V2Withdrawal={
 id:number;user:string;asset:string;gross:bigint;fee:bigint;
 positionId:number;requestedAt:number;status:number;principal:boolean;
};
export type V2Snapshot={
 wallet:string;block:number;blockHash:string;asOf:number;
 registered:boolean;referrer:string;kyc:boolean;suspended:boolean;eligible:boolean;
 lastCheckIn:number;capitalUsd:bigint;memberCount:number;positionsTotal:number;
 withdrawalsTotal:number;positions:V2Position[];withdrawals:V2Withdrawal[];
 token:string;accounts:V2Account[];feeBps:number;cooldownSeconds:number;
 canApprove:boolean;canKyc:boolean;
};

export const v2Short=(address:string)=>address.slice(0,9)+'…'+address.slice(-6);
export const v2Money=(value:bigint,decimals:number,precision=4)=>{
 const text=formatUnits(value,decimals);
 const [whole,fraction='']=text.split('.');
 return BigInt(whole).toLocaleString('en-US')+(fraction?'.'+fraction.slice(0,precision).replace(/0+$/,''):'');
};
export const v2Date=(seconds:number)=>seconds?new Date(seconds*1000).toLocaleString('en-US'):'Not recorded';
export const v2WithdrawalStatus=(status:number)=>{
 if(status===0)return 'Waiting for manager approval';
 if(status===1)return 'Approved — awaiting payment';
 if(status===2)return 'Paid to wallet';
 if(status===3)return 'Cancelled';
 if(status===4)return 'Rejected';
 return 'Unknown — verify on chain';
};

export async function v2Session(walletProvider:Eip1193Provider,wallet:string){
 if(!isAddress(wallet))throw Error('Connect a valid account on BNB Testnet.');
 const [chain,accounts]=await Promise.all([
  walletProvider.request({method:'eth_chainId'}),
  walletProvider.request({method:'eth_accounts'})
 ]);
 if(Number(chain)!==V2_CHAIN_ID)throw Error('Switch your wallet to BNB Testnet (chain 97).');
 if(!Array.isArray(accounts)||!accounts.some(value=>typeof value==='string'&&value.toLowerCase()===wallet.toLowerCase()))
  throw Error('The selected wallet changed; reconnect before using V2.');
 const provider=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
 const head=await provider.getBlockNumber();
 const blockNumber=Math.max(0,head-3);
 const [block,code]=await Promise.all([
  provider.getBlock(blockNumber),
  provider.getCode(V2_ADDRESS,blockNumber)
 ]);
 if(!block||!block.hash||block.number!==blockNumber||code==='0x'||keccak256(code).toLowerCase()!==V2_CODE_HASH)
  throw Error('The verified V2 testnet contract was not found at the expected address and code hash.');
 const vault=new Contract(V2_ADDRESS,V2_VAULT_ABI,provider);
 const fee=await vault.PROFIT_FEE_BPS({blockTag:blockNumber});
 const cooldown=await vault.WITHDRAWAL_COOLDOWN({blockTag:blockNumber});
 if(fee!==300n||cooldown!==259200n)throw Error('V2 on-chain withdrawal terms do not match the approved terms.');
 return {provider,vault,block,options:{blockTag:blockNumber}};
}

export async function readV2Snapshot(walletProvider:Eip1193Provider,wallet:string):Promise<V2Snapshot>{
 wallet=getAddress(wallet);
 const {provider,vault,block,options}=await v2Session(walletProvider,wallet);
 const [user,eligible,memberCount,positionCount,requestCount,token,decimals,kycRole,approveRole]=await Promise.all([
  vault.users(wallet,options),vault.isEligible(wallet,options),vault.memberCount(options),
  vault.positionCount(wallet,options),vault.userWithdrawalCount(wallet,options),
  vault.usdt(options),vault.tokenDecimals(options),
  vault.KYC_ADMIN_ROLE(options),vault.WITHDRAWAL_APPROVER_ROLE(options)
 ]);
 const [canKyc,canApprove]=await Promise.all([
  vault.hasRole(kycRole,wallet,options),vault.hasRole(approveRole,wallet,options)
 ]);
 const positionsTotal=Number(positionCount),withdrawalsTotal=Number(requestCount);
 if(!Number.isSafeInteger(positionsTotal)||!Number.isSafeInteger(withdrawalsTotal)||
   positionsTotal<0||withdrawalsTotal<0)throw Error('Invalid V2 account indexes.');
 const addresses=[ZeroAddress,getAddress(token)];
 const assets=await Promise.all(addresses.map(async (asset,index)=>{
  const [account,cap,principal,profit,cash,unfunded]=await Promise.all([
   vault.accounts(wallet,asset,options),vault.profitWithdrawalCap(wallet,asset,options),
   vault.principalLiability(asset,options),vault.profitLiability(asset,options),
   vault.assetBalance(asset,options),vault.unfundedPrincipal(asset,options)
  ]);
  return {symbol:index===0?'BNB':'USDT',address:asset,decimals:index===0?18:Number(decimals),
   principal:BigInt(account.principal),profit:BigInt(account.profit),
   deposited:BigInt(account.externalDeposited),reinvested:BigInt(account.reinvested),
   nextRequestAt:Number(account.nextRequestAt),requestPending:Boolean(account.requestPending),
   cap:BigInt(cap),contractPrincipal:BigInt(principal),contractProfit:BigInt(profit),
   cash:BigInt(cash),unfunded:BigInt(unfunded)} as V2Account;
 }));
 const positions=await Promise.all(
  Array.from({length:Math.min(10,positionsTotal)},async(_,i)=>{
   const p=await vault.positionOf(wallet,i,options);
   return {id:i,asset:getAddress(p.asset),principal:BigInt(p.principal),capitalUsd:BigInt(p.capitalUsd),
    openedAt:Number(p.openedAt),lastSettlementAt:Number(p.lastSettlementAt),reserved:BigInt(p.reserved)};
  })
 );
 const withdrawalIds=await Promise.all(
  Array.from({length:Math.min(10,withdrawalsTotal)},async(_,i)=>
    vault.userWithdrawalId(wallet,withdrawalsTotal-1-i,options) as Promise<bigint>)
 );
 const withdrawals=await Promise.all(withdrawalIds.map(async id=>{
  const r=await vault.withdrawalOf(id,options);
  return {id:Number(id),user:getAddress(r.user),asset:getAddress(r.asset),gross:BigInt(r.gross),
   fee:BigInt(r.fee),positionId:Number(r.positionId),requestedAt:Number(r.requestedAt),
   status:Number(r.status),principal:Boolean(r.principal)};
 }));
 return {
  wallet,block:block.number,blockHash:block.hash!,asOf:block.timestamp,
  registered:Boolean(user.registered),referrer:getAddress(user.referrer),
  kyc:Boolean(user.vipKyc),suspended:Boolean(user.suspended),eligible:Boolean(eligible),
  lastCheckIn:Number(user.lastCheckIn),capitalUsd:BigInt(user.capitalUsd),
  memberCount:Number(memberCount),positionsTotal,withdrawalsTotal,
  positions,withdrawals,token:getAddress(token),accounts:assets,feeBps:300,cooldownSeconds:259200,
  canApprove:Boolean(canApprove),canKyc:Boolean(canKyc)
 };
}

// Read-only verified-oracle quote. It never requests an ERC20 allowance,
 // calls deposit, generates a user balance, or sends any financial transaction.
export async function readV2InvestmentQuote(
 walletProvider:Eip1193Provider,wallet:string,asset:string,amount:bigint
){
 if(!isAddress(asset)||amount<=0n)throw Error('Invalid read-only quote request.');
 const {vault,options,block}=await v2Session(walletProvider,wallet);
 const [approvedToken,decimals]=await Promise.all([vault.usdt(options),vault.tokenDecimals(options)]);
 const actual=getAddress(asset);
 if(actual!==ZeroAddress&&actual!==getAddress(approvedToken))
  throw Error('The proposed asset is not supported by this V2 contract.');
 const usd=BigInt(await vault.quoteUsd(actual,amount,options));
 return Object.freeze({asset:actual,amount,usd,block:block.number,
  decimals:actual===ZeroAddress?18:Number(decimals),status:'QUOTE_ONLY_NO_DEPOSIT' as const});
}

// Only intended user-initiated actions are available; V2 deposits and revenue
// settlement are deliberately NOT exposed by this unaudited site integration.
export type V2Action=
 | {kind:'register';referrer:string}
 | {kind:'checkIn'}
 | {kind:'reinvest';asset:string;amount:bigint}
 | {kind:'requestProfit';asset:string;amount:bigint}
 | {kind:'requestPrincipal';asset:string;amount:bigint;positionId:number}
 | {kind:'approveWithdrawal';id:number}
 | {kind:'payWithdrawal';id:number};

export async function sendV2Action(walletProvider:Eip1193Provider,wallet:string,action:V2Action){
 const {vault}=await v2Session(walletProvider,wallet);
 const signer=await new BrowserProvider(walletProvider).getSigner(wallet);
 const target=vault.connect(signer) as Contract;
 let name:string,args:unknown[];
 switch(action.kind){
  case 'register':
   if(!isAddress(action.referrer))throw Error('Enter a valid referrer or use the zero address.');
   name='register';args=[getAddress(action.referrer)];break;
  case 'checkIn':name='checkIn';args=[];break;
  case 'reinvest':
   if(action.amount<=0n)throw Error('Enter a positive reinvestment amount.');
   name='reinvest';args=[getAddress(action.asset),action.amount];break;
  case 'requestProfit':
   if(action.amount<=0n)throw Error('Enter a positive profit withdrawal amount.');
   name='requestWithdrawal';args=[getAddress(action.asset),action.amount,false,0];break;
  case 'requestPrincipal':
   if(action.amount<=0n||!Number.isSafeInteger(action.positionId)||action.positionId<0)
    throw Error('Invalid principal withdrawal request.');
   name='requestWithdrawal';args=[getAddress(action.asset),action.amount,true,action.positionId];break;
  case 'approveWithdrawal':
   if(!Number.isSafeInteger(action.id)||action.id<0)throw Error('Invalid request ID.');
   name='approveWithdrawal';args=[action.id];break;
  case 'payWithdrawal':
   if(!Number.isSafeInteger(action.id)||action.id<0)throw Error('Invalid request ID.');
   name='payWithdrawal';args=[action.id];break;
 }
 await target.getFunction(name).staticCall(...args);
 const sent=await target.getFunction(name)(...args);
 const receipt=await sent.wait(3);
 if(!receipt||receipt.status!==1)throw Error('Transaction not confirmed.');
 return receipt.hash as string;
}

export async function readV2AdminRequests(walletProvider:Eip1193Provider,wallet:string,page=0){
 if(!Number.isSafeInteger(page)||page<0||page>100000)throw Error('Invalid withdrawal page.');
 const {vault,options}=await v2Session(walletProvider,wallet);
 const role=await vault.WITHDRAWAL_APPROVER_ROLE(options);
 if(!await vault.hasRole(role,wallet,options))throw Error('Only an approved manager may inspect the admin queue.');
 const n=Number(await vault.withdrawalCount(options));
 if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid withdrawal count.');
 const limit=10;
 const ids=Array.from({length:Math.max(0,Math.min(limit,n-page*limit))},(_,i)=>n-1-page*limit-i);
 const rows=await Promise.all(ids.map(async id=>{
  const r=await vault.withdrawalOf(id,options);
  return {id,user:getAddress(r.user),asset:getAddress(r.asset),gross:BigInt(r.gross),
   fee:BigInt(r.fee),positionId:Number(r.positionId),requestedAt:Number(r.requestedAt),
   status:Number(r.status),principal:Boolean(r.principal)} as V2Withdrawal;
 }));
 return {total:n,page,rows};
}

export type V2AdminMember={
 wallet:string;registered:boolean;eligible:boolean;kyc:boolean;suspended:boolean;
 referrer:string;capitalUsd:bigint;lastCheckIn:number;principalUsdt:bigint;profitUsdt:bigint;
};
export async function readV2AdminMembers(walletProvider:Eip1193Provider,wallet:string,page=0){
 if(!Number.isSafeInteger(page)||page<0||page>100000)throw Error('Invalid member page.');
 const {vault,options}=await v2Session(walletProvider,wallet);
 const [kycRole,withdrawalRole]=await Promise.all([
  vault.KYC_ADMIN_ROLE(options),vault.WITHDRAWAL_APPROVER_ROLE(options)
 ]);
 const [canKyc,canApprove]=await Promise.all([
  vault.hasRole(kycRole,wallet,options),vault.hasRole(withdrawalRole,wallet,options)
 ]);
 if(!canKyc&&!canApprove)throw Error('The connected wallet is not an authorized manager.');
 const total=Number(await vault.memberCount(options));
 if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid member count.');
 const token=getAddress(await vault.usdt(options));
 const start=page*10;
 const ids=Array.from({length:Math.max(0,Math.min(10,total-start))},(_,i)=>start+i);
 const members=await Promise.all(ids.map(async i=>{
  const address=getAddress(await vault.memberAt(i,options));
  const [user,eligible,account]=await Promise.all([
   vault.users(address,options),vault.isEligible(address,options),vault.accounts(address,token,options)
  ]);
  return {wallet:address,registered:Boolean(user.registered),eligible:Boolean(eligible),
   kyc:Boolean(user.vipKyc),suspended:Boolean(user.suspended),
   referrer:getAddress(user.referrer),capitalUsd:BigInt(user.capitalUsd),
   lastCheckIn:Number(user.lastCheckIn),principalUsdt:BigInt(account.principal),
   profitUsdt:BigInt(account.profit)} as V2AdminMember;
 }));
 return {total,page,members};
}
