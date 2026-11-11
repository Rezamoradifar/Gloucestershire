import {Contract,ContractFactory,getAddress,keccak256,parseUnits} from 'ethers';
import {loadNewDeployerRelease,validateNewDeployerRelease} from './new-deployer-testnet-profile.mjs';

const budget=parseUnits('10',18);
const grant='new-deployer-test-reward-seed-v1';
const labels=Object.freeze({mint:grant+'-mint',approve:grant+'-approve',fund:grant+'-fund'});

export function isNewDeployerTestSeedLabel(label){return Object.values(labels).includes(label);}

function identityFor(release,readiness,wallet){
 const c=validateNewDeployerRelease(release);
 if(readiness?.version!==1||readiness.releaseId!==c.releaseId||readiness.chainId!==97||readiness.artifact!==c.artifact||readiness.testMode!==true||readiness.initialServerReporter!==true||readiness.fastTestnetVersion!==1||readiness.newDeployerTestnetVersion!==1||readiness.artifactHash!==c.artifactHash||readiness.owner!==c.owner||readiness.operator!==c.deployer||readiness.token!==c.token||readiness.siteConnected!==true)throw Error('NEW_DEPLOYER_TEST_SEED_VERIFIED_TARGET_REQUIRED');
 if(getAddress(wallet.address)!==c.deployer)throw Error('NEW_DEPLOYER_SERVER_OPERATOR_KEY_REQUIRED');
 return {version:1,releaseId:c.releaseId,chainId:97,target:getAddress(readiness.target),owner:c.owner,operator:c.deployer,token:c.token,hash:readiness.hash,runtimeHash:readiness.runtimeHash,budget:budget.toString(),grant};
}

function checkedState(state,identity){
 const seed=state.newDeployerSeedTest;
 if(!seed||JSON.stringify(seed.identity)!==JSON.stringify(identity))throw Error('NEW_DEPLOYER_TEST_SEED_IDENTITY_MISMATCH');
 if(!/^(0|[1-9][0-9]*)$/.test(seed.mintAmount||'')||BigInt(seed.mintAmount)>budget||typeof seed.approvalRequired!=='boolean'||typeof seed.completed!=='boolean')throw Error('NEW_DEPLOYER_TEST_SEED_PLAN_INVALID');
 return seed;
}

async function verifyTarget({provider,wallet,artifact,release,readiness,vault}){
 const identity=identityFor(release,readiness,wallet),token=new Contract(identity.token,artifact.abi,provider);
 if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
 const expected=await provider.call(await new ContractFactory(artifact.abi,artifact.bytecode||'0x'+artifact.evm.bytecode.object).getDeployTransaction(18));
 if(expected==='0x'||(await provider.getCode(identity.token)).toLowerCase()!==expected.toLowerCase())throw Error('REVIEWED_TEST_TOKEN_REQUIRED');
 if(await token.decimals()!==18n||await token.name()!=='Test USDT'||await token.symbol()!=='TUSDT')throw Error('TEST_TOKEN_METADATA_MISMATCH');
 if(getAddress(await vault.getAddress())!==identity.target||keccak256(await provider.getCode(identity.target))!==identity.runtimeHash||await vault.usdt()!==identity.token||await vault.owner()!==identity.owner||await vault.tokenDecimals()!==18n||await vault.FAST_TESTNET_VERSION()!==1n||!await vault.reporters(identity.operator))throw Error('NEW_DEPLOYER_TEST_SEED_VAULT_MISMATCH');
 return {identity,token};
}

function requestFor(label,{identity,token,vault,seed}){
 if(label===labels.mint&&BigInt(seed.mintAmount)>0n)return {to:identity.token,data:token.interface.encodeFunctionData('mint',[identity.operator,BigInt(seed.mintAmount)])};
 if(label===labels.approve&&seed.approvalRequired)return {to:identity.token,data:token.interface.encodeFunctionData('approve',[identity.target,budget])};
 if(label===labels.fund)return {to:identity.target,data:vault.interface.encodeFunctionData('fundRewards',[identity.token,budget])};
 throw Error('NEW_DEPLOYER_TEST_SEED_TRANSACTION_NOT_PLANNED');
}

// A saved request may be retried only when it still resolves to the exact
// target-bound seed step.  It never grants another budget after completion.
export async function verifyNewDeployerTestSeedPending(options){
 const {identity,token}=await verifyTarget(options),seed=checkedState(options.state,identity);
 const expected=requestFor(options.label,{identity,token,vault:options.vault,seed}),request=options.request;
 if(!request?.to||getAddress(request.to)!==getAddress(expected.to)||request.data!==expected.data||BigInt(request.value??0)!==0n)throw Error('NEW_DEPLOYER_TEST_SEED_PENDING_TRANSACTION_MISMATCH');
 return true;
}

export async function seedNewDeployerTestRewards(options){
 const {provider,wallet,artifact,release=loadNewDeployerRelease(),readiness,vault,state,save,transact}=options;
 const {identity,token}=await verifyTarget({provider,wallet,artifact,release,readiness,vault});
 for(const [label,entry] of Object.entries(state.transactions||{}))if(isNewDeployerTestSeedLabel(label)&&entry.block){
  if((await provider.getBlock(entry.block))?.hash!==entry.blockHash)throw Error('NEW_DEPLOYER_COMPLETED_JOURNAL_NOT_CANONICAL');
 }
 if(!state.newDeployerSeedTest){
  if(Object.keys(state.transactions||{}).some(isNewDeployerTestSeedLabel))throw Error('NEW_DEPLOYER_TEST_SEED_UNBOUND_JOURNAL');
  const [balance,allowance]=await Promise.all([token.balanceOf(identity.operator),token.allowance(identity.operator,identity.target)]);
  state.newDeployerSeedTest={identity,mintAmount:(balance<budget?budget-balance:0n).toString(),approvalRequired:allowance<budget,completed:false};save();
 }
 const seed=checkedState(state,identity);
 if(seed.completed)return seed.report;
 const execute=async label=>{
  const request=requestFor(label,{identity,token,vault,seed});
  await verifyNewDeployerTestSeedPending({provider,wallet,artifact,release,readiness,vault,state,label,request});
  return transact(label,request);
 };
 if(BigInt(seed.mintAmount)>0n)await execute(labels.mint);
 if(seed.approvalRequired)await execute(labels.approve);
 const receipt=await execute(labels.fund);
 const funded=receipt.logs.filter(row=>getAddress(row.address)===identity.target).map(row=>{
  try{return vault.interface.parseLog(row);}catch{return null;}
 }).filter(event=>event?.name==='Funded');
 if(funded.length!==1||funded[0].args.sender!==identity.operator||funded[0].args.asset!==identity.token||funded[0].args.amount!==budget||funded[0].args.feeReserve!==false)throw Error('NEW_DEPLOYER_TEST_SEED_RECEIPT_MISMATCH');
 seed.completed=true;
 seed.report={status:'NEW_DEPLOYER_TEST_REWARD_SEED_CONFIRMED',testMode:true,chainId:97,target:identity.target,token:identity.token,amountTestUsdt:'10',mintedTestUsdtUnits:seed.mintAmount,transaction:receipt.hash,block:receipt.blockNumber,blockHash:receipt.blockHash};
 save();return seed.report;
}
