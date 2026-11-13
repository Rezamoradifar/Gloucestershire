// STRICT deployment proof for new Global V3 TESTNET website integration.
// Read only, no signatures. Fail closed until the actual deployment receipt
// exists on BNB Testnet and every pinned bytecode/asset/role field matches.
// Never trust an invented address, front-end query param, old-V2 API or
// user-generated site config for financial actions.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Contract,FetchRequest,JsonRpcProvider,getAddress,isAddress,keccak256} from 'ethers';

const PROOF='/var/lib/globaldroptrade/v3-prototype/deployment.json';
const OLD_V2=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
const ADMIN=getAddress('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const FEES=getAddress('0x74015dedf36677485793f1714ec7bd4893907b26');
const DEPOSIT_FEE_1=getAddress('0x7037cc199499d7a3431285a01e435454eae51265');
const DEPOSIT_FEE_2=getAddress('0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632');
const OPERATIONS=getAddress('0x8c4ac9b009808a0b49ba77b58e3871e7cdba463c');
const RPC=['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com'];
const ABI=[
 'function asset() view returns(address)',
 'function feeReceiver() view returns(address)',
 'function FEE_WALLET_1() view returns(address)',
 'function FEE_WALLET_2() view returns(address)',
 'function OPERATIONS_WALLET() view returns(address)',
 'function DEPOSIT_FEE_EACH_BPS() view returns(uint256)',
 'function MANAGER_ROLE() view returns(bytes32)',
 'function FUNDER_ROLE() view returns(bytes32)',
 'function hasRole(bytes32,address) view returns(bool)',
 'function memberCount() view returns(uint256)',
 'function profitLiability() view returns(uint256)',
 'function principalLiability() view returns(uint256)'
];
const isHash=x=>typeof x==='string'&&/^0x[a-fA-F0-9]{64}$/.test(x);
export function validateV3DeploymentProof(v){
 if(!v||v.status!=='VERIFIED_BNB_TESTNET_ONLY'||v.chainId!==97||
    !isAddress(v.contract)||!isAddress(v.asset)||!isAddress(v.admin)||
    !isAddress(v.feeReceiver)||!isHash(v.runtimeHash)||!isHash(v.txHash)||
    !isHash(v.creationBytecodeHash)||
    v.deployedV2Unmodified!==true)
  throw Error('V3_VERIFIED_TESTNET_DEPLOYMENT_PROOF_REQUIRED');
 const address=getAddress(v.contract);
 if(address===OLD_V2||getAddress(v.asset)!==TOKEN||getAddress(v.admin)!==ADMIN||
    getAddress(v.feeReceiver)!==FEES)
  throw Error('V3_DEPLOYED_ADDRESS_ADMIN_OR_ASSET_MISMATCH');
 if(!Number.isSafeInteger(v.blockNumber)||v.blockNumber<=0)
  throw Error('V3_DEPLOYMENT_BLOCK_INVALID');
 return Object.freeze({address,runtimeHash:v.runtimeHash.toLowerCase(),
  deploymentTx:v.txHash.toLowerCase(),
  creationBytecodeHash:v.creationBytecodeHash.toLowerCase(),blockNumber:v.blockNumber});
}
function verifyCurrentV3BuildMatchesDeployIntent(proof){
 // Compile the exact V3 source (pinned solc, viaIR & optimizer) in this
 // candidate release. A website built from a differing contract ABI/source
 // is refused even if another deployed V3 address exists.
 execFileSync(process.execPath,['scripts/compile-global-v3.mjs'],{stdio:'pipe',timeout:120000});
 const compiled=JSON.parse(fs.readFileSync('artifacts/GlobalV3DeferredTestnet.json','utf8'));
 if(!compiled?.evm?.bytecode?.object||compiled.compiler?.startsWith('0.8.30')!==true)
  throw Error('V3_EXPECTED_COMPILED_CONTRACT_ARTIFACT_MISSING');
 if(keccak256('0x'+compiled.evm.bytecode.object).toLowerCase()!==proof.creationBytecodeHash)
  throw Error('V3_WEBSITE_CONTRACT_SOURCE_DIFFERS_FROM_ACTUALLY_DEPLOYED_RELEASE');
}
function readProof(){
 const s=fs.lstatSync(PROOF);
 if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||
    (s.mode&0o077)!==0||s.size>30000)
  throw Error('V3_OPERATOR_DEPLOYMENT_PROOF_PERMISSIONS_INVALID');
 return validateV3DeploymentProof(JSON.parse(fs.readFileSync(PROOF,'utf8')));
}
async function verifyCurrentChain(proof){
 const errors=[];
 for(const url of RPC){
  const request=new FetchRequest(url);request.timeout=9000;
  const rpc=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{
   const [chain,code,receipt]=await Promise.all([
    rpc.send('eth_chainId',[]),rpc.getCode(proof.address,'latest'),
    rpc.getTransactionReceipt(proof.deploymentTx)
   ]);
   if(Number(BigInt(chain))!==97||code==='0x'||
      keccak256(code).toLowerCase()!==proof.runtimeHash||
      !receipt||receipt.status!==1||
      getAddress(receipt.contractAddress??'0x0000000000000000000000000000000000000000')!==proof.address||
      receipt.blockNumber!==proof.blockNumber)
    throw Error('V3_ONCHAIN_DEPLOY_RECEIPT_OR_RUNTIME_MISMATCH');
   const contract=new Contract(proof.address,ABI,rpc);
   const [asset,fees,role,funderRole,managerAllowed,capital,profit,fee1,fee2,operations,depositFee]=await Promise.all([
    contract.asset(),contract.feeReceiver(),contract.MANAGER_ROLE(),contract.FUNDER_ROLE(),
    contract.hasRole(await contract.MANAGER_ROLE(),ADMIN),
    contract.principalLiability(),contract.profitLiability(),contract.FEE_WALLET_1(),
    contract.FEE_WALLET_2(),contract.OPERATIONS_WALLET(),contract.DEPOSIT_FEE_EACH_BPS()
   ]);
   if(getAddress(asset)!==TOKEN||getAddress(fees)!==FEES||
      !managerAllowed||role===funderRole||capital<0n||profit<0n||
      getAddress(fee1)!==DEPOSIT_FEE_1||getAddress(fee2)!==DEPOSIT_FEE_2||
      getAddress(operations)!==OPERATIONS||depositFee!==1000n)
    throw Error('V3_APPROVED_CONTRACT_IDENTITY_OR_ROLE_MISMATCH');
   return {...proof,rpc:url,capital:capital.toString(),accruedTestProfit:profit.toString()};
  }catch(e){errors.push(url+': '+String(e?.message||e).slice(0,100));}
  finally{rpc.destroy();}
 }
 throw Error('V3_NO_VERIFIED_PUBLIC_TESTNET_DEPLOYMENT: '+errors.join(' | '));
}
async function main(){
 const mode=process.argv[2];
 if(!['--check','--emit-site-env'].includes(mode)||process.argv.length!==3)
  throw Error('Usage: --check OR --emit-site-env (after real deployed V3 receipt)');
 if(process.getuid?.()!==0)throw Error('V3_DEPLOYMENT_PROOF_ROOT_ONLY');
 const proof=readProof();
 verifyCurrentV3BuildMatchesDeployIntent(proof);
 const verified=await verifyCurrentChain(proof);
 if(mode==='--check')
  console.log('V3_WEBSITE_DEPLOYMENT_PRECHECK_PASS '+JSON.stringify({
   chainId:97,contract:verified.address,bytecodeHash:verified.runtimeHash,
   deploymentTx:verified.deploymentTx,source:verified.rpc,
   principalClaimTestUnits:verified.capital,
   unfundedAccruedTestProfit:verified.accruedTestProfit,
   oldV2Unmodified:true,noAssetsOrFinancialStateTransferred:true,
   mainnetApproved:false
  }));
 else{
  // Exactly these one-line known-name public-only env assignments; never
  // print any user/private/server secrets or an arbitrary config payload.
  console.log('export VITE_V3_CONTRACT_ADDRESS='+verified.address);
  console.log('export VITE_V3_RUNTIME_HASH='+verified.runtimeHash);
  console.log('export VITE_V3_DEPLOYMENT_TX='+verified.deploymentTx);
  console.log('export VITE_V3_PRIMARY_DASHBOARD=verified-testnet');
 }
}
const invoked=process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1];
if(invoked)main().catch(error=>{
 console.error('V3_SITE_ACTIVATION_BLOCKED '+String(error?.message||error));
 process.exitCode=1;
});
