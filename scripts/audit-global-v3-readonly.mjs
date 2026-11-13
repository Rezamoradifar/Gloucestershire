// Read-only, no-key, chain-97 V3 solvency preflight. Deliberately requires
// the operator-provided ACTUAL deployed runtime hash; never assumes V3 deployed.
// Usage: node scripts/audit-global-v3-readonly.mjs --check 0xVAULT 0xCODEHASH
import {Contract,FetchRequest,JsonRpcProvider,getAddress,keccak256,formatUnits} from 'ethers';

const pattern=/^0x[0-9a-fA-F]{64}$/;
const urls=[
 'https://bsc-testnet-dataseed.bnbchain.org',
 'https://bsc-testnet-rpc.publicnode.com'
];
const VAULT_ABI=[
 'function asset() view returns(address)',
 'function principalLiability() view returns(uint256)',
 'function profitLiability() view returns(uint256)',
 'function reservedForPayout() view returns(uint256)',
 'function principalEscrowed() view returns(uint256)',
 'function withdrawalCount() view returns(uint256)',
 'function withdrawalOf(uint256) view returns(tuple(address beneficiary,uint256 positionId,uint256 gross,uint256 fee,uint64 requestedAt,uint8 status,uint8 kind))',
 'function cashStatus() view returns(uint256 cash,uint256 principal,uint256 accruedProfit,uint256 escrowedCash,uint256 totalCashShortfall)'
];
const TOKEN_ABI=[
 'function balanceOf(address) view returns(uint256)',
 'function decimals() view returns(uint8)'
];
export function auditV3Values({cash,principal,profit,escrow,principalEscrow,shortfall}){
 const x=[cash,principal,profit,escrow,principalEscrow,shortfall];
 if(!x.every(v=>typeof v==='bigint'&&v>=0n))throw Error('INVALID_V3_LEDGER_NUMBERS');
 if(escrow>cash||principalEscrow>escrow||principalEscrow>principal)
  throw Error('V3_ESCROW_EXCEEDS_VERIFIED_CASH_OR_PRINCIPAL');
 const expected=principal+profit>cash?principal+profit-cash:0n;
 if(expected!==shortfall)throw Error('V3_LIABILITY_CASH_RECONCILIATION_MISMATCH');
 return {coverageTestUnits:cash.toString(),totalLiabilityTestUnits:(principal+profit).toString(),
  shortfallTestUnits:shortfall.toString(),escrowTestUnits:escrow.toString(),
  fullyCovered:shortfall===0n};
}
async function main(){
 if(process.argv.length!==5||process.argv[2]!=='--check'||
    !pattern.test(process.argv[4]))throw Error('V3_USAGE_CHECK_ADDRESS_RUNTIME_HASH');
 const address=getAddress(process.argv[3]);
 const expectedHash=process.argv[4].toLowerCase();
 let provider,foundUrl;
 for(const url of urls){
  const req=new FetchRequest(url);req.timeout=9000;
  const p=new JsonRpcProvider(req,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{
   const [chain,code]=await Promise.all([p.send('eth_chainId',[]),p.getCode(address,'latest')]);
   if(Number(BigInt(chain))!==97||code==='0x'||
      keccak256(code).toLowerCase()!==expectedHash)throw Error('V3_NOT_VERIFIED');
   provider=p;foundUrl=url;break;
  }catch{p.destroy();}
 }
 if(!provider)throw Error('V3_TESTNET_RUNTIME_NOT_VERIFIED_NO_AUDIT_PERFORMED');
 try{
  const vault=new Contract(address,VAULT_ABI,provider);
  const [token,values,requests]=await Promise.all([
   vault.asset(),vault.cashStatus(),vault.withdrawalCount()
  ]);
  const erc20=new Contract(token,TOKEN_ABI,provider);
  const [cash,decimals]=await Promise.all([erc20.balanceOf(address),erc20.decimals()]);
  if(Number(decimals)!==18||BigInt(values.cash)!==BigInt(cash))
   throw Error('V3_TOKEN_CASH_MISMATCH');
  const summary=auditV3Values({
   cash:BigInt(cash),principal:BigInt(values.principal),
   profit:BigInt(values.accruedProfit),escrow:BigInt(values.escrowedCash),
   principalEscrow:BigInt(await vault.principalEscrowed()),
   shortfall:BigInt(values.totalCashShortfall)
  });
  const count=Number(requests);
  if(!Number.isSafeInteger(count)||count<0)throw Error('INVALID_WITHDRAWAL_COUNT');
  const sampleIds=Array.from({length:Math.min(20,count)},(_,i)=>count-i-1);
  const sampled=await Promise.all(sampleIds.map(async id=>{
   const w=await vault.withdrawalOf(id);
   return {id,beneficiary:getAddress(w.beneficiary),kind:Number(w.kind),
    status:Number(w.status),grossTestUnits:formatUnits(w.gross,18)};
  }));
  console.log('V3_READ_ONLY_AUDIT '+JSON.stringify({
   status:'READ_ONLY_AUDIT_COMPLETE',chainId:97,address,expectedHash,token:getAddress(token),
   sourceRpc:foundUrl,checkedAt:new Date().toISOString(),...summary,
   withdrawalCount:count,latest20Only:sampled,
   warning:'Independent security or economic audit NOT performed; test tokens have no monetary value',
   transactionSent:false,productionApproved:false
  }));
  if(!summary.fullyCovered)process.exitCode=2;
 }finally{provider.destroy();}
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 main().catch(error=>{
  const msg=String(error?.message||'V3_UNKNOWN');
  console.error(msg);
  process.exitCode=1;
 });
}
