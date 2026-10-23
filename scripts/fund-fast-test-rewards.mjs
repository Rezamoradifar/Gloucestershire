import {Contract,ContractFactory,getAddress,keccak256,parseUnits} from 'ethers';
import {validateZeroStartRelease} from './deploy-zero-start.mjs';

const tokenAddress='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const budget=parseUnits('10',18);
const grant='fast-test-reward-seed-v1';
const labels={mint:grant+'-mint',approve:grant+'-approve',fund:grant+'-fund'};

export function isFastTestSeedLabel(label){return Object.values(labels).includes(label);}

function identityFor(release,readiness,wallet){
 const c=validateZeroStartRelease(release);
 if(c.releaseId!=='global-fresh-fast-test-v1'||!c.testMode||!c.initialServerReporter||c.token!==tokenAddress)throw Error('FAST_TEST_SEED_PROFILE_REQUIRED');
 if(readiness?.releaseId!==c.releaseId||readiness.chainId!==97||readiness.testMode!==true||readiness.initialServerReporter!==true||readiness.fastTestnetVersion!==1||readiness.artifactHash!==c.artifactHash||readiness.owner!==c.owner||readiness.operator!==c.deployer||readiness.token!==c.token||readiness.siteConnected!==true)throw Error('FAST_TEST_SEED_VERIFIED_TARGET_REQUIRED');
 if(getAddress(wallet.address)!==c.deployer)throw Error('EXPECTED_SERVER_OPERATOR_KEY_REQUIRED');
 return {version:1,releaseId:c.releaseId,chainId:97,target:getAddress(readiness.target),owner:c.owner,operator:c.deployer,token:c.token,hash:readiness.hash,runtimeHash:readiness.runtimeHash,budget:budget.toString(),grant};
}

function checkedState(state,identity){
 const seed=state.seedTest;
 if(!seed||JSON.stringify(seed.identity)!==JSON.stringify(identity))throw Error('FAST_TEST_SEED_IDENTITY_MISMATCH');
 if(!/^(0|[1-9][0-9]*)$/.test(seed.mintAmount||'')||BigInt(seed.mintAmount)>budget||typeof seed.approvalRequired!=='boolean')throw Error('FAST_TEST_SEED_PLAN_INVALID');
 return seed;
}

async function verifyTarget({provider,wallet,artifact,release,readiness,vault}){
 const identity=identityFor(release,readiness,wallet),token=new Contract(identity.token,artifact.abi,provider);
 if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
 // Simulate constructor creation to patch the reviewed token's decimals immutable.
 const expected=await provider.call(await new ContractFactory(artifact.abi,artifact.bytecode||'0x'+artifact.evm.bytecode.object).getDeployTransaction(18));
 if(expected==='0x'||(await provider.getCode(identity.token)).toLowerCase()!==expected.toLowerCase())throw Error('REVIEWED_TEST_TOKEN_REQUIRED');
 if(await token.decimals()!==18n||await token.name()!=='Test USDT'||await token.symbol()!=='TUSDT')throw Error('TEST_TOKEN_METADATA_MISMATCH');
 if(getAddress(await vault.getAddress())!==identity.target||keccak256(await provider.getCode(identity.target))!==identity.runtimeHash||await vault.usdt()!==identity.token||await vault.owner()!==identity.owner||await vault.tokenDecimals()!==18n||await vault.FAST_TESTNET_VERSION()!==1n||!await vault.reporters(identity.operator))throw Error('FAST_TEST_SEED_VAULT_MISMATCH');
 return {identity,token};
}

function requestFor(label,{identity,token,vault,seed}){
 if(label===labels.mint&&BigInt(seed.mintAmount)>0n)return {to:identity.token,data:token.interface.encodeFunctionData('mint',[identity.operator,BigInt(seed.mintAmount)])};
 if(label===labels.approve&&seed.approvalRequired)return {to:identity.token,data:token.interface.encodeFunctionData('approve',[identity.target,budget])};
 if(label===labels.fund)return {to:identity.target,data:vault.interface.encodeFunctionData('fundRewards',[identity.token,budget])};
 throw Error('FAST_TEST_SEED_TRANSACTION_NOT_PLANNED');
}

// Only the saved, fixed seed operations may be resumed without the creation flag.
export async function verifyFastTestSeedPending(options){
 const {identity,token}=await verifyTarget(options),seed=checkedState(options.state,identity);
 const expected=requestFor(options.label,{identity,token,vault:options.vault,seed});
 const request=options.request;
 if(request.to!==expected.to||request.data!==expected.data||BigInt(request.value??0)!==0n)throw Error('FAST_TEST_SEED_PENDING_TRANSACTION_MISMATCH');
 return true;
}

// This is one target-bound ten-token seed, never an automatic budget refill.
// All three requests use the worker's existing journal and cumulative fee cap.
export async function seedFastTestRewards(options){
 const {provider,wallet,artifact,release,readiness,vault,state,save,transact}=options;
 const {identity,token}=await verifyTarget(options);
 for(const [label,entry] of Object.entries(state.transactions||{}))if(isFastTestSeedLabel(label)&&entry.block){
  if((await provider.getBlock(entry.block))?.hash!==entry.blockHash)throw Error('ZERO_START_COMPLETED_JOURNAL_NOT_CANONICAL');
 }
 if(!state.seedTest){
  if(Object.keys(state.transactions||{}).some(isFastTestSeedLabel))throw Error('FAST_TEST_SEED_UNBOUND_JOURNAL');
  const balance=await token.balanceOf(identity.operator),allowance=await token.allowance(identity.operator,identity.target);
  state.seedTest={identity,mintAmount:(balance<budget?budget-balance:0n).toString(),approvalRequired:allowance<budget,completed:false};save();
 }
 const seed=checkedState(state,identity);
 if(seed.completed)return seed.report;
 const execute=async label=>{
  const request=requestFor(label,{identity,token,vault,seed});
  await verifyFastTestSeedPending({provider,wallet,artifact,release,readiness,vault,state,label,request});
  return transact(label,request);
 };
 if(BigInt(seed.mintAmount)>0n)await execute(labels.mint);
 if(seed.approvalRequired)await execute(labels.approve);
 const receipt=await execute(labels.fund);
 const funded=receipt.logs.filter(row=>getAddress(row.address)===identity.target).map(row=>{
  try{return vault.interface.parseLog(row);}catch{return null;}
 }).filter(event=>event?.name==='Funded');
 if(funded.length!==1||funded[0].args.sender!==identity.operator||funded[0].args.asset!==identity.token||funded[0].args.amount!==budget||funded[0].args.feeReserve!==false)throw Error('FAST_TEST_SEED_RECEIPT_MISMATCH');
 seed.completed=true;
 seed.report={status:'TEST_REWARD_SEED_CONFIRMED',testMode:true,chainId:97,target:identity.target,token:identity.token,amountTestUsdt:'10',mintedTestUsdtUnits:seed.mintAmount,transaction:receipt.hash,block:receipt.blockNumber,blockHash:receipt.blockHash};
 save();return seed.report;
}
