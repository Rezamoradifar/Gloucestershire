// Strict opt-in V2 testnet-only deployment CLI.
// Nothing on the old site or existing vault is upgraded, migrated, funded or reconfigured.
// No deployment occurs in --check mode. Never paste/print a signing key.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,Wallet,formatEther,getAddress,getCreateAddress,keccak256,parseEther} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {readPrivateKey} from './migration-signers.mjs';

const LEGACY_VAULT='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
const FIXED_CHAIN_ID=97;
const MAX_DEPLOY_GAS=9_000_000n;
const MAX_DEPLOY_FEE=parseEther('0.10'); // max testnet BNB spend per deployment
const RELEASE_FILE='config/new-deployer-testnet.json';
const ARTIFACT_FILE='artifacts/GlobalV2Prototype.json';
const CONFIG_ENV='/etc/globaldroptrade/trades.env';
const SIGNER_FILE='/etc/globaldroptrade/new-deployer-testnet-v1/deployer.key';
const STATE_DIR='/var/lib/globaldroptrade/v2-prototype';
const PROOF_FILE=path.join(STATE_DIR,'deployment.json');
const LIMITED_ABI=[
 'function usdt() view returns(address)',
 'function operationsWallet() view returns(address)',
 'function bnbFeed() view returns(address)',
 'function tokenFeed() view returns(address)',
 'function oracleAge() view returns(uint32)',
 'function PROFIT_FEE_BPS() view returns(uint256)',
 'function WITHDRAWAL_COOLDOWN() view returns(uint256)',
 'function REVENUE_FUNDER_ROLE() view returns(bytes32)',
 'function KYC_ADMIN_ROLE() view returns(bytes32)',
 'function WITHDRAWAL_APPROVER_ROLE() view returns(bytes32)',
 'function DEFAULT_ADMIN_ROLE() view returns(bytes32)',
 'function hasRole(bytes32,address) view returns(bool)',
 'function memberCount() view returns(uint256)',
 'function withdrawalCount() view returns(uint256)',
 'function principalLiability(address) view returns(uint256)',
 'function profitLiability(address) view returns(uint256)',
 'function assetBalance(address) view returns(uint256)'
];
const fail=(reason)=>{throw Error(reason);};
const validAddress=value=>{
 try{return getAddress(value);}catch{fail('V2_RELEASE_ADDRESS_REQUIRED');}
};
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const units=value=>typeof value==='string'&&/^[0-9]+$/.test(value);

export function validateV2DeployRelease(config){
 if(config?.version!==1||config?.chainId!==97||
   config.releaseId!=='global-new-deployer-testnet-v1'||config.testMode!==true||
   config.artifact!=='FastNewDeployerTestnetVault')
  fail('V2_RELEASE_PROFILE_MISMATCH');
 const owner=validAddress(config.owner),deployer=validAddress(config.deployer);
 const token=validAddress(config.token),bnbFeed=validAddress(config.bnbFeed);
 const tokenFeed=validAddress(config.tokenFeed),operations=validAddress(config.operations);
 if(owner===deployer||new Set([owner,deployer,token,bnbFeed,tokenFeed,operations]).size!==6)
  fail('V2_RELEASE_COLLISION');
 if(!units(config.age)||BigInt(config.age)<60n||BigInt(config.age)>604800n)
  fail('V2_RELEASE_ORACLE_AGE');
 return Object.freeze({owner,deployer,token,bnbFeed,tokenFeed,operations,age:Number(config.age)});
}

export function validateV2DeployArtifact(artifact){
 if(!artifact||!Array.isArray(artifact.abi)||artifact.compiler?.startsWith('0.8.30+commit.73712a01.')!==true||
  !/^[0-9a-f]+$/i.test(artifact.evm?.bytecode?.object||'')||
  !/^[0-9a-f]+$/i.test(artifact.evm?.deployedBytecode?.object||''))
  fail('V2_COMPILED_ARTIFACT_REQUIRED');
 const runtime=artifact.evm.deployedBytecode.object.length/2;
 const init=artifact.evm.bytecode.object.length/2;
 if(runtime===0||runtime>24576||init>49152)fail('V2_EVM_SIZE_GATE_FAILED');
 const iface=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object).interface;
 for(const name of ['checkIn','isEligible','deposit','settleFundedEarnings','reinvest',
  'requestWithdrawal','approveWithdrawal','payWithdrawal','setVipKyc'])if(!iface.hasFunction(name))
    fail('V2_INTERFACE_GATE_FAILED');
 return Object.freeze({init,runtime,bytecodeHash:keccak256('0x'+artifact.evm.bytecode.object)});
}

export async function verifyV2TestnetContext({provider,release,artifact,legacyVault=LEGACY_VAULT}){
 const profile=validateV2DeployRelease(release);
 const compiled=validateV2DeployArtifact(artifact);
 if(Number(await provider.send('eth_chainId',[]))!==FIXED_CHAIN_ID)fail('V2_TESTNET_CHAIN_97_ONLY');
 if((await provider.getCode(legacyVault))==='0x')fail('V2_EXPECTED_LEGACY_CONTRACT_MISSING');
 const addresses=[profile.token,profile.bnbFeed,profile.tokenFeed];
 for(const address of addresses)if(await provider.getCode(address)==='0x')fail('V2_DEPENDENCY_CODE_MISSING');
 const token=new Contract(profile.token,['function decimals() view returns(uint8)'],provider);
 const feedAbi=['function decimals() view returns(uint8)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)'];
 const feeds=[new Contract(profile.bnbFeed,feedAbi,provider),new Contract(profile.tokenFeed,feedAbi,provider)];
 const block=await provider.getBlock('latest');
 if(!block||block.timestamp<=0)fail('V2_CHAIN_HEAD_REQUIRED');
 const tokenDecimals=Number(await token.decimals());
 if(tokenDecimals<0||tokenDecimals>18)fail('V2_TOKEN_DECIMALS_INVALID');
 for(const feed of feeds){
  const [digits,oracle]=await Promise.all([feed.decimals(),feed.latestRoundData()]);
  const [round,price,,updated,answered]=oracle;
  if(digits>18n||round<1n||answered<round||price<=0n||updated<1n||
    updated>BigInt(block.timestamp)||BigInt(block.timestamp)-updated>BigInt(profile.age))
   fail('V2_ORACLE_UNAVAILABLE_OR_STALE');
 }
 return {...profile,...compiled,head:block.number,headHash:block.hash,chainId:97,tokenDecimals};
}
export async function verifyV2Deployed({provider,address,release,artifact,adminOnly=true}){
 const profile=validateV2DeployRelease(release);
 validateV2DeployArtifact(artifact);
 if(Number(await provider.send('eth_chainId',[]))!==97)fail('V2_TESTNET_CHAIN_97_ONLY');
 address=validAddress(address);
 if(address===getAddress(LEGACY_VAULT))fail('V2_LEGACY_ADDRESS_FORBIDDEN');
 const code=await provider.getCode(address);
 if(code==='0x')fail('V2_DEPLOYED_CODE_MISSING');
 const vault=new Contract(address,LIMITED_ABI,provider);
 const [token,operations,bnb,usdtFeed,age,fee,cooldown,kyc,approver,admin,hasKyc,hasApprover,hasAdmin,
   memberCount,withdrawalCount,principal,profit]=await Promise.all([
  vault.usdt(),vault.operationsWallet(),vault.bnbFeed(),vault.tokenFeed(),
  vault.oracleAge(),vault.PROFIT_FEE_BPS(),vault.WITHDRAWAL_COOLDOWN(),
  vault.KYC_ADMIN_ROLE(),vault.WITHDRAWAL_APPROVER_ROLE(),vault.DEFAULT_ADMIN_ROLE(),
  vault.hasRole(keccak256(Buffer.from('KYC_ADMIN_ROLE')),profile.owner).catch(()=>false),
  vault.hasRole(keccak256(Buffer.from('WITHDRAWAL_APPROVER_ROLE')),profile.owner).catch(()=>false),
  vault.hasRole('0x'+'0'.repeat(64),profile.owner),
  vault.memberCount(),vault.withdrawalCount(),vault.principalLiability(profile.token),vault.profitLiability(profile.token)
 ]);
 if([token,operations,bnb,usdtFeed].map(getAddress).join(':')!==
   [profile.token,profile.operations,profile.bnbFeed,profile.tokenFeed].join(':')||
   Number(age)!==profile.age||fee!==300n||cooldown!==259200n||
   !hash(kyc)||!hash(approver)||!hash(admin)||!hasKyc||!hasApprover||!hasAdmin)
  fail('V2_POST_DEPLOY_MISMATCH');
 if(adminOnly&&(memberCount!==0n||withdrawalCount!==0n||principal!==0n||profit!==0n))
  fail('V2_PROTOTYPE_NOT_EMPTY');
 return {address,chainId:97,codeHash:keccak256(code),admin:profile.owner,
  feeBps:Number(fee),cooldownSeconds:Number(cooldown),
  memberCount:String(memberCount),withdrawalCount:String(withdrawalCount)};
}

const readPrivate=(file)=>{
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.uid!==0||(stat.mode&0o077)!==0||stat.nlink!==1)
  fail('V2_ROOT_ONLY_CONFIGURATION_REQUIRED');
 return fs.readFileSync(file,'utf8');
};
function markerStatus(){
 try{
  const st=fs.lstatSync(PROOF_FILE);
  if(!st.isFile()||st.uid!==0||(st.mode&0o077)!==0||st.nlink!==1)
   fail('V2_MARKER_PERMISSION_INVALID');
  const obj=JSON.parse(fs.readFileSync(PROOF_FILE,'utf8'));
  if(obj.chainId!==97||!hash(obj.txHash)||!obj.predictedAddress)fail('V2_MARKER_INVALID');
  return obj;
 }catch(e){
  if(e.code==='ENOENT')return null;
  throw e;
 }
}
function saveMarker(value){
 fs.mkdirSync(STATE_DIR,{recursive:true,mode:0o700});
 const st=fs.lstatSync(STATE_DIR);
 if(!st.isDirectory()||st.uid!==0||(st.mode&0o077)!==0)
  fail('V2_MARKER_DIRECTORY_UNSAFE');
 // Refuse any second run: if an RPC/send fails, reconcile this marker,
 // rather than accidentally deploying a second separate contract.
 fs.writeFileSync(PROOF_FILE,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
}
export async function deployV2OnTestnet({provider,release,artifact,key,save=saveMarker,existing=markerStatus,legacyVault=LEGACY_VAULT,confirmations=3}){
 if(!Number.isSafeInteger(confirmations)||confirmations<1||confirmations>10)fail('V2_CONFIRMATIONS_INVALID');
 const context=await verifyV2TestnetContext({provider,release,artifact,legacyVault});
 if(existing())fail('V2_DEPLOYMENT_ALREADY_STARTED_RECONCILE_FIRST');
 if(!/^0x[0-9a-f]{64}$/i.test(key||''))fail('V2_SIGNER_KEY_INVALID');
 const signer=new Wallet(key,provider);
 if(getAddress(signer.address)!==context.deployer)fail('V2_SIGNER_ADDRESS_MISMATCH');
 if(context.deployer===context.owner)fail('V2_DEPLOYER_MUST_NOT_BE_ADMIN');
 const factory=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signer);
 const request=await factory.getDeployTransaction(context.owner,context.token,context.bnbFeed,context.tokenFeed,context.age,context.operations);
 const nonce=await provider.getTransactionCount(signer.address,'pending');
 const predictedAddress=getCreateAddress({from:signer.address,nonce});
 if(predictedAddress===getAddress(LEGACY_VAULT)||await provider.getCode(predictedAddress)!=='0x')
  fail('V2_PREDICTED_CONTRACT_COLLISION');
 const estimate=await provider.estimateGas({from:signer.address,data:request.data});
 const gasLimit=estimate+estimate/5n;
 const price=await provider.getFeeData();
 const effective=price.maxFeePerGas??price.gasPrice;
 if(!effective||gasLimit>MAX_DEPLOY_GAS||gasLimit*effective>MAX_DEPLOY_FEE)
  fail('V2_GAS_LIMIT_EXCEEDED');
 const balance=await provider.getBalance(signer.address);
 if(balance<gasLimit*effective)fail('V2_DEPLOYER_INSUFFICIENT_TEST_BNB');
 let fees;
 if(price.maxFeePerGas&&price.maxPriorityFeePerGas)
  fees={type:2,maxFeePerGas:price.maxFeePerGas,maxPriorityFeePerGas:price.maxPriorityFeePerGas};
 else fees={type:0,gasPrice:price.gasPrice};
 const signed=await signer.signTransaction({
  ...request,to:null,nonce,chainId:97,gasLimit,...fees
 });
 const txHash=keccak256(signed);
 save({version:1,chainId:97,status:'pending',txHash,predictedAddress,nonce,
  owner:context.owner,bytecodeHash:context.bytecodeHash,startedAt:new Date().toISOString()});
 const broadcast=await provider.broadcastTransaction(signed);
 if(broadcast.hash.toLowerCase()!==txHash.toLowerCase())fail('V2_TX_HASH_MISMATCH');
 const receipt=await broadcast.wait(confirmations);
 if(!receipt||receipt.status!==1||getAddress(receipt.contractAddress)!==predictedAddress)
  fail('V2_RECEIPT_UNCONFIRMED');
 const output=await verifyV2Deployed({provider,address:predictedAddress,release,artifact});
 return {...output,txHash,block:receipt.blockNumber};
}

async function main(){
 const mode=process.argv[2];
 if(process.argv.length!==3||!['--check','--deploy','--verify'].includes(mode))
  fail('V2_USAGE_CHECK_DEPLOY_VERIFY');
 if(process.getuid?.()!==0)fail('V2_ROOT_SHELL_REQUIRED');
 const release=JSON.parse(fs.readFileSync(RELEASE_FILE,'utf8'));
 const artifact=JSON.parse(fs.readFileSync(ARTIFACT_FILE,'utf8'));
 const env=parseEnv(readPrivate(CONFIG_ENV));
 const settings=readConfig(env);
 if(settings.chainId!==97||getAddress(settings.address)!==getAddress(LEGACY_VAULT))
  fail('V2_INSTALLED_SITE_MUST_STAY_ON_LEGACY_TESTNET');
 const req=new FetchRequest(settings.rpcUrl);req.timeout=15000;
 const rpc=new JsonRpcProvider(req,97,{staticNetwork:true,batchMaxCount:1});
 try{
  const record=markerStatus();
  if(mode==='--verify'){
   if(!record)fail('V2_MARKER_NOT_FOUND');
   const receipt=await rpc.getTransactionReceipt(record.txHash);
   if(!receipt)fail('V2_TX_RECEIPT_NOT_AVAILABLE');
   if(receipt.status!==1||getAddress(receipt.contractAddress)!==getAddress(record.predictedAddress))
    fail('V2_DEPLOY_RECEIPT_MISMATCH');
   const proof=await verifyV2Deployed({provider:rpc,address:record.predictedAddress,release,artifact});
   console.log('V2_TESTNET_VERIFIED '+JSON.stringify({...proof,txHash:record.txHash,block:receipt.blockNumber}));
  }else{
   const preflight=await verifyV2TestnetContext({provider:rpc,release,artifact});
   console.log('V2_TESTNET_PREFLIGHT '+JSON.stringify({chainId:97,admin:preflight.owner,
    deployer:preflight.deployer,legacyUnchanged:true,feeBps:300,cooldownSeconds:259200,
    runtimeSize:preflight.runtime,bytecodeHash:preflight.bytecodeHash,
    pendingMarker:Boolean(record)}));
   if(mode==='--deploy'){
    const key=readPrivateKey(SIGNER_FILE);
    if(!key)fail('V2_DEPLOYER_KEY_FILE_REQUIRED');
    const proof=await deployV2OnTestnet({provider:rpc,release,artifact,key});
    console.log('V2_TESTNET_DEPLOYED '+JSON.stringify(proof));
   }
  }
 }finally{rpc.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{await main();}
 catch(e){console.error('V2_DEPLOY_ERROR '+(/^[A-Z][A-Z0-9_]+$/.test(e?.message||'')?e.message:'V2_CHECK_FAILED'));process.exitCode=1;}
}
