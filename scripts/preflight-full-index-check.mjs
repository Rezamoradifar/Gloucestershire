// Read-only latency measurement; does not open a signer or acquire a lock.
import {parseEnv} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FetchRequest,JsonRpcProvider,keccak256} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {assertZeroStartJournalCanonical} from './zero-start-automation.mjs';
import {readNewDeployerPrivateText,readImmutableV1Archive,assertImmutableV1Archive} from './connect-new-deployer-testnet.mjs';

const expected='0x4c0f6141b18971db4b14e45c0be8cddb09febc14';
const stateDir='/var/lib/globaldroptrade/new-deployer-testnet-automation-v1';
const vaultDir='/var/lib/globaldroptrade/new-deployer-testnet-v1';
const envFile='/etc/globaldroptrade/trades.env';
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const fail=code=>{throw Error(code);};

export function reviewFinancialRows(state){
 if(!state||!state.daily||!state.transactions||typeof state.transactions!=='object'||Array.isArray(state.transactions)||
  (state.oracle&&(typeof state.oracle!=='object'||Array.isArray(state.oracle))))fail('FULL_INDEX_INVALID_JOURNAL');
 const rows=Object.values(state.transactions),pending=Boolean(state.pending||state.oracle?.pending||Object.hasOwn(state.daily,'pendingDailyPlan'));
 if(rows.some(row=>!row||!Number.isSafeInteger(row.block)||row.block<1||!hash(row.hash)||!hash(row.blockHash)))fail('FULL_INDEX_UNSETTLED_OR_INVALID_JOURNAL');
 if(pending)fail('FULL_INDEX_PENDING_FINANCIAL_STATE');
 return {entries:rows.length,distinctBlocks:new Set(rows.map(row=>row.block)).size};
}

export async function measureFullChecks({provider,state,readArchive,verifyArchive,readInputs,canonical=assertZeroStartJournalCanonical,clock=()=>Number(process.hrtime.bigint()/1000000n),timeoutMs=45000}){
 const rows=reviewFinancialRows(state);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>45000)fail('FULL_INDEX_INVALID_TIMEOUT');
 const input=readInputs(),startArchive=clock(),archive=readArchive(),archiveReadMs=clock()-startArchive;
 const startGuard=clock();readInputs();verifyArchive(archive);const archiveGuardMs=clock()-startGuard;
 let timer;
 const start=clock();
 try{
  await Promise.race([canonical(provider,state),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('FULL_INDEX_CANONICAL_TIMEOUT')),timeoutMs);})]);
 }finally{clearTimeout(timer);}
 const canonicalMs=clock()-start;
 const secondGuardStart=clock();const current=readInputs();verifyArchive(archive);const secondArchiveGuardMs=clock()-secondGuardStart;
 return {...rows,canonicalVerified:true,archiveVerified:true,journalAndInputsUnchanged:current===input,archiveReadMs,archiveGuardMs,secondArchiveGuardMs,canonicalMs};
}

async function main(){
 let provider;
 try{
  if(process.getuid?.()!==0||process.argv.length!==3||process.argv[2]!=='--check')fail('FULL_INDEX_EXPLICIT_ROOT_CHECK_REQUIRED');
  const files=[envFile,stateDir+'/journal.json',stateDir+'/daily-policy.json',vaultDir+'/deployment-public.json',vaultDir+'/connection-public.json'];
  const inputs=()=>JSON.stringify(files.map(file=>readNewDeployerPrivateText(file)));
  const first=inputs(),[environment,journalText,policyText,deploymentText]=JSON.parse(first),config=readConfig(parseEnv(environment));
  const state=JSON.parse(journalText),policy=JSON.parse(policyText),deployment=JSON.parse(deploymentText);
  if(config.chainId!==97||String(config.address).toLowerCase()!==expected||state.identity?.chainId!==97||String(state.identity?.target).toLowerCase()!==expected||
   policy.chainId!==97||String(policy.vaultAddress).toLowerCase()!==expected||deployment.chainId!==97||deployment.verified!==true||String(deployment.contractAddress).toLowerCase()!==expected||!hash(deployment.runtimeHash)||
   String(state.identity?.runtimeHash).toLowerCase()!==deployment.runtimeHash.toLowerCase()||String(policy.runtimeHash).toLowerCase()!==deployment.runtimeHash.toLowerCase())fail('FULL_INDEX_TARGET_MISMATCH');
  const request=new FetchRequest(config.rpcUrl);request.timeout=8000;
  provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  const [chain,head,runtime]=await Promise.all([provider.send('eth_chainId',[]),provider.getBlockNumber(),provider.getCode(config.address)]);
  if(Number(chain)!==97||!Number.isSafeInteger(head)||runtime==='0x'||keccak256(runtime).toLowerCase()!==deployment.runtimeHash.toLowerCase())fail('FULL_INDEX_LIVE_TARGET_MISMATCH');
  if(inputs()!==first)fail('FULL_INDEX_INPUT_CHANGED');
  const result=await measureFullChecks({provider,state,readArchive:readImmutableV1Archive,verifyArchive:assertImmutableV1Archive,readInputs:inputs});
  if(inputs()!==first||!result.journalAndInputsUnchanged)fail('FULL_INDEX_INPUT_CHANGED');
  console.log('INDEX_FULL_READ_ONLY_PROBE '+JSON.stringify({sampledAt:new Date().toISOString(),chainId:97,confirmedHead:head-Math.max(3,config.confirmations),runtimeMatches:true,...result,signerOpened:false,transactionsSent:0,journalWritten:false,lockAcquired:false},null,2));
 }catch(error){console.error('INDEX_FULL_PROBE_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message||'')?error.message:'RPC_OR_STATE_REVIEW_REQUIRED'));process.exitCode=1;}
 finally{provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
