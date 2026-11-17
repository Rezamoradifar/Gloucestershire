// Testnet-only dry run for ONE proposed accrual. No key, signing or broadcast.
// The future sender must repeat every check at send time, persist its nonce and
// any returned hash, and stop if a broadcast or receipt is unresolved.
import {getAddress,parseEther,ZeroAddress} from 'ethers';
import {verifyUnifiedDeployment,recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';

const MAX_GAS=1500000n,MAX_GAS_PRICE=100000000000n;
const MAX_FEE=parseEther('0.005'),MIN_BALANCE=parseEther('0.001');
const index=(n)=>Number.isSafeInteger(n)&&n>=0;

export async function simulateUnifiedAccrual({provider,proof,candidate,operator,makeContract}){
 const who=getAddress(operator);
 if(who===ZeroAddress||!candidate||!index(candidate.positionId)||!Array.isArray(candidate.args))
  throw Error('INVALID_UNIFIED_CANDIDATE');
 const member=getAddress(candidate.member);
 if(member===ZeroAddress||typeof candidate.args[0]!=='string'||getAddress(candidate.args[0])!==member)
  throw Error('INVALID_UNIFIED_CANDIDATE');
 const grouped=candidate.method==='accrueReinvestmentPage';
 if(grouped){
  if(candidate.args.length!==3||!index(candidate.args[1])||!index(candidate.args[2])||
     candidate.args[2]<1||candidate.args[2]>8)throw Error('INVALID_UNIFIED_CANDIDATE');
 }else if(candidate.method!=='accrueDaily'||candidate.args.length!==2||candidate.args[1]!==candidate.positionId){
  throw Error('INVALID_UNIFIED_CANDIDATE');
 }
 const verified=await verifyUnifiedDeployment(provider,proof,makeContract?{makeContract}:{});
 const vault=verified.vault;
 const roles=await Promise.all([vault.DEFAULT_ADMIN_ROLE(),vault.MANAGER_ROLE(),vault.FUNDER_ROLE(),vault.GUARDIAN_ROLE()]);
 if((await Promise.all(roles.map(role=>vault.hasRole(role,who)))).some(Boolean))
  throw Error('USE_UNPRIVILEGED_TESTNET_KEEPER');
 const [paused,eligible,groupPlusOne]=await Promise.all([
  vault.paused(),vault.isEligible(member),vault.reinvestmentPositionPlusOne(member)
 ]);
 if(paused||!eligible)throw Error('UNIFIED_ACCOUNT_NOT_READY');
 const group=BigInt(groupPlusOne)===BigInt(candidate.positionId)+1n;
 if(group!==grouped)throw Error('UNIFIED_POSITION_METHOD_MISMATCH');
 const method=vault.getFunction(candidate.method);
 let estimate;
 try{
  await method.staticCall(...candidate.args,{from:who});
  estimate=BigInt(await method.estimateGas(...candidate.args,{from:who}));
 }catch{throw Error('UNIFIED_ACCRUAL_SIMULATION_FAILED_NO_TRANSACTION');}
 const gasLimit=(estimate*125n+99n)/100n;
 const [block,fees,balance]=await Promise.all([
  provider.getBlock('latest'),provider.getFeeData(),provider.getBalance(who)
 ]);
 const gasPrice=fees.gasPrice===null?0n:BigInt(fees.gasPrice);
 if(!block||typeof block.gasLimit!=='bigint'||estimate<=0n||gasLimit>MAX_GAS||gasLimit>block.gasLimit||
    gasPrice<=0n||gasPrice>MAX_GAS_PRICE||gasLimit*gasPrice>MAX_FEE)
  throw Error('UNIFIED_KEEPER_GAS_LIMIT_EXCEEDED');
 if(typeof balance!=='bigint'||balance<MIN_BALANCE||balance<gasLimit*gasPrice)
  throw Error('UNIFIED_KEEPER_TEST_BNB_TOO_LOW');
 await recheckUnifiedBlock(provider,verified.block);
 return {chainId:97,vault:verified.proof.vault,operator:who,member,positionId:candidate.positionId,
  method:candidate.method,args:candidate.args,estimate,gasLimit,gasPrice,maximumFeeWei:gasLimit*gasPrice,
  block:verified.block,transactionSent:false};
}
