import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,JsonRpcProvider,Wallet,keccak256,parseEther} from 'ethers';
import {journalTransaction,writePrivateJson} from './migration-journal.mjs';
import {readPrivateKey} from './migration-signers.mjs';
import {inspectLegacyJournals,loadArchivedLegacySession,loadNewDeployerArtifact,newDeployerRequest,parseNewDeployerRpc,verifyLegacyJournalReceipts} from './deploy-new-deployer-testnet.mjs';
import {loadNewDeployerRelease,NEW_DEPLOYER_KEY_FILE,NEW_DEPLOYER_STATE_DIR} from './new-deployer-testnet-profile.mjs';

const mockRuntimeHash='0x21bc8d5f1bdbb96b6f4758942e2b5327846170e996c79bd4830c09fcbd3877b8';
const abi=['function decimals() view returns(uint8)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)','function set(int256,uint256,uint80,uint80)'];
const fail=code=>{throw Error(code);};
const privateRead=file=>{
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0||s.size>4*1024*1024)fail('ORACLE_PRIVATE_FILE_REQUIRED');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
};

export async function assertRefreshBudget({provider,wallet,request,deployment,state}){
 const [fees,refreshGas,deployGas,balance]=await Promise.all([
  provider.getFeeData(),provider.estimateGas({...request,from:wallet.address}),
  provider.estimateGas({...deployment,from:wallet.address}),provider.getBalance(wallet.address)
 ]);
 if(!fees.gasPrice||fees.gasPrice<=0n)fail('ORACLE_GAS_PRICE_REQUIRED');
 const refreshFee=refreshGas*120n/100n*fees.gasPrice,deployFee=deployGas*120n/100n*fees.gasPrice;
 const reserved=Object.values(state.transactions).reduce((n,t)=>n+BigInt(t.maxFee),0n);
 if(reserved+refreshFee+deployFee>parseEther('0.1')||balance<refreshFee+deployFee)fail('ORACLE_AND_DEPLOY_FEE_BUDGET_REQUIRED');
}

export async function refreshNewDeployerOracles({provider,wallet,release,state,save,guard=async()=>{},budgetGuard=async()=>{},journal=journalTransaction,confirmations=3}){
 if(Number(await provider.send('eth_chainId',[]))!==97||wallet.address!==release.deployer)fail('ORACLE_TESTNET_IDENTITY_REQUIRED');
 if(!state||!state.transactions||typeof state.transactions!=='object'||!state.plans||typeof state.plans!=='object')fail('ORACLE_JOURNAL_REQUIRED');
 const feeds=[release.bnbFeed,release.tokenFeed];
 const identity={version:1,chainId:97,deployer:release.deployer,feeds,artifactHash:mockRuntimeHash};
 if(state.identity&&JSON.stringify(state.identity)!==JSON.stringify(identity))fail('ORACLE_JOURNAL_IDENTITY_CHANGED');
 if(!state.identity){if(Object.keys(state.transactions).length||Object.keys(state.plans).length)fail('ORACLE_UNBOUND_JOURNAL');state.identity=identity;save();}
 await guard();
 const initialBlock=await provider.getBlock('latest');
 if(!initialBlock)fail('ORACLE_DATA_INVALID');
 for(const address of feeds){
  const feed=new Contract(address,abi,provider);
  if(keccak256(await provider.getCode(address))!==mockRuntimeHash)fail('ORACLE_TESTNET_MOCK_REQUIRED');
  const [d,r]=await Promise.all([feed.decimals(),feed.latestRoundData()]);
  if(d!==8n||r[0]===0n||r[1]<=0n||r[3]===0n||r[3]>BigInt(initialBlock.timestamp)||r[4]<r[0]||r[0]>=2n**80n-1n)fail('ORACLE_DATA_INVALID');
 }
 const results=[];
 for(let index=0;index<feeds.length;index++){
  const address=feeds[index],label='testnet-oracle-'+index,feed=new Contract(address,abi,provider);
  const checkBase=async()=>{
   await guard();
   if(Number(await provider.send('eth_chainId',[]))!==97||keccak256(await provider.getCode(address))!==mockRuntimeHash)fail('ORACLE_TESTNET_MOCK_REQUIRED');
  };
  await checkBase();
  let plan=state.plans[label];
  if(!plan){
   const block=await provider.getBlock('latest');const [d,round]=await Promise.all([feed.decimals(),feed.latestRoundData()]);
   const [r,answer,,updated,answered]=round;
   if(!block||d!==8n||r===0n||answer<=0n||updated===0n||updated>BigInt(block.timestamp)||answered<r||r>=2n**80n-1n)fail('ORACLE_DATA_INVALID');
   if(BigInt(block.timestamp)-updated<=BigInt(release.age)){results.push({address,status:'fresh'});continue;}
   plan={address,answer:answer.toString(),round:r.toString(),updated:updated.toString(),answered:answered.toString(),timestamp:String(block.timestamp),nextRound:String(r+1n)};
   state.plans[label]=plan;save();
  }
  if(plan.address!==address||!/^\d+$/.test(plan.answer)||!/^\d+$/.test(plan.round)||!/^\d+$/.test(plan.updated)||!/^\d+$/.test(plan.answered)||!/^\d+$/.test(plan.timestamp)||BigInt(plan.nextRound)!==BigInt(plan.round)+1n)fail('ORACLE_JOURNAL_PLAN_INVALID');
  const request=await feed.set.populateTransaction(BigInt(plan.answer),BigInt(plan.timestamp),BigInt(plan.nextRound),BigInt(plan.nextRound));
  const verifyUnchanged=async()=>{
   await checkBase();
   const entry=state.transactions[label];
   if(entry&&await provider.getTransactionReceipt(entry.hash))return;
   const round=await feed.latestRoundData();
   if(round[0].toString()!==plan.round||round[1].toString()!==plan.answer||round[3].toString()!==plan.updated||round[4].toString()!==plan.answered)fail('ORACLE_CHANGED_REVIEW_REQUIRED');
   if(!entry){
    const block=await provider.getBlock('latest');
    if(!block||BigInt(plan.timestamp)>BigInt(block.timestamp)||BigInt(block.timestamp)-BigInt(plan.timestamp)>BigInt(release.age)/2n)fail('ORACLE_SAVED_PLAN_STALE_REVIEW_REQUIRED');
    await budgetGuard(request,state);
   }
  };
  const receipt=await journal({provider,wallet,state,save,label,request,guard:verifyUnchanged,confirmations,maxTotalFee:parseEther('0.002')});
  const [round,block]=await Promise.all([feed.latestRoundData(),provider.getBlock('latest')]);
  if(!block||round[1]!==BigInt(plan.answer)||round[0]<BigInt(plan.nextRound)||round[3]===0n||round[3]>BigInt(block.timestamp)||BigInt(block.timestamp)-round[3]>BigInt(release.age)||round[4]<round[0])fail('ORACLE_POSTCHECK_REQUIRED');
  results.push({address,status:'refreshed',hash:receipt.hash});
 }
 return results;
}

async function main(){
 let provider;
 try{
  if(process.getuid?.()!==0||process.argv.length!==3||process.argv[2]!=='--execute')fail('ORACLE_EXPLICIT_EXECUTE_REQUIRED');
  const release=loadNewDeployerRelease(),archive=loadArchivedLegacySession(),legacy=inspectLegacyJournals();
  const stateDir=NEW_DEPLOYER_STATE_DIR,stat=fs.lstatSync(stateDir);
  if(!stat.isDirectory()||stat.uid!==0||(stat.mode&0o077)!==0)fail('ORACLE_PRIVATE_DIRECTORY_REQUIRED');
  const file=path.join(stateDir,'predeploy-oracles-journal.json');
  let state=fs.existsSync(file)?JSON.parse(privateRead(file)):{transactions:{},plans:{}};
  const request=new FetchRequest(parseNewDeployerRpc(privateRead('/etc/globaldroptrade/trades.env')));request.timeout=20000;
  provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=2000;
  const key=readPrivateKey(NEW_DEPLOYER_KEY_FILE);let wallet;
  try{wallet=new Wallet(key,provider);}catch{fail('ORACLE_SIGNER_REQUIRED');}
  if(wallet.address!==release.deployer)fail('ORACLE_SIGNER_REQUIRED');
  const guard=async()=>{
   if(loadArchivedLegacySession().sha256!==archive.sha256)fail('ORACLE_ARCHIVE_CHANGED');
   const current=inspectLegacyJournals();if(current.digest!==legacy.digest)fail('ORACLE_LEGACY_JOURNAL_CHANGED');
   await verifyLegacyJournalReceipts(provider,current);
   const deployJournal=path.join(stateDir,'journal.json');
   if(fs.existsSync(deployJournal))fail('ORACLE_DEPLOY_JOURNAL_REVIEW_REQUIRED');
  };
  const artifact=loadNewDeployerArtifact(),deployment=await newDeployerRequest({artifact,release});
  const budgetGuard=(request,state)=>assertRefreshBudget({provider,wallet,request,deployment,state});
  const save=()=>writePrivateJson(file,state);
  const result=await refreshNewDeployerOracles({provider,wallet,release,state,save,guard,budgetGuard});
  console.log('NEW_DEPLOYER_ORACLES_READY '+JSON.stringify(result));
 }catch(error){const code=/^[A-Z][A-Z0-9_]+$/.test(error?.message||'')?error.message:'CHECK_REQUIRED';console.error('ORACLE_REFRESH_STOPPED '+code);process.exitCode=1;}finally{provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();
