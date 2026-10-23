import {Contract,ContractFactory,Transaction,getAddress,keccak256,parseUnits} from 'ethers';
import {validateZeroStartRelease} from './deploy-zero-start.mjs';

const tokenAddress='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const amount=parseUnits('1000000',18);
const purpose='fast-test-reward-topup-1000000-v1';
const labels={mint:purpose+'-mint',approve:purpose+'-approve',fund:purpose+'-fund'};
const number=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value);
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);

export function isMillionTestRewardLabel(label){return Object.values(labels).includes(label);}

function identityFor({release,readiness,wallet}){
 const c=validateZeroStartRelease(release);
 if(c.releaseId!=='global-fresh-fast-test-v1'||c.testMode!==true||c.initialServerReporter!==true||c.token!==tokenAddress)throw Error('MILLION_TEST_REWARDS_FAST_PROFILE_REQUIRED');
 if(readiness?.version!==1||!['fresh-zero-verified-target','fresh-zero-daily-readiness'].includes(readiness.kind)||readiness.releaseId!==c.releaseId||readiness.chainId!==97||readiness.testMode!==true||readiness.initialServerReporter!==true||readiness.fastTestnetVersion!==1||readiness.owner!==c.owner||readiness.operator!==c.deployer||readiness.token!==c.token||readiness.artifactHash!==c.artifactHash||readiness.siteConnected!==true||getAddress(readiness.contractAddress)!==getAddress(readiness.target)||![readiness.hash,readiness.runtimeHash,readiness.initcodeHash].every(hash))throw Error('MILLION_TEST_REWARDS_VERIFIED_TARGET_REQUIRED');
 if(getAddress(wallet.address)!==c.deployer)throw Error('EXPECTED_SERVER_OPERATOR_KEY_REQUIRED');
 return {version:1,purpose,releaseId:c.releaseId,chainId:97,target:getAddress(readiness.target),owner:c.owner,operator:c.deployer,token:c.token,queue:getAddress(readiness.queue),hash:readiness.hash,runtimeHash:readiness.runtimeHash,initcodeHash:readiness.initcodeHash,amount:amount.toString()};
}

async function canonicalCompleted(provider,state){
 for(const entry of Object.values(state.transactions||{}))if(entry.block!==undefined){
  if(!Number.isSafeInteger(entry.block)||entry.block<1||!hash(entry.blockHash)||(await provider.getBlock(entry.block))?.hash!==entry.blockHash)throw Error('MILLION_TEST_REWARDS_JOURNAL_NOT_CANONICAL');
 }
}

async function verifyTarget(options){
 const {provider,artifact,vault}=options,identity=identityFor(options);
 if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
 const token=new Contract(identity.token,artifact.abi,provider);
 const expected=await provider.call(await new ContractFactory(artifact.abi,artifact.bytecode||'0x'+artifact.evm.bytecode.object).getDeployTransaction(18));
 if(expected==='0x'||(await provider.getCode(identity.token)).toLowerCase()!==expected.toLowerCase())throw Error('REVIEWED_TEST_TOKEN_REQUIRED');
 if(await token.decimals()!==18n||await token.name()!=='Test USDT'||await token.symbol()!=='TUSDT')throw Error('TEST_TOKEN_METADATA_MISMATCH');
 if(getAddress(await vault.getAddress())!==identity.target||keccak256(await provider.getCode(identity.target))!==identity.runtimeHash||await vault.usdt()!==identity.token||await vault.owner()!==identity.owner||await vault.tokenDecimals()!==18n||await vault.FAST_TESTNET_VERSION()!==1n||!await vault.reporters(identity.operator)||getAddress(await vault.withdrawalQueue())!==identity.queue)throw Error('MILLION_TEST_REWARDS_VAULT_MISMATCH');
 return {identity,token};
}

function checkedPlan(state,identity){
 const plan=state.millionTestRewardGrant;
 if(!plan||JSON.stringify(plan.identity)!==JSON.stringify(identity))throw Error('MILLION_TEST_REWARDS_PLAN_IDENTITY_MISMATCH');
 if(![plan.initialOperatorBalance,plan.initialAllowance,plan.mintAmount].every(number)||BigInt(plan.mintAmount)>amount||typeof plan.approvalRequired!=='boolean'||typeof plan.completed!=='boolean')throw Error('MILLION_TEST_REWARDS_PLAN_INVALID');
 const balance=BigInt(plan.initialOperatorBalance);
 if(BigInt(plan.mintAmount)!==(balance<amount?amount-balance:0n)||plan.approvalRequired!==(BigInt(plan.initialAllowance)!==amount))throw Error('MILLION_TEST_REWARDS_PLAN_INVALID');
 return plan;
}

function requestFor(label,{identity,token,vault,plan}){
 if(label===labels.mint&&BigInt(plan.mintAmount)>0n)return {to:identity.token,data:token.interface.encodeFunctionData('mint',[identity.operator,BigInt(plan.mintAmount)])};
 if(label===labels.approve&&plan.approvalRequired)return {to:identity.token,data:token.interface.encodeFunctionData('approve',[identity.target,amount])};
 if(label===labels.fund)return {to:identity.target,data:vault.interface.encodeFunctionData('fundRewards',[identity.token,amount])};
 throw Error('MILLION_TEST_REWARDS_TRANSACTION_NOT_PLANNED');
}

function assertStepOrder(state,plan){
 const steps=[...(BigInt(plan.mintAmount)>0n?[labels.mint]:[]),...(plan.approvalRequired?[labels.approve]:[]),labels.fund];
 for(const label of Object.keys(state.transactions||{}))if(isMillionTestRewardLabel(label)&&!steps.includes(label))throw Error('MILLION_TEST_REWARDS_TRANSACTION_NOT_PLANNED');
 for(let index=0;index<steps.length;index++)if(state.transactions[steps[index]]){
  if(steps.slice(0,index).some(label=>!state.transactions[label]?.block))throw Error('MILLION_TEST_REWARDS_JOURNAL_STEP_ORDER_MISMATCH');
 }
}

function exactRequest(expected,request){
 if(!request?.to||getAddress(request.to)!==expected.to||request.data!==expected.data||BigInt(request.value??0)!==0n)throw Error('MILLION_TEST_REWARDS_PENDING_REQUEST_MISMATCH');
}

export async function verifyMillionTestRewardPending(options){
 const {identity,token}=await verifyTarget(options),plan=checkedPlan(options.state,identity);
 assertStepOrder(options.state,plan);
 exactRequest(requestFor(options.label,{identity,token,vault:options.vault,plan}),options.request);
 return true;
}

// The funding-only command cannot reconcile an oracle, payout or daily credit.
// Check every pending label and request before any new nonce may be allocated.
export async function assertMillionTestRewardPendingScope(options){
 const {state}=options;
 if(state.pending||state.oracle?.pending)throw Error('MILLION_TEST_REWARDS_OTHER_PENDING_REQUIRES_RECONCILIATION');
 const pending=Object.entries(state.transactions||{}).filter(([,entry])=>!entry.block);
 if(pending.some(([label])=>!isMillionTestRewardLabel(label)))throw Error('MILLION_TEST_REWARDS_OTHER_PENDING_REQUIRES_RECONCILIATION');
 if(pending.length>1)throw Error('MILLION_TEST_REWARDS_MULTIPLE_PENDING_TRANSACTIONS');
 const {identity,token}=await verifyTarget(options);
 const expectedRoot={version:1,chainId:97,target:identity.target,owner:identity.owner,operator:identity.operator,queue:identity.queue,hash:identity.hash,runtimeHash:identity.runtimeHash};
 if(state.identity&&JSON.stringify(state.identity)!==JSON.stringify(expectedRoot))throw Error('MILLION_TEST_REWARDS_ROOT_IDENTITY_MISMATCH');
 if(!state.identity&&Object.keys(state.transactions||{}).length)throw Error('MILLION_TEST_REWARDS_UNBOUND_JOURNAL');
 await canonicalCompleted(options.provider,state);
 if(state.millionTestRewardGrant)assertStepOrder(state,checkedPlan(state,identity));
 if(pending.length){
  const plan=checkedPlan(state,identity);
  for(const[label,entry]of pending){
   const tx=Transaction.from(entry.raw);
   if(tx.chainId!==97n||tx.from!==identity.operator||keccak256(entry.raw)!==entry.hash)throw Error('MILLION_TEST_REWARDS_PENDING_REQUEST_MISMATCH');
   exactRequest(requestFor(label,{identity,token,vault:options.vault,plan}),{to:tx.to,data:tx.data,value:tx.value});
  }
 }
 return {identity,token};
}

async function verifyFundingReceipt({provider,vault,state,identity,receipt}){
 const entry=state.transactions[labels.fund];
 if(!entry?.block||entry.hash!==receipt.hash||entry.block!==receipt.blockNumber||entry.blockHash!==receipt.blockHash||receipt.status!==1||(await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('MILLION_TEST_REWARDS_RECEIPT_NOT_CANONICAL');
 const transaction=await provider.getTransaction(receipt.hash);
 if(!transaction||transaction.chainId!==97n||transaction.from!==identity.operator||transaction.to!==identity.target||transaction.value!==0n||transaction.data!==vault.interface.encodeFunctionData('fundRewards',[identity.token,amount]))throw Error('MILLION_TEST_REWARDS_FUND_TRANSACTION_MISMATCH');
 const funded=receipt.logs.filter(log=>getAddress(log.address)===identity.target).map(log=>{try{return vault.interface.parseLog(log);}catch{return null;}}).filter(event=>event?.name==='Funded');
 if(funded.length!==1||funded[0].args.sender!==identity.operator||funded[0].args.asset!==identity.token||funded[0].args.amount!==amount||funded[0].args.feeReserve!==false)throw Error('MILLION_TEST_REWARDS_FUND_EVENT_MISMATCH');
 const [before,after]=await Promise.all([vault.ledgers(identity.token,{blockTag:receipt.blockNumber-1}),vault.ledgers(identity.token,{blockTag:receipt.blockNumber})]);
 if((await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('MILLION_TEST_REWARDS_RECEIPT_NOT_CANONICAL');
 const net=after.rewards-before.rewards;
 // Other transactions in this same block can fund or consume rewards. The
 // exact canonical Funded event proves this grant; record the measured net
 // change separately instead of resending a confirmed grant after concurrency.
 return {method:'canonical-fund-event-and-receipt-block-ledgers',block:receipt.blockNumber,blockHash:receipt.blockHash,rewardsBeforeUnits:before.rewards.toString(),rewardsAfterUnits:after.rewards.toString(),rewardLedgerNetChangeUnits:net.toString(),verifiedGrantCreditUnits:amount.toString(),otherSameBlockRewardChangeUnits:(net-amount).toString()};
}

// Add one fixed million-token test grant. Completion never follows current
// reward balances, so spending or withdrawing rewards cannot trigger a refill.
export async function fundMillionTestRewards(options){
 const {provider,vault,state,save,transact}=options;
 const {identity,token}=await assertMillionTestRewardPendingScope(options);
 if(!state.millionTestRewardGrant){
  if(Object.keys(state.transactions||{}).some(isMillionTestRewardLabel))throw Error('MILLION_TEST_REWARDS_UNBOUND_JOURNAL');
  const [balance,allowance]=await Promise.all([token.balanceOf(identity.operator),token.allowance(identity.operator,identity.target)]);
  state.millionTestRewardGrant={identity,initialOperatorBalance:balance.toString(),initialAllowance:allowance.toString(),mintAmount:(balance<amount?amount-balance:0n).toString(),approvalRequired:allowance!==amount,completed:false};
  await save();
 }
 const plan=checkedPlan(state,identity);
 if(plan.completed){
  const entry=state.transactions[labels.fund],report=plan.report;
  if(report?.status!=='TEST_REWARD_TOPUP_CONFIRMED'||report.purpose!==purpose||report.target!==identity.target||report.amountTestUsdt!=='1000000'||!entry?.block||report.transaction!==entry.hash||report.block!==entry.block||report.blockHash!==entry.blockHash||report.ledgerProof?.verifiedGrantCreditUnits!==amount.toString())throw Error('MILLION_TEST_REWARDS_COMPLETED_STATE_INVALID');
  return plan.report;
 }
 const execute=async label=>{
  const request=requestFor(label,{identity,token,vault,plan});
  await verifyMillionTestRewardPending({...options,label,request});
  return transact(label,request);
 };
 if(BigInt(plan.mintAmount)>0n)await execute(labels.mint);
 if(plan.approvalRequired)await execute(labels.approve);
 const receipt=await execute(labels.fund);
 await canonicalCompleted(provider,state);
 const ledgerProof=await verifyFundingReceipt({provider,vault,state,identity,receipt});
 plan.completed=true;
 plan.report={status:'TEST_REWARD_TOPUP_CONFIRMED',purpose,testMode:true,chainId:97,target:identity.target,token:identity.token,amountTestUsdt:'1000000',mintedTestUsdtUnits:plan.mintAmount,transaction:receipt.hash,block:receipt.blockNumber,blockHash:receipt.blockHash,ledgerProof};
 await save();return plan.report;
}
