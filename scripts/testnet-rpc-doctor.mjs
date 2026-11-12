// Verify BNB Testnet archive RPC candidates without ever reading a signing key.
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {Interface,getAddress} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {withVerifiedDiagnosticRpc} from './new-user-diagnostic-rpc.mjs';
import {blockAtTime} from './daily-profit.mjs';

const oldVault='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
const privateEnv='/etc/globaldroptrade/trades.env';
const statePath='/var/lib/globaldroptrade/new-deployer-testnet-automation-v1/journal.json';
const topic=new Interface(['event Registered(address indexed user,address indexed referrer)']).getEvent('Registered').topicHash;
async function main(){
 if(process.getuid?.()!==0||process.argv.length!==2)throw Error('NEW_USER_RPC_DOCTOR_ROOT_REQUIRED');
 const config=readConfig(parseEnv(fs.readFileSync(privateEnv,'utf8')));
 const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
 if(config.chainId!==97||getAddress(config.address)!==getAddress(oldVault)||
  state?.identity?.chainId!==97||getAddress(state.identity.target)!==getAddress(oldVault))
  throw Error('NEW_USER_RPC_DOCTOR_TARGET_CHANGED');
 // Journal identity has a deployment hash but not necessarily the deployment block.
 // Use the signed daily policy's deployment block, never an assumed height.
 const policy=JSON.parse(fs.readFileSync('/var/lib/globaldroptrade/new-deployer-testnet-automation-v1/daily-policy.json','utf8'));
 const block=policy.deploymentBlock;
 if(!Number.isSafeInteger(block)||block<1||!/^0x[0-9a-f]{64}$/i.test(state.identity.runtimeHash||''))
  throw Error('NEW_USER_RPC_DOCTOR_POLICY_REQUIRED');
 const attempts=[];
 const result=await withVerifiedDiagnosticRpc({
  config,expectedVault:oldVault,runtimeHash:state.identity.runtimeHash,deploymentBlock:block,
  onAttempt:entry=>{attempts.push(entry);console.log('RPC_CHECK '+JSON.stringify(entry));},
  read:async(provider,head)=>{
   const recent=Math.max(block,head.number-2);
   const proof=await provider.getLogs({address:oldVault,topics:[topic],fromBlock:recent,toBlock:head.number});
   if(!Array.isArray(proof))throw Error('HISTORICAL_LOG_RESPONSE_INVALID');
   const newest=Object.values(state.daily?.positionIndex?.positions||{}).sort((a,b)=>b.openedAt-a.openedAt)[0];
   if(newest?.openedAt)await blockAtTime(provider,newest.openedAt,block,head.number);
   return {chainId:97,confirmedBlock:head.number,archiveCodeVerified:true,
    recentLogsReadable:true,latestPositionHistoricalBlockReadable:Boolean(newest?.openedAt),
    signerOpened:false,transactionsSent:0};
  }
 });
 console.log('NEW_USER_ARCHIVE_RPC_READY '+JSON.stringify({candidate:result.usedCandidate,...result.output}));
}
let invoked;
try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;}catch{}
if(import.meta.url===invoked)main().catch(error=>{
 const name=String(error?.message||'');
 console.error(name.startsWith('NEW_USER_')?name:'NEW_USER_RPC_DOCTOR_REVIEW_REQUIRED');
 if(Array.isArray(error?.statuses))console.error('RPC_CHECK_SUMMARY '+JSON.stringify(error.statuses));
 process.exitCode=1;
});
