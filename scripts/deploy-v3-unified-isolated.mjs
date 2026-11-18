// Isolated chain-97 deployment only. This never changes a site or migrates accounts.
// A signed transaction hash is durably journaled before it can be broadcast.
import fs from 'node:fs';
import path from 'node:path';
import {hostname} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Contract,ContractFactory,JsonRpcProvider,Transaction,Wallet,getAddress,getCreateAddress,keccak256} from 'ethers';
import {compileUnifiedTestnet,compileSingleCapitalTestnet} from './compile-global-v3-unified-testnet.mjs';
import {planUnifiedDeployment} from './v3-unified-deploy-preflight.mjs';
import {openUnifiedJournal} from './v3-unified-keeper-journal.mjs';
import {waitV3DeploymentReceipt} from './v3-deploy-receipt-poll.mjs';
import {recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';
import {verifyUnifiedRelease} from './verify-v3-unified-release.mjs';
import {withUnifiedReadRpc} from './v3-unified-verification-rpc.mjs';
export {verifyUnifiedRelease} from './verify-v3-unified-release.mjs';

import {UNIFIED_TOKEN,UNIFIED_TOKEN_RUNTIME_HASH,UNIFIED_DEPLOYER,UNIFIED_MANAGER,UNIFIED_FEE_RECEIVER,
 UNIFIED_PROFILE,SINGLE_CAPITAL_PROFILE,unifiedProfileForFlag} from './v3-unified-release-pins.mjs';

const DEPLOYER=getAddress(UNIFIED_DEPLOYER);
const RPCS=new Set(['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com']);

function writeProof(directory,proof){
 const temporary=path.join(directory,'.proof-'+randomBytes(12).toString('hex'));
 const final=path.join(directory,'deployment-proof.json');
 let fd;
 try{
  fd=fs.openSync(temporary,'wx',0o600);
  fs.writeFileSync(fd,JSON.stringify(proof)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  // link, unlike rename, refuses to replace an existing proof.
  fs.linkSync(temporary,final);
  const dir=fs.openSync(directory,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
  try{fs.unlinkSync(temporary);}catch(error){if(error?.code!=='ENOENT')throw error;}
 }
}

async function verifyPrivateProofFile(provider,profile) {
 const filename=path.join(profile.stateDirectory,'deployment-proof.json');
 if (fs.realpathSync(filename) !== filename) throw Error('UNIFIED_PROOF_SYMLINK');
 const file=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let bytes;
 try {
  const stat=fs.fstatSync(file);
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size < 2 || stat.size > 65536) {
   throw Error('UNIFIED_PROOF_FILE_NOT_PRIVATE');
  }
  bytes=fs.readFileSync(file);
 } finally { fs.closeSync(file); }
 await verifyUnifiedRelease(provider,JSON.parse(bytes.toString('utf8')),DEPLOYER,profile);
 return createHash('sha256').update(bytes).digest('hex');
}

export async function deployUnifiedIsolated({provider,signer,directory,expectedDeployer=DEPLOYER,
 profile=UNIFIED_PROFILE,compile=profile===SINGLE_CAPITAL_PROFILE?compileSingleCapitalTestnet:compileUnifiedTestnet,
 waitReceipt=waitV3DeploymentReceipt}){
 if(!(signer instanceof Wallet)||signer.provider!==provider||
    getAddress(await signer.getAddress())!==getAddress(expectedDeployer))
  throw Error('UNIFIED_DEDICATED_DEPLOYER_REQUIRED');
 const journal=openUnifiedJournal(directory);
 try{
  if(journal.read()||fs.existsSync(path.join(directory,'deployment-proof.json')))
   throw Error('UNIFIED_PREVIOUS_DEPLOYMENT_NEEDS_REVIEW');
  const artifacts=compile(),artifact=artifacts[profile===SINGLE_CAPITAL_PROFILE?'GlobalV3SingleCapitalTestnet':'GlobalV3UnifiedTestnet'];
  const plan=await planUnifiedDeployment({provider,from:expectedDeployer,profile,compile:()=>artifacts});
  if(plan.initcodeHash.toLowerCase()!==profile.initcodeHash)
   throw Error('UNIFIED_REVIEWED_INITCODE_HASH_MISMATCH');
  const tokenCode=await provider.getCode(plan.token,plan.block);
  if(keccak256(tokenCode).toLowerCase()!==UNIFIED_TOKEN_RUNTIME_HASH)
   throw Error('UNIFIED_REVIEWED_TOKEN_HASH_MISMATCH');
  if(plan.hasPendingTransactions||!plan.candidateAddress||!plan.enoughTestBNB)
   throw Error('UNIFIED_DEPLOY_ACCOUNT_NOT_READY');
  const request=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object)
   .getDeployTransaction(plan.manager,plan.token,plan.feeReceiver);
  const [chain,latest,pending]=await Promise.all([
   provider.send('eth_chainId',[]),provider.send('eth_getTransactionCount',[plan.sender,'latest']),
   provider.send('eth_getTransactionCount',[plan.sender,'pending'])
  ]);
  const nonce=Number(BigInt(latest));
  if(BigInt(chain)!==97n||!Number.isSafeInteger(nonce)||nonce<0||BigInt(pending)!==BigInt(latest)||
     plan.candidateAddress!==getCreateAddress({from:plan.sender,nonce}))
   throw Error('UNIFIED_DEPLOY_CHAIN_OR_NONCE_CHANGED');
  if(await provider.getCode(plan.candidateAddress)!=='0x')throw Error('UNIFIED_CANDIDATE_ADDRESS_OCCUPIED');
  await recheckUnifiedBlock(provider,{number:plan.block,hash:plan.blockHash});
  const raw=await signer.signTransaction({type:0,chainId:97,nonce,data:request.data,value:0,
   gasLimit:BigInt(plan.gasLimit),gasPrice:BigInt(plan.gasPriceWei)});
  const signed=Transaction.from(raw),hash=keccak256(raw);
  if(signed.hash!==hash||signed.from!==plan.sender||signed.to!==null||signed.chainId!==97n||
     signed.nonce!==nonce||keccak256(signed.data)!==plan.initcodeHash)
   throw Error('UNIFIED_SIGNED_TRANSACTION_MISMATCH');
  // Failure or process death after this line is ambiguous and never retried automatically.
  journal.prepare({status:'PREPARED',chainId:97,hash,nonce,sender:plan.sender,
   candidateAddress:plan.candidateAddress,initcodeHash:plan.initcodeHash,
   tokenRuntimeHash:UNIFIED_TOKEN_RUNTIME_HASH,gasLimit:plan.gasLimit,gasPriceWei:plan.gasPriceWei});
  const sent=await provider.broadcastTransaction(raw);
  if(sent.hash.toLowerCase()!==hash.toLowerCase())throw Error('UNIFIED_BROADCAST_HASH_MISMATCH_INSPECT_JOURNAL');
  journal.markBroadcast(hash);
  const receipt=await waitReceipt(provider,hash,{confirmations:3});
  return await recordConfirmedDeployment(provider,journal,directory,expectedDeployer,receipt,profile);
 }finally{journal.close();}
}

// Both paths reconcile the original signed intent against its canonical receipt.
async function recordConfirmedDeployment(provider, journal, directory, expectedDeployer, receipt, profile) {
 const record = journal.read();
 const sender = getAddress(expectedDeployer);
 if (!record || record.sender !== sender || record.candidateAddress !== getCreateAddress({from:sender, nonce:record.nonce}) ||
     record.initcodeHash !== profile.initcodeHash || record.tokenRuntimeHash !== UNIFIED_TOKEN_RUNTIME_HASH) {
  throw Error('UNIFIED_DEPLOYMENT_JOURNAL_IDENTITY_MISMATCH');
 }
 const {hash, candidateAddress} = record;
 if (!receipt || receipt.status !== 1 || !receipt.contractAddress || getAddress(receipt.contractAddress) !== candidateAddress ||
     String(receipt.hash).toLowerCase() !== hash.toLowerCase()) {
  throw Error('UNIFIED_RECEIPT_MISMATCH_INSPECT_JOURNAL');
 }
 const tx = await provider.getTransaction(hash);
 if (!tx || tx.from !== sender || tx.to !== null || tx.chainId !== 97n || tx.nonce !== record.nonce ||
     tx.value !== 0n || keccak256(tx.data) !== profile.initcodeHash || tx.gasLimit !== BigInt(record.gasLimit) ||
     tx.gasPrice !== BigInt(record.gasPriceWei) || tx.blockHash !== receipt.blockHash) {
  throw Error('UNIFIED_CHAIN_TRANSACTION_MISMATCH');
 }
 const vault = new Contract(candidateAddress, [
  'function reinvestmentBook() view returns (address)', 'function networkPlan() view returns (address)'
 ], provider);
 const at = {blockTag:receipt.blockNumber};
 const [book, network] = await Promise.all([vault.reinvestmentBook(at), vault.networkPlan(at)]);
 const [vaultCode, bookCode, networkCode, tokenCode] = await Promise.all(
  [candidateAddress, book, network, UNIFIED_TOKEN].map(address => provider.getCode(address,receipt.blockNumber))
 );
 if ([vaultCode, bookCode, networkCode].some(code => code === '0x') || keccak256(tokenCode) !== UNIFIED_TOKEN_RUNTIME_HASH) {
  throw Error('UNIFIED_RUNTIME_CODE_MISMATCH');
 }
 const proof = {status:profile.status, chainId:97, vault:candidateAddress,
  book:getAddress(book), network:getAddress(network), token:UNIFIED_TOKEN, manager:UNIFIED_MANAGER,
  feeReceiver:UNIFIED_FEE_RECEIVER, deploymentBlock:receipt.blockNumber, deploymentTx:hash,
  initcodeHash:profile.initcodeHash, tokenRuntimeHash:UNIFIED_TOKEN_RUNTIME_HASH,
  vaultRuntimeHash:keccak256(vaultCode), bookRuntimeHash:keccak256(bookCode), networkRuntimeHash:keccak256(networkCode)};
 await verifyUnifiedRelease(provider,proof,sender,profile);
 writeProof(directory,proof);
 if (record.status !== 'CONFIRMED') journal.markConfirmed(hash);
 return {...proof, siteUpdated:false, migrationPerformed:false};
}

export async function recoverUnifiedDeployment({provider, directory, expectedDeployer=DEPLOYER, profile=UNIFIED_PROFILE}) {
 const journal = openUnifiedJournal(directory);
 try {
  const record = journal.read();
  if (!record) throw Error('UNIFIED_DEPLOYMENT_JOURNAL_NOT_FOUND');
  if (fs.existsSync(path.join(directory,'deployment-proof.json'))) throw Error('UNIFIED_PROOF_ALREADY_EXISTS');
  const receipt = await provider.getTransactionReceipt(record.hash);
  if (!receipt) throw Error('UNIFIED_ORIGINAL_RECEIPT_UNAVAILABLE');
  return await recordConfirmedDeployment(provider,journal,directory,expectedDeployer,receipt,profile);
 } finally { journal.close(); }
}

function readServerSigner(provider){
 const locations=['/etc/globaldroptrade/new-deployer-testnet-v1/deployer.key',
  '/root/global-testnet-v071/.testnet-server/deployer.key'];
 for(const filename of locations){
  let fd;try{fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}catch(error){
   if(error?.code==='ENOENT')continue;throw Error('UNIFIED_DEPLOYER_KEY_FILE_NOT_PRIVATE');
  }
  let key;
  try{
   const stat=fs.fstatSync(fd);
   if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o600||stat.size>128)
    throw Error('UNIFIED_DEPLOYER_KEY_FILE_NOT_PRIVATE');
   key=fs.readFileSync(fd,'utf8').trim();
  }finally{fs.closeSync(fd);}
  if(!/^(?:0x)?[0-9a-fA-F]{64}$/.test(key))throw Error('UNIFIED_DEPLOYER_KEY_INVALID');
  const signer=new Wallet(key.startsWith('0x')?key:'0x'+key,provider);
  if(signer.address!==DEPLOYER)throw Error('UNIFIED_DEPLOYER_KEY_ADDRESS_MISMATCH');
  return signer;
 }
 throw Error('UNIFIED_DEPLOYER_KEY_NOT_FOUND');
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 let provider;
 try{
  const args=process.argv.slice(2);
  const [mode,rpc,flag]=args;
  if(args.length<2||args.length>3||!['--check','--verify-existing','--recover-existing','--deploy-testnet'].includes(mode)||!RPCS.has(rpc)) {
   throw Error('UNIFIED_ARGUMENTS_EXPECT_MODE_AND_ALLOWED_RPC');
  }
  const profile=unifiedProfileForFlag(flag),directory=profile.stateDirectory;
  if(mode!=='--verify-existing')provider=new JsonRpcProvider(rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});
  if(mode==='--verify-existing') {
   const digest=await withUnifiedReadRpc(rpc,'existing-proof',reader=>verifyPrivateProofFile(reader,profile));
   console.log('UNIFIED_DEPLOYMENT_PROOF_SHA256='+digest);
  } else if(mode==='--check') {
   const plan=await planUnifiedDeployment({provider,from:DEPLOYER,profile});
   if(plan.initcodeHash!==profile.initcodeHash||!plan.tokenRuntimeIndependentlyVerified) {
    throw Error('UNIFIED_RELEASE_PIN_MISMATCH');
   }
   console.log('UNIFIED_TESTNET_ESTIMATE '+JSON.stringify(plan));
  } else if(mode==='--recover-existing') {
   await recoverUnifiedDeployment({provider,directory,profile});
   const digest=await verifyPrivateProofFile(provider,profile);
   console.log('UNIFIED_DEPLOYMENT_PROOF_SHA256='+digest);
  } else {
   if(process.getuid()!==0||hostname().split('.')[0]!=='vps-luna-2585') {
    throw Error('UNIFIED_SERVER_SIGNER_REQUIRES_GLOBAL_VPS');
   }
   // The two profiles may use the same dedicated TESTNET gas signer.
   const lock=openUnifiedJournal('/var/lib/globaldroptrade/v3-testnet-deploy-lock');
   try{
    const result=await deployUnifiedIsolated({provider,signer:readServerSigner(provider),directory,profile});
    console.log('UNIFIED_TESTNET_DEPLOYED '+JSON.stringify(result));
   }finally{lock.close();}
  }
 }catch(error){
  // Do not print RPC payloads, signed transactions, local file contents or keys.
  const code=String(error?.message||'UNIFIED_DEPLOY_FAILED').split('\n')[0];
  console.error('UNIFIED_TESTNET_DEPLOY_BLOCKED '+(/^UNIFIED_[A-Z0-9_]+$/.test(code)?code:'INSPECT_PRIVATE_JOURNAL_AND_RPC'));
  process.exitCode=1;
 }finally{provider?.destroy();}
}
