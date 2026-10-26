import fs from 'node:fs';
import {Contract,FetchRequest,JsonRpcProvider,Wallet,keccak256} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {readPrivateKey} from './migration-signers.mjs';
import {writePrivateJson} from './migration-journal.mjs';
import {dailyAbi,approvedQueueAbi,validateDailyPolicy} from './daily-profit.mjs';
const config=readConfig();if(config.chainId!==97||!config.address||!config.rpcUrl)throw Error('AUTOMATION_TESTNET_CONFIGURATION_REQUIRED');
const request=new FetchRequest(config.rpcUrl);request.timeout=15000;
const provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});
try{
 if(Number((await provider.getNetwork()).chainId)!==97)throw Error('TESTNET_ONLY');
 const code=await provider.getCode(config.address);if(code==='0x')throw Error('CONTRACT_MISSING');
 const vault=new Contract(config.address,dailyAbi,provider),queue=new Contract(await vault.withdrawalQueue(),approvedQueueAbi,provider);
 if(await queue.APPROVAL_VERSION()!==1n||(await queue.vault()).toLowerCase()!==config.address.toLowerCase())throw Error('NEW_APPROVAL_CONTRACT_REQUIRED');
 const key=readPrivateKey('/etc/globaldroptrade/automation.key');if(!key)throw Error('AUTOMATION_SIGNER_REQUIRED');
 if(!await vault.reporters(new Wallet(key).address))throw Error('AUTOMATION_SIGNER_IS_NOT_REPORTER');
 const file='/etc/globaldroptrade/daily-policy.json';
 if(fs.existsSync(file)){
  const p=validateDailyPolicy(JSON.parse(fs.readFileSync(file,'utf8')));
  if(p.chainId!==97||p.vaultAddress.toLowerCase()!==config.address.toLowerCase()||p.runtimeHash!==keccak256(code))throw Error('EXISTING_POLICY_TARGET_MISMATCH');
 }else{
  let low=0,high=await provider.getBlockNumber();const latest=await provider.getBlock(high);
  // Migration deployments expose their immutable creation block; no genesis-state binary search is needed.
  let copiedBlock;
  try{copiedBlock=Number(await new Contract(config.address,['function migrationBlock() view returns(uint256)'],provider).migrationBlock());}catch{}
  if(copiedBlock!==undefined){if(!Number.isSafeInteger(copiedBlock)||copiedBlock<1||copiedBlock>high)throw Error('INVALID_MIGRATION_BLOCK');low=copiedBlock;}
  else while(low<high){const mid=Math.floor((low+high)/2);if(await provider.getCode(config.address,mid)==='0x')low=mid+1;else high=mid;}
  const policy=validateDailyPolicy({version:1,chainId:97,vaultAddress:config.address,runtimeHash:keccak256(code),deploymentBlock:low,startTimestamp:latest.timestamp,basis:'period-start-active-principal',periodSeconds:86400,includeReinvestment:true});
  writePrivateJson(file,policy);
 }
 console.log('DAILY_PLAN_AND_APPROVAL_AUTOMATION_CONFIGURED');
}catch(e){console.error('AUTOMATION_SETUP_STOPPED '+(/^[A-Z][A-Z0-9_]+$/.test(e.message||'')?e.message:'RPC_OR_VALIDATION_FAILED'));process.exitCode=1;}finally{provider.destroy();}
