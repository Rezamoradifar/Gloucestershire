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

// Read every value from the same three-confirmation block. The hash is
// checked again after the reads, so a reorganization cannot mix snapshots.
// The runtime hash is supplied by the operator; it is not independent proof
// of a deployment, a security audit, or the correctness of the business model.
export async function auditV3Snapshot(provider,address,expectedHash,{
 makeContract=(at,abi)=>new Contract(at,abi,provider)
}={}){
 const vaultAddress=getAddress(address);
 if(!pattern.test(expectedHash))throw Error('V3_USAGE_CHECK_ADDRESS_RUNTIME_HASH');
 if(BigInt(await provider.send('eth_chainId',[]))!==97n)throw Error('V3_TESTNET_CHAIN_REQUIRED');
 const head=await provider.getBlockNumber();
 if(!Number.isSafeInteger(head)||head<3)throw Error('V3_CONFIRMED_BLOCK_REQUIRED');
 const blockNumber=head-2,block=await provider.getBlock(blockNumber);
 if(!block||block.number!==blockNumber||!pattern.test(block.hash))throw Error('V3_CONFIRMED_BLOCK_REQUIRED');
 const code=await provider.getCode(vaultAddress,blockNumber);
 if(typeof code!=='string'||!/^0x(?:[a-f0-9]{2})+$/i.test(code)||
    keccak256(code).toLowerCase()!==expectedHash.toLowerCase())throw Error('V3_RUNTIME_HASH_MISMATCH');
 const vault=makeContract(vaultAddress,VAULT_ABI),at={blockTag:blockNumber};
 const [token,values,requests,principalEscrow]=await Promise.all([
  vault.asset(at),vault.cashStatus(at),vault.withdrawalCount(at),vault.principalEscrowed(at)
 ]);
 const tokenAddress=getAddress(token),erc20=makeContract(tokenAddress,TOKEN_ABI);
 const [cash,decimals]=await Promise.all([erc20.balanceOf(vaultAddress,at),erc20.decimals(at)]);
 if(Number(decimals)!==18||BigInt(values.cash)!==BigInt(cash))throw Error('V3_TOKEN_CASH_MISMATCH');
 const summary=auditV3Values({
  cash:BigInt(cash),principal:BigInt(values.principal),profit:BigInt(values.accruedProfit),
  escrow:BigInt(values.escrowedCash),principalEscrow:BigInt(principalEscrow),
  shortfall:BigInt(values.totalCashShortfall)
 });
 const count=Number(requests);
 if(!Number.isSafeInteger(count)||count<0)throw Error('INVALID_WITHDRAWAL_COUNT');
 const sampleIds=Array.from({length:Math.min(20,count)},(_,i)=>count-i-1);
 const sampled=await Promise.all(sampleIds.map(async id=>{
  const w=await vault.withdrawalOf(id,at);
  const status=Number(w.status),kind=Number(w.kind);
  if(!Number.isInteger(status)||status<0||status>5||!Number.isInteger(kind)||kind<0||kind>3||
     BigInt(w.gross)<=0n||BigInt(w.fee)>BigInt(w.gross))throw Error('INVALID_V3_WITHDRAWAL');
  return {id,beneficiary:getAddress(w.beneficiary),kind,status,grossTestUnits:formatUnits(w.gross,18)};
 }));
 const finalBlock=await provider.getBlock(blockNumber);
 if(!finalBlock||finalBlock.number!==blockNumber||
    String(finalBlock.hash).toLowerCase()!==block.hash.toLowerCase()||
    BigInt(await provider.send('eth_chainId',[]))!==97n)throw Error('V3_CONFIRMED_BLOCK_CHANGED');
 return {chainId:97,address:vaultAddress,expectedHash:expectedHash.toLowerCase(),token:tokenAddress,
  checkpoint:{block:blockNumber,blockHash:block.hash,observedHead:head,confirmations:3},
  ...summary,withdrawalCount:count,latest20Only:sampled};
}

async function main(){
 if(process.argv.length!==5||process.argv[2]!=='--check'||
    !pattern.test(process.argv[4]))throw Error('V3_USAGE_CHECK_ADDRESS_RUNTIME_HASH');
 const address=getAddress(process.argv[3]);
 const expectedHash=process.argv[4].toLowerCase();
 let report,foundUrl;
 for(const url of urls){
  const req=new FetchRequest(url);req.timeout=9000;
  const p=new JsonRpcProvider(req,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{
   report=await auditV3Snapshot(p,address,expectedHash);foundUrl=url;break;
  }catch{/* Try a separate public testnet endpoint without reporting partial data. */}
  finally{p.destroy();}
 }
 if(!report)throw Error('V3_TESTNET_RUNTIME_NOT_VERIFIED_NO_AUDIT_PERFORMED');
 console.log('V3_READ_ONLY_AUDIT '+JSON.stringify({
  status:'READ_ONLY_AUDIT_COMPLETE',...report,sourceRpc:foundUrl,checkedAt:new Date().toISOString(),
  warning:'Operator-supplied runtime hash; independent security or economic audit NOT performed; test tokens have no monetary value',
  transactionSent:false,productionApproved:false
 }));
 if(!report.fullyCovered)process.exitCode=2;
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 main().catch(error=>{
  const msg=String(error?.message||'V3_UNKNOWN');
  console.error(msg);
  process.exitCode=1;
 });
}
