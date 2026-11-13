// V2 operator-facing, read-only solvency and account/withdrawal health check.
// NO signing, NO deposits, NO changing installed API or existing user ledgers.
import {Contract,FetchRequest,JsonRpcProvider,ZeroAddress,formatUnits,keccak256,getAddress} from 'ethers';
import {openVerifiedV2ReadProvider} from '../server/v2-read-rpc.mjs';
import {analyzeV2Liquidity} from './global-v2-solvency.mjs';

const CHAIN=97;
const VAULT=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
const CODE_HASH='0x3e1f99305bf7edbb12d4d9870124f84ece95bb23b6bf890470e94d06a336bf99';
const ABI=[
 'function usdt() view returns(address)',
 'function tokenDecimals() view returns(uint8)',
 'function memberCount() view returns(uint256)',
 'function withdrawalCount() view returns(uint256)',
 'function withdrawalOf(uint256) view returns(tuple(address user,address asset,uint256 gross,uint256 fee,uint256 positionId,uint64 requestedAt,uint8 status,bool principal))',
 'function principalLiability(address) view returns(uint256)',
 'function profitLiability(address) view returns(uint256)',
 'function assetBalance(address) view returns(uint256)',
 'function unfundedPrincipal(address) view returns(uint256)',
 'function PROFIT_FEE_BPS() view returns(uint256)',
 'function WITHDRAWAL_COOLDOWN() view returns(uint256)'
];
const fail=code=>{throw Error(code);};
const output=(number,decimals)=>formatUnits(number,decimals);
function singleAsset(raw,decimals,symbol){
 const report=analyzeV2Liquidity(raw);
 return {
  symbol,decimals,
  contractVaultCash:output(report.vaultCash,decimals),
  principalLiability:output(report.principalLiability,decimals),
  creditedProfitLiability:output(report.profitLiability,decimals),
  totalLiability:output(report.total,decimals),
  principalCashShortfall:output(report.principalShortfall,decimals),
  profitCashShortfall:output(report.profitShortfall,decimals),
  combinedCashShortfall:output(report.combinedShortfall,decimals),
  coverageBps:report.coverageBps?.toString()??null,
  status:report.status,independentAudit:false,operationsWalletCountedAsCash:false
 };
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--check')
  fail('GLOBAL_V2_AUDIT_READ_ONLY_CHECK_ONLY');
 // Read V2 independently of the legacy RPC, with strict chain and code
 // verification before auditing any financial liabilities.
 const provider=await openVerifiedV2ReadProvider();
 try{
  if(Number(await provider.send('eth_chainId',[]))!==CHAIN)fail('GLOBAL_V2_AUDIT_WRONG_CHAIN');
  const latest=await provider.getBlockNumber();
  const blockNumber=latest-3;
  if(blockNumber<142416836)fail('GLOBAL_V2_AUDIT_BEFORE_DEPLOYMENT');
  const [block,code]=await Promise.all([
   provider.getBlock(blockNumber),provider.getCode(VAULT,'latest')
  ]);
  if(!block?.hash||code==='0x'||keccak256(code).toLowerCase()!==CODE_HASH)
   fail('GLOBAL_V2_AUDIT_CODE_OR_BLOCK_MISMATCH');
  const vault=new Contract(VAULT,ABI,provider);
  const options={blockTag:blockNumber};
  const [token,tokenDecimals,fee,cooldown,memberCount,requestCount]=await Promise.all([
   vault.usdt(options),vault.tokenDecimals(options),vault.PROFIT_FEE_BPS(options),
   vault.WITHDRAWAL_COOLDOWN(options),vault.memberCount(options),vault.withdrawalCount(options)
  ]);
  if(fee!==300n||cooldown!==259200n)fail('GLOBAL_V2_AUDIT_APPROVED_TERMS_MISMATCH');
  if(Number(tokenDecimals)>18)fail('GLOBAL_V2_AUDIT_TOKEN_DECIMALS_INVALID');
  const addresses=[ZeroAddress,getAddress(token)];
  const assets=await Promise.all(addresses.map(async(address,index)=>{
   const [principal,profit,cash,contractShortfall]=await Promise.all([
    vault.principalLiability(address,options),vault.profitLiability(address,options),
    vault.assetBalance(address,options),vault.unfundedPrincipal(address,options)
   ]);
   const result=singleAsset({principalLiability:principal,profitLiability:profit,vaultCash:cash},
    index===0?18:Number(tokenDecimals),index===0?'BNB':'USDT');
   const verified=analyzeV2Liquidity({principalLiability:principal,profitLiability:profit,vaultCash:cash});
   if(verified.principalShortfall!==contractShortfall)
    fail('GLOBAL_V2_AUDIT_CONTRACT_RECONCILIATION_FAILED');
   return result;
  }));
  // Sampling the newest requests only; never misrepresent as all requests.
  const totalRequests=Number(requestCount);
  if(!Number.isSafeInteger(totalRequests))fail('GLOBAL_V2_AUDIT_REQUEST_COUNT_INVALID');
  const ids=Array.from({length:Math.min(20,totalRequests)},(_,i)=>totalRequests-1-i);
  const recent=await Promise.all(ids.map(async(id)=>{
   const row=await vault.withdrawalOf(id,options);
   return {id,status:Number(row.status),asset:getAddress(row.asset),
    user:getAddress(row.user),principal:Boolean(row.principal)};
  }));
  const report={
   schema:1,chainId:CHAIN,address:VAULT,block:blockNumber,blockHash:block.hash,
   checkedAt:new Date().toISOString(),source:'PINNED_ONCHAIN_READS_ONLY',
   feeBps:Number(fee),cooldownSeconds:Number(cooldown),
   membersTotal:String(memberCount),requestsTotal:String(requestCount),
   requestStatusesOfLatest20:recent.reduce((x,r)=>{x[String(r.status)]=(x[String(r.status)]??0)+1;return x;},{}),
   requestStatusSampleSize:recent.length,
   assets,hasAnyVaultCashShortfall:assets.some(a=>a.status==='VAULT_CASH_INSUFFICIENT'),
   migrationNotPerformed:true,externalOperationsFundsNotVerified:true,
   conclusion:'Testnet-only accounting evidence; not an independent financial or security audit'
  };
  console.log('GLOBAL_V2_READONLY_AUDIT '+JSON.stringify(report));
  if(report.hasAnyVaultCashShortfall)process.exitCode=2;
 }finally{provider.destroy();}
}
main().catch(error=>{
 const message=/^[A-Z][A-Z0-9_]+$/.test(error?.message||'')?error.message:'GLOBAL_V2_AUDIT_RPC_OR_DATA_ERROR';
 console.error(message);
 process.exitCode=1;
});
