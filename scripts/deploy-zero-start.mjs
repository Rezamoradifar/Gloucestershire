import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Contract,ContractFactory,FetchRequest,Interface,JsonRpcProvider,Wallet,ZeroAddress,getAddress,getCreateAddress,keccak256} from 'ethers';
import {readPrivateKey} from './migration-signers.mjs';
import {journalTransaction,writePrivateJson} from './migration-journal.mjs';

export const zeroStartRelease=JSON.parse(fs.readFileSync(new URL('../config/fresh-zero-testnet.json',import.meta.url),'utf8'));
const queueAbi=['function vault() view returns(address)','function APPROVAL_VERSION() view returns(uint256)','function requestCount() view returns(uint256)','function pending(address) view returns(uint256)'];
const registration=new Interface(['event Registered(address indexed user,address indexed referrer)']);
const feedAbi=['function decimals() view returns(uint8)','function latestRoundData() view returns(uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)'];

export function validateZeroStartRelease(value){
 if(value?.version!==1||value.releaseId!=='global-fresh-zero-v1'||value.chainId!==97||value.artifact!=='AutomaticGroupVault')throw Error('ZERO_START_RELEASE_REQUIRED');
 if(!/^0x[0-9a-f]{64}$/i.test(value.artifactHash||'')||/^0x0{64}$/i.test(value.artifactHash))throw Error('ZERO_START_ARTIFACT_HASH_REQUIRED');
 const address=name=>{try{const result=getAddress(value[name]);if(result!==ZeroAddress)return result;}catch{}throw Error('ZERO_START_ADDRESS_REQUIRED');};
 if(!/^[1-9][0-9]*$/.test(String(value.age))||BigInt(value.age)>604800n)throw Error('ZERO_START_ORACLE_AGE_REQUIRED');
 if(!Array.isArray(value.partners)||value.partners.length!==7)throw Error('ZERO_START_PARTNERS_REQUIRED');
 let partners;try{partners=value.partners.map(getAddress);}catch{throw Error('ZERO_START_PARTNERS_REQUIRED');}
 if(new Set(partners).size!==7||partners.includes(ZeroAddress))throw Error('ZERO_START_PARTNERS_REQUIRED');
 return {version:1,releaseId:value.releaseId,chainId:97,artifact:'AutomaticGroupVault',artifactHash:value.artifactHash.toLowerCase(),owner:address('owner'),deployer:address('deployer'),token:address('token'),bnbFeed:address('bnbFeed'),tokenFeed:address('tokenFeed'),age:String(value.age),partners,operations:address('operations')};
}

function deploymentRequest(artifact,release){
 const bytecode=artifact.bytecode||'0x'+artifact.evm?.bytecode?.object;
 if(!/^0x(?:[0-9a-f]{2})+$/i.test(bytecode)||keccak256(bytecode)!==release.artifactHash)throw Error('ZERO_START_ARTIFACT_MISMATCH');
 return new ContractFactory(artifact.abi,bytecode).getDeployTransaction(release.owner,release.token,release.bnbFeed,release.tokenFeed,release.age,release.partners,release.operations);
}

async function inspectFeeds(provider,c,block){
 const feeds=[];
 for(const address of [c.bnbFeed,c.tokenFeed]){
  try{
   const feed=new Contract(address,feedAbi,provider),o={blockTag:block.number};
   const [decimals,round]=await Promise.all([feed.decimals(o),feed.latestRoundData(o)]);
   const ready=decimals<=18n&&round.roundId>0n&&round.answer>0n&&round.updatedAt>0n&&round.updatedAt<=BigInt(block.timestamp)&&BigInt(block.timestamp)-round.updatedAt<=BigInt(c.age)&&round.answeredInRound>=round.roundId;
   feeds.push({address,decimals:Number(decimals),roundId:round.roundId.toString(),answer:round.answer.toString(),updatedAt:round.updatedAt.toString(),answeredInRound:round.answeredInRound.toString(),ready});
  }catch{feeds.push({address,ready:false,error:'FEED_READ_UNAVAILABLE'});}
 }
 return {block:block.number,timestamp:block.timestamp,ready:feeds.every(feed=>feed.ready),feeds};
}

// Verify the exact creation transaction and its empty initial state without any prior deployment.
export async function verifyZeroStartDeployment({provider,artifact,release=zeroStartRelease,hash,confirmations=3}){
 const c=validateZeroStartRelease(release),request=await deploymentRequest(artifact,c);
 if(!Number.isSafeInteger(confirmations)||confirmations<1)throw Error('ZERO_START_CONFIRMATIONS_REQUIRED');
 if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
 if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw Error('ZERO_START_TRANSACTION_REQUIRED');
 const [receipt,transaction]=await Promise.all([provider.getTransactionReceipt(hash),provider.getTransaction(hash)]);
 if(!receipt||receipt.status!==1||!receipt.contractAddress)throw Error('ZERO_START_RECEIPT_REQUIRED');
 if(!transaction||transaction.hash.toLowerCase()!==hash.toLowerCase()||transaction.to!==null||getAddress(transaction.from)!==c.deployer||transaction.chainId!==97n||transaction.value!==0n||transaction.data.toLowerCase()!==request.data.toLowerCase())throw Error('ZERO_START_TRANSACTION_MISMATCH');
 const address=getAddress(receipt.contractAddress);
 if(address!==getCreateAddress({from:c.deployer,nonce:transaction.nonce}))throw Error('ZERO_START_CREATE_ADDRESS_MISMATCH');
 const block=await provider.getBlock(receipt.blockNumber);
 if(block?.hash!==receipt.blockHash||(await provider.getBlockNumber())-receipt.blockNumber+1<confirmations)throw Error('ZERO_START_RECEIPT_NOT_FINAL');
 const code=await provider.getCode(address,receipt.blockNumber);
 if(code==='0x')throw Error('ZERO_START_CODE_MISSING');
 const vault=new Contract(address,artifact.abi,provider),o={blockTag:receipt.blockNumber};
 if(getAddress(await vault.owner(o))!==c.owner||await vault.paused(o)||await vault.REWARD_ACCRUAL_VERSION(o)!==1n||await vault.AUTO_REWARD_GROUP_VERSION(o)!==1n||await vault.volumeJobCount(o)!==0n)throw Error('ZERO_START_CAPABILITY_VERIFY_FAILED');
 for(const [method,expected] of [['usdt',c.token],['bnbUsdFeed',c.bnbFeed],['usdtUsdFeed',c.tokenFeed],['dropshippingWallet',c.operations]])if(getAddress(await vault[method](o))!==expected)throw Error('ZERO_START_SETTINGS_MISMATCH');
 if(await vault.maxOracleAge(o)!==BigInt(c.age)||await vault.partnerVotesRequired(o)!==2n||!await vault.reporters(c.owner,o))throw Error('ZERO_START_SETTINGS_MISMATCH');
 if(c.deployer!==c.owner&&await vault.reporters(c.deployer,o))throw Error('ZERO_START_UNEXPECTED_REPORTER');
 for(let i=0;i<7;i++)if(getAddress(await vault.partnerWallets(i,o))!==c.partners[i])throw Error('ZERO_START_PARTNER_MISMATCH');
 const queueAddress=getAddress(await vault.withdrawalQueue(o));
 if(queueAddress===ZeroAddress||await provider.getCode(queueAddress,receipt.blockNumber)==='0x')throw Error('ZERO_START_QUEUE_MISSING');
 const queue=new Contract(queueAddress,queueAbi,provider);
 if(await queue.APPROVAL_VERSION(o)!==1n||getAddress(await queue.vault(o))!==address||await queue.requestCount(o)!==0n)throw Error('ZERO_START_QUEUE_VERIFY_FAILED');
 for(const asset of [ZeroAddress,c.token]){
  if((await vault.ledgers(asset,o)).some(value=>value!==0n)||await vault.assetBalance(asset,o)!==0n||await queue.pending(asset,o)!==0n)throw Error('ZERO_START_INITIAL_STATE_NOT_EMPTY');
 }
 if((await provider.getLogs({address,topics:[registration.getEvent('Registered').topicHash],fromBlock:receipt.blockNumber,toBlock:receipt.blockNumber})).length)throw Error('ZERO_START_INITIAL_REGISTRY_NOT_EMPTY');
 const feedReadiness=await inspectFeeds(provider,c,block);
 // A canonical receipt and exact initcode bind unenumerable mappings to constructor initialization.
 if((await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('ZERO_START_REORG');
 return {version:1,kind:'fresh-zero-automatic-groups',releaseId:c.releaseId,chainId:97,contractAddress:address,owner:c.owner,deployer:c.deployer,hash,block:receipt.blockNumber,blockHash:receipt.blockHash,queue:queueAddress,artifactHash:c.artifactHash,initcodeHash:keccak256(request.data),runtimeHash:keccak256(code),approvalVersion:1,automaticGroupVersion:1,config:c,verified:true,emptyAtDeployment:true,emptyStateCheckpoint:{block:receipt.blockNumber,blockHash:receipt.blockHash},feedReadiness,accountsMigrated:false,siteConnected:false,automationActive:false,dailyAutomationActive:false};
}

// The journal is bound to literal settings and bytecode before its only transaction is signed.
export async function deployZeroStart({provider,wallet,artifact,release=zeroStartRelease,state,save,confirmations=3,log=()=>{}}){
 if(!Number.isSafeInteger(confirmations)||confirmations<1)throw Error('ZERO_START_CONFIRMATIONS_REQUIRED');
 const c=validateZeroStartRelease(release),request=await deploymentRequest(artifact,c);
 if(getAddress(wallet.address)!==c.deployer)throw Error('EXPECTED_DEPLOYER_KEY_REQUIRED');
 if(!state||typeof state!=='object'||Array.isArray(state)||!state.transactions||typeof state.transactions!=='object'||Array.isArray(state.transactions))throw Error('ZERO_START_JOURNAL_REQUIRED');
 const identity={version:1,kind:'fresh-zero-automatic-groups',release:c,initcodeHash:keccak256(request.data)};
 if(state.identity&&JSON.stringify(state.identity)!==JSON.stringify(identity))throw Error('ZERO_START_JOURNAL_IDENTITY_MISMATCH');
 if(!state.identity&&Object.keys(state.transactions).length)throw Error('UNBOUND_ZERO_START_JOURNAL');
 if(Object.keys(state.transactions).some(label=>label!=='zero-start-deploy'))throw Error('ZERO_START_UNEXPECTED_TRANSACTION');
 const guard=async()=>{if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');};
 await guard();
 // Establish narrow log-query support before spending gas on a deployment whose proof needs it.
 const head=await provider.getBlock('latest'),nonce=await provider.getTransactionCount(wallet.address,'latest');
 if(!head)throw Error('ZERO_START_LATEST_BLOCK_REQUIRED');
 try{await provider.getLogs({address:getCreateAddress({from:c.deployer,nonce}),topics:[registration.getEvent('Registered').topicHash],fromBlock:head.number,toBlock:head.number});}
 catch{throw Error('ZERO_START_REGISTRATION_LOG_RPC_REQUIRED');}
 if(!state.identity){state.identity=identity;save();}
 const receipt=await journalTransaction({provider,wallet,state,save,label:'zero-start-deploy',request,guard,log,confirmations});
 return verifyZeroStartDeployment({provider,artifact,release:c,hash:receipt.hash,confirmations});
}

function privateFile(file){
 if(!fs.existsSync(file))return;
 const s=fs.lstatSync(file);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_REGULAR_STATE_FILE_REQUIRED');
}

async function main(){
 let provider;
 try{
  if(process.argv.length!==3||process.argv[2]!=='--execute')throw Error('EXPLICIT_EXECUTE_FLAG_REQUIRED');
  if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
  if(process.env.TRADES_CHAIN_ID!=='97'||!process.env.TRADES_RPC_URL)throw Error('TESTNET_RPC_REQUIRED');
  const release=validateZeroStartRelease(zeroStartRelease);
  const key=readPrivateKey('/etc/globaldroptrade/migration-deployer.key')||readPrivateKey('/root/global-testnet-v071/.testnet-server/deployer.key');
  if(!key)throw Error('DEPLOYER_KEY_NOT_FOUND');
  const transport=new FetchRequest(process.env.TRADES_RPC_URL);transport.timeout=20000;
  provider=new JsonRpcProvider(transport,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=2000;
  const wallet=new Wallet(key,provider);if(wallet.address!==release.deployer)throw Error('EXPECTED_DEPLOYER_KEY_REQUIRED');
  const directory='/var/lib/globaldroptrade/fresh-zero-v1';fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.uid!==0||(stat.mode&0o077)!==0)throw Error('PRIVATE_STATE_DIRECTORY_REQUIRED');
  const journal=path.join(directory,'journal.json'),reportFile=path.join(directory,'deployment-public.json');privateFile(journal);privateFile(reportFile);
  const state=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal,'utf8')):{transactions:{}};
  const artifact=JSON.parse(fs.readFileSync(new URL('../artifacts/AutomaticGroupVault.json',import.meta.url),'utf8'));
  const report=await deployZeroStart({provider,wallet,artifact,release,state,save:()=>writePrivateJson(journal,state),log:console.log});
  writePrivateJson(reportFile,report);
  console.log('ZERO_START_CONTRACT_DEPLOYED_AND_VERIFIED');console.log('NEW_CONTRACT='+report.contractAddress);console.log('WITHDRAWAL_QUEUE='+report.queue);console.log('TX_HASH='+report.hash);console.log('OWNER='+report.owner);console.log('REPORT='+reportFile);
  console.log('ACCOUNTS_MIGRATED=false SITE_CONNECTED=false AUTOMATION_ACTIVE=false');
  console.log('PRICE_FEEDS_READY_AT_DEPLOYMENT='+report.feedReadiness.ready);
  console.log('The new contract started empty. Site connection and daily reporter authorization are separate steps.');
 }catch(e){console.error('ZERO_START_DEPLOY_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message||'')?e.message:'RPC_OR_VERIFICATION_FAILED'));console.error('Keep the fresh-zero journal and rerun the same command to resume.');process.exitCode=1;}
 finally{provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
