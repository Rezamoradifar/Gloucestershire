// Independent V3 BNB TESTNET chain adapter. V2 stays installed and untouched.
// A V3 wallet or balance is NEVER shown until an operator-pinned public
// deployment has been verified against its actual on-chain runtime bytecode.
// No default/fabricated V3 address, old V2 state, mainnet, or demo balances.
import {BrowserProvider,Contract,FetchRequest,JsonRpcProvider,getAddress,
 isAddress,keccak256,ZeroAddress,type Eip1193Provider} from 'ethers';
import {V3_TEST_TOKEN,V3_TESTNET_CHAIN_ID,v3ParseReleaseConfig,
 type V3SiteReleaseConfig} from './v3-site-config';
import type {V3ClaimLedger,V3ClaimPosition} from './v3-claim-balance';

export const V3_EXPLORER='https://testnet.bscscan.com';
export const V3_ABI=[
 'function asset() view returns(address)',
 'function feeReceiver() view returns(address)',
 'function paused() view returns(bool)',
 'function users(address) view returns(address referrer,bool registered,bool suspended,bool vipKyc,uint64 lastCheckIn,uint64 nextRequestAt,bool pendingRequest,uint256 capital,uint256 originalDeposits,uint256 reinvestments,uint256 referralAvailable,uint256 referralReserved,uint256 cumulativeReferral)',
 'function isEligible(address) view returns(bool)',
 'function tierOf(address) view returns(uint8)',
 'function dailyBps(uint8) view returns(uint16)',
 'function principalLiability() view returns(uint256)',
 'function profitLiability() view returns(uint256)',
 'function reservedForPayout() view returns(uint256)',
 'function principalEscrowed() view returns(uint256)',
 'function profitWithdrawalCap(address) view returns(uint256)',
 'function claimableDaily(address,uint256) view returns(uint256)',
 'function claimableCompound(address,uint256) view returns(uint256)',
 'function positionCount(address) view returns(uint256)',
 'function positionOf(address,uint256) view returns(tuple(uint256 principal,uint256 compoundedBasis,uint256 availableProfit,uint256 reservedProfit,uint256 reservedPrincipal,uint256 cumulativeDaily,uint256 cumulativeCompound,uint64 openedAt,uint64 lastAccruedAt,bool fromReinvestment))',
 'function withdrawalCount() view returns(uint256)',
 'function withdrawalOf(uint256) view returns(tuple(address beneficiary,uint256 positionId,uint256 gross,uint256 fee,uint64 requestedAt,uint8 status,uint8 kind))',
 'function userWithdrawalCount(address) view returns(uint256)',
 'function userWithdrawalId(address,uint256) view returns(uint256)',
 'function memberCount() view returns(uint256)',
 'function memberAt(uint256) view returns(address)',
 'function MANAGER_ROLE() view returns(bytes32)',
 'function FUNDER_ROLE() view returns(bytes32)',
 'function hasRole(bytes32,address) view returns(bool)',
 'function cashStatus() view returns(uint256 cash,uint256 principal,uint256 accruedProfit,uint256 escrowedCash,uint256 totalCashShortfall)',
 'function register(address)',
 'function checkIn()',
 'function checkInAndAccrue(uint256[])',
 'function deposit(uint256,address)',
 'function reinvest(uint256,uint256)',
 'function requestProfit(uint256,uint256)',
 'function requestReferral(uint256)',
 'function requestPrincipal(uint256,uint256)',
 'function approveWithdrawal(uint256)',
 'function rejectWithdrawal(uint256)',
 'function reserveExistingCash(uint256)',
 'function fundWithdrawal(uint256)',
 'function payWithdrawal(uint256)',
 'event DailyClaimAccrued(address indexed user,uint256 indexed positionId,uint256 personal,uint256 compounded,uint256 total,uint256 at)',
 'event WithdrawalRequested(uint256 indexed id,address indexed user,uint8 kind,uint256 gross,uint256 fee)',
 'event WithdrawalEscrowFunded(uint256 indexed id,address indexed funder,uint256 gross)',
 'event WithdrawalExistingCashReserved(uint256 indexed id,uint256 gross)',
 'event WithdrawalPaid(uint256 indexed id,address indexed beneficiary,uint256 net,uint256 fee)'
];
export const V3_TEST_TOKEN_ABI=[
 'function balanceOf(address) view returns(uint256)',
 'function allowance(address,address) view returns(uint256)',
 'function approve(address,uint256) returns(bool)',
 'function decimals() view returns(uint8)'
];
const endpoints=[
 'https://bsc-testnet-dataseed.bnbchain.org',
 'https://bsc-testnet-rpc.publicnode.com'
] as const;
const withTimeout=<T,>(promise:Promise<T>,milliseconds:number)=>Promise.race([
 promise,new Promise<T>((_,reject)=>{
  const timer=setTimeout(()=>reject(Error('V3_RPC_TIMEOUT')),milliseconds);
  void promise.finally(()=>clearTimeout(timer)).catch(()=>{});
 })
]);
export const v3ReleaseConfig:V3SiteReleaseConfig|null=v3ParseReleaseConfig({
 address:import.meta.env.VITE_V3_CONTRACT_ADDRESS,
 runtimeHash:import.meta.env.VITE_V3_RUNTIME_HASH,
 deploymentTx:import.meta.env.VITE_V3_DEPLOYMENT_TX
});
export type V3WalletPosition=V3ClaimPosition&{
 openedAt:number;lastAccruedAt:number;reservedPrincipal:bigint;
 fromReinvestment:boolean;compoundedBasis:bigint
};
export type V3Withdrawal={
 id:number;beneficiary:string;positionId:number;gross:bigint;fee:bigint;
 requestedAt:number;status:number;kind:number
};
export type V3Snapshot={
 wallet:string;block:number;asOf:number;hash:string;registered:boolean;
 suspended:boolean;vipKyc:boolean;eligible:boolean;
 referrer:string;lastCheckIn:number;nextRequestAt:number;
 pendingWithdrawal:boolean;capital:bigint;originalDeposits:bigint;
 reinvestments:bigint;referralAvailable:bigint;referralReserved:bigint;
 tier:number;dailyRateBps:number;paused:boolean;canManage:boolean;canFund:boolean;
 positions:V3WalletPosition[];withdrawals:V3Withdrawal[];
 withdrawCount:number;memberCount:number;totalWithdrawalCount:number;
 walletTestTokenBalance:bigint;allowance:bigint;gasWei:bigint;
 ledger:V3ClaimLedger;
};
const toSafeCount=(raw:bigint,label:string)=>{
 const n=Number(raw);
 if(!Number.isSafeInteger(n)||n<0||n>1000000)throw Error('Invalid V3 '+label+' index.');
 return n;
};
export async function v3ReadSession(walletProvider:Eip1193Provider,wallet:string,
 config:V3SiteReleaseConfig|null=v3ReleaseConfig){
 if(!config)throw Error('V3 has not been publicly deployed and operator-pinned for this site. Existing V2 account remains available.');
 if(!isAddress(wallet))throw Error('Connect a valid testnet wallet.');
 wallet=getAddress(wallet);
 const [chain,accounts]=await Promise.all([
  walletProvider.request({method:'eth_chainId'}),
  walletProvider.request({method:'eth_accounts'})
 ]);
 if(Number(BigInt(String(chain)))!==V3_TESTNET_CHAIN_ID||
  !Array.isArray(accounts)||!accounts.some(a=>typeof a==='string'&&a.toLowerCase()===wallet.toLowerCase()))
  throw Error('Select the same connected wallet on BNB Testnet (chain 97).');
 const verify=async(provider:JsonRpcProvider|BrowserProvider,checkChain:boolean)=>{
  if(checkChain&&Number(BigInt(await provider.send('eth_chainId',[])))!==97)
   throw Error('V3 source returned a different chain.');
  const height=await provider.getBlockNumber();
  if(height<4)throw Error('BNB Testnet has no confirmed V3 blocks.');
  const [block,code]=await Promise.all([
   provider.getBlock(height-3),provider.getCode(config.address,'latest')
  ]);
  if(!block||!block.hash||code==='0x'||keccak256(code).toLowerCase()!==config.runtimeHash)
   throw Error('V3 runtime bytecode or confirmed block is not the approved deployment.');
  const vault=new Contract(config.address,V3_ABI,provider);
  const asset=await vault.asset({blockTag:block.number});
  if(getAddress(asset)!==V3_TEST_TOKEN)throw Error('V3 asset is not the approved TEST USDT token.');
  return {provider,vault,options:{blockTag:block.number},block,config};
 };
 const sources=endpoints.map(url=>async()=>{
  const request=new FetchRequest(url);request.timeout=8000;
  const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{return await verify(provider,true);}
  finally{provider.destroy();}
 });
 // Public read-only RPC normally works, but the signed user's wallet can
 // serve as a fallback when public mobile reads are rate-limited.
 sources.push(async()=>{
  const provider=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
  try{return await verify(provider,false);}
  finally{provider.destroy();}
 });
 try{return await withTimeout(Promise.any(sources.map(run=>run())),20000);}
 catch{throw Error('Verified V3 BNB Testnet reads unavailable. No financial values will be shown; retry.');}
}
export async function readV3Snapshot(walletProvider:Eip1193Provider,wallet:string,
 config:V3SiteReleaseConfig|null=v3ReleaseConfig):Promise<V3Snapshot>{
 const {vault,provider,options,block}=await v3ReadSession(walletProvider,wallet,config);
 wallet=getAddress(wallet);
 const [user,eligible,nPosition,nWithdraw,tWithdraw,nMember,cap,paused,managerRole,funderRole,cashStatus]=await Promise.all([
  vault.users(wallet,options),vault.isEligible(wallet,options),
  vault.positionCount(wallet,options),vault.userWithdrawalCount(wallet,options),
  vault.withdrawalCount(options),vault.memberCount(options),
  vault.profitWithdrawalCap(wallet,options),vault.paused(options),
  vault.MANAGER_ROLE(options),vault.FUNDER_ROLE(options),vault.cashStatus(options)
 ]);
 const [canManage,canFund,tier,tokenBalance,allowance,gasWei]=await Promise.all([
  vault.hasRole(managerRole,wallet,options),
  vault.hasRole(funderRole,wallet,options),
  vault.tierOf(wallet,options),
  new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,provider).balanceOf(wallet,options),
  new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,provider).allowance(wallet,config!.address,options),
  provider.getBalance(wallet,block.number)
 ]);
 const count=toSafeCount(nPosition,'position');
 if(count>100)throw Error('V3 account has more than 100 positions; load a verified paginated indexer before displaying incomplete claims.');
 const positions=await Promise.all(Array.from({length:count},async(_,id)=>{
  const [p,daily,compound]=await Promise.all([
   vault.positionOf(wallet,id,options),
   vault.claimableDaily(wallet,id,options),
   vault.claimableCompound(wallet,id,options)
  ]);
  return {
   id,principal:BigInt(p.principal),compoundedBasis:BigInt(p.compoundedBasis),
   availableProfit:BigInt(p.availableProfit),
   availableDaily:BigInt(daily),availableCompound:BigInt(compound),
   reservedProfit:BigInt(p.reservedProfit),
   reservedPrincipal:BigInt(p.reservedPrincipal),
   cumulativeDaily:BigInt(p.cumulativeDaily),cumulativeCompound:BigInt(p.cumulativeCompound),
   openedAt:Number(p.openedAt),lastAccruedAt:Number(p.lastAccruedAt),
   fromReinvestment:Boolean(p.fromReinvestment)
  } as V3WalletPosition;
 }));
 const withdrawCount=toSafeCount(nWithdraw,'withdrawal');
 const withdrawalIds=await Promise.all(Array.from({length:Math.min(20,withdrawCount)},(_,i)=>
  vault.userWithdrawalId(wallet,withdrawCount-1-i,options) as Promise<bigint>));
 const withdrawals=await Promise.all(withdrawalIds.map(async id=>{
  const w=await vault.withdrawalOf(id,options);
  return {
   id:toSafeCount(id,'withdrawal ID'),beneficiary:getAddress(w.beneficiary),
   positionId:toSafeCount(w.positionId,'withdrawal position'),gross:BigInt(w.gross),
   fee:BigInt(w.fee),requestedAt:Number(w.requestedAt),status:Number(w.status),
   kind:Number(w.kind)
  } as V3Withdrawal;
 }));
 const ledger:V3ClaimLedger={
  chainId:97,runtimeVerified:true,block:block.number,
  registered:Boolean(user.registered),suspended:Boolean(user.suspended),
  pendingWithdrawal:Boolean(user.pendingRequest),
  asOf:block.timestamp,nextRequestAt:Number(user.nextRequestAt),
  requestCap:BigInt(cap),referralAvailable:BigInt(user.referralAvailable),
  principalLiability:BigInt(cashStatus.principal),
  profitLiability:BigInt(cashStatus.accruedProfit),
  cash:BigInt(cashStatus.cash),escrow:BigInt(cashStatus.escrowedCash),
  positions
 };
 const t=Number(tier);
 if(t<0||t>4)throw Error('Unknown verified V3 tier');
 const dailyRateBps=Number(await vault.dailyBps(t,options));
 if(![50,70,90,110,130].includes(dailyRateBps))
  throw Error('V3 deployed daily rate differs from the reviewed test contract.');
 return {
  wallet,block:block.number,asOf:block.timestamp,hash:block.hash!,
  registered:Boolean(user.registered),suspended:Boolean(user.suspended),
  vipKyc:Boolean(user.vipKyc),eligible:Boolean(eligible),
  referrer:getAddress(user.referrer),lastCheckIn:Number(user.lastCheckIn),
  nextRequestAt:Number(user.nextRequestAt),pendingWithdrawal:Boolean(user.pendingRequest),
  capital:BigInt(user.capital),originalDeposits:BigInt(user.originalDeposits),
  reinvestments:BigInt(user.reinvestments),
  referralAvailable:BigInt(user.referralAvailable),
  referralReserved:BigInt(user.referralReserved),
  tier:t,dailyRateBps,paused:Boolean(paused),
  canManage:Boolean(canManage),canFund:Boolean(canFund),
  positions,withdrawals,withdrawCount,memberCount:toSafeCount(nMember,'member'),
  totalWithdrawalCount:toSafeCount(tWithdraw,'global withdrawal'),
  walletTestTokenBalance:BigInt(tokenBalance),allowance:BigInt(allowance),
  gasWei:BigInt(gasWei),ledger
 };
}
