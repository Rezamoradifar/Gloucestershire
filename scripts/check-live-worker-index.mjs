// Read-only description of the installed finance worker and its index cursor.
// This tool NEVER replaces the service, reads a signing key, or changes a journal.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const service='globaldroptrade-new-deployer-daily.service';
const timer='globaldroptrade-new-deployer-daily.timer';
const base='/opt/globaldroptrade-new-deployer-daily/releases/';
const journal='/var/lib/globaldroptrade/new-deployer-testnet-automation-v1/journal.json';
const fail=code=>{throw Error(code);};
export function scannerRefreshInstalled(source){
 return typeof source==='string'&&
  /const scan=await scanPositionHistory\(/.test(source)&&
  /advanceCompletedTarget:isNewDeployerTestnetPolicy\(policy\)/.test(source);
}
function privateJournal(){
 const fd=fs.openSync(journal,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.uid!==0||stat.nlink!==1||(stat.mode&0o077)!==0||stat.size>128*1024*1024)fail('GLOBAL_WORKER_PRIVATE_JOURNAL_REQUIRED');
  return JSON.parse(fs.readFileSync(fd,'utf8'));
 }finally{fs.closeSync(fd);}
}
function safeUnitInfo(name,property){
 try{return execFileSync('systemctl',['show',name,'--property='+property,'--value'],{
  timeout:4000,encoding:'utf8'}).trim();}
 catch{fail('GLOBAL_WORKER_SYSTEMD_INSPECTION_FAILED');}
}
function main(){
 if(process.getuid?.()!==0||process.argv.length!==2)fail('GLOBAL_WORKER_READONLY_ROOT_REQUIRED');
 const active=safeUnitInfo(service,'ActiveState'),timerActive=safeUnitInfo(timer,'ActiveState'),
  dir=safeUnitInfo(service,'WorkingDirectory');
 let release;
 try{release=fs.realpathSync(dir);}catch{fail('GLOBAL_WORKER_RELEASE_NOT_FOUND');}
 if(!release.startsWith(base)||!release.slice(base.length)||release.includes('\n'))fail('GLOBAL_WORKER_RELEASE_OUTSIDE_VETTED_ROOT');
 const sourceFile=path.join(release,'scripts/position-profit.mjs');
 const stat=fs.lstatSync(sourceFile);
 if(!stat.isFile()||stat.isSymbolicLink())fail('GLOBAL_WORKER_SOURCE_REQUIRED');
 const contents=fs.readFileSync(sourceFile,'utf8'),state=privateJournal();
 const daily=state.daily||{},registered=Object.keys(daily.registry?.members||{}).length,
  positions=Object.keys(daily.positionIndex?.positions||{}).length;
 const pending=Object.values(state.transactions||{}).filter(x=>!x?.block).length;
 const report={kind:'read-only-active-worker-inspection',chainId:state.identity?.chainId,
  vault:state.identity?.target,serviceActive:active,timerActive,
  releaseDirectory:release,indexRefreshInLiveWorker:scannerRefreshInstalled(contents),
  liveSourceSha256:createHash('sha256').update(contents).digest('hex'),
  indexedMembers:registered,indexedPositions:positions,
  memberThrough:daily.registry?.through??null,positionThrough:daily.positionIndex?.through??null,
  fixedTarget:daily.positionScanTarget?.number??null,
  pendingFinancialTransactions:pending,
  newReleaseNeedsSupervisedRollout:!scannerRefreshInstalled(contents),
  signerOpened:false,transactionsSent:0};
 console.log(JSON.stringify(report,null,2));
}
let invoked;try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;}catch{}
if(import.meta.url===invoked)try{main();}catch(error){
 console.error(/^GLOBAL_WORKER_[A-Z0-9_]+$/.test(error?.message||'')?error.message:'GLOBAL_WORKER_READONLY_CHECK_FAILED');
 process.exitCode=1;
}
