// Configure verified, read-only BNB Testnet RPC fallbacks without changing the primary signer RPC.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {getAddress,Interface,keccak256} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';

const envFile='/etc/globaldroptrade/trades.env';
const stateFile='/var/lib/globaldroptrade/new-deployer-testnet-automation-v1/journal.json';
const policyFile='/var/lib/globaldroptrade/new-deployer-testnet-automation-v1/daily-policy.json';
const backupDir='/var/backups/globaldroptrade';
const vault='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
const publicFallbacks=[
 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
 'https://data-seed-prebsc-2-s1.bnbchain.org:8545',
 'https://bsc-testnet-rpc.publicnode.com'
];
const sig=new Interface(['function dailyTargetBps(address) view returns(uint16)']);
const fail=reason=>{throw Error(reason);};

function privateFile(file){
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==0||(stat.mode&0o077)!==0)fail('RPC_CONFIG_PRIVATE_FILE_REQUIRED');
 return fs.readFileSync(file,'utf8');
}
const isHash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
const checkHex=x=>typeof x==='string'&&/^0x[0-9a-f]+$/i.test(x);

export function makeRpcFallbackEnv(original,fallbacks){
 if(typeof original!=='string'||!Array.isArray(fallbacks)||fallbacks.length<1||fallbacks.length>3||
    fallbacks.some(x=>typeof x!=='string'||x.includes("'")||/[\r\n]/.test(x)))fail('RPC_FALLBACK_SELECTION_INVALID');
 const sanitized=original.split('\n').filter(line=>!/^(?:export\s+)?TRADES_RPC_URLS\s*=/.test(line)).join('\n');
 return sanitized.replace(/\n*$/,'\n')+"TRADES_RPC_URLS='"+JSON.stringify(fallbacks)+"'\n";
}

async function rpc(url,method,params,timeout=7000){
 const response=await fetch(url,{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
  signal:AbortSignal.timeout(timeout)});
 if(!response.ok)throw Error('RPC_HTTP_ERROR');
 const payload=await response.json();
 if(!payload||typeof payload!=='object'||!Object.hasOwn(payload,'result')||
  Object.hasOwn(payload,'error'))throw Error('RPC_INVALID_RESULT');
 return payload.result;
}

export async function verifyRpcFallback(url,{runtimeHash,deploymentBlock,checkpointBlock,checkpointHash,probe=rpc}){
 if(typeof url!=='string'||!['http:','https:'].includes(new URL(url).protocol))fail('RPC_FALLBACK_URL_INVALID');
 const chain=await probe(url,'eth_chainId',[]);
 if(chain!=='0x61')return {recent:false,archive:false,reason:'WRONG_CHAIN'};
 const headText=await probe(url,'eth_blockNumber',[]);
 if(!checkHex(headText))return {recent:false,archive:false,reason:'INVALID_HEAD'};
 const head=Number(BigInt(headText));
 if(!Number.isSafeInteger(head)||head<deploymentBlock+3)return {recent:false,archive:false,reason:'HEAD_BEHIND'};
 const checkpoint=await probe(url,'eth_getBlockByNumber',['0x'+checkpointBlock.toString(16),false]);
 if(!checkpoint||checkpoint.hash?.toLowerCase()!==checkpointHash.toLowerCase())
  return {recent:false,archive:false,reason:'CHECKPOINT_MISMATCH'};
 const recentCode=await probe(url,'eth_getCode',[vault,'latest']);
 if(!/^0x(?:[0-9a-f]{2})+$/i.test(recentCode||'')||
  keccak256(recentCode).toLowerCase()!==runtimeHash.toLowerCase())
  return {recent:false,archive:false,reason:'RUNTIME_MISMATCH'};
 const logBlock=head-3;
 const logs=await probe(url,'eth_getLogs',[{address:vault,fromBlock:'0x'+logBlock.toString(16),toBlock:'0x'+logBlock.toString(16)}]);
 if(!Array.isArray(logs))return {recent:false,archive:false,reason:'LOGS_UNAVAILABLE'};
 let archive=false;
 try{
  const old='0x'+deploymentBlock.toString(16);
  const oldCode=await probe(url,'eth_getCode',[vault,old]);
  if(keccak256(oldCode).toLowerCase()===runtimeHash.toLowerCase()){
   const data=sig.encodeFunctionData('dailyTargetBps',['0x0000000000000000000000000000000000000001']);
   const response=await probe(url,'eth_call',[{to:vault,data},old]);
   archive=typeof response==='string'&&/^0x[0-9a-f]+$/i.test(response);
  }
 }catch{}
 return {recent:true,archive,reason:archive?'FULL_HISTORY_VERIFIED':'RECENT_READS_ONLY'};
}

export async function selectRpcFallbacks({config,runtimeHash,deploymentBlock,checkpointBlock,checkpointHash,probe=rpc,report=()=>{}}){
 if(config?.chainId!==97||getAddress(config.address)!==getAddress(vault))fail('RPC_FALLBACK_TESTNET_ONLY');
 const candidates=[...new Set([...(config.rpcUrls||[]).slice(1),...publicFallbacks])]
  .filter(url=>url!==config.rpcUrl);
 const responses=await Promise.all(candidates.map(async(url,index)=>{
  let result;
  try{result=await verifyRpcFallback(url,{runtimeHash,deploymentBlock,checkpointBlock,checkpointHash,probe});}
  catch{result={recent:false,archive:false,reason:'TRANSPORT_OR_RPC_ERROR'};}
  report({candidate:index+1,status:result.reason});
  return {url,...result,index};
 }));
 // Prioritize archive-capable alternatives, retaining candidate order within
 // each capability. A non-archive public node can support recent UI reads,
 // but it is not treated as a replacement for historical reward accounting.
 const selected=responses.filter(x=>x.recent).sort((a,b)=>
  Number(b.archive)-Number(a.archive)||a.index-b.index).slice(0,3);
 return {selected:selected.map(x=>x.url),archives:selected.filter(x=>x.archive).length,
  checked:responses.length};
}

async function main(){
 if(process.getuid?.()!==0||!['--check','--apply'].includes(process.argv[2])||
    process.argv.length!==3)fail('RPC_FALLBACK_ROOT_EXPLICIT_MODE_REQUIRED');
 const original=privateFile(envFile),config=readConfig(parseEnv(original));
 const state=JSON.parse(privateFile(stateFile)),policy=JSON.parse(privateFile(policyFile));
 if(config.chainId!==97||getAddress(config.address)!==getAddress(vault)||
  !config.rpcUrl||state?.identity?.chainId!==97||
  getAddress(state.identity.target)!==getAddress(vault)||
  policy?.chainId!==97||getAddress(policy.vaultAddress)!==getAddress(vault)||
  !isHash(state.identity.runtimeHash)||!Number.isSafeInteger(policy.deploymentBlock)||
  !Number.isSafeInteger(state.daily?.registry?.through)||!isHash(state.daily.registry.hash))
  fail('RPC_FALLBACK_TARGET_AND_JOURNAL_REQUIRED');
 const selected=await selectRpcFallbacks({config,
  runtimeHash:state.identity.runtimeHash,deploymentBlock:policy.deploymentBlock,
  checkpointBlock:state.daily.registry.through,checkpointHash:state.daily.registry.hash,
  report:entry=>console.log('RPC_PROBE '+JSON.stringify(entry))});
 const originalPrimary=config.rpcUrl;
 const next=makeRpcFallbackEnv(original,selected.selected);
 const validated=readConfig(parseEnv(next));
 if(validated.rpcUrl!==originalPrimary||validated.address!==config.address||
  validated.chainId!==97||validated.rpcUrls.length!==selected.selected.length+1)
  fail('RPC_FALLBACK_ENV_REVIEW_REQUIRED');
 console.log('RPC_FALLBACK_CHECKED '+JSON.stringify({configuredAlternatives:selected.selected.length,
  archiveCapableAlternatives:selected.archives,primaryPreserved:true,
  chainId:97,transactionsSent:0}));
 if(process.argv[2]==='--check')return;
 const parent=fs.lstatSync(path.dirname(envFile));
 if(!parent.isDirectory()||parent.uid!==0||parent.mode&0o022)fail('RPC_FALLBACK_DIRECTORY_UNSAFE');
 if(privateFile(envFile)!==original)fail('RPC_FALLBACK_ENV_CHANGED');
 fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
 const backupStat=fs.lstatSync(backupDir);
 if(!backupStat.isDirectory()||backupStat.isSymbolicLink()||backupStat.uid!==0||
  (backupStat.mode&0o022)!==0)fail('RPC_FALLBACK_BACKUP_DIRECTORY_UNSAFE');
 const stamp=new Date().toISOString().replace(/[-:.]/g,'').replace('T','-').replace('Z','');
 const backup=path.join(backupDir,'rpc-fallback-'+stamp+'-'+process.pid+'.env');
 const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW;
 function writeSecure(file,bytes){
  const fd=fs.openSync(file,flags,0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }
 writeSecure(backup,original);
 const temp=envFile+'.'+process.pid+'.new';
 try{
  writeSecure(temp,next);
  if(privateFile(envFile)!==original)fail('RPC_FALLBACK_ENV_CHANGED');
  fs.renameSync(temp,envFile);
 }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 console.log('RPC_FALLBACK_CONFIG_INSTALLED '+JSON.stringify({
  chainId:97,primaryPreserved:true,alternatives:selected.selected.length,
  archiveCapableAlternatives:selected.archives,backupPath:backup,
  apiRestartRequired:true,workerUnchanged:true,transactionsSent:0
 }));
}
let invoked;
try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;}catch{}
if(import.meta.url===invoked)main().catch(error=>{
 console.error(/^RPC_FALLBACK_[A-Z0-9_]+$/.test(error?.message||'')?
  error.message:'RPC_FALLBACK_VALIDATION_FAILED');
 process.exitCode=1;
});
