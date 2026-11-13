// Read-only guard before a separate routed TESTNET release. Never signs,
// transfers, alters the old proof, deletes data or changes the old contract.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,JsonRpcProvider,getAddress,isAddress,keccak256} from 'ethers';

const PROOF='/var/lib/globaldroptrade/v3-prototype/deployment.json';
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const MANAGER=getAddress('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');
const FEE=getAddress('0x74015dedf36677485793f1714ec7bd4893907b26');
const ABI=['function asset() view returns(address)','function feeReceiver() view returns(address)',
 'function MANAGER_ROLE() view returns(bytes32)','function hasRole(bytes32,address) view returns(bool)',
 'function memberCount() view returns(uint256)','function withdrawalCount() view returns(uint256)',
 'function principalLiability() view returns(uint256)','function profitLiability() view returns(uint256)',
 'function reservedForPayout() view returns(uint256)'];
const isHash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);

export function checkPriorV3Snapshot(proof,s){
 if(!proof||proof.status!=='VERIFIED_BNB_TESTNET_ONLY'||proof.chainId!==97||
  !isAddress(proof.contract)||!isHash(proof.runtimeHash)||!isHash(proof.txHash)||
  !Number.isSafeInteger(proof.blockNumber)||proof.blockNumber<=0)
  throw Error('PRIOR_V3_DEPLOYMENT_PROOF_NOT_VERIFIED');
 if(s.chain!==97||!isHash(s.codeHash)||s.codeHash.toLowerCase()!==proof.runtimeHash.toLowerCase()||
  !s.receipt||s.receipt.status!==1||!s.receipt.contractAddress||
  !isHash(s.receipt.hash)||s.receipt.hash.toLowerCase()!==proof.txHash.toLowerCase()||
  getAddress(s.receipt.contractAddress)!==getAddress(proof.contract)||
  s.receipt.blockNumber!==proof.blockNumber||s.confirmedBlock<proof.blockNumber||
  getAddress(s.asset)!==TOKEN||getAddress(s.fee)!==FEE||!s.managerAllowed)
  throw Error('PRIOR_V3_CHAIN_RECEIPT_OR_IDENTITY_MISMATCH');
 const values=[s.members,s.withdrawals,s.principal,s.profit,s.reserved,s.cash,s.nativeCash];
 if(values.some(v=>typeof v!=='bigint'||v<0n))throw Error('PRIOR_V3_INVALID_COUNTER');
 if(values.some(v=>v!==0n))throw Error('PRIOR_V3_HAS_MEMBERS_CLAIMS_REQUESTS_OR_CASH_REVIEW_BEFORE_SWITCH');
 return Object.freeze({contract:getAddress(proof.contract),confirmedBlock:s.confirmedBlock,
  members:'0',withdrawals:'0',principal:'0',profit:'0',reserved:'0',cash:'0',nativeCash:'0'});
}
function readPriorProof(){
 const st=fs.lstatSync(PROOF);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o077)!==0||st.size>30000)
  throw Error('PRIOR_V3_PROOF_MUST_BE_ROOT_PRIVATE');
 return JSON.parse(fs.readFileSync(PROOF,'utf8'));
}
export async function verifyPriorV3Empty(provider,proof=readPriorProof()){
 if(!proof||!isAddress(proof.contract)||!isHash(proof.txHash)||!isHash(proof.runtimeHash))
  throw Error('PRIOR_V3_DEPLOYMENT_PROOF_NOT_VERIFIED');
 const chain=Number(BigInt(await provider.send('eth_chainId',[])));
 if(chain!==97)throw Error('PRIOR_V3_WRONG_CHAIN');
 const height=await provider.getBlockNumber();
 if(height<4)throw Error('PRIOR_V3_CONFIRMED_BLOCK_UNAVAILABLE');
 const confirmedBlock=height-3,options={blockTag:height};
 const address=getAddress(proof.contract);
 const [code,receipt]=await Promise.all([
  provider.getCode(address,height),provider.getTransactionReceipt(proof.txHash)
 ]);
 if(code==='0x')throw Error('PRIOR_V3_CONTRACT_CODE_MISSING');
 const vault=new Contract(address,ABI,provider);
 const token=new Contract(TOKEN,['function balanceOf(address) view returns(uint256)'],provider);
 const role=await vault.MANAGER_ROLE(options);
 const [asset,fee,managerAllowed,members,withdrawals,principal,profit,reserved,cash,nativeCash]=await Promise.all([
  vault.asset(options),vault.feeReceiver(options),vault.hasRole(role,MANAGER,options),
  vault.memberCount(options),vault.withdrawalCount(options),vault.principalLiability(options),
  vault.profitLiability(options),vault.reservedForPayout(options),token.balanceOf(address,options),
  provider.getBalance(address,height)
 ]);
 return checkPriorV3Snapshot(proof,{chain,codeHash:keccak256(code),receipt,confirmedBlock,
  asset,fee,managerAllowed,members,withdrawals,principal,profit,reserved,cash,nativeCash});
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--check')throw Error('USAGE_CHECK_ONLY');
 const urls=['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com'];
 const errors=[];
 for(const url of urls){
  const request=new FetchRequest(url);request.timeout=9000;
  const p=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{const result=await verifyPriorV3Empty(p);console.log('PRIOR_V3_EMPTY_VERIFIED '+JSON.stringify(result));return;}
  catch(e){errors.push(String(e?.message||e).slice(0,180));}
  finally{p.destroy();}
 }
 throw Error('PRIOR_V3_READ_ONLY_CHECK_FAILED '+errors.join(' | '));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().catch(e=>{console.error('PRIOR_V3_PREFLIGHT_BLOCKED '+String(e?.message||e));process.exitCode=1;});
