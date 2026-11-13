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
const V3_EXPECTED_MANAGER=getAddress('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');
const V3_EXPECTED_FEE_RECEIVER=getAddress('0x74015dedf36677485793f1714ec7bd4893907b26');
export const V3_DEPOSIT_FEE_1=getAddress('0x7037cc199499d7a3431285a01e435454eae51265');
export const V3_DEPOSIT_FEE_2=getAddress('0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632');
export const V3_OPERATIONS=getAddress('0x8c4ac9b009808a0b49ba77b58e3871e7cdba463c');
export const V3_ABI=[
 'function asset() view returns(address)',
 'function feeReceiver() view returns(address)',
 'function FEE_WALLET_1() view returns(address)',
 'function FEE_WALLET_2() view returns(address)',
 'function OPERATIONS_WALLET() view returns(address)',
 'function DEPOSIT_FEE_EACH_BPS() view returns(uint256)',
 'function paused() view returns(bool)',
 'function users(address) view returns(address referrer,bool registered,bool suspended,bool vipKyc,uint64 lastCheckIn,uint64 nextRequestAt,bool pendingRequest,uint256 capital,uint256 originalDeposits,uint256 reinvestments,uint256 referralAvailable,uint256 referralReserved,uint256 cumulativeReferral)',
 'function isEligible(address) view returns(bool)',
 'function tierOf(address) view returns(uint8)',
 'function dailyBps(uint8) view returns(uint16)',
 'function effectiveDailyBps(address) view returns(uint16)',
 'function qualifiedDirects(address) view returns(uint256)',
 'function qualifiedVolume(address,uint8) view returns(uint256)',
 'function upgradeTerms(uint8) view returns(uint256 target,uint256 directs,uint16 maximumBps)',
 'function networkAvailable(address) view returns(uint256)',
 'function networkReserved(address) view returns(uint256)',
 'function cumulativeNetwork(address) view returns(uint256)',
 'function networkBranchCount(address) view returns(uint256)',
 'function networkBranch(address,uint256) view returns(address)',
 'function branchVolumeUsd(address,address) view returns(uint256)',
 'function rewardGroupCount(address) view returns(uint256)',
 'function rewardProgress(address,uint256) view returns(uint8 stage,uint256 preparedUsd,uint256 cursor,uint256 branches)',
 'function rewardStage(uint256) pure returns(uint256 volumeUsd,uint256 rewardUsd)',
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
 'function requestNetworkReward(uint256)',
 'function createRewardGroup(address[])',
 'function addRewardBranches(uint256,address[])',
 'function prepareNetworkReward(uint256,uint8,uint256)',
 'function claimNetworkRewards(uint256,uint8,uint8)',
 'function requestPrincipal(uint256,uint256)',
 'function approveWithdrawal(uint256)',
 'function rejectWithdrawal(uint256)',
 'function reserveExistingCash(uint256)',
 'function fundWithdrawal(uint256)',
 'function payWithdrawal(uint256)',
 'event DailyClaimAccrued(address indexed user,uint256 indexed positionId,uint256 personal,uint256 compounded,uint256 total,uint256 at)',
 'event DepositRouted(address indexed user,uint256 indexed positionId,uint256 amount,uint256 fee1,uint256 fee2,uint256 operations)',
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
export type V3NetworkBranch={address:string;volume:bigint};
export type V3NetworkGroup={id:number;stage:number;prepared:bigint;branches:number;target:bigint;reward:bigint};
export type V3Snapshot={
 wallet:string;block:number;asOf:number;hash:string;registered:boolean;
 suspended:boolean;vipKyc:boolean;eligible:boolean;
 referrer:string;lastCheckIn:number;nextRequestAt:number;
 pendingWithdrawal:boolean;capital:bigint;originalDeposits:bigint;
 reinvestments:bigint;referralAvailable:bigint;referralReserved:bigint;
 tier:number;dailyRateBps:number;paused:boolean;canManage:boolean;canFund:boolean;
 qualifiedDirects:number;qualifiedVolume:bigint;requiredDirects:number;requiredVolume:bigint;maximumRateBps:number;
 networkAvailable:bigint;networkReserved:bigint;cumulativeNetwork:bigint;
 networkBranches:V3NetworkBranch[];networkBranchCount:number;
 networkGroups:V3NetworkGroup[];networkGroupCount:number;networkLoaded:boolean;
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
  const [block,code,receipt]=await Promise.all([
   provider.getBlock(height-3),provider.getCode(config.address,'latest'),
   provider.getTransactionReceipt(config.deploymentTx)
  ]);
  if(!block||!block.hash||code==='0x'||keccak256(code).toLowerCase()!==config.runtimeHash||
   !receipt||receipt.status!==1||receipt.blockNumber>block.number||
   !receipt.contractAddress||getAddress(receipt.contractAddress)!==config.address)
   throw Error('V3 runtime, confirmed deployment transaction or BNB Testnet block mismatched.');
  const vault=new Contract(config.address,V3_ABI,provider);
  const options={blockTag:block.number};
  const [asset,fees,managerRole,depositFee1,depositFee2,operations,depositBps]=await Promise.all([
   vault.asset(options),vault.feeReceiver(options),vault.MANAGER_ROLE(options),
   vault.FEE_WALLET_1(options),vault.FEE_WALLET_2(options),
   vault.OPERATIONS_WALLET(options),vault.DEPOSIT_FEE_EACH_BPS(options)
  ]);
  const adminAllowed=await vault.hasRole(managerRole,V3_EXPECTED_MANAGER,options);
  if(getAddress(asset)!==V3_TEST_TOKEN||
    getAddress(fees)!==V3_EXPECTED_FEE_RECEIVER||!adminAllowed||
    getAddress(depositFee1)!==V3_DEPOSIT_FEE_1||getAddress(depositFee2)!==V3_DEPOSIT_FEE_2||
    getAddress(operations)!==V3_OPERATIONS||BigInt(depositBps)!==1000n)
   throw Error('V3 asset, routing destinations, fees or manager role was not verified.');
  return {provider,vault,options,block,config};
 };
 // Try independent sources sequentially; retain the successful provider only
 // for the scoped read, so its connection is not destroyed prematurely.
 for(const url of endpoints){
  const request=new FetchRequest(url);request.timeout=8000;
  const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{return await withTimeout(verify(provider,true),12000);}
  catch{provider.destroy();}
 }
 const browser=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
 try{return await withTimeout(verify(browser,false),12000);}
 catch{
  browser.destroy();
  throw Error('Verified V3 BNB Testnet reads unavailable. No financial values will be shown; retry.');
 }
}
export async function readV3Snapshot(walletProvider:Eip1193Provider,wallet:string,
 config:V3SiteReleaseConfig|null=v3ReleaseConfig,includeNetworkDetails=false):Promise<V3Snapshot>{
 const {vault,provider,options,block}=await v3ReadSession(walletProvider,wallet,config);
 try{
 wallet=getAddress(wallet);
 const [user,eligible,nPosition,nWithdraw,tWithdraw,nMember,cap,paused,managerRole,funderRole,cashStatus]=await Promise.all([
  vault.users(wallet,options),vault.isEligible(wallet,options),
  vault.positionCount(wallet,options),vault.userWithdrawalCount(wallet,options),
  vault.withdrawalCount(options),vault.memberCount(options),
  vault.profitWithdrawalCap(wallet,options),vault.paused(options),
  vault.MANAGER_ROLE(options),vault.FUNDER_ROLE(options),vault.cashStatus(options)
 ]);
 const [canManage,canFund,tier,tokenBalance,allowance,gasWei,netAvailable,netReserved,netCumulative,rawDirects]=await Promise.all([
  vault.hasRole(managerRole,wallet,options),
  vault.hasRole(funderRole,wallet,options),
  vault.tierOf(wallet,options),
  new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,provider).balanceOf(wallet,options),
  new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,provider).allowance(wallet,config!.address,options),
  provider.getBalance(wallet,block.number),vault.networkAvailable(wallet,options),
  vault.networkReserved(wallet,options),vault.cumulativeNetwork(wallet,options),
  vault.qualifiedDirects(wallet,options)
 ]);
 const [rawBranches,rawGroups]=includeNetworkDetails?
  await Promise.all([vault.networkBranchCount(wallet,options),vault.rewardGroupCount(wallet,options)]):[0n,0n];
 const branchCount=toSafeCount(rawBranches,'network branch');
 const groupCount=toSafeCount(rawGroups,'network group');
 const networkBranches=await Promise.all(Array.from({length:Math.min(branchCount,50)},async(_,index)=>{
  const address=getAddress(await vault.networkBranch(wallet,index,options));
  return {address,volume:BigInt(await vault.branchVolumeUsd(wallet,address,options))};
 }));
 const networkGroups=await Promise.all(Array.from({length:Math.min(groupCount,20)},async(_,id)=>{
  const progress=await vault.rewardProgress(wallet,id,options),stage=Number(progress.stage);
  if(stage<0||stage>14)throw Error('Invalid V3 network stage.');
  const terms=stage<14?await vault.rewardStage(stage,options):null;
  return {id,stage,prepared:BigInt(progress.preparedUsd),branches:toSafeCount(progress.branches,'group branch'),
   target:terms?BigInt(terms.volumeUsd):0n,reward:terms?BigInt(terms.rewardUsd):0n};
 }));
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
  registered:Boolean(user.registered),suspended:Boolean(user.suspended),paused:Boolean(paused),
  pendingWithdrawal:Boolean(user.pendingRequest),
  asOf:block.timestamp,nextRequestAt:Number(user.nextRequestAt),
  requestCap:BigInt(cap),referralAvailable:BigInt(user.referralAvailable),networkAvailable:BigInt(netAvailable),
  principalLiability:BigInt(cashStatus.principal),
  profitLiability:BigInt(cashStatus.accruedProfit),
  cash:BigInt(cashStatus.cash),escrow:BigInt(cashStatus.escrowedCash),
  positions
 };
 const t=Number(tier);
 if(t<0||t>4)throw Error('Unknown verified V3 tier');
 const [rate,eligibleVolume,terms]=await Promise.all([
  vault.effectiveDailyBps(wallet,options),vault.qualifiedVolume(wallet,t,options),vault.upgradeTerms(t,options)
 ]);
 const dailyRateBps=Number(rate);
 if(![50,70,90,100,110,120,130,150,180,200].includes(dailyRateBps))
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
  qualifiedDirects:toSafeCount(rawDirects,'qualified directs'),qualifiedVolume:BigInt(eligibleVolume),
  requiredDirects:toSafeCount(terms.directs,'required directs'),requiredVolume:BigInt(terms.target),
  maximumRateBps:Number(terms.maximumBps),networkAvailable:BigInt(netAvailable),
  networkReserved:BigInt(netReserved),cumulativeNetwork:BigInt(netCumulative),
  networkBranches,networkBranchCount:branchCount,networkGroups,networkGroupCount:groupCount,networkLoaded:includeNetworkDetails,
  canManage:Boolean(canManage),canFund:Boolean(canFund),
  positions,withdrawals,withdrawCount,memberCount:toSafeCount(nMember,'member'),
  totalWithdrawalCount:toSafeCount(tWithdraw,'global withdrawal'),
  walletTestTokenBalance:BigInt(tokenBalance),allowance:BigInt(allowance),
  gasWei:BigInt(gasWei),ledger
 };
 }finally{provider.destroy();}
}
