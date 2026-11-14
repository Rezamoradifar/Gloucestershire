#!/usr/bin/env node
// Strict opt-in, separate ONE-HOUR BNB TESTNET-only V3 deployer.
// NEVER touches deployed V2, existing balances, DNS, Nginx, or the website.
// NEVER signs silently or asks for any signing key in chat.
// Accepts only the EXACT prior GAS-ONLY BNB TESTNET deployer held in its
// existing root-private server file, separately
// from the administrator. Every deployment requires operator TTY approval.
import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {waitV3DeploymentReceipt} from './v3-deploy-receipt-poll.mjs';
import {compileHourly} from './compile-global-v3-hourly-testnet.mjs';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,Wallet,
 getAddress,keccak256,parseEther,formatEther} from 'ethers';

const CHAIN=97;
const ADMIN=getAddress('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const FEE=getAddress('0x74015dedf36677485793f1714ec7bd4893907b26');
const DEPOSIT_FEE_1=getAddress('0x7037cc199499d7a3431285a01e435454eae51265');
const DEPOSIT_FEE_2=getAddress('0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632');
const OPERATIONS=getAddress('0x8c4ac9b009808a0b49ba77b58e3871e7cdba463c');
const OLD_V2=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
const PROFILE=Object.freeze({name:'hourly-testnet',
 proof:'/var/lib/globaldroptrade/v3-hourly-testnet/deployment.json',
 keeperConfig:'/etc/globaldroptrade/v3-hourly-keeper-testnet.json'});
const MARKER=PROFILE.proof;
const KEEPER_CONFIG=PROFILE.keeperConfig;
const OLD_TESTNET_DEPLOYER=getAddress('0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d');
const OLD_TESTNET_DEPLOYER_KEYFILE='/etc/globaldroptrade/new-deployer-testnet-v1/deployer.key';
const MAX_GAS=9000000n;
const MAX_COST=parseEther('0.08');
const RPC=[
 'https://bsc-testnet-dataseed.bnbchain.org',
 'https://bsc-testnet-rpc.publicnode.com'
];
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
 const a=compileHourly();
 if(a.network!=='BNB_TESTNET_ONLY'||a.accrualPeriodSeconds!==3600||
    !a.evm?.bytecode?.object||!a.abi)error('PINNED_LOCAL_V3_HOURLY_ARTIFACT_INVALID');
 return a;
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
 if(!['--check','--check-old-testnet-deployer','--deploy-old-testnet-deployer'].includes(mode)||
    process.argv.length!==3)
  error('V3_HOURLY_USE_PINNED_TESTNET_DEPLOYER_ONLY');
 if(process.getuid?.()!==0)error('ROOT_REQUIRED_FOR_PRIVATE_DEPLOYMENT_RECORD');
 if(fs.existsSync(MARKER)){
  const existing=JSON.parse(fs.readFileSync(MARKER,'utf8'));
  console.log('V3_EXISTING_DEPLOYMENT_INTENT '+JSON.stringify({
   status:existing.status,contract:existing.contract||null,txHash:existing.txHash||null
  }));
  if(mode==='--deploy-old-testnet-deployer')
   error('V3_DEPLOYMENT_ALREADY_ATTEMPTED_RECONCILE_FIRST');
 }
 const a=artifact();
 const {provider:p,rpc}=await provider();
 try{
  console.log('V3_HOURLY_TESTNET_DEPLOY_PREFLIGHT '+JSON.stringify({
   chainId:97,admin:ADMIN,testToken:TOKEN,feeWallet:FEE,
   depositFeeWallet1:DEPOSIT_FEE_1,depositFeeWallet2:DEPOSIT_FEE_2,
   operationsWallet:OPERATIONS,depositFeeEachBps:1000,
   repositoryArtifact:'GlobalV3HourlyTestnet',compiler:a.compiler,accrualPeriodSeconds:3600,
   creationBytecodeHash:keccak256('0x'+a.evm.bytecode.object),
   sourceRpc:rpc,oldV2Unaffected:OLD_V2,
   directUserWalletFundsRequired:false,prototypeNotProduction:true,
   userProfitAutoCompoundWithoutAdmin:true
  }));
  if(mode==='--check')return;
  const wallet=loadExistingV2TestnetDeployer();
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
  const rl=createInterface({input:process.stdin,terminal:false});
  let approved=false;
  try{
   for(let attempt=1;attempt<=5;attempt++){
    process.stdout.write('Type DEPLOY HOURLY V3 BNB TESTNET ONLY: ');
    const answer=await rl.question('');
    if(answer.trim()==='DEPLOY HOURLY V3 BNB TESTNET ONLY'){approved=true;break;}
    if(attempt<5)process.stdout.write('V3_CONFIRMATION_NOT_MATCHED. Enter the exact phrase at the next prompt while this program is still running.\n');
   }
  }finally{rl.close();}
  if(!approved)error('DEPLOYMENT_CANCELLED_BY_OPERATOR');
  const record={
   status:'INTENT',createdAt:new Date().toISOString(),
   profile:'ISOLATED_HOURLY_TESTNET_ONLY',accrualPeriodSeconds:3600,
   chainId:97,deployer:wallet.address,admin:ADMIN,asset:TOKEN,feeReceiver:FEE,
   creationBytecodeHash:keccak256('0x'+a.evm.bytecode.object),
   deployedV2Unmodified:true
  };
  saveMarker(record,true);
  try{
   const vault=await factory.deploy(ADMIN,TOKEN,FEE,{gasLimit:estimate*12n/10n,gasPrice:price});
   const sent=vault.deploymentTransaction();
   if(!sent)error('NO_V3_DEPLOY_TX');
   record.status='BROADCAST';record.txHash=sent.hash;saveMarker(record);
   const receipt=await waitV3DeploymentReceipt(p,sent.hash,{confirmations:3});
   if(!receipt||receipt.status!==1||!receipt.contractAddress)
    error('V3_DEPLOYMENT_RECEIPT_NOT_CONFIRMED');
   const contract=getAddress(receipt.contractAddress);
   if(contract===OLD_V2)error('DEPLOYED_CONTRACT_MUST_NOT_REPLACE_EXISTING_V2');
   const code=await p.getCode(contract,'latest');
   if(code==='0x')error('V3_DEPLOYED_RUNTIME_MISSING');
   const verified=new Contract(contract,a.abi,p);
   const managerRole=await verified.MANAGER_ROLE();
   const [token,feeReceiver,adminAllowed,count,fee1,fee2,operations,depositFee,period,activity]=await Promise.all([
    verified.asset(),verified.feeReceiver(),
    verified.hasRole(managerRole,ADMIN),verified.memberCount(),
    verified.FEE_WALLET_1(),verified.FEE_WALLET_2(),
    verified.OPERATIONS_WALLET(),verified.DEPOSIT_FEE_EACH_BPS(),
    verified.ACCRUAL_PERIOD(),verified.ONE_DAY()
   ]);
   if(getAddress(token)!==TOKEN||getAddress(feeReceiver)!==FEE||
      !adminAllowed||count!==0n||getAddress(fee1)!==DEPOSIT_FEE_1||
      getAddress(fee2)!==DEPOSIT_FEE_2||getAddress(operations)!==OPERATIONS||
      depositFee!==1000n||period!==3600n||activity!==86400n)
    error('V3_HOURLY_CONTRACT_CONFIGURATION_NOT_VERIFIED');
   record.status='VERIFIED_BNB_TESTNET_ONLY';record.contract=contract;
   record.runtimeHash=keccak256(code);record.blockNumber=receipt.blockNumber;
   record.confirmedAt=new Date().toISOString();saveMarker(record);
   fs.mkdirSync(path.dirname(KEEPER_CONFIG),{recursive:true,mode:0o700});
   if(fs.existsSync(KEEPER_CONFIG))error('EXISTING_V3_KEEPER_CONFIG_DO_NOT_OVERWRITE');
   fs.writeFileSync(KEEPER_CONFIG,JSON.stringify({
    network:'BNB_TESTNET_ONLY',chainId:97,
    profile:'ISOLATED_HOURLY_TESTNET_ONLY',accrualPeriodSeconds:3600,
    contract,runtimeHash:record.runtimeHash,token:TOKEN,
    maxMembers:100,maxTransactions:30,maxPositionsPerMember:128
   },null,2)+'\n',{flag:'wx',mode:0o600});
   console.log('V3_PUBLIC_HOURLY_TESTNET_DEPLOYED_AND_VERIFIED '+JSON.stringify({
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
