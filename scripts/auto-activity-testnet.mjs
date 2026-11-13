// Opt-in independent verifier for BNB TESTNET (97) only.
// Reads signed 24-hour check-in proofs and public vault state; never touches
// financial journals, reward cursors, withdrawals or KYC decisions.
// The current vault's reporter permission ALSO permits KYC updates, so a
// standalone verifier key is a privileged operational key, not a KYC-isolated
// blockchain role. Do not enable on mainnet without a role-separated upgrade.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {Contract,FetchRequest,JsonRpcProvider,Wallet,getAddress,keccak256,parseEther,ZeroAddress} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {readNewDeployerPrivateText} from './connect-new-deployer-testnet.mjs';
import {readDailyActivity,createDailyActivityReader} from './daily-activity.mjs';
import {readPrivateKey} from './migration-signers.mjs';
import {evaluateAutoActivity} from './auto-activity-eligibility.mjs';

const POLICY='/etc/globaldroptrade/auto-activity-v1.json';
const VAULT='0x4C0F6141b18971db4b14E45c0bE8cDdB09febc14';
const ABI=[
 'function reporters(address) view returns(bool)',
 'function owner() view returns(address)',
 'function users(address) view returns(address referrer,bool registered,bool active,bool vipKyc,uint32 activeDirect,uint256 capitalUsd,uint256 salesUsd)',
 'function setCustomerStatus(address,bool,bool)'
];
const fail=code=>{throw Error(code);};
const json=file=>{
 const raw=readNewDeployerPrivateText(file);
 let x;try{x=JSON.parse(raw);}catch{fail('AUTO_ACTIVITY_POLICY_INVALID');}
 return x;
};
export function validateAutoActivityPolicy(value){
 if(value?.version!==1||value.chainId!==97||value.enabled!==true||
 value.vaultAddress?.toLowerCase()!==VAULT.toLowerCase()||
 !/^0x[0-9a-f]{64}$/i.test(value.runtimeHash||'')||
 value.origin!=='https://globaldroptrade.com'||
 typeof value.historyFile!=='string'||!path.isAbsolute(value.historyFile)||
 value.historyFile!=='/var/lib/globaldroptrade-api/daily-activity.json'||
 typeof value.reporterKeyFile!=='string'||!path.isAbsolute(value.reporterKeyFile)||
 !/^\/etc\/globaldroptrade\/auto-activity\/[^/]+\.key$/.test(value.reporterKeyFile)||
 !Number.isSafeInteger(value.maxActivations)||value.maxActivations<1||value.maxActivations>10||
 !Number.isSafeInteger(value.activationTimestamp)||value.activationTimestamp<1)
  fail('AUTO_ACTIVITY_POLICY_INVALID');
 return Object.freeze({...value});
}
export async function runAutoActivity({policy,provider,now=()=>Math.floor(Date.now()/1000),mode='--check',read=readDailyActivity,loadKey=readPrivateKey}){
 if(!['--check','--execute'].includes(mode))fail('AUTO_ACTIVITY_MODE_REQUIRED');
 policy=validateAutoActivityPolicy(policy);
 const configured=readConfig(parseEnv(readNewDeployerPrivateText('/etc/globaldroptrade/trades.env')));
 if(configured.chainId!==97||getAddress(configured.address)!==getAddress(VAULT))
  fail('AUTO_ACTIVITY_TARGET_MISMATCH');
 if(Number(await provider.send('eth_chainId',[]))!==97)fail('AUTO_ACTIVITY_WRONG_CHAIN');
 const code=await provider.getCode(VAULT);
 if(code==='0x'||keccak256(code).toLowerCase()!==policy.runtimeHash.toLowerCase())
  fail('AUTO_ACTIVITY_RUNTIME_CHANGED');
 const head=await provider.getBlockNumber(),checkpoint=await provider.getBlock(head-4);
 if(!checkpoint||checkpoint.number!==head-4||now()-checkpoint.timestamp>300)
  fail('AUTO_ACTIVITY_CHECKPOINT_UNAVAILABLE');
 const vault=new Contract(VAULT,ABI,provider);
 const history=read({file:policy.historyFile,immutable:true,chainId:97,vaultAddress:VAULT,origin:policy.origin});
 // Source selection is exclusively from signature-verified, target-bound
 // check-ins. Never take arbitrary API-provided wallet lists or public input.
 const wallets=[...new Set(history.records.map(row=>getAddress(row.wallet)))].sort();
 const reader=createDailyActivityReader({provider,state:history,chainId:97,vaultAddress:VAULT,origin:policy.origin});
 const decisions=[];
 for(const member of wallets){
  const user=await vault.users(member,{blockTag:checkpoint.number});
  const evidence=await reader.evidence(member,checkpoint.timestamp+1);
  const result=evaluateAutoActivity({
   chainId:97,vaultAddress:VAULT,wallet:member,confirmedBlock:checkpoint.number,
   confirmedTimestamp:checkpoint.timestamp,nowTimestamp:now(),registered:Boolean(user.registered),
   active:Boolean(user.active),vipKyc:Boolean(user.vipKyc),capitalUsd:BigInt(user.capitalUsd),
   validSignedCheckIn:Boolean(evidence),checkInTimestamp:evidence?.block.timestamp??null,
   minimumCapitalUsd:10n**18n,eligibleSince:policy.activationTimestamp
  });
  decisions.push(result);
 }
 const eligible=decisions.filter(row=>row.action==='activate_without_kyc_change');
 // Never dump private activity signatures, challenge contents or reporter key.
 const report={version:1,chainId:97,confirmedBlock:checkpoint.number,observed:decisions.length,
  eligible:eligible.length,alreadyActive:decisions.filter(row=>row.action==='already_active').length,
  blocked:decisions.filter(row=>row.blockers.length>0).length,mode,transactionsSent:0};
 if(mode==='--check')return report;
 // Activation is opt-in, bounded, never replays missed periods. The final
 // KYC verification and elevated VIP status remain manual.
 if(process.getuid?.()!==0)fail('AUTO_ACTIVITY_ROOT_REQUIRED');
 const key=loadKey(policy.reporterKeyFile);
 if(!key)fail('AUTO_ACTIVITY_SEPARATE_REPORTER_KEY_REQUIRED');
 const signer=new Wallet(key,provider);
 if(getAddress(signer.address)===getAddress(await vault.owner()))
  fail('AUTO_ACTIVITY_OWNER_KEY_FORBIDDEN');
 if(!(await vault.reporters(signer.address)))fail('AUTO_ACTIVITY_REPORTER_ROLE_REQUIRED');
 const connected=vault.connect(signer);
 for(const item of eligible.slice(0,policy.maxActivations)){
  const current=await provider.getBlock('latest');
  if(!current||now()-current.timestamp>300)fail('AUTO_ACTIVITY_CHAIN_STALE');
  const profile=await vault.users(item.wallet);
  // Fail closed on a concurrent KYC or registration change. This protects the
  // observed snapshot, though the old contract cannot atomically separate KYC.
  if(profile.vipKyc!==item.observedKyc||!profile.registered)fail('AUTO_ACTIVITY_STATUS_CHANGED');
  if(profile.active)continue;
  const signed=await reader.evidence(item.wallet,current.timestamp+1);
  if(!signed||signed.block.timestamp<policy.activationTimestamp||
   current.timestamp-signed.block.timestamp>=86400)continue;
  const tx=await connected.setCustomerStatus.populateTransaction(item.wallet,true,Boolean(profile.vipKyc));
  await connected.setCustomerStatus.staticCall(item.wallet,true,Boolean(profile.vipKyc));
  const fee=await provider.getFeeData(),gas=await provider.estimateGas({...tx,from:signer.address});
  const price=fee.maxFeePerGas??fee.gasPrice;
  if(!price||gas*price>parseEther('0.001'))fail('AUTO_ACTIVITY_GAS_CAP_EXCEEDED');
  const sent=await signer.sendTransaction({...tx,gasLimit:gas+gas/5n});
  const receipt=await sent.wait(4);
  if(receipt?.status!==1)fail('AUTO_ACTIVITY_TX_UNCONFIRMED');
  const check=await vault.users(item.wallet);
  if(!check.active||check.vipKyc!==profile.vipKyc)fail('AUTO_ACTIVITY_POST_STATE_CHANGED');
  report.transactionsSent++;
 }
 return report;
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
 let provider;
 try{
  if(process.argv.length!==3||!['--check','--execute'].includes(process.argv[2]))
   fail('AUTO_ACTIVITY_USAGE_CHECK_OR_EXECUTE');
  const policy=validateAutoActivityPolicy(json(POLICY));
  const config=readConfig(parseEnv(readNewDeployerPrivateText('/etc/globaldroptrade/trades.env')));
  const request=new FetchRequest(config.rpcUrl);request.timeout=15000;
  provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  const result=await runAutoActivity({policy,provider,mode:process.argv[2]});
  console.log('AUTO_ACTIVITY_RESULT '+JSON.stringify(result));
 }catch(error){
  console.error('AUTO_ACTIVITY_ERROR '+(/^[A-Z][A-Z0-9_]+$/.test(error?.message||'')?error.message:'UNVERIFIED_ERROR'));
  process.exitCode=1;
 }finally{provider?.destroy();}
}
