// Read-only identity check for an operator-pinned, actual chain-97 deployment.
// This is not a deployer, a migration mechanism or a financial/security audit.
import {Contract,getAddress,isAddress,keccak256,toQuantity,ZeroAddress} from 'ethers';
import {UNIFIED_PROFILE,SINGLE_CAPITAL_PROFILE} from './v3-unified-release-pins.mjs';

const TEST_TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const FEE_1=getAddress('0x7037cc199499d7a3431285a01e435454eae51265');
const FEE_2=getAddress('0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632');
const OPERATIONS=getAddress('0x8c4ac9b009808a0b49ba77b58e3871e7cdba463c');
const pattern=/^0x[0-9a-fA-F]{64}$/;
const VAULT_ABI=[
 'function asset() view returns(address)','function feeReceiver() view returns(address)',
 'function reinvestmentBook() view returns(address)','function networkPlan() view returns(address)',
 'function ACCRUAL_PERIOD() view returns(uint256)','function ONE_DAY() view returns(uint256)',
 'function SINGLE_CAPITAL_VERSION() view returns(uint256)',
 'function FEE_WALLET_1() view returns(address)','function FEE_WALLET_2() view returns(address)',
 'function OPERATIONS_WALLET() view returns(address)','function DEPOSIT_FEE_EACH_BPS() view returns(uint256)',
 'function DEFAULT_ADMIN_ROLE() view returns(bytes32)','function MANAGER_ROLE() view returns(bytes32)',
 'function FUNDER_ROLE() view returns(bytes32)','function GUARDIAN_ROLE() view returns(bytes32)',
 'function hasRole(bytes32,address) view returns(bool)',
 'function paused() view returns(bool)','function memberCount() view returns(uint256)',
 'function memberAt(uint256) view returns(address)','function isEligible(address) view returns(bool)',
 'function positionCount(address) view returns(uint256)','function reinvestmentPositionPlusOne(address) view returns(uint256)',
 'function effectiveDailyBps(address) view returns(uint16)',
 'function positionOf(address,uint256) view returns(tuple(uint256 principal,uint256 compoundedBasis,uint256 availableProfit,uint256 reservedProfit,uint256 reservedPrincipal,uint256 cumulativeDaily,uint256 cumulativeCompound,uint64 openedAt,uint64 lastAccruedAt,bool fromReinvestment))',
 'function accrueDaily(address,uint256)','function accrueReinvestmentPage(address,uint256,uint256)'
];
const CHILD_ABI=['function vault() view returns(address)'];
const BOOK_ABI=[...CHILD_ABI,
 'function position(address) view returns(uint256 principal,uint256 reservedPrincipal,uint256 daily,uint256 compound,uint256 basis,uint256 reservedProfit,uint256 cumulativeDaily,uint256 cumulativeCompound,uint256 lots)',
 'function lot(address,uint256) view returns(tuple(uint256 principal,uint256 reservedPrincipal,uint256 daily,uint256 compound,uint256 basis,uint256 reservedProfit,uint64 openedAt,uint64 lastAccruedAt))'
];
const address=value=>{
 if(!isAddress(value))throw Error('INVALID_UNIFIED_DEPLOYMENT_PROOF');
 const normalized=getAddress(value);
 if(normalized===ZeroAddress)throw Error('INVALID_UNIFIED_DEPLOYMENT_PROOF');
 return normalized;
};
// Raw RPC avoids a provider's block cache hiding a reorganization between
// the initial verification, a later scan and the final canonicality check.
async function freshBlock(provider,number){
 const value=await provider.send('eth_getBlockByNumber',[toQuantity(number),false]);
 if(!value||typeof value.number!=='string'||typeof value.timestamp!=='string'||
    !pattern.test(String(value.hash)))throw Error('UNIFIED_CONFIRMED_BLOCK_REQUIRED');
 const actual=Number(BigInt(value.number)),timestamp=Number(BigInt(value.timestamp));
 if(!Number.isSafeInteger(actual)||actual!==number||!Number.isSafeInteger(timestamp)||timestamp<0)
  throw Error('UNIFIED_CONFIRMED_BLOCK_REQUIRED');
 return {number:actual,hash:value.hash,timestamp};
}

export async function recheckUnifiedBlock(provider,block){
 if(!block||!Number.isSafeInteger(block.number)||block.number<0||!pattern.test(String(block.hash)))
  throw Error('UNIFIED_CONFIRMED_BLOCK_REQUIRED');
 const [again,chain]=await Promise.all([freshBlock(provider,block.number),provider.send('eth_chainId',[])]);
 if(again.hash.toLowerCase()!==block.hash.toLowerCase()||BigInt(chain)!==97n)
  throw Error('UNIFIED_CONFIRMED_BLOCK_CHANGED');
 return true;
}

export function validateUnifiedProof(raw){
 if(!raw||![UNIFIED_PROFILE.status,SINGLE_CAPITAL_PROFILE.status].includes(raw.status)||raw.chainId!==97||
    !Number.isSafeInteger(raw.deploymentBlock)||raw.deploymentBlock<1||
    ![raw.vaultRuntimeHash,raw.bookRuntimeHash,raw.networkRuntimeHash,raw.deploymentTx].every(x=>typeof x==='string'&&pattern.test(x)))
  throw Error('INVALID_UNIFIED_DEPLOYMENT_PROOF');
 const proof={...raw,vault:address(raw.vault),book:address(raw.book),network:address(raw.network),
  token:address(raw.token),manager:address(raw.manager),feeReceiver:address(raw.feeReceiver),
  vaultRuntimeHash:raw.vaultRuntimeHash.toLowerCase(),bookRuntimeHash:raw.bookRuntimeHash.toLowerCase(),
  networkRuntimeHash:raw.networkRuntimeHash.toLowerCase(),deploymentTx:raw.deploymentTx.toLowerCase()};
 if(proof.token!==TEST_TOKEN||new Set([proof.vault,proof.book,proof.network]).size!==3)
  throw Error('INVALID_UNIFIED_DEPLOYMENT_PROOF');
 return Object.freeze(proof);
}

export async function verifyUnifiedDeployment(provider,raw,{makeContract=(at,abi)=>new Contract(at,abi,provider)}={}){
 const proof=validateUnifiedProof(raw);
 if(BigInt(await provider.send('eth_chainId',[]))!==97n)throw Error('UNIFIED_TESTNET_CHAIN_REQUIRED');
 const head=await provider.getBlockNumber();
 if(!Number.isSafeInteger(head)||head<proof.deploymentBlock+2)throw Error('UNIFIED_DEPLOYMENT_NOT_CONFIRMED');
 const number=head-2,block=await freshBlock(provider,number);
 const deploymentBlock=await freshBlock(provider,proof.deploymentBlock);
 const [receipt,vaultCode,bookCode,networkCode,tokenCode]=await Promise.all([
  provider.getTransactionReceipt(proof.deploymentTx),provider.getCode(proof.vault,number),
  provider.getCode(proof.book,number),provider.getCode(proof.network,number),provider.getCode(TEST_TOKEN,number)
 ]);
 if(!receipt||receipt.status!==1||!receipt.contractAddress||getAddress(receipt.contractAddress)!==proof.vault||
    receipt.blockNumber!==proof.deploymentBlock||String(receipt.hash).toLowerCase()!==proof.deploymentTx||
    typeof receipt.blockHash!=='string'||!pattern.test(receipt.blockHash)||
    receipt.blockHash.toLowerCase()!==deploymentBlock.hash.toLowerCase())
  throw Error('UNIFIED_DEPLOYMENT_RECEIPT_MISMATCH');
 const checkCode=(code,expected)=>{
  if(typeof code!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(code)||keccak256(code).toLowerCase()!==expected)
   throw Error('UNIFIED_COMPONENT_RUNTIME_MISMATCH');
 };
 checkCode(vaultCode,proof.vaultRuntimeHash);checkCode(bookCode,proof.bookRuntimeHash);
 checkCode(networkCode,proof.networkRuntimeHash);
 if(typeof tokenCode!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(tokenCode))throw Error('UNIFIED_TEST_TOKEN_NOT_DEPLOYED');
 const vault=makeContract(proof.vault,VAULT_ABI),book=makeContract(proof.book,BOOK_ABI);
 const network=makeContract(proof.network,CHILD_ABI),at={blockTag:number};
 if(proof.status===SINGLE_CAPITAL_PROFILE.status&&BigInt(await vault.SINGLE_CAPITAL_VERSION(at))!==1n)
  throw Error('UNIFIED_SINGLE_CAPITAL_VERSION_MISMATCH');
 const [token,fee,bookAddress,networkAddress,period,activity,fee1,fee2,operations,bps,role,bookVault,networkVault]=await Promise.all([
  vault.asset(at),vault.feeReceiver(at),vault.reinvestmentBook(at),vault.networkPlan(at),
  vault.ACCRUAL_PERIOD(at),vault.ONE_DAY(at),vault.FEE_WALLET_1(at),vault.FEE_WALLET_2(at),
  vault.OPERATIONS_WALLET(at),vault.DEPOSIT_FEE_EACH_BPS(at),vault.MANAGER_ROLE(at),
  book.vault(at),network.vault(at)
 ]);
 if(getAddress(token)!==proof.token||getAddress(fee)!==proof.feeReceiver||
    getAddress(bookAddress)!==proof.book||getAddress(networkAddress)!==proof.network||
    getAddress(bookVault)!==proof.vault||getAddress(networkVault)!==proof.vault||
    BigInt(period)!==3600n||BigInt(activity)!==86400n||getAddress(fee1)!==FEE_1||
    getAddress(fee2)!==FEE_2||getAddress(operations)!==OPERATIONS||BigInt(bps)!==1000n||
    !await vault.hasRole(role,proof.manager,at))throw Error('UNIFIED_DEPLOYMENT_CONFIGURATION_MISMATCH');
 await recheckUnifiedBlock(provider,block);
 await recheckUnifiedBlock(provider,deploymentBlock);
 return {proof,block:{number,hash:block.hash,timestamp:block.timestamp},vault,book,network,
  transactionSent:false,siteUpdated:false};
}
