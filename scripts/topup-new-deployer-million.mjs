// A single target-bound test-token reward top-up; never refills after completion.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,Transaction,Wallet,getAddress,keccak256,parseEther,parseUnits,formatUnits} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {journalTransaction,writePrivateJson} from './migration-journal.mjs';
import {readPrivateKey} from './migration-signers.mjs';
import {assertZeroStartJournalCanonical} from './zero-start-automation.mjs';
import {verifyNewDeployerAutomationReadiness,NEW_DEPLOYER_AUTOMATION_DIR} from './new-deployer-testnet-automation.mjs';
import {assertImmutableV1Archive,readImmutableV1Archive,readNewDeployerPrivateText,validateNewDeployerConnectionRelease} from './connect-new-deployer-testnet.mjs';
import {NEW_DEPLOYER_ARTIFACT_FILE,NEW_DEPLOYER_KEY_FILE,NEW_DEPLOYER_STATE_DIR,loadNewDeployerRelease} from './new-deployer-testnet-profile.mjs';

const EXPECTED_TARGET='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
const AMOUNT=parseUnits('1000000',18);
const PURPOSE='new-deployer-test-rewards-one-million-v1';
const LABELS={mint:PURPOSE+'-mint',approve:PURPOSE+'-approve',fund:PURPOSE+'-fund'};
const num=x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x);
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{throw Error(code);};

export async function verifyTopupIdentity({provider,vault,tokenArtifact,identity}){
 if(Number(await provider.send('eth_chainId',[]))!==97)fail('TOPUP_TESTNET_REQUIRED');
 const token=new Contract(identity.token,tokenArtifact.abi,provider);
 const creation=await new ContractFactory(tokenArtifact.abi,tokenArtifact.bytecode||'0x'+tokenArtifact.evm.bytecode.object).getDeployTransaction(18);
 const expected=await provider.call(creation);
 if(expected==='0x'||(await provider.getCode(identity.token)).toLowerCase()!==expected.toLowerCase())fail('TOPUP_REVIEWED_TEST_TOKEN_REQUIRED');
 const [name,symbol,decimals,target,owner,operator,tokenAddress,queue,version,code]=await Promise.all([
  token.name(),token.symbol(),token.decimals(),vault.getAddress(),vault.owner(),vault.reporters(identity.operator),vault.usdt(),vault.withdrawalQueue(),vault.FAST_TESTNET_VERSION(),provider.getCode(identity.target)
 ]);
 if(name!=='Test USDT'||symbol!=='TUSDT'||decimals!==18n||getAddress(target)!==identity.target||getAddress(owner)!==identity.owner||operator!==true||getAddress(tokenAddress)!==identity.token||getAddress(queue)!==identity.queue||version!==1n||keccak256(code)!==identity.runtimeHash)fail('TOPUP_TARGET_IDENTITY_MISMATCH');
 return token;
}

function requestFor(label,{plan,identity,token,vault}){
 const gap=BigInt(plan.gap),mint=BigInt(plan.mintAmount);
 if(label===LABELS.mint&&mint>0n)return {to:identity.token,data:token.interface.encodeFunctionData('mint',[identity.operator,mint])};
 if(label===LABELS.approve&&plan.approvalRequired&&gap>0n)return {to:identity.token,data:token.interface.encodeFunctionData('approve',[identity.target,gap])};
 if(label===LABELS.fund&&gap>0n)return {to:identity.target,data:vault.interface.encodeFunctionData('fundRewards',[identity.token,gap])};
 fail('TOPUP_TRANSACTION_NOT_PLANNED');
}

function checkPlan(plan,identity){
 if(!plan||!same(plan.identity,identity)||![plan.initialRewards,plan.initialCash,plan.initialOperatorBalance,plan.initialAllowance,plan.gap,plan.mintAmount].every(num)||typeof plan.approvalRequired!=='boolean'||typeof plan.completed!=='boolean'||!Number.isSafeInteger(plan.snapshotBlock)||!hash(plan.snapshotHash))fail('TOPUP_PLAN_INVALID');
 const rewards=BigInt(plan.initialRewards),gap=rewards>=AMOUNT?0n:AMOUNT-rewards,balance=BigInt(plan.initialOperatorBalance);
 if(BigInt(plan.gap)!==gap||BigInt(plan.mintAmount)!==(balance<gap?gap-balance:0n)||plan.approvalRequired!==(gap>0n&&BigInt(plan.initialAllowance)<gap))fail('TOPUP_PLAN_INVALID');
 return plan;
}

function validateTransactions({state,plan,identity,token,vault}){
 if(!state.transactions||typeof state.transactions!=='object'||Array.isArray(state.transactions))fail('TOPUP_JOURNAL_INVALID');
 const steps=[...(BigInt(plan.mintAmount)>0n?[LABELS.mint]:[]),...(plan.approvalRequired?[LABELS.approve]:[]),...(BigInt(plan.gap)>0n?[LABELS.fund]:[])];
 const entries=Object.entries(state.transactions);
 if(state.pending||state.oracle?.pending||entries.some(([label,entry])=>!entry?.block&&!steps.includes(label))||entries.filter(([,entry])=>!entry?.block).length>1||entries.some(([label])=>label.startsWith(PURPOSE)&&!steps.includes(label)))fail('TOPUP_JOURNAL_SCOPE_INVALID');
 for(const [index,label] of steps.entries())if(state.transactions[label]){
  if(steps.slice(0,index).some(prior=>!state.transactions[prior]?.block))fail('TOPUP_JOURNAL_ORDER_INVALID');
  const entry=state.transactions[label];let tx;try{tx=Transaction.from(entry.raw);}catch{fail('TOPUP_SIGNED_REQUEST_INVALID');}
  const request=requestFor(label,{plan,identity,token,vault});
  if(tx.chainId!==97n||!tx.from||getAddress(tx.from)!==identity.operator||getAddress(tx.to)!==getAddress(request.to)||tx.data!==request.data||tx.value!==0n||keccak256(entry.raw)!==entry.hash||!num(entry.maxFee))fail('TOPUP_SIGNED_REQUEST_INVALID');
 }
}

async function observeFunding(provider,vault,identity){
 const block=await provider.getBlock('latest');if(!block||!hash(block.hash))fail('TOPUP_OBSERVATION_REQUIRED');
 const o={blockTag:block.number};
 const [ledger,cash,accounted]=await Promise.all([vault.ledgers(identity.token,o),vault.assetBalance(identity.token,o),vault.accounted(identity.token,o)]);
 if((await provider.getBlock(block.number))?.hash!==block.hash)fail('TOPUP_OBSERVATION_REORG');
 return {observationBlock:block.number,observationBlockHash:block.hash,currentRewards:formatUnits(ledger.rewards,18),currentCash:formatUnits(cash,18),recordedObligations:formatUnits(accounted,18),totalCashShortfall:formatUnits(accounted>cash?accounted-cash:0n,18)};
}

async function verifyFundingReceipt({provider,vault,identity,plan,state,receipt}){
 const entry=state.transactions[LABELS.fund];
 if(!receipt||!entry?.block||entry.hash!==receipt.hash||receipt.blockNumber!==entry.block||receipt.blockHash!==entry.blockHash||receipt.status!==1||(await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)fail('TOPUP_FUND_RECEIPT_INVALID');
 const transaction=await provider.getTransaction(receipt.hash),expected=vault.interface.encodeFunctionData('fundRewards',[identity.token,BigInt(plan.gap)]);
 if(!transaction||transaction.chainId!==97n||getAddress(transaction.from)!==identity.operator||getAddress(transaction.to)!==identity.target||transaction.value!==0n||transaction.data!==expected)fail('TOPUP_FUND_TRANSACTION_INVALID');
 const events=receipt.logs.filter(row=>getAddress(row.address)===identity.target).map(row=>{try{return vault.interface.parseLog(row);}catch{return null;}}).filter(row=>row?.name==='Funded');
 if(events.length!==1||getAddress(events[0].args.sender)!==identity.operator||getAddress(events[0].args.asset)!==identity.token||events[0].args.amount!==BigInt(plan.gap)||events[0].args.feeReserve!==false)fail('TOPUP_FUND_EVENT_INVALID');
}

export async function topupNewDeployerMillion({provider,wallet,vault,tokenArtifact,identity,state,save,guard,transact}){
 if(getAddress(wallet.address)!==identity.operator)fail('TOPUP_SIGNER_REQUIRED');
 if(!state||typeof state!=='object'||!state.transactions)fail('TOPUP_JOURNAL_INVALID');
 await guard();
 const token=await verifyTopupIdentity({provider,vault,tokenArtifact,identity});
 if(!state.newDeployerMillionTopup){
  if(Object.keys(state.transactions).some(label=>label.startsWith(PURPOSE)))fail('TOPUP_UNBOUND_JOURNAL');
  if(state.pending||state.oracle?.pending||Object.values(state.transactions).some(entry=>!entry?.block))fail('TOPUP_WORKER_PENDING_REVIEW_REQUIRED');
  const block=await provider.getBlock('latest');if(!block||!hash(block.hash))fail('TOPUP_SNAPSHOT_REQUIRED');
  const o={blockTag:block.number};
  const [ledger,cash,balance,allowance]=await Promise.all([vault.ledgers(identity.token,o),vault.assetBalance(identity.token,o),token.balanceOf(identity.operator,o),token.allowance(identity.operator,identity.target,o)]);
  if((await provider.getBlock(block.number))?.hash!==block.hash)fail('TOPUP_SNAPSHOT_REORG');
  const rewards=ledger.rewards,gap=rewards>=AMOUNT?0n:AMOUNT-rewards,mint=balance<gap?gap-balance:0n;
  state.newDeployerMillionTopup={identity,snapshotBlock:block.number,snapshotHash:block.hash,initialRewards:String(rewards),initialCash:String(cash),initialOperatorBalance:String(balance),initialAllowance:String(allowance),gap:String(gap),mintAmount:String(mint),approvalRequired:gap>0n&&allowance<gap,completed:false};
  await save();
 }
 const plan=checkPlan(state.newDeployerMillionTopup,identity);
 if((await provider.getBlock(plan.snapshotBlock))?.hash!==plan.snapshotHash)fail('TOPUP_SNAPSHOT_REORG');
 validateTransactions({state,plan,identity,token,vault});
 await assertZeroStartJournalCanonical(provider,state);
 if(plan.completed){
  if(!plan.report||plan.report.target!==identity.target||plan.report.fundedUnits!==plan.gap)fail('TOPUP_COMPLETED_REPORT_INVALID');
  if(BigInt(plan.gap)>0n&&(!state.transactions[LABELS.fund]?.block||plan.report.transaction!==state.transactions[LABELS.fund].hash))fail('TOPUP_COMPLETED_REPORT_INVALID');
  if(BigInt(plan.gap)>0n)await verifyFundingReceipt({provider,vault,identity,plan,state,receipt:await provider.getTransactionReceipt(plan.report.transaction)});
  return {...plan.report,status:'TEST_REWARDS_TOPUP_ALREADY_COMPLETED',...await observeFunding(provider,vault,identity)};
 }
 const run=async label=>{
  const request=requestFor(label,{plan,identity,token,vault});
  return transact(label,request,async()=>{
   await guard();await verifyTopupIdentity({provider,vault,tokenArtifact,identity});
   validateTransactions({state,plan,identity,token,vault});
  });
 };
 if(BigInt(plan.mintAmount)>0n)await run(LABELS.mint);
 if(plan.approvalRequired)await run(LABELS.approve);
 let receipt=null;
 if(BigInt(plan.gap)>0n){
  receipt=await run(LABELS.fund);
  await verifyFundingReceipt({provider,vault,identity,plan,state,receipt});
 }
 plan.report={status:receipt?'TEST_REWARDS_TOPUP_CONFIRMED':'TEST_REWARDS_LEDGER_ALREADY_AT_GOAL',chainId:97,target:identity.target,token:identity.token,goalTestUsdt:'1000000',initialRewards:formatUnits(BigInt(plan.initialRewards),18),fundedUnits:plan.gap,fundedTestUsdt:formatUnits(BigInt(plan.gap),18),mintedTestUsdt:formatUnits(BigInt(plan.mintAmount),18),...await observeFunding(provider,vault,identity),transaction:receipt?.hash??null,block:receipt?.blockNumber??null};
 plan.completed=true;await save();return plan.report;
}

function privateJson(file,reason){try{const x=JSON.parse(readNewDeployerPrivateText(file));if(!x||typeof x!=='object'||Array.isArray(x))throw Error();return x;}catch{fail(reason);}}
function lockWorker(directory){
 const s=fs.lstatSync(directory);if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)fail('TOPUP_PRIVATE_STATE_REQUIRED');
 const file=path.join(directory,'run.lock');let fd;
 try{fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,String(process.pid));fs.fsyncSync(fd);}catch(error){if(error.code==='EEXIST')fail('TOPUP_WORKER_LOCK_REVIEW_REQUIRED');throw error;}finally{if(fd!==undefined)fs.closeSync(fd);}
 return file;
}
function releaseWorker(file){if(!file)return;try{if(readNewDeployerPrivateText(file)===String(process.pid))fs.unlinkSync(file);}catch{}}

async function main(){
 let provider,lock;
 try{
  if(process.getuid?.()!==0||process.argv.length!==3||process.argv[2]!=='--execute')fail('TOPUP_EXPLICIT_EXECUTE_REQUIRED');
  lock=lockWorker(NEW_DEPLOYER_AUTOMATION_DIR);
  const release=validateNewDeployerConnectionRelease(loadNewDeployerRelease()),artifact=JSON.parse(fs.readFileSync(NEW_DEPLOYER_ARTIFACT_FILE,'utf8'));
  const tokenArtifact=JSON.parse(fs.readFileSync(new URL('../artifacts/MockToken.json',import.meta.url),'utf8'));
  const original=readNewDeployerPrivateText('/etc/globaldroptrade/trades.env'),config=readConfig(parseEnv(original));
  const deploymentReport=privateJson(NEW_DEPLOYER_STATE_DIR+'/deployment-public.json','TOPUP_DEPLOYMENT_REQUIRED');
  const connectionReport=privateJson(NEW_DEPLOYER_STATE_DIR+'/connection-public.json','TOPUP_CONNECTION_REQUIRED');
  const archive=readImmutableV1Archive(),rpc=new FetchRequest(config.rpcUrl);rpc.timeout=15000;
  provider=new JsonRpcProvider(rpc,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=2000;
  let wallet;try{wallet=new Wallet(readPrivateKey(NEW_DEPLOYER_KEY_FILE),provider);}catch{fail('TOPUP_SIGNER_REQUIRED');}
  const ready=()=>verifyNewDeployerAutomationReadiness({provider,artifact,release,deploymentReport,connectionReport,archive,original,confirmations:Math.max(3,config.confirmations)});
  const r=await ready();if(r.target!==EXPECTED_TARGET||wallet.address!==release.deployer)fail('TOPUP_TARGET_IDENTITY_MISMATCH');
  const identity={version:1,purpose:PURPOSE,chainId:97,target:r.target,owner:r.owner,operator:r.operator,token:r.token,queue:r.queue,hash:r.hash,runtimeHash:r.runtimeHash};
  const stateFile=path.join(NEW_DEPLOYER_AUTOMATION_DIR,'journal.json');
  const state=fs.existsSync(stateFile)?privateJson(stateFile,'TOPUP_JOURNAL_REQUIRED'):{transactions:{}};
  const save=()=>writePrivateJson(stateFile,state),vault=new Contract(identity.target,artifact.abi,wallet);
  const expectedRoot={version:1,chainId:97,target:identity.target,owner:identity.owner,operator:identity.operator,queue:identity.queue,hash:identity.hash,runtimeHash:identity.runtimeHash};
  if(state.identity&&!same(state.identity,expectedRoot))fail('TOPUP_WORKER_IDENTITY_MISMATCH');
  if(!state.identity&&Object.keys(state.transactions||{}).length)fail('TOPUP_UNBOUND_JOURNAL');
  state.identity??=expectedRoot;
  const guard=async()=>{
   if(readNewDeployerPrivateText('/etc/globaldroptrade/trades.env')!==original)fail('TOPUP_ENV_CHANGED');
   assertImmutableV1Archive(archive);
   const current=await ready();
   if(current.target!==identity.target||current.runtimeHash!==identity.runtimeHash||current.hash!==identity.hash)fail('TOPUP_TARGET_IDENTITY_MISMATCH');
   await assertZeroStartJournalCanonical(provider,state);
  };
  const transact=(label,request,check)=>journalTransaction({provider,wallet,state,save,label,request,guard:check,confirmations:Math.max(3,config.confirmations),timeout:90000,maxTotalFee:parseEther('0.1')});
  const report=await topupNewDeployerMillion({provider,wallet,vault,tokenArtifact,identity,state,save,guard,transact});
  console.log('NEW_DEPLOYER_TEST_MILLION_TOPUP '+JSON.stringify(report));
 }catch(error){const code=/^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message||'')?error.message:'TOPUP_CHECK_REQUIRED';console.error('TOPUP_STOPPED '+code);process.exitCode=1;}finally{releaseWorker(lock);provider?.destroy();}
}
let invoked;try{if(process.argv[1])invoked=pathToFileURL(path.resolve(process.argv[1])).href;}catch{}
if(import.meta.url===invoked)await main();
