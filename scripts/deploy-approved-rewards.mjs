import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,JsonRpcProvider,Wallet,ZeroAddress,getAddress,keccak256} from 'ethers';
import {deployFreshRewards} from './deploy-fresh-rewards.mjs';
import {readPrivateKey} from './migration-signers.mjs';
import {writePrivateJson} from './migration-journal.mjs';

export const approvedRelease={
 chainId:97,
 source:'0x731Ba0644e8f44BbBd48124F945724ba534431eb',
 sourceRuntimeHash:'0x6efe9551ee99d12a8e8db4844a06ae6e66e79fc424b0cfca426e2528ff2f69b6',
 owner:'0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632',
 deployer:'0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2',
 artifactHash:'0x715abdf6424a7100d572984070dbc29cfc11349e6cc35f85827ffc2e37fe29b6'
};
const queueAbi=['function vault() view returns(address)','function APPROVAL_VERSION() view returns(uint256)','function requestCount() view returns(uint256)','function pending(address) view returns(uint256)'];

// Deploy a separate, empty candidate. Never pause, copy, withdraw from or switch the source.
export async function deployApprovedRewards({provider,wallet,source,owner,artifact,expectedSourceHash,state,save,confirmations=3,log=()=>{}}){
 owner=getAddress(owner);
 const sourceAddress=getAddress(await source.getAddress());
 const bytecode=artifact.bytecode||'0x'+artifact.evm.bytecode.object;
 if(keccak256(bytecode)!==approvedRelease.artifactHash)throw Error('APPROVAL_ARTIFACT_MISMATCH');
 if(!/^0x[0-9a-f]{64}$/i.test(expectedSourceHash||''))throw Error('SOURCE_RUNTIME_HASH_REQUIRED');
 const identity={version:1,chainId:97,source:sourceAddress,sourceRuntimeHash:expectedSourceHash,owner,deployer:getAddress(wallet.address),artifactHash:keccak256(bytecode)};
 if(state.identity&&JSON.stringify(state.identity)!==JSON.stringify(identity))throw Error('CANDIDATE_JOURNAL_IDENTITY_MISMATCH');
 if(!state.identity&&Object.keys(state.transactions||{}).length)throw Error('UNBOUND_CANDIDATE_JOURNAL');
 const verifySource=async()=>{
  if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
  const block=await provider.getBlock('latest'),options={blockTag:block.number};
  if(keccak256(await provider.getCode(sourceAddress,block.number))!==expectedSourceHash)throw Error('SOURCE_RUNTIME_CHANGED');
  if(getAddress(await source.owner(options))!==owner)throw Error('SOURCE_OWNER_CHANGED');
 };
 await verifySource();
 if(!state.identity){state.identity=identity;save();}
 const result=await deployFreshRewards({provider,wallet,source,owner,artifact:{...artifact,bytecode},state,save,confirmations,log,verifySource});
 const vault=new Contract(result.contractAddress,artifact.abi,provider),options={blockTag:result.block};
 const queue=new Contract(result.queue,queueAbi,provider);
 if(await queue.APPROVAL_VERSION(options)!==1n||getAddress(await queue.vault(options))!==getAddress(result.contractAddress))throw Error('APPROVAL_QUEUE_VERIFY_FAILED');
 if(await queue.requestCount(options)!==0n)throw Error('CANDIDATE_QUEUE_NOT_EMPTY');
 for(const asset of [ZeroAddress,result.config.token]){
  if(await queue.pending(asset,options)!==0n||await vault.assetBalance(asset,options)!==0n)throw Error('CANDIDATE_NOT_EMPTY');
 }
 const transaction=await provider.getTransaction(result.hash);
 if(!transaction||transaction.to!==null||getAddress(transaction.from)!==identity.deployer||transaction.chainId!==97n||transaction.value!==0n)throw Error('CANDIDATE_TRANSACTION_MISMATCH');
 if((await provider.getBlock(result.block))?.hash!==result.blockHash)throw Error('CANDIDATE_REORG');
 return {...result,kind:'approval-enabled-empty-candidate',approvalVersion:1,artifactHash:identity.artifactHash,sourceRuntimeHash:expectedSourceHash,accountsMigrated:false,siteConnected:false,cutoverAllowed:false};
}

function privateFile(file){
 if(!fs.existsSync(file))return;
 const s=fs.lstatSync(file);
 if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_REGULAR_STATE_FILE_REQUIRED');
}

async function main(){
 let provider;
 try{
  if(!process.argv.includes('--execute'))throw Error('EXPLICIT_EXECUTE_FLAG_REQUIRED');
  if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
  if(process.env.TRADES_CHAIN_ID!=='97'||getAddress(process.env.TRADES_VAULT_ADDRESS||ZeroAddress)!==approvedRelease.source||!process.env.TRADES_RPC_URL)throw Error('ACTIVE_TESTNET_SOURCE_REQUIRED');
  const key=readPrivateKey('/etc/globaldroptrade/migration-deployer.key')||readPrivateKey('/root/global-testnet-v071/.testnet-server/deployer.key');
  if(!key)throw Error('DEPLOYER_KEY_NOT_FOUND');
  const request=new FetchRequest(process.env.TRADES_RPC_URL);request.timeout=20000;
  provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  const wallet=new Wallet(key,provider);
  if(wallet.address!==approvedRelease.deployer)throw Error('EXPECTED_DEPLOYER_KEY_REQUIRED');
  const directory='/var/lib/globaldroptrade/approved-rewards-v1';
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const s=fs.lstatSync(directory);
  if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_STATE_DIRECTORY_REQUIRED');
  const journal=path.join(directory,'journal.json'),reportFile=path.join(directory,'deployment-public.json');
  privateFile(journal);privateFile(reportFile);
  const state=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal,'utf8')):{transactions:{}};
  const artifact=JSON.parse(fs.readFileSync(new URL('../artifacts/DeferredRewardsVault.json',import.meta.url)));
  const source=new Contract(approvedRelease.source,artifact.abi,provider);
  const report=await deployApprovedRewards({provider,wallet,source,owner:approvedRelease.owner,artifact,expectedSourceHash:approvedRelease.sourceRuntimeHash,state,save:()=>writePrivateJson(journal,state),log:console.log});
  writePrivateJson(reportFile,report);
  console.log('APPROVAL_CONTRACT_DEPLOYED_AND_VERIFIED');
  console.log('NEW_CONTRACT='+report.contractAddress);console.log('WITHDRAWAL_QUEUE='+report.queue);console.log('TX_HASH='+report.hash);console.log('OWNER='+report.owner);
  console.log('REPORT='+reportFile);
  console.log('ACCOUNTS_MIGRATED=false SITE_CONNECTED=false AUTOMATION_ACTIVE=false');
  console.log('Existing accounts and pending withdrawals require a separate verified transition before site cutover.');
 }catch(e){
  console.error('APPROVED_DEPLOY_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message||'')?e.message:'RPC_OR_VERIFICATION_FAILED'));
  console.error('Keep the journal and rerun the same command to resume. Do not run the legacy fresh deployment installer.');
  process.exitCode=1;
 }finally{provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
