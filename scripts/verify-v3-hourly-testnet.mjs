// Verify the separate hourly BNB Testnet deployment and expose only validated
// public build variables. Never sign or touch either deployment's state.
import fs from 'node:fs';
import {Contract,FetchRequest,JsonRpcProvider,getAddress,isAddress,keccak256} from 'ethers';
import {compileHourly} from './compile-global-v3-hourly-testnet.mjs';

const PROOF='/var/lib/globaldroptrade/v3-hourly-testnet/deployment.json';
const ADMIN=getAddress('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const FEE=getAddress('0x74015dedf36677485793f1714ec7bd4893907b26');
const FEE1=getAddress('0x7037cc199499d7a3431285a01e435454eae51265');
const FEE2=getAddress('0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632');
const OPERATIONS=getAddress('0x8c4ac9b009808a0b49ba77b58e3871e7cdba463c');
const hash=x=>typeof x==='string'&&/^0x[a-fA-F0-9]{64}$/.test(x);
const abi=[
 'function ACCRUAL_PERIOD() view returns(uint256)', 'function ONE_DAY() view returns(uint256)',
 'function asset() view returns(address)', 'function feeReceiver() view returns(address)',
 'function FEE_WALLET_1() view returns(address)', 'function FEE_WALLET_2() view returns(address)',
 'function OPERATIONS_WALLET() view returns(address)', 'function DEPOSIT_FEE_EACH_BPS() view returns(uint256)',
 'function MANAGER_ROLE() view returns(bytes32)', 'function hasRole(bytes32,address) view returns(bool)'
];
export function checkHourlyProof(v){
 if(!v||v.status!=='VERIFIED_BNB_TESTNET_ONLY'||v.profile!=='ISOLATED_HOURLY_TESTNET_ONLY'||
   v.accrualPeriodSeconds!==3600||v.chainId!==97||!isAddress(v.contract)||
   !isAddress(v.asset)||getAddress(v.asset)!==TOKEN||!isAddress(v.admin)||
   getAddress(v.admin)!==ADMIN||!isAddress(v.feeReceiver)||getAddress(v.feeReceiver)!==FEE||
   !hash(v.runtimeHash)||!hash(v.txHash)||!hash(v.creationBytecodeHash)||
   !Number.isSafeInteger(v.blockNumber)||v.blockNumber<=0)
  throw Error('V3_HOURLY_VALIDATED_DEPLOYMENT_PROOF_REQUIRED');
 return Object.freeze({...v,contract:getAddress(v.contract),runtimeHash:v.runtimeHash.toLowerCase(),
  txHash:v.txHash.toLowerCase(),creationBytecodeHash:v.creationBytecodeHash.toLowerCase()});
}
function readProof(){
 const s=fs.lstatSync(PROOF);
 if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077)!==0||s.size>30000)
  throw Error('V3_HOURLY_PROOF_MUST_BE_ROOT_PRIVATE');
 return checkHourlyProof(JSON.parse(fs.readFileSync(PROOF,'utf8')));
}
export async function verifiedHourlyDeployment(proof,options={}){
 proof=checkHourlyProof(proof);
 const artifact=(options.compile??compileHourly)();
 if(keccak256('0x'+artifact.evm.bytecode.object).toLowerCase()!==proof.creationBytecodeHash)
  throw Error('V3_HOURLY_SOURCE_DEPLOYMENT_MISMATCH');
 const endpoints=options.endpoints??['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com'];
 for(const url of endpoints){
  const req=new FetchRequest(url);req.timeout=9000;
  const rpc=options.makeProvider?options.makeProvider(req):
   new JsonRpcProvider(req,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{
   const [chain,height,receipt]=await Promise.all([
    rpc.send('eth_chainId',[]),rpc.getBlockNumber(),rpc.getTransactionReceipt(proof.txHash)
   ]);
   if(BigInt(chain)!==97n||height<proof.blockNumber+2||!receipt||receipt.status!==1||
      !receipt.contractAddress||getAddress(receipt.contractAddress)!==proof.contract||
      receipt.blockNumber!==proof.blockNumber||receipt.hash.toLowerCase()!==proof.txHash)
    throw Error('V3_HOURLY_CONFIRMATION_MISMATCH');
   const block=await rpc.getBlock(height-2);
   if(!block?.hash||keccak256(await rpc.getCode(proof.contract,block.number)).toLowerCase()!==proof.runtimeHash)
    throw Error('V3_HOURLY_RUNTIME_MISMATCH');
   const vault=new Contract(proof.contract,abi,rpc),o={blockTag:block.number};
   const [period,activity,asset,fees,fee1,fee2,ops,bps,managerRole]=await Promise.all([
    vault.ACCRUAL_PERIOD(o),vault.ONE_DAY(o),vault.asset(o),vault.feeReceiver(o),
    vault.FEE_WALLET_1(o),vault.FEE_WALLET_2(o),vault.OPERATIONS_WALLET(o),
    vault.DEPOSIT_FEE_EACH_BPS(o),vault.MANAGER_ROLE(o)
   ]);
   if(period!==3600n||activity!==86400n||getAddress(asset)!==TOKEN||
      getAddress(fees)!==FEE||getAddress(fee1)!==FEE1||getAddress(fee2)!==FEE2||
      getAddress(ops)!==OPERATIONS||bps!==1000n||!await vault.hasRole(managerRole,ADMIN,o))
    throw Error('V3_HOURLY_CONTRACT_IDENTITY_MISMATCH');
   const again=await rpc.getBlock(block.number);
   if(!again||again.hash!==block.hash)throw Error('V3_HOURLY_BLOCK_CHANGED');
   return proof;
  }catch{ /* Retry another public testnet RPC. */ }
  finally{rpc.destroy();}
 }
 throw Error('V3_HOURLY_VERIFIED_TESTNET_DEPLOYMENT_UNAVAILABLE');
}
async function main(){
 const mode=process.argv[2];
 if(process.getuid?.()!==0||process.argv.length!==3||!['--check','--emit-site-env'].includes(mode))
  throw Error('V3_HOURLY_ROOT_AND_MODE_REQUIRED');
 const verified=await verifiedHourlyDeployment(readProof());
 if(mode==='--check'){
  console.log('V3_HOURLY_PUBLIC_TESTNET_VERIFIED '+JSON.stringify({
   chainId:97,contract:verified.contract,txHash:verified.txHash,accrualPeriodSeconds:3600
  }));
 }else{
  console.log('export VITE_V3_CONTRACT_ADDRESS='+verified.contract);
  console.log('export VITE_V3_RUNTIME_HASH='+verified.runtimeHash);
  console.log('export VITE_V3_DEPLOYMENT_TX='+verified.txHash);
  console.log('export VITE_V3_PRIMARY_DASHBOARD=verified-testnet');
  console.log('export VITE_V3_HOURLY_TEST=isolated-1h');
 }
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 main().catch(e=>{console.error('V3_HOURLY_VERIFICATION_BLOCKED '+String(e?.message||e));process.exitCode=1;});
}
