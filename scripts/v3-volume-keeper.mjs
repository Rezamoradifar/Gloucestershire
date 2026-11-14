// BNB chain-97 hourly V3 ONLY. A separate nonprivileged signer may only
// continue on-chain volume jobs. No token, payout or approval transactions.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Contract,FetchRequest,Interface,JsonRpcProvider,Wallet,ZeroAddress,getAddress,keccak256,parseEther,formatEther} from 'ethers';
import {isV3SystemdCredential,keeperReadiness,validateV3KeeperProof} from './global-v3-auto-compound-keeper.mjs';
import {waitV3KeeperReceipt} from './v3-keeper-receipt-poll.mjs';

const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const KEY='/etc/globaldroptrade/v3-hourly-volume-keeper-gas-only.key';
const CONFIG='/etc/globaldroptrade/v3-hourly-keeper-testnet.json';
const PROOF='/var/lib/globaldroptrade/v3-hourly-testnet/deployment.json';
const STATE='/var/lib/globaldroptrade-v3-hourly-volume';
const ABI=[
 'function asset() view returns(address)','function ACCRUAL_PERIOD() view returns(uint256)',
 'function DEFAULT_ADMIN_ROLE() view returns(bytes32)','function MANAGER_ROLE() view returns(bytes32)',
 'function FUNDER_ROLE() view returns(bytes32)','function GUARDIAN_ROLE() view returns(bytes32)',
 'function hasRole(bytes32,address) view returns(bool)','function paused() view returns(bool)',
 'function volumeJobCount() view returns(uint256)',
 'function volumeJobs(uint256) view returns(address child,address ancestor,uint256 usd)',
 'function processNetworkVolume(uint256,uint256)',
 'event NetworkVolumeProgress(uint256 indexed job,address nextAncestor)'
];
const EVENTS=new Interface(ABI), MAX_SCAN=100, MAX_TX=10, STEPS=8;
const MAX_GAS=2000000n, MAX_TX_COST=parseEther('0.005'), MAX_RUN_COST=parseEther('0.03');

// Report only public chain data before rejecting an unready signer.  This
// distinguishes insufficient gas from paused/privileged conditions without
// disclosing the private credential or sending a transaction.
export function reportVolumeReadiness({contract,wallet,balance,privileged,paused,source},report=console.log){
 const readiness=keeperReadiness({balance,privileged,paused});
 const reasons=[];
 if(!readiness.enoughTestBNB)reasons.push('INSUFFICIENT_TEST_BNB');
 if(readiness.paused)reasons.push('CONTRACT_PAUSED');
 if(readiness.privileged)reasons.push('SIGNER_HAS_PRIVILEGED_ROLE');
 const detail={chainId:97,contract,wallet,testBNB:formatEther(balance),...readiness,
  reasons,source,transactionSent:false};
 report('V3_VOLUME_READINESS '+JSON.stringify(detail));
 if(!readiness.ready)throw Error('V3_VOLUME_SIGNER_NOT_READY');
 return detail;
}
function readPrivate(filename,name,max){
 const resolved=path.resolve(filename),s=fs.lstatSync(resolved);
 if(!s.isFile()||s.isSymbolicLink()||s.size<1||s.size>max)throw Error('V3_VOLUME_PRIVATE_FILE_INVALID');
 if(s.uid===process.getuid()&&(s.mode&0o077)===0)return fs.readFileSync(resolved,'utf8');
 const dir=process.env.CREDENTIALS_DIRECTORY;
 if(!dir||!path.isAbsolute(dir))throw Error('V3_VOLUME_PRIVATE_FILE_INVALID');
 const d=fs.lstatSync(dir);
 if(!d.isDirectory()||d.isSymbolicLink()||!isV3SystemdCredential({filename:resolved,name,
  credentialDir:dir,fileUid:s.uid,fileGid:s.gid,fileMode:s.mode,dirUid:d.uid,dirGid:d.gid,dirMode:d.mode}))
  throw Error('V3_VOLUME_PRIVATE_FILE_INVALID');
 return fs.readFileSync(resolved,'utf8');
}
function credential(name,root){
 return process.env.CREDENTIALS_DIRECTORY?path.join(process.env.CREDENTIALS_DIRECTORY,name):root;
}
function load(){
 const config=JSON.parse(readPrivate(credential('volume-config',CONFIG),'volume-config',30000));
 const proof=JSON.parse(readPrivate(credential('deployment-proof',PROOF),'deployment-proof',30000));
 if(config.network!=='BNB_TESTNET_ONLY'||config.chainId!==97||
    config.profile!=='ISOLATED_HOURLY_TESTNET_ONLY'||config.accrualPeriodSeconds!==3600||
    getAddress(config.token)!==TOKEN)throw Error('V3_VOLUME_HOURLY_CONFIG_REQUIRED');
 const settings={contract:getAddress(config.contract),runtimeHash:String(config.runtimeHash).toLowerCase(),periodSeconds:3600};
 const checked=validateV3KeeperProof(settings,proof);
 return {settings,proof:checked};
}
function getWallet(provider){
 const key=readPrivate(credential('volume-gas-key',KEY),'volume-gas-key',128).trim();
 if(!/^0x[0-9a-f]{64}$/i.test(key))throw Error('V3_VOLUME_KEY_INVALID');
 return new Wallet(key,provider);
}
async function connect({settings,proof}){
 for(const url of ['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com']){
  const req=new FetchRequest(url);req.timeout=9000;
  const rpc=new JsonRpcProvider(req,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{
   const [chain,code,receipt,height]=await Promise.all([rpc.send('eth_chainId',[]),
    rpc.getCode(settings.contract),rpc.getTransactionReceipt(proof.txHash),rpc.getBlockNumber()]);
   if(BigInt(chain)!==97n||code==='0x'||keccak256(code).toLowerCase()!==settings.runtimeHash||
      !receipt||receipt.status!==1||!receipt.contractAddress||
      getAddress(receipt.contractAddress)!==settings.contract||receipt.blockNumber!==proof.blockNumber||
      receipt.hash.toLowerCase()!==proof.txHash||height<proof.blockNumber+2)throw Error('V3_VOLUME_PROOF_MISMATCH');
   const vault=new Contract(settings.contract,ABI,rpc);
   if(getAddress(await vault.asset())!==TOKEN||await vault.ACCRUAL_PERIOD()!==3600n)
    throw Error('V3_VOLUME_ASSET_OR_PERIOD_MISMATCH');
   return {rpc,vault,url};
  }catch{rpc.destroy();}
 }
 throw Error('V3_VOLUME_VERIFIED_RPC_UNAVAILABLE');
}
export async function planVolumeJob(vault,cursor,limit=MAX_SCAN){
 const count=Number(await vault.volumeJobCount());
 if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(cursor)||cursor<0||
    !Number.isSafeInteger(limit)||limit<1||limit>MAX_SCAN)throw Error('V3_VOLUME_CURSOR_INVALID');
 if(!count)return {count,selected:null,next:0,scanned:0};
 const start=cursor%count,total=Math.min(count,limit);
 for(let i=0;i<total;i++){
  const index=(start+i)%count,job=await vault.volumeJobs(index);
  if(getAddress(job.ancestor)!==ZeroAddress)return {count,selected:index,next:index,scanned:i+1};
 }
 return {count,selected:null,next:(start+total)%count,scanned:total};
}
function readCursor(){
 try{const x=JSON.parse(fs.readFileSync(path.join(STATE,'cursor.json'),'utf8'));
  if(!Number.isSafeInteger(x.cursor)||x.cursor<0)throw Error('V3_VOLUME_CURSOR_INVALID');return x.cursor;
 }catch(e){if(e.code==='ENOENT')return 0;throw e;}
}
function atomic(name,value){
 const target=path.join(STATE,name),tmp=target+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(value)+'\n',{mode:0o600});fs.renameSync(tmp,target);
}
async function main(){
 const mode=process.argv[2];
 if(process.argv.length!==3||!['--init-wallet','--address','--check','--run','--probe-systemd-credential'].includes(mode))throw Error('V3_VOLUME_MODE_INVALID');
 if(mode==='--probe-systemd-credential'){
  if(!process.env.CREDENTIALS_DIRECTORY||readPrivate(credential('volume-gas-key',KEY),'volume-gas-key',128)!=='GLOBAL_V3_VOLUME_CREDENTIAL_PROBE\n')
   throw Error('V3_VOLUME_CREDENTIAL_PROBE_FAILED');
  console.log('V3_VOLUME_CREDENTIAL_PROBE_PASS');return;
 }
 if(mode==='--init-wallet'){
  if(process.getuid()!==0)throw Error('V3_VOLUME_ROOT_REQUIRED');
  const dir=path.dirname(KEY);if(fs.lstatSync(dir).isSymbolicLink()||fs.lstatSync(dir).uid!==0)
   throw Error('V3_VOLUME_KEY_EXISTS_OR_DIRECTORY_UNSAFE');
  if(fs.existsSync(KEY)){console.log('V3_VOLUME_EXISTING_KEY_PRESERVED');}
  else{const wallet=Wallet.createRandom();fs.writeFileSync(KEY,wallet.privateKey+'\n',{flag:'wx',mode:0o600});}
  const wallet=getWallet(null);
  console.log('V3_VOLUME_GAS_ONLY_ADDRESS='+wallet.address);return;
 }
 if(mode==='--address'){console.log('V3_VOLUME_GAS_ONLY_ADDRESS='+getWallet(null).address);return;}
 const config=load(),{rpc,vault,url}=await connect(config);
 try{
  const signer=getWallet(rpc);
  const roles=await Promise.all([vault.DEFAULT_ADMIN_ROLE(),vault.MANAGER_ROLE(),vault.FUNDER_ROLE(),vault.GUARDIAN_ROLE()]);
  const [balance,paused,roleFlags]=await Promise.all([rpc.getBalance(signer.address),vault.paused(),
   Promise.all(roles.map(role=>vault.hasRole(role,signer.address)))]);
  const privileged=roleFlags.some(Boolean);
  reportVolumeReadiness({contract:config.settings.contract,wallet:signer.address,
   balance,privileged,paused:Boolean(paused),source:url});
  const cursor=mode==='--run'?readCursor():0, plan=await planVolumeJob(vault,cursor);
  console.log('V3_VOLUME_PREFLIGHT '+JSON.stringify(plan));
  if(mode==='--check')return;
  fs.mkdirSync(STATE,{recursive:true,mode:0o700});
  const pending=path.join(STATE,'pending.json');
  // DynamicUser StateDirectory may intentionally use systemd's symlink into
  // /var/lib/private. Validate the resolved directory owner and mode instead.
  const state=fs.statSync(STATE);
  if(!state.isDirectory()||state.uid!==process.getuid()||(state.mode&0o077)!==0)
   throw Error('V3_VOLUME_STATE_DIRECTORY_UNSAFE');
  try{fs.lstatSync(pending);throw Error('V3_VOLUME_PENDING_REQUIRES_REVIEW');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(plan.selected===null){atomic('cursor.json',{cursor:plan.next});return;}
  const writable=vault.connect(signer);
  let job=plan.selected,cost=0n,sent=0;
  while(sent<MAX_TX){
   const before=await vault.volumeJobs(job);
   if(getAddress(before.ancestor)===ZeroAddress){atomic('cursor.json',{cursor:job+1});break;}
   await writable.processNetworkVolume.staticCall(job,STEPS);
   const gas=await writable.processNetworkVolume.estimateGas(job,STEPS),limit=gas*12n/10n;
   const gasPrice=(await rpc.getFeeData()).gasPrice;
   if(gas<=0n||limit>MAX_GAS||!gasPrice||gasPrice<=0n||limit*gasPrice>MAX_TX_COST||
      cost+limit*gasPrice>MAX_RUN_COST||await rpc.getBalance(signer.address)<limit*gasPrice)
    throw Error('V3_VOLUME_GAS_LIMIT');
   // Persist intent before any broadcast. A crash or unclear send is not retried.
   const nonce=await rpc.getTransactionCount(signer.address,'pending');
   fs.writeFileSync(pending,JSON.stringify({status:'INTENT',job,nonce})+'\n',{flag:'wx',mode:0o600});
   const tx=await writable.processNetworkVolume(job,STEPS,{gasLimit:limit,gasPrice,nonce});
   atomic('pending.json',{status:'BROADCAST',job,nonce,txHash:tx.hash});
   const receipt=await waitV3KeeperReceipt(rpc,tx.hash,{confirmations:2});
   const event=receipt.logs.find(log=>{
    if(log.address.toLowerCase()!==config.settings.contract.toLowerCase())return false;
    try{const e=EVENTS.parseLog(log);return e?.name==='NetworkVolumeProgress'&&e.args.job===BigInt(job);}catch{return false;}
   });
   if(!event)throw Error('V3_VOLUME_EVENT_NOT_VERIFIED');
   const parsed=EVENTS.parseLog(event);
   console.log('V3_VOLUME_CONFIRMED '+JSON.stringify({job,txHash:receipt.hash,nextAncestor:parsed.args.nextAncestor}));
   fs.unlinkSync(pending);cost+=limit*gasPrice;sent++;
   if(getAddress(parsed.args.nextAncestor)===ZeroAddress){atomic('cursor.json',{cursor:job+1});break;}
  }
  console.log('V3_VOLUME_RESULT '+JSON.stringify({job,confirmedTransactions:sent,noTokenTransfers:true}));
 }finally{rpc.destroy();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))
 main().catch(e=>{console.error('V3_VOLUME_BLOCKED '+String(e?.shortMessage||e?.message||e));process.exitCode=1;});
