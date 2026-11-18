// Strict READ-ONLY diagnosis of the publicly deployed V3 BNB TESTNET vault.
// This script cannot sign, settle, mint, add test principal or credit profit.
// User wallets and deposits that existed on V2 DO NOT show up on V3 without a
// legitimately authorized, recorded migration (not provided by this script).
import fs from 'node:fs';
import {Contract,FetchRequest,JsonRpcProvider,getAddress,keccak256,formatUnits} from 'ethers';

const CHAIN_ID=97;
const VAULT=getAddress('0x81B55ab9A1B36CccE355aFC4FfC579BA861f74e7');
const EXPECTED_RUNTIME_HASH='0xf17b01bd58e8391036e1c6be3239fccea3ea4a3de245d208c2d66fefbf990a29';
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const MANAGER=getAddress('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');
const FEE=getAddress('0x74015dedf36677485793f1714ec7bd4893907b26');
const ABI=[
 'function asset() view returns(address)',
 'function feeReceiver() view returns(address)',
 'function paused() view returns(bool)',
 'function MANAGER_ROLE() view returns(bytes32)',
 'function hasRole(bytes32,address) view returns(bool)',
 'function memberCount() view returns(uint256)',
 'function memberAt(uint256) view returns(address)',
 'function users(address) view returns(address referrer,bool registered,bool suspended,bool vipKyc,uint64 lastCheckIn,uint64 nextRequestAt,bool pendingRequest,uint256 capital,uint256 originalDeposits,uint256 reinvestments,uint256 referralAvailable,uint256 referralReserved,uint256 cumulativeReferral)',
 'function isEligible(address) view returns(bool)',
 'function positionCount(address) view returns(uint256)',
 'function positionOf(address,uint256) view returns(tuple(uint256 principal,uint256 compoundedBasis,uint256 availableProfit,uint256 reservedProfit,uint256 reservedPrincipal,uint256 cumulativeDaily,uint256 cumulativeCompound,uint64 openedAt,uint64 lastAccruedAt,bool fromReinvestment))',
 'function principalLiability() view returns(uint256)',
 'function profitLiability() view returns(uint256)'
];
const RPC=[
 'https://bsc-testnet-dataseed.bnbchain.org',
 'https://bsc-testnet-rpc.publicnode.com'
];
const checked=(n,cap,name)=>{
 const value=Number(n);
 if(!Number.isSafeInteger(value)||value<0||value>cap)
  throw Error(name+'_COUNT_OUT_OF_SAFE_BOUNDS');
 return value;
};
async function open(){
 const errs=[];
 for(const url of RPC){
  const req=new FetchRequest(url);req.timeout=10000;
  const provider=new JsonRpcProvider(req,CHAIN_ID,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{
   const [chain,code]=await Promise.all([
    provider.send('eth_chainId',[]),provider.getCode(VAULT)
   ]);
   if(Number(BigInt(chain))!==CHAIN_ID||code==='0x')throw Error('V3_NOT_FOUND_ON_CHAIN97');
   return {provider,url,runtimeHash:keccak256(code)};
  }catch(e){errs.push(url+' '+String(e?.message||e).slice(0,100));provider.destroy();}
 }
 throw Error('V3_DIAGNOSTIC_PUBLIC_RPC_UNAVAILABLE '+errs.join(' | '));
}
async function main(){
 if(process.argv[2]!=='--check'||![3,4].includes(process.argv.length)||
    (process.argv.length===4&&!process.argv[3]?.startsWith('--config=')))
  throw Error('Usage: --check [--config=/etc/globaldroptrade/v3-keeper-testnet.json]');
 let pinned=null;
 if(process.argv[3]?.startsWith('--config=')){
  const config=JSON.parse(fs.readFileSync(process.argv[3].slice(9),'utf8'));
  if(config.chainId!==CHAIN_ID||getAddress(config.contract)!==VAULT||
     getAddress(config.token)!==TOKEN||
     !/^0x[0-9a-f]{64}$/i.test(config.runtimeHash))
   throw Error('V3_OPERATOR_PINNED_CONFIG_MISMATCH');
  pinned=config.runtimeHash.toLowerCase();
 }
 const {provider,url,runtimeHash}=await open();
 if(runtimeHash.toLowerCase()!==EXPECTED_RUNTIME_HASH)
  {provider.destroy();throw Error('V3_LIVE_RUNTIME_HASH_CHANGED_PUBLIC_DIAGNOSIS_BLOCKED');}
 try{
  if(pinned&&runtimeHash.toLowerCase()!==pinned)
   throw Error('V3_PUBLIC_BYTECODE_NOT_EQUAL_TO_DEPLOYED_OPERATOR_PIN');
  const vault=new Contract(VAULT,ABI,provider);
  const head=await provider.getBlock('latest');
  if(!head)throw Error('V3_LATEST_BLOCK_NOT_VERIFIED');
  const [asset,fee,role,paused,count,principal,profit]=await Promise.all([
   vault.asset(),vault.feeReceiver(),vault.MANAGER_ROLE(),vault.paused(),
   vault.memberCount(),vault.principalLiability(),vault.profitLiability()
  ]);
  if(getAddress(asset)!==TOKEN||getAddress(fee)!==FEE||
     !await vault.hasRole(role,MANAGER))throw Error('V3_IDENTITY_OR_MANAGER_ROLE_INVALID');
  const members=checked(count,100,'MEMBERS');
  const diagnosis={totalMembers:members,accountsWithPrincipal:0,eligibleMembers:0,
   expiredOrMissingCheckins:0,accrualDueEligiblePositions:0,
   positionsWithinFirst24Hours:0,positionsMaturedButIneligible:0,
   positionsAccruedBefore:0,positionsTotal:0};
  for(let i=0;i<members;i++){
   const address=await vault.memberAt(i);
   const [u,eligible,rawCount]=await Promise.all([
    vault.users(address),vault.isEligible(address),vault.positionCount(address)
   ]);
   if(BigInt(u.capital)>0n)diagnosis.accountsWithPrincipal++;
   if(eligible)diagnosis.eligibleMembers++;
   else if(!u.lastCheckIn||head.timestamp-Number(u.lastCheckIn)>=86400)
    diagnosis.expiredOrMissingCheckins++;
   const positions=checked(rawCount,128,'POSITIONS');
   diagnosis.positionsTotal+=positions;
   for(let j=0;j<positions;j++){
    const p=await vault.positionOf(address,j);
    if(BigInt(p.cumulativeDaily)>0n)diagnosis.positionsAccruedBefore++;
    if(BigInt(p.principal)<=0n)continue;
    if(head.timestamp<Number(p.lastAccruedAt)+86400){
     diagnosis.positionsWithinFirst24Hours++;
    }else if(eligible){diagnosis.accrualDueEligiblePositions++;}
    else diagnosis.positionsMaturedButIneligible++;
   }
  }
  const state=members===0?'NO_V3_MEMBERS_OR_PRINCIPAL':
   diagnosis.accountsWithPrincipal===0?'NO_V3_POSITION_PRINCIPAL':
   paused?'V3_PAUSED':
   diagnosis.accrualDueEligiblePositions?'V3_ACCRUAL_DUE_NEEDS_KEEPER_OR_USER_SIGNED_TX':
   diagnosis.positionsMaturedButIneligible?'CHECK_IN_OR_ELIGIBILITY_REQUIRED':
   'NO_CURRENTLY_DUE_V3_POSITIONS';
  console.log('V3_PUBLIC_READ_ONLY_PROFIT_DIAGNOSTIC '+JSON.stringify({
   checkedAt:new Date().toISOString(),sourceRpc:url,chainId:97,
   vault:VAULT,asset:TOKEN,block:head.number,runtimeHash,
   runtimeComparedToOperatorPin:Boolean(pinned),paused:Boolean(paused),
   recordedPrincipalTestUnits:formatUnits(principal,18),
   recordedProfitTestUnits:formatUnits(profit,18),
   state,...diagnosis,
   existingV2FundsMigrated:false,walletTransferPerformed:false,
   serviceStatusNotAvailableFromPublicChain:true
  }));
 }finally{provider.destroy();}
}
main().catch(e=>{console.error('V3_PUBLIC_READONLY_DIAGNOSIS_FAILED '+String(e?.message||e));process.exitCode=1;});
