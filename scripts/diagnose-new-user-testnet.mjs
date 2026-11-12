// Read-only diagnostic for the latest BNB Testnet depositors.
// No signer, token transfer, journal mutation, status publication or RPC URL output.
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {
 Contract,formatUnits,getAddress,keccak256,toUtf8Bytes
} from 'ethers';
import {withVerifiedDiagnosticRpc} from './new-user-diagnostic-rpc.mjs';
import {readConfig} from '../server/trades-api.mjs';
import {validateDailyPolicy,isNewDeployerTestnetPolicy} from './daily-profit.mjs';
import {blockAtTime} from './daily-profit.mjs';
import {createDailyActivityReader,validateDailyActivityPolicy} from './daily-activity.mjs';
import {NEW_DEPLOYER_DAILY_ACTIVITY_POLICY_FILE,NEW_DEPLOYER_DAILY_POLICY_FILE,NEW_DEPLOYER_AUTOMATION_DIR} from './new-deployer-testnet-automation.mjs';

export const expectedVault='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
const privateEnv='/etc/globaldroptrade/trades.env';
const journalFile=NEW_DEPLOYER_AUTOMATION_DIR+'/journal.json';
const abi=[
 'function accounts(address,address) view returns(uint256 principal,uint256 profit,uint256 externalDeposited,uint256 nextWithdrawal)',
 'function positionOf(address,uint256) view returns((address asset,uint256 principal,uint256 capitalUsd,uint256 unlockAt,uint16 penaltyBps))',
 'function dailyTargetBps(address) view returns(uint16)',
 'function usedRewardBatch(bytes32) view returns(bool)',
 'function tokenDecimals() view returns(uint8)',
 'function usdt() view returns(address)'
];

const fail=code=>{throw Error(code);};
const privateJson=file=>{
 let fd;
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}catch{fail('NEW_USER_DIAGNOSTIC_FILE_REQUIRED');}
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.uid!==0||stat.nlink!==1||(stat.mode&0o077)!==0||stat.size>256*1024*1024)fail('NEW_USER_DIAGNOSTIC_PRIVATE_FILE_REQUIRED');
  return JSON.parse(fs.readFileSync(fd,'utf8'));
 }finally{fs.closeSync(fd);}
};
export function latestUserPositions(positions,limit=2){
 if(!positions||typeof positions!=='object'||Array.isArray(positions)||!Number.isSafeInteger(limit)||limit<1||limit>20)fail('NEW_USER_DIAGNOSTIC_POSITIONS_REQUIRED');
 const entries=Object.entries(positions).filter(([key,row])=>typeof key==='string'&&
  typeof row?.member==='string'&&Number.isSafeInteger(row.openedAt)&&row.openedAt>0&&
  /^(0|[1-9][0-9]*)$/.test(String(row.id)));
 const wallets=new Set(),selected=[];
 for(const [key,row] of entries.sort((a,b)=>b[1].openedAt-a[1].openedAt||a[0].localeCompare(b[0]))){
  let address;
  try{address=getAddress(row.member);}catch{fail('NEW_USER_DIAGNOSTIC_ADDRESS_INVALID');}
  if(key!==address.toLowerCase()+':'+row.id)fail('NEW_USER_DIAGNOSTIC_POSITION_IDENTITY_CHANGED');
  if(wallets.has(address))continue;
  wallets.add(address);selected.push({key,row:{...row,member:address}});
  if(selected.length===limit)break;
 }
 return selected;
}
export function personalBatchId({chainId,vault,member,positionId,period,asset}){
 if(chainId!==97||!Number.isSafeInteger(period)||period<0||!/^(0|[1-9][0-9]*)$/.test(String(positionId)))fail('NEW_USER_DIAGNOSTIC_PERIOD_INVALID');
 const domain=['GLOBAL_POSITION_HOURLY_NEW_DEPLOYER_TEST_V1',chainId,getAddress(vault).toLowerCase(),
  getAddress(member).toLowerCase(),String(positionId),period,getAddress(asset).toLowerCase()].join(':');
 return keccak256(toUtf8Bytes(domain+':personal'));
}
export function periodTimes(openedAt,index){
 if(!Number.isSafeInteger(openedAt)||openedAt<1||!Number.isSafeInteger(index)||index<0)fail('NEW_USER_DIAGNOSTIC_PERIOD_INVALID');
 const start=openedAt+index*3600,end=start+3600;
 if(!Number.isSafeInteger(end))fail('NEW_USER_DIAGNOSTIC_PERIOD_INVALID');
 return {start,end};
}
async function main(){
 if(process.getuid?.()!==0||process.argv.slice(2).length>1)fail('NEW_USER_DIAGNOSTIC_ROOT_REQUIRED');
 const limit=process.argv[2]===undefined?2:Number(process.argv[2]);
 if(!Number.isSafeInteger(limit)||limit<1||limit>10)fail('NEW_USER_DIAGNOSTIC_LIMIT_REQUIRED');
 const env=readConfig(parseEnv(fs.readFileSync(privateEnv,'utf8')));
 const journal=privateJson(journalFile),policy=validateDailyPolicy(privateJson(NEW_DEPLOYER_DAILY_POLICY_FILE));
 const activityPolicy=validateDailyActivityPolicy(privateJson(NEW_DEPLOYER_DAILY_ACTIVITY_POLICY_FILE),{
  chainId:97,vaultAddress:expectedVault,origin:'https://globaldroptrade.com'});
 if(env.chainId!==97||getAddress(env.address)!==getAddress(expectedVault)||
  journal.identity?.chainId!==97||getAddress(journal.identity.target)!==getAddress(expectedVault)||
  !isNewDeployerTestnetPolicy(policy)||policy.vaultAddress!==getAddress(expectedVault)||
  policy.periodSeconds!==3600||policy.basis!=='position-anniversary-principal'){
  fail('NEW_USER_DIAGNOSTIC_TARGET_MISMATCH');
 }
 const daily=journal.daily||{},index=daily.positionIndex||{},registry=daily.registry||{},
  positions=latestUserPositions(index.positions||{},limit);
 const verified=await withVerifiedDiagnosticRpc({
  config:env,expectedVault,runtimeHash:journal.identity.runtimeHash,
  deploymentBlock:policy.deploymentBlock,
  onAttempt:entry=>console.error('NEW_USER_RPC_CANDIDATE '+JSON.stringify(entry)),
  read:async(provider,head)=>{
  const vault=new Contract(expectedVault,abi,provider),token=getAddress(await vault.usdt()),
   decimals=Number(await vault.tokenDecimals());
  const activity=createDailyActivityReader({provider,file:activityPolicy.historyFile,
   chainId:97,vaultAddress:expectedVault,origin:'https://globaldroptrade.com'});
  const report={version:1,kind:'new-depositor-readonly-check',chainId:97,vault:expectedVault,
   confirmedHead:head.number,indexedThrough:index.through??null,
   memberIndexedThrough:registry.through??null,positionScanTarget:daily.positionScanTarget?.number??null,
   knownMembers:Object.keys(registry.members||{}).length,
   knownPositions:Object.keys(index.positions||{}).length,activityActivation:activityPolicy.activationTimestamp,
   users:[],signerOpened:false,transactionsSigned:0,transactionsSent:0};
  for(const {key,row} of positions){
   const paid=daily.positionPaid?.[key]??0;
   if(!Number.isSafeInteger(paid)||paid<0)fail('NEW_USER_DIAGNOSTIC_PAID_CURSOR_INVALID');
   const account=await vault.accounts(row.member,token);
   const current=await vault.positionOf(row.member,BigInt(row.id));
   const latestCheckIn=await activity.evidence(row.member,head.timestamp+1);
   const periods=[];
   // Processed periods only; one latest user need not have been eligible historically.
   for(let i=Math.max(0,paid-3);i<paid;i++){
    const {start,end}=periodTimes(row.openedAt,i),required=start>=activityPolicy.activationTimestamp,
     evidence=required?await activity.evidence(row.member,end):null,eligible=!required||Boolean(evidence),
     batchId=personalBatchId({chainId:97,vault:expectedVault,member:row.member,positionId:row.id,period:i,asset:row.asset});
    const creditedOnChain=Boolean(await vault.usedRewardBatch(batchId,{blockTag:head.number}));
    let expectedPersonal=null,rateBps=null,snapshotBlock=null,snapshotIssue=null;
    try{
     const snapshot=await blockAtTime(provider,start,policy.deploymentBlock,head.number);
     const pos=await vault.positionOf(row.member,BigInt(row.id),{blockTag:snapshot.number});
     if(getAddress(pos.asset)!==getAddress(row.asset))fail('NEW_USER_DIAGNOSTIC_ASSET_CHANGED');
     const rate=eligible?await vault.dailyTargetBps(row.member,{blockTag:snapshot.number}):0n;
     rateBps=rate.toString();snapshotBlock=snapshot.number;
     expectedPersonal=formatUnits(pos.principal*rate/10000n,decimals);
    }catch{snapshotIssue='HISTORICAL_RPC_OR_SNAPSHOT_REQUIRED';}
    periods.push({period:i+1,end:new Date(end*1000).toISOString(),
     activityRequired:required,activityEligible:eligible,rateBps,
     expectedPersonal,confirmedPersonalBatch:creditedOnChain,snapshotBlock,snapshotIssue});
   }
   const nextDue=periodTimes(row.openedAt,paid).end;
   report.users.push({wallet:row.member,positionId:String(row.id),openedAt:new Date(row.openedAt*1000).toISOString(),
    processedPeriods:paid,nextDue:new Date(nextDue*1000).toISOString(),
    dueNow:nextDue<=head.timestamp,positionPrincipal:formatUnits(current.principal,decimals),
    walletPrincipal:formatUnits(account.principal,decimals),walletProfit:formatUnits(account.profit,decimals),
    activityCurrent:Boolean(latestCheckIn),latestEligibleCheckInAt:latestCheckIn?new Date(latestCheckIn.block.timestamp*1000).toISOString():null,
    periods});
  }
  return report;
  }
 });
 console.log('NEW_USER_RPC_SELECTED='+verified.usedCandidate);
 console.log(JSON.stringify(verified.output,null,2));
}
let invoked;
try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;}catch{}
if(invoked===import.meta.url)main().catch(e=>{
 const label=/^NEW_USER_DIAGNOSTIC_[A-Z0-9_]+$/.test(e?.message||'')?e.message:'NEW_USER_DIAGNOSTIC_REVIEW_REQUIRED';
 console.error(label);
 if(Array.isArray(e?.statuses))console.error('NEW_USER_RPC_SUMMARY '+JSON.stringify(e.statuses));
 process.exitCode=1;
});
