// Strictly read-only probe: no lock, wallet, signer, journal writes or sends.
import {parseEnv} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FetchRequest,JsonRpcProvider,keccak256} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {readNewDeployerPrivateText} from './connect-new-deployer-testnet.mjs';

const EXPECTED='0x4c0f6141b18971db4b14e45c0be8cddb09febc14';
const BASE='/var/lib/globaldroptrade/new-deployer-testnet-automation-v1';
const DEPLOYMENT='/var/lib/globaldroptrade/new-deployer-testnet-v1/deployment-public.json';
const fail=code=>{throw Error(code);};
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const safe=value=>Number.isSafeInteger(value)&&value>=0;

// Count only elapsed position hours in the indexed snapshot. This measures
// scheduling backlog, not how many positions are eligible or owed a payment.
export function countDuePositionHours(daily, targetBlock, targetTimestamp, intervalSeconds){
 if(intervalSeconds!==3600||!safe(targetBlock)||!safe(targetTimestamp)||targetTimestamp===0)return null;
 const positions=daily?.positionIndex?.positions,paid=daily?.positionPaid??{},closed=daily?.positionClosed??{};
 if(!positions||typeof positions!=='object'||Array.isArray(positions)||!paid||typeof paid!=='object'||Array.isArray(paid)||!closed||typeof closed!=='object'||Array.isArray(closed))return null;
 let total=0,positionCount=0;
 for(const [key,row] of Object.entries(positions)){
  if(!row||!safe(row.openedAt)||row.openedAt===0||row.openedAt>targetTimestamp||!safe(row.openedBlock)||row.openedBlock>targetBlock||!safe(paid[key]??0)||
    (Object.hasOwn(closed,key)&&typeof closed[key]!=='boolean'))return null;
  if(closed[key]===true)continue;
  const elapsed=Math.max(0,Math.floor((targetTimestamp-row.openedAt)/intervalSeconds));
  const due=Math.max(0,elapsed-(paid[key]??0));
  if(due){positionCount++;total+=due;if(!safe(total))return null;}
 }
 return {positionCount,positionHours:total,eligibilityAndAmountsChecked:false};
}

// Reading the journal is intentionally lock-free. A concurrent writer may
// invalidate this aggregate; never present it for a changed snapshot.
export function suppressUnstableBacklog(result,journalUnchanged,policyUnchanged){
 return {...result,scheduledBacklog:journalUnchanged===true&&policyUnchanged===true?result.scheduledBacklog:null};
}

export async function probeIndexSnapshot({provider,state,confirmations,expectedRuntimeHash,expectedTarget,intervalSeconds,clock=Date.now}){
 if(!provider||!state?.daily||!state.identity||state.identity.chainId!==97||
    typeof expectedTarget!=='string'||expectedTarget.toLowerCase()!==EXPECTED||
    String(state.identity.target).toLowerCase()!==EXPECTED||!hash(expectedRuntimeHash)||
    !Number.isSafeInteger(confirmations)||confirmations<3)fail('INDEX_PROBE_INPUT_MISMATCH');
 const timingsMs={};
 const timed=async(name,operation)=>{const start=clock();try{return await operation();}finally{timingsMs[name]=Math.max(0,clock()-start);}};
 const daily=state.daily;
 const named={target:daily.positionScanTarget,member:daily.registry,position:daily.positionIndex};
 const blockNumber=item=>item?.number??item?.through??null;
 for(const item of Object.values(named))if(item&&(!safe(blockNumber(item))||!hash(item.hash)))fail('INDEX_PROBE_PREFIX_INVALID');
 const validTransactions=state.transactions&&typeof state.transactions==='object'&&!Array.isArray(state.transactions);
 const transactions=validTransactions?Object.values(state.transactions):[];
 const completed=transactions.filter(row=>Number.isSafeInteger(row?.block)&&row.block>0&&hash(row.blockHash)&&hash(row.hash)).sort((a,b)=>b.block-a.block).slice(0,3);
 const pendingFinancial=Boolean(!validTransactions||state.pending||state.oracle?.pending||daily.pendingDailyPlan||transactions.some(row=>!Number.isSafeInteger(row?.block)||row.block<1||!hash(row.blockHash)||!hash(row.hash)));
 const [chain,head,runtime,prefixBlocks,financialBlocks]=await Promise.all([
  timed('chain',()=>provider.send('eth_chainId',[])),
  timed('head',()=>provider.getBlockNumber()),
  timed('runtime',()=>provider.getCode(expectedTarget)),
  Promise.all(Object.entries(named).map(async([name,item])=>item?timed(name,()=>provider.getBlock(blockNumber(item))):null)),
  Promise.all(completed.map((row,index)=>timed('financial'+index,()=>provider.getBlock(row.block))))
 ]);
 if(Number(chain)!==97||!safe(head))fail('INDEX_PROBE_CHAIN_MISMATCH');
 const confirmedHead=Math.max(0,head-confirmations),memberThrough=blockNumber(named.member),positionThrough=blockNumber(named.position);
 const blockChecks=Object.fromEntries(Object.entries(named).map(([name,item],i)=>[name,item?Boolean(prefixBlocks[i]&&prefixBlocks[i].number===blockNumber(item)&&prefixBlocks[i].hash===item.hash):null]));
 const targetTimestamp=blockChecks.target&&safe(prefixBlocks[0]?.timestamp)?prefixBlocks[0].timestamp:null;
 const targetBlock=blockNumber(named.target);
 const runtimeMatches=runtime!=='0x'&&keccak256(runtime)===expectedRuntimeHash;
 const financialBlockChecks=completed.map((row,i)=>Boolean(financialBlocks[i]&&financialBlocks[i].number===row.block&&financialBlocks[i].hash===row.blockHash));
 const scheduledBacklog=targetTimestamp===null||memberThrough!==targetBlock||positionThrough!==targetBlock||
  targetBlock>confirmedHead||!runtimeMatches||pendingFinancial||financialBlockChecks.some(value=>!value)||!blockChecks.member||!blockChecks.position?
  null:countDuePositionHours(daily,targetBlock,targetTimestamp,intervalSeconds);
 const completedFinancial=transactions.filter(row=>Number.isSafeInteger(row?.block)&&row.block>0&&hash(row.blockHash)&&hash(row.hash));
 return {chainId:97,targetMatches:true,confirmedHead,targetBlock:blockNumber(named.target),memberThrough,positionThrough,
  memberLagBlocks:memberThrough===null?null:Math.max(0,confirmedHead-memberThrough),
  positionLagBlocks:positionThrough===null?null:Math.max(0,confirmedHead-positionThrough),
  runtimeMatches,
  blockChecks,financialBlockChecks,
  pendingFinancial,financialEntries:completedFinancial.length,financialDistinctBlocks:new Set(completedFinancial.map(row=>row.block)).size,
  targetTimestamp,scheduledBacklog,timingsMs};
}

async function localJson(route){
 const response=await fetch('http://127.0.0.1:3115'+route,{cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!response.ok)fail('INDEX_PROBE_LOCAL_API_UNAVAILABLE');
 return response.json();
}
async function main(){
 let provider;
 try{
  if(process.getuid?.()!==0||process.argv.length!==3||process.argv[2]!=='--check')fail('INDEX_PROBE_EXPLICIT_ROOT_CHECK_REQUIRED');
  const [api,status]=await Promise.all([localJson('/api/config'),localJson('/api/automation/status')]);
  if(api?.chainId!==97||String(api.vaultAddress).toLowerCase()!==EXPECTED||status?.chainId!==97||String(status.vaultAddress).toLowerCase()!==EXPECTED)fail('INDEX_PROBE_LOCAL_API_TARGET_MISMATCH');
  const config=readConfig(parseEnv(readNewDeployerPrivateText('/etc/globaldroptrade/trades.env')));
  if(config.chainId!==97||String(config.address).toLowerCase()!==EXPECTED)fail('INDEX_PROBE_LOCAL_CONFIG_MISMATCH');
  const deployment=JSON.parse(readNewDeployerPrivateText(DEPLOYMENT));
  if(deployment.chainId!==97||deployment.verified!==true||String(deployment.contractAddress).toLowerCase()!==EXPECTED||!hash(deployment.runtimeHash))fail('INDEX_PROBE_DEPLOYMENT_MISMATCH');
  const journalFile=BASE+'/journal.json',before=readNewDeployerPrivateText(journalFile),state=JSON.parse(before);
  const policyFile=BASE+'/daily-policy.json',policyText=readNewDeployerPrivateText(policyFile),policy=JSON.parse(policyText);
  const request=new FetchRequest(config.rpcUrl);request.timeout=15000;
  provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  const intervalSeconds=policy.chainId===97&&String(policy.vaultAddress).toLowerCase()===EXPECTED&&policy.runtimeHash===deployment.runtimeHash&&policy.basis==='position-anniversary-principal'&&policy.positionScheduleVersion===1?policy.periodSeconds:null;
  const result=await probeIndexSnapshot({provider,state,confirmations:Math.max(3,config.confirmations),expectedRuntimeHash:deployment.runtimeHash,expectedTarget:config.address,intervalSeconds});
  const unchanged=readNewDeployerPrivateText(journalFile)===before;
  const policyUnchanged=readNewDeployerPrivateText(policyFile)===policyText;
  console.log('INDEX_AUTO_READ_ONLY_PROBE '+JSON.stringify({sampledAt:new Date().toISOString(),statusCheckedAt:status.checkedAt,dailyStatus:status.dailyStatus,blockers:status.blockers,journalUnchangedDuringProbe:unchanged,policyUnchangedDuringProbe:policyUnchanged,...suppressUnstableBacklog(result,unchanged,policyUnchanged),signerOpened:false,transactionsSent:0,journalWritten:false},null,2));
 }catch(error){console.error('INDEX_AUTO_PROBE_STOPPED '+(/^[A-Z][A-Z0-9_]+$/.test(error?.message||'')?error.message:'RPC_OR_STATE_REVIEW_REQUIRED'));process.exitCode=1;}
 finally{provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
