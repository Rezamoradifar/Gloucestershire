// Explicit production activation only. No testnet environment/key fallback.
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,JsonRpcProvider,Wallet,getAddress,getCreateAddress,keccak256,parseEther} from 'ethers';
import {planMainnet,readMainnetPreparationRpc} from './server-mainnet.mjs';
import {validateDailyPolicy,blockAtTime} from './daily-profit.mjs';
import {writePrivateJson} from './migration-journal.mjs';
import {readPrivateKey} from './migration-signers.mjs';
import {runProductionAutomation,productionGuard,productionBinding,verifyProductionJournalAnchor} from './production-automation.mjs';
import {journalMainnetTransaction,validateMainnetJournal} from './mainnet-automation-journal.mjs';
const root='/var/lib/globaldroptrade/mainnet-automation-v1';
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
function privateText(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o777)!==0o600||s.size>16*1024*1024)throw Error('PRODUCTION_PRIVATE_INPUT_REQUIRED');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
}
export function validateProductionActivation(m){
 if(m?.version!==1||m.chainId!==56||!['primary','standby'].includes(m.role)||!hash(m.deploymentTxHash)||!Array.isArray(m.rpcFiles)||m.rpcFiles.length<1||m.rpcFiles.length>3||m.rpcFiles.some(p=>typeof p!=='string'||!path.isAbsolute(p))||new Set(m.rpcFiles).size!==m.rpcFiles.length||!/^[1-9][0-9]{0,19}$/.test(m.gasBudgetWei||'')||BigInt(m.gasBudgetWei)>parseEther('0.1'))throw Error('PRODUCTION_ACTIVATION_REQUIRED');
 const policy=validateDailyPolicy(m.policy);
 if(policy.chainId!==56||policy.periodSeconds!==86400||policy.basis!=='period-start-active-principal')throw Error('PRODUCTION_24H_POLICY_REQUIRED');
 const operator=getAddress(m.operator),deployer=getAddress(m.deployer),queueAddress=getAddress(m.queueAddress);
 if([operator,deployer,queueAddress].some(x=>x==='0x'+'0'.repeat(40))||m.role==='primary'&&!/^[0-9a-f]{32}$/.test(m.executionMachineId||''))throw Error('PRODUCTION_EXECUTION_HOST_REQUIRED');
 return {...m,operator,deployer,queueAddress,policy};
}
export async function verifyProductionDeployment({provider,activation,artifact,config,state}){
 const m=validateProductionActivation(activation),plan=await planMainnet(config,artifact);
 if(m.operator===plan.config.initialOwner)throw Error('PRODUCTION_DEDICATED_OPERATOR_REQUIRED');
 if(Number(await provider.send('eth_chainId',[]))!==56)throw Error('MAINNET_CHAIN_56_REQUIRED');
 const [tx,r,head]=await Promise.all([provider.getTransaction(m.deploymentTxHash),provider.getTransactionReceipt(m.deploymentTxHash),provider.getBlockNumber()]);
 if(!tx||!r||r.status!==1||tx.hash!==m.deploymentTxHash||r.hash!==m.deploymentTxHash||tx.to!==null||r.to!==null||getAddress(tx.from)!==m.deployer||getAddress(r.from)!==m.deployer||tx.chainId!==56n||tx.value!==0n||tx.data.toLowerCase()!==plan.request.data.toLowerCase()||r.blockNumber!==m.policy.deploymentBlock||tx.blockHash!==r.blockHash||tx.blockNumber!==r.blockNumber||!Number.isSafeInteger(head)||head-r.blockNumber+1<3||getAddress(r.contractAddress)!==m.policy.vaultAddress||getCreateAddress({from:m.deployer,nonce:tx.nonce})!==m.policy.vaultAddress)throw Error('PRODUCTION_CREATION_PROOF_REQUIRED');
 const creationBlock=await provider.getBlock(r.blockNumber);
 if(!creationBlock||!Number.isSafeInteger(creationBlock.timestamp)||m.policy.startTimestamp<creationBlock.timestamp)throw Error('PRODUCTION_POLICY_START_BEFORE_DEPLOYMENT');
 if(creationBlock.hash!==r.blockHash||getCreateAddress({from:m.policy.vaultAddress,nonce:1})!==m.queueAddress)throw Error('PRODUCTION_CREATION_HEADER_OR_QUEUE_MISMATCH');
 const vault=new Contract(m.policy.vaultAddress,artifact.abi,provider),queue=new Contract(m.queueAddress,['function vault() view returns(address)','function APPROVAL_VERSION() view returns(uint256)','function pending(address) view returns(uint256)','function requestCount() view returns(uint256)','function requests(uint256) view returns(address user,address asset,uint256 gross,uint256 fee,uint256 dueAt,uint8 status)','function pay(uint256)'],provider);
 await productionGuard({provider,vault,queue,policy:m.policy,expectedOwner:plan.config.initialOwner});
 if(getAddress(await vault.usdt())!==plan.config.usdt||await vault.AUTO_REWARD_GROUP_VERSION()!==1n||await vault.REWARD_ACCRUAL_VERSION()!==1n)throw Error('PRODUCTION_CONTRACT_VERSION_REQUIRED');
 const final=await provider.getBlock(Math.max(0,head-3)),epoch=state.daily?.epoch??0;
 if(!Number.isSafeInteger(epoch)||epoch<0)throw Error('PRODUCTION_EPOCH_INVALID');
 const start=m.policy.startTimestamp+epoch*86400;
 if(!Number.isSafeInteger(start))throw Error('PRODUCTION_EPOCH_INVALID');
 if(final.timestamp>=start){const historical=await blockAtTime(provider,start,m.policy.deploymentBlock,final.number);await vault.owner({blockTag:historical.number});}
 await verifyProductionJournalAnchor(provider,state);
 return {vault,queue,owner:plan.config.initialOwner,token:plan.config.usdt};
}
async function main(){
 let provider,lockFd,lockIdentity,signerOpened=false,executionStarted=false,journalState,selectedIndex,manifest;
 try{
  const {values}=parseArgs({options:{check:{type:'boolean'},execute:{type:'boolean'},'activation-file':{type:'string'}},strict:true,allowPositionals:false});
  if(process.getuid?.()!==0||Boolean(values.check)===Boolean(values.execute)||!values['activation-file']||!path.isAbsolute(values['activation-file']))throw Error('PRODUCTION_EXPLICIT_ACTION_REQUIRED');
  const file=values['activation-file'],original=privateText(file),m=validateProductionActivation(JSON.parse(original));manifest=m;
  if(values.execute){
   if(m.role!=='primary'||fs.readFileSync('/etc/machine-id','utf8').trim()!==m.executionMachineId)throw Error('PRODUCTION_PRIMARY_HOST_REQUIRED');
   fs.mkdirSync(root,{recursive:true,mode:0o700});const s=fs.lstatSync(root);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o777)!==0o700)throw Error('PRODUCTION_PRIVATE_STATE_REQUIRED');
   lockFd=fs.openSync(root+'/run.lock',fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
   lockIdentity=fs.fstatSync(lockFd);
   execFileSync('python3',['-c','import fcntl;fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)'],{stdio:['ignore','ignore','pipe',lockFd]});
  }
  const journal=root+'/journal.json',state=fs.existsSync(journal)?JSON.parse(privateText(journal)):{transactions:{},daily:{epoch:0}};journalState=state;
  const config=JSON.parse(fs.readFileSync(new URL('../config.mainnet.json',import.meta.url))),artifact=JSON.parse(fs.readFileSync(new URL('../artifacts/AutomaticGroupVault.json',import.meta.url)));
  let verified,selected,index;
  const cursor=Number.isSafeInteger(state.rpcCursor)?state.rpcCursor:0;
  for(let attempt=0;attempt<m.rpcFiles.length;attempt++){
   index=(cursor+attempt)%m.rpcFiles.length;
   try{
    selected=readMainnetPreparationRpc(m.rpcFiles[index]);const request=new FetchRequest(selected.url);request.timeout=15000;
    provider=new JsonRpcProvider(request,56,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=2000;
    verified=await verifyProductionDeployment({provider,activation:m,artifact,config,state});break;
   }catch{await provider?.destroy();provider=undefined;verified=undefined;}
  }
  if(!verified)throw Error('PRODUCTION_NO_VERIFIED_RPC');selectedIndex=index;
  const binding=productionBinding({policy:m.policy,expectedOwner:verified.owner,operator:m.operator,queue:verified.queue});
  if(state.binding&&state.binding!==binding||!state.binding&&Object.keys(state.transactions||{}).length)throw Error('PRODUCTION_JOURNAL_BINDING_CHANGED');
  const saved=validateMainnetJournal({state,operator:m.operator,target:m.policy.vaultAddress,queue:m.queueAddress,token:verified.token,maxTotalFee:BigInt(m.gasBudgetWei)});
  const assertLease=async()=>{
   if(lockFd===undefined||privateText(file)!==original||fs.readFileSync('/etc/machine-id','utf8').trim()!==m.executionMachineId)throw Error('PRODUCTION_EXECUTION_LEASE_LOST');
   const live=fs.lstatSync(root+'/run.lock');if(!live.isFile()||live.ino!==lockIdentity.ino||live.dev!==lockIdentity.dev)throw Error('PRODUCTION_EXECUTION_LEASE_LOST');
   selected.assertCurrent();await productionGuard({provider,...verified,policy:m.policy,expectedOwner:verified.owner});await verifyProductionJournalAnchor(provider,state);
  };
  let transact;
  if(values.execute){
   const key=readPrivateKey('/etc/globaldroptrade/mainnet-automation.key');if(!key)throw Error('PRODUCTION_OPERATOR_KEY_REQUIRED');const wallet=new Wallet(key,provider);signerOpened=true;
   if(wallet.address!==m.operator)throw Error('PRODUCTION_OPERATOR_KEY_MISMATCH');
   const save=()=>writePrivateJson(journal,state);
   transact=(label,request)=>journalMainnetTransaction({provider,wallet,state,save,label,request,guard:assertLease,target:m.policy.vaultAddress,queue:m.queueAddress,token:verified.token,maxTotalFee:BigInt(m.gasBudgetWei)});
   executionStarted=true;
   for(const pending of saved.pending)await transact(pending.label,pending.request);
   verified.vault=verified.vault.connect(wallet);verified.queue=verified.queue.connect(wallet);
  }
  const report=await runProductionAutomation({provider,...verified,policy:m.policy,expectedOwner:verified.owner,operator:m.operator,state,save:()=>writePrivateJson(journal,state),transact,assertLease,role:m.role,execute:Boolean(values.execute)});
  report.feeBudgetRemainingWei=(BigInt(m.gasBudgetWei)-validateMainnetJournal({state,operator:m.operator,target:m.policy.vaultAddress,queue:m.queueAddress,token:verified.token,maxTotalFee:BigInt(m.gasBudgetWei)}).total).toString();report.rpcIndex=index;report.rpcCandidateCount=m.rpcFiles.length;report.writerFailover='manual-promotion-with-synchronized-journal';
  if(m.rpcFiles.length===1)report.warnings.push('RPC_REDUNDANCY_NOT_CONFIGURED');
  if(values.execute){state.rpcCursor=report.status==='waiting'?(index+1)%m.rpcFiles.length:index;writePrivateJson(journal,state);writePrivateJson(root+'/status.json',report);}
  console.log('PRODUCTION_AUTOMATION_'+report.status.toUpperCase().replace(/-/g,'_'));console.log(JSON.stringify(report));
 }catch(e){if(executionStarted&&journalState&&Number.isSafeInteger(selectedIndex)&&manifest){try{journalState.rpcCursor=(selectedIndex+1)%manifest.rpcFiles.length;writePrivateJson(root+'/journal.json',journalState);}catch{}}console.log('PRODUCTION_AUTOMATION_BLOCKED');console.log(JSON.stringify({blocker:/^(?:PRODUCTION|MAINNET)_[A-Z0-9_]+$/.test(e.message||'')?e.message:'PRODUCTION_RPC_OR_STATE_CHECK_FAILED',signerOpened,transactionsSent:executionStarted?null:0,transactionOutcome:executionStarted?'inspect-journal':'no-transaction-sent'}));process.exitCode=1;}
 finally{await provider?.destroy();if(lockFd!==undefined)fs.closeSync(lockFd);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
