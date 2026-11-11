// Read-only preflight for an isolated second-generation zero-state testnet launch.
// It NEVER resets an existing deployed vault or opens a signing key.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Contract,FetchRequest,JsonRpcProvider,ZeroAddress,getAddress,keccak256} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';

export const PREVIOUS_TESTNET_VAULT='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
export const ZERO_V2_STATE_DIR='/var/lib/globaldroptrade/testnet-zero-v2';
const oldState='/var/lib/globaldroptrade/new-deployer-testnet-v1';
const oldWorker='/var/lib/globaldroptrade/new-deployer-testnet-automation-v1';
const backupRoot='/var/backups/globaldroptrade';
const envFile='/etc/globaldroptrade/trades.env';

function fail(value){throw Error(value);}
function privateStat(file,{directory=false}={}){
 let value;
 try{value=fs.lstatSync(file);}catch{fail('ZERO_V2_REQUIRED_BACKUP_OR_STATE_MISSING');}
 if(value.uid!==0||(directory?!value.isDirectory():!value.isFile())||
    (value.mode&(directory?0o077:0o077))!==0||value.isSymbolicLink()){
   fail('ZERO_V2_PRIVATE_BACKUP_REQUIRED');
 }
 return value;
}
function readJson(file){
 privateStat(file);
 let value;
 try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail('ZERO_V2_REPORT_REQUIRED');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('ZERO_V2_REPORT_REQUIRED');
 return value;
}
export function selectBackup(root=backupRoot){
 const parent=fs.lstatSync(root);
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||(parent.mode&0o022)!==0)fail('ZERO_V2_BACKUP_ROOT_REQUIRED');
 const names=fs.readdirSync(root).filter(name=>/^pre-zero-[0-9]{8}T[0-9]{6}Z$/.test(name)).sort().reverse();
 for(const name of names){
  const directory=path.join(root,name);
  try{
   privateStat(directory,{directory:true});
   privateStat(path.join(directory,'new-deployer-testnet-v1'),{directory:true});
   privateStat(path.join(directory,'new-deployer-testnet-automation-v1'),{directory:true});
   privateStat(path.join(directory,'trades.env'));
   privateStat(path.join(directory,'new-deployer-testnet-v1','deployment-public.json'));
   return directory;
  }catch{continue;}
 }
 fail('ZERO_V2_VERIFIED_BACKUP_REQUIRED');
}
export function verifyOldReport(current,backup,target=PREVIOUS_TESTNET_VAULT){
 if(current?.chainId!==97||backup?.chainId!==97||current?.verified!==true||backup?.verified!==true)fail('ZERO_V2_PREVIOUS_REPORT_INVALID');
 for(const field of ['contractAddress','hash','queue','runtimeHash','block','blockHash']){
  if(current[field]!==backup[field])fail('ZERO_V2_BACKUP_DEPLOYMENT_MISMATCH');
 }
 try{if(getAddress(current.contractAddress)!==getAddress(target))throw Error();}catch{fail('ZERO_V2_PREVIOUS_TARGET_CHANGED');}
 return current;
}
function unitActive(name){
 try{execFileSync('systemctl',['is-active','--quiet',name],{timeout:5000,stdio:'ignore'});return true;}
 catch{return false;}
}
export async function preflight({provider,config,report,token,backupPath,timerActive}){
 if(config.chainId!==97||getAddress(config.address)!==getAddress(PREVIOUS_TESTNET_VAULT))fail('ZERO_V2_ACTIVE_TARGET_REQUIRED');
 if(Number(await provider.send('eth_chainId',[]))!==97)fail('ZERO_V2_CHAIN_97_REQUIRED');
 const [head,runtime]=await Promise.all([provider.getBlockNumber(),provider.getCode(PREVIOUS_TESTNET_VAULT)]);
 if(runtime==='0x'||keccak256(runtime)!==report.runtimeHash)fail('ZERO_V2_PREVIOUS_RUNTIME_CHANGED');
 const vault=new Contract(PREVIOUS_TESTNET_VAULT,[
  'function ledgers(address) view returns(uint256 principal,uint256 profit,uint256 feeReserve,uint256 rewards)',
  'function assetBalance(address) view returns(uint256)',
  'function withdrawalQueue() view returns(address)'
 ],provider);
 const queueAddress=getAddress(await vault.withdrawalQueue());
 if(queueAddress!==getAddress(report.queue))fail('ZERO_V2_PREVIOUS_QUEUE_CHANGED');
 const queue=new Contract(queueAddress,[
  'function requestCount() view returns(uint256)',
  'function pending(address) view returns(uint256)'
 ],provider);
 const assets=[];
 for(const [name,address] of [['BNB',ZeroAddress],['TEST_USDT',token]]){
  const [ledger,cash,pending]=await Promise.all([
   vault.ledgers(address),vault.assetBalance(address),queue.pending(address)
  ]);
  assets.push({
   asset:name,principalUnits:ledger.principal.toString(),
   rewardBudgetUnits:ledger.rewards.toString(),
   creditedProfitUnits:ledger.profit.toString(),feeReserveUnits:ledger.feeReserve.toString(),
   contractCashUnits:cash.toString(),queuedUnits:pending.toString()
  });
 }
 const requests=(await queue.requestCount()).toString();
 return {
  version:1,kind:'testnet-zero-v2-readonly-preflight',
  status:'CURRENT_VAULT_ARCHIVE_REVIEW_REQUIRED',
  chainId:97,oldVault:PREVIOUS_TESTNET_VAULT,
  oldDeploymentBlock:report.block,readBlock:head,
  backupPath,
  oldWorkerTimerActive:timerActive,
  queueRequestCount:requests,
  assets,
  nextVaultDeployed:false,cutoverPerformed:false,
  signerOpened:false,transactionsSigned:0,transactionsSent:0
 };
}
async function main(){
 if(process.getuid?.()!==0||process.argv.length!==3||process.argv[2]!=='--check')fail('ZERO_V2_ROOT_EXPLICIT_CHECK_REQUIRED');
 const backupPath=selectBackup();
 privateStat(oldState,{directory:true});privateStat(oldWorker,{directory:true});privateStat(envFile);
 const report=verifyOldReport(
  readJson(path.join(oldState,'deployment-public.json')),
  readJson(path.join(backupPath,'new-deployer-testnet-v1','deployment-public.json'))
 );
 const active=readConfig(parseEnv(fs.readFileSync(envFile,'utf8')));
 const archived=readConfig(parseEnv(fs.readFileSync(path.join(backupPath,'trades.env'),'utf8')));
 if(archived.chainId!==97||getAddress(archived.address)!==getAddress(PREVIOUS_TESTNET_VAULT))fail('ZERO_V2_BACKUP_TARGET_REQUIRED');
 const profile=JSON.parse(fs.readFileSync(new URL('../config/new-deployer-testnet.json',import.meta.url),'utf8'));
 const request=new FetchRequest(active.rpcUrl);request.timeout=15000;
 const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 try{
  const status=await preflight({provider,config:active,report,token:profile.token,backupPath,
   timerActive:unitActive('globaldroptrade-new-deployer-daily.timer')});
  console.log('ZERO_V2_READONLY_PREFLIGHT_PASS');
  console.log(JSON.stringify(status,null,2));
 }finally{provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 main().catch(error=>{console.error(/^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message||'')?error.message:'ZERO_V2_PREFLIGHT_FAILED');process.exitCode=1;});
}
