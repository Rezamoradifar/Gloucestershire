#!/usr/bin/env node
// Strict opt-in, isolated BNB TESTNET V3 prototype deployer.
// NEVER touches deployed V2, existing balances, DNS, Nginx, or the website.
// NEVER signs silently or asks for any signing key in chat.
// Accepts only an encrypted dedicated wallet or the EXACT prior GAS-ONLY BNB
// TESTNET deployer held in its existing root-private server file, separately
// from the administrator. Every deployment requires operator TTY approval.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,Wallet,
 getAddress,keccak256,parseEther,formatEther} from 'ethers';

const CHAIN=97;
const ADMIN=getAddress('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const FEE=getAddress('0x74015dedf36677485793f1714ec7bd4893907b26');
const OLD_V2=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
const MARKER='/var/lib/globaldroptrade/v3-prototype/deployment.json';
const KEEPER_CONFIG='/etc/globaldroptrade/v3-keeper-testnet.json';
const ENCRYPTED_DEPLOYER='/etc/globaldroptrade/v3-deployer-only-testnet.json';
const OLD_TESTNET_DEPLOYER=getAddress('0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d');
const OLD_TESTNET_DEPLOYER_KEYFILE='/etc/globaldroptrade/new-deployer-testnet-v1/deployer.key';
const MAX_GAS=9000000n;
const MAX_COST=parseEther('0.08');
const RPC=[
 'https://bsc-testnet-dataseed.bnbchain.org',
 'https://bsc-testnet-rpc.publicnode.com'
];
const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const error=m=>{throw Error(m);};
async function provider(){
 for(const url of RPC){
  const request=new FetchRequest(url);request.timeout=9000;
  const p=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{
   const [chain,code,decimals]=await Promise.all([
    p.send('eth_chainId',[]),p.getCode(TOKEN,'latest'),
    new Contract(TOKEN,['function decimals() view returns(uint8)'],p).decimals()
   ]);
   if(Number(BigInt(chain))!==CHAIN||code==='0x'||Number(decimals)!==18)
    error('WRONG_TESTNET_TOKEN_OR_CHAIN');
   return {provider:p,rpc:url};
  }catch{p.destroy();}
 }
 error('BNB_TESTNET_AND_PINNED_TEST_TOKEN_NOT_VERIFIED');
}
function artifact(){
 execFileSync(process.execPath,['scripts/compile-global-v3.mjs'],{cwd:ROOT,stdio:'pipe'});
 const a=JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/GlobalV3DeferredTestnet.json'),'utf8'));
 if(a.deploymentAuthorization!=='NONE_TESTNET_PROTOTYPE'||
    !a.evm?.bytecode?.object||!a.abi)error('PINNED_LOCAL_V3_ARTIFACT_INVALID');
 return a;
}
async function passwordPrompt(){
 if(!process.stdin.isTTY||!process.stdout.isTTY)error('INTERACTIVE_TTY_REQUIRED');
 const term=spawnSync('stty',['-echo'],{stdio:'inherit'});
 if(term.status!==0)error('CANNOT_HIDE_ENCRYPTED_WALLET_PASSWORD');
 // Android SSH clients often include a trailing newline when pasting the
 // command, which gets consumed as an empty password. Re-prompt instead of
 // failing and requiring a complete new shell command.
 const rl=createInterface({input:process.stdin,terminal:false});
 try{
  for(let attempt=1;attempt<=5;attempt++){
   process.stdout.write('Enter TESTNET keystore password (12+ characters; invisible), then press Enter: ');
   const answer=await rl.question('');
   if(answer.length>=12)return answer;
   process.stdout.write('\n');
   if(attempt<5)process.stdout.write(
    'EMPTY_OR_SHORT_PASSWORD_NOT_ACCEPTED. Type the actual password AFTER this prompt; characters will stay hidden.\n'
   );
  }
  error('TESTNET_KEYSTORE_PASSWORD_MUST_BE_AT_LEAST_12_CHARS');
 }finally{
  rl.close();
  spawnSync('stty',['echo'],{stdio:'inherit'});
  process.stdout.write('\n');
 }
}
function loadKeystore(filename){
 if(!path.isAbsolute(filename))error('ENCRYPTED_KEYSTORE_MUST_USE_ABSOLUTE_PATH');
 const stat=fs.lstatSync(filename);
 if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||
    stat.size>200000)error('ENCRYPTED_TESTNET_KEYSTORE_MUST_BE_OWNER_ONLY');
 const raw=fs.readFileSync(filename,'utf8'),json=JSON.parse(raw);
 if(!json.crypto&&!json.Crypto)error('ENCRYPTED_JSON_KEYSTORE_REQUIRED');
 return raw;
}
function loadExistingV2TestnetDeployer(){
 // Only the pinned, previously deployed testnet-only signer is accepted.
 // No arbitrary wallet files, admin keys, environment secrets or remote keys.
 // V2 legacy deployment supported two PREDEFINED testnet-only file paths.
 // Never accept caller-supplied paths or access the separate manager key.
 const candidates=[OLD_TESTNET_DEPLOYER_KEYFILE,'/root/global-testnet-v071/.testnet-server/deployer.key'];
 const file=candidates.find(candidate=>fs.existsSync(candidate));
 if(!file)error('PREVIOUS_V2_TESTNET_DEPLOYER_SIGNER_FILE_MISSING');
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||
    (stat.mode&0o077)!==0||stat.size>128)
  error('PREVIOUS_V2_TESTNET_SIGNER_FILE_MUST_BE_ROOT_PRIVATE');
 const raw=fs.readFileSync(file,'utf8').trim();
 if(!/^(?:0x)?[0-9a-f]{64}$/i.test(raw))
  error('PREVIOUS_TESTNET_DEPLOYER_FILE_FORMAT_INVALID');
 const wallet=new Wallet(raw.startsWith('0x')?raw:'0x'+raw);
 if(getAddress(wallet.address)!==OLD_TESTNET_DEPLOYER||getAddress(wallet.address)===ADMIN)
  error('PREVIOUS_TESTNET_DEPLOYER_ADDRESS_MISMATCH');
 // Never log the key, and never write or copy it to another file.
 return wallet;
}
function saveMarker(data,create=false){
 fs.mkdirSync(path.dirname(MARKER),{recursive:true,mode:0o700});
 const tmp=MARKER+'.new';
 if(create){
  fs.writeFileSync(MARKER,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
 }else{
  fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600});
  fs.renameSync(tmp,MARKER);
 }
}
async function main(){
 const mode=process.argv[2];
 if(!['--check','--deploy','--init-deployer','--check-old-testnet-deployer',
       '--deploy-old-testnet-deployer'].includes(mode)||
    (mode==='--check'&&process.argv.length!==3)||
    (mode==='--check-old-testnet-deployer'&&process.argv.length!==3)||
    (mode==='--deploy-old-testnet-deployer'&&process.argv.length!==3)||
    (mode==='--deploy'&&process.argv.length!==4)||
    (mode==='--init-deployer'&&process.argv.length!==3))
  error('USAGE_CHECK_OLD_DEPLOYER_OR_ENCRYPTED_TESTNET_SIGNER');
 if(process.getuid?.()!==0)error('ROOT_REQUIRED_FOR_PRIVATE_DEPLOYMENT_RECORD');
 if(mode==='--init-deployer'){
  if(fs.existsSync(ENCRYPTED_DEPLOYER))error('TESTNET_DEPLOYER_KEYSTORE_ALREADY_EXISTS');
  const password=await passwordPrompt();
  if(password.length<12)error('TESTNET_KEYSTORE_PASSWORD_MUST_BE_AT_LEAST_12_CHARS');
  const fresh=Wallet.createRandom();
  const encrypted=await fresh.encrypt(password);
  fs.mkdirSync(path.dirname(ENCRYPTED_DEPLOYER),{recursive:true,mode:0o700});
  fs.writeFileSync(ENCRYPTED_DEPLOYER,encrypted+'\n',{flag:'wx',mode:0o600});
  console.log('V3_NEW_TESTNET_DEPLOYER_ONLY '+JSON.stringify({
   publicAddress:fresh.address,encryptedKeystore:ENCRYPTED_DEPLOYER,
   chainId:97,needsValuelessTestnetBNBGas:true,privateKeyPrinted:false
  }));
  return;
 }
 if(fs.existsSync(MARKER)){
  const existing=JSON.parse(fs.readFileSync(MARKER,'utf8'));
  console.log('V3_EXISTING_DEPLOYMENT_INTENT '+JSON.stringify({
   status:existing.status,contract:existing.contract||null,txHash:existing.txHash||null
  }));
  if(mode==='--deploy'||mode==='--deploy-old-testnet-deployer')
   error('V3_DEPLOYMENT_ALREADY_ATTEMPTED_RECONCILE_FIRST');
 }
 const a=artifact();
 const {provider:p,rpc}=await provider();
 try{
  console.log('V3_TESTNET_DEPLOY_PREFLIGHT '+JSON.stringify({
   chainId:97,admin:ADMIN,testToken:TOKEN,feeWallet:FEE,
   repositoryArtifact:'GlobalV3DeferredTestnet',compiler:a.compiler,
   creationBytecodeHash:keccak256('0x'+a.evm.bytecode.object),
   sourceRpc:rpc,oldV2Unaffected:OLD_V2,
   directUserWalletFundsRequired:false,prototypeNotProduction:true,
   userProfitAutoCompoundWithoutAdmin:true
  }));
  if(mode==='--check')return;
  let wallet;
  if(mode==='--check-old-testnet-deployer'||mode==='--deploy-old-testnet-deployer'){
   wallet=loadExistingV2TestnetDeployer();
  }else{
   const encrypted=loadKeystore(process.argv[3]);
   const password=await passwordPrompt();
   wallet=await Wallet.fromEncryptedJson(encrypted,password);
  }
  if(getAddress(wallet.address)===ADMIN)error('DEPLOYER_MUST_BE_SEPARATE_FROM_MANAGER_ADMIN');
  const signer=wallet.connect(p),factory=new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer);
  const txReq=await factory.getDeployTransaction(ADMIN,TOKEN,FEE);
  const estimate=await p.estimateGas({from:wallet.address,data:txReq.data});
  const fee=await p.getFeeData();
  const price=fee.maxFeePerGas??fee.gasPrice;
  if(!price||estimate<=0n||estimate*12n/10n>MAX_GAS||
     estimate*12n/10n*price>MAX_COST)error('V3_DEPLOYMENT_GAS_COST_LIMIT');
  const actualBalance=await p.getBalance(wallet.address);
  const estimatedRequired=estimate*12n/10n*price;
  if(mode==='--check-old-testnet-deployer'){
   console.log('V3_PRIOR_TESTNET_DEPLOYER_CHECK '+JSON.stringify({
    network:'BNB_TESTNET_ONLY',chainId:97,publicDeployer:wallet.address,
    testBNB:formatEther(actualBalance),
    upperBoundGasCostTestBNB:formatEther(estimatedRequired),
    enoughTestBNB:actualBalance>=estimatedRequired,
    isNotContractAdmin:wallet.address!==ADMIN,
    signingKeyStayedOnExistingServer:true,oldV2Unmodified:true,
    transactionSent:false
   }));
   if(actualBalance<estimatedRequired)process.exitCode=2;
   return;
  }
  if(actualBalance<estimatedRequired)
   error('TESTNET_DEPLOYER_HAS_INSUFFICIENT_TBNB');
  if(!process.stdin.isTTY||!process.stdout.isTTY)
   error('INTERACTIVE_DEPLOYMENT_CONFIRMATION_REQUIRED');
  // Android SSH often submits an extra empty newline when the multi-line
  // release command is pasted. Do not cancel on that empty line and never
  // accept a confirmation typed after returning to the shell.
  const rl=createInterface({input:process.stdin,terminal:false});
  let approved=false;
  try{
   for(let attempt=1;attempt<=5;attempt++){
    process.stdout.write('Type DEPLOY NEW V3 BNB TESTNET ONLY: ');
    const answer=await rl.question('');
    if(answer.trim()==='DEPLOY NEW V3 BNB TESTNET ONLY'){
     approved=true;
     break;
    }
    if(attempt<5)process.stdout.write(
     'V3_CONFIRMATION_NOT_MATCHED. Enter the EXACT phrase at the NEXT prompt while this program is still running.\n'
    );
   }
  }finally{rl.close();}
  if(!approved)error('DEPLOYMENT_CANCELLED_BY_OPERATOR');
  const record={
   status:'INTENT',createdAt:new Date().toISOString(),
   chainId:97,deployer:wallet.address,admin:ADMIN,asset:TOKEN,feeReceiver:FEE,
   creationBytecodeHash:keccak256('0x'+a.evm.bytecode.object),
   deployedV2Unmodified:true
  };
  saveMarker(record,true);
  try{
   const vault=await factory.deploy(ADMIN,TOKEN,FEE,{gasLimit:estimate*12n/10n});
   const sent=vault.deploymentTransaction();
   if(!sent)error('NO_V3_DEPLOY_TX');
   record.status='BROADCAST';record.txHash=sent.hash;saveMarker(record);
   const receipt=await sent.wait(3);
   if(!receipt||receipt.status!==1||!receipt.contractAddress)
    error('V3_DEPLOYMENT_RECEIPT_NOT_CONFIRMED');
   const contract=getAddress(receipt.contractAddress);
   if(contract===OLD_V2)error('DEPLOYED_CONTRACT_MUST_NOT_REPLACE_EXISTING_V2');
   const code=await p.getCode(contract,'latest');
   if(code==='0x')error('V3_DEPLOYED_RUNTIME_MISSING');
   const verified=new Contract(contract,a.abi,p);
   const managerRole=await verified.MANAGER_ROLE();
   const [token,feeReceiver,adminAllowed,count]=await Promise.all([
    verified.asset(),verified.feeReceiver(),
    verified.hasRole(managerRole,ADMIN),verified.memberCount()
   ]);
   if(getAddress(token)!==TOKEN||getAddress(feeReceiver)!==FEE||
      !adminAllowed||count!==0n)error('V3_CONTRACT_CONFIGURATION_NOT_VERIFIED');
   record.status='VERIFIED_BNB_TESTNET_ONLY';record.contract=contract;
   record.runtimeHash=keccak256(code);record.blockNumber=receipt.blockNumber;
   record.confirmedAt=new Date().toISOString();saveMarker(record);
   fs.mkdirSync(path.dirname(KEEPER_CONFIG),{recursive:true,mode:0o700});
   if(fs.existsSync(KEEPER_CONFIG))error('EXISTING_V3_KEEPER_CONFIG_DO_NOT_OVERWRITE');
   fs.writeFileSync(KEEPER_CONFIG,JSON.stringify({
    network:'BNB_TESTNET_ONLY',chainId:97,
    contract,runtimeHash:record.runtimeHash,token:TOKEN,
    maxMembers:100,maxTransactions:30,maxPositionsPerMember:128
   },null,2)+'\n',{flag:'wx',mode:0o600});
   console.log('V3_PUBLIC_TESTNET_DEPLOYED_AND_VERIFIED '+JSON.stringify({
    contract,chainId:97,token:TOKEN,admin:ADMIN,
    feeReceiver:FEE,runtimeHash:record.runtimeHash,
    txHash:receipt.hash,confirmations:3,
    keeperConfigPath:KEEPER_CONFIG,
    oldV2Unchanged:true,network:'BNB_TESTNET_ONLY',mainnetReady:false
   }));
  }catch(e){
   record.status=record.status==='VERIFIED_BNB_TESTNET_ONLY'?
    'DEPLOYED_BUT_KEEPER_CONFIG_NEEDS_REVIEW':'REVIEW_ON_CHAIN_BEFORE_RETRY';
   saveMarker(record);
   throw e;
  }
 }finally{p.destroy();}
}
main().catch(e=>{
 console.error('V3_DEPLOY_BLOCKED '+String(e?.message||e));
 process.exitCode=1;
});
