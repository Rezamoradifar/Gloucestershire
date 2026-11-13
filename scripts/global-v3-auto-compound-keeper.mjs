// V3 TESTNET-ONLY permissionless daily + profit-on-profit accounting.
// No manager approval, token transfer, withdrawal, mint, or mainnet signing.
import fs from 'node:fs';
import path from 'node:path';
import {Contract,FetchRequest,JsonRpcProvider,Wallet,getAddress,isAddress,keccak256,parseEther,formatEther,Interface} from 'ethers';
import {waitV3KeeperReceipt} from './v3-keeper-receipt-poll.mjs';

const CHAIN=97,DAY=86400,MAX_GAS=500000n,DEFAULT_LIMIT=100,DEFAULT_TX_LIMIT=30;
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const RETIRED_V2=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
const FEE_1=getAddress('0x7037cc199499d7a3431285a01e435454eae51265');
const FEE_2=getAddress('0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632');
const OPERATIONS=getAddress('0x8c4ac9b009808a0b49ba77b58e3871e7cdba463c');
const GAS_LIMIT_PER_TX=parseEther('0.005');
const GAS_LIMIT_PER_RUN=parseEther('0.15');
const MIN_GAS_BALANCE=parseEther('0.001');
const ABI=[
 'function asset() view returns(address)',
 'function FEE_WALLET_1() view returns(address)',
 'function FEE_WALLET_2() view returns(address)',
 'function OPERATIONS_WALLET() view returns(address)',
 'function DEPOSIT_FEE_EACH_BPS() view returns(uint256)',
 'function DEFAULT_ADMIN_ROLE() view returns(bytes32)',
 'function MANAGER_ROLE() view returns(bytes32)',
 'function FUNDER_ROLE() view returns(bytes32)',
 'function GUARDIAN_ROLE() view returns(bytes32)',
 'function hasRole(bytes32,address) view returns(bool)',
 'function paused() view returns(bool)',
 'function memberCount() view returns(uint256)',
 'function memberAt(uint256) view returns(address)',
 'function positionCount(address) view returns(uint256)',
 'function positionOf(address,uint256) view returns(tuple(uint256 principal,uint256 compoundedBasis,uint256 availableProfit,uint256 reservedProfit,uint256 reservedPrincipal,uint256 cumulativeDaily,uint256 cumulativeCompound,uint64 openedAt,uint64 lastAccruedAt,bool fromReinvestment))',
 'function isEligible(address) view returns(bool)',
 'function accrueDaily(address,uint256)',
 'event DailyClaimAccrued(address indexed user,uint256 indexed positionId,uint256 personal,uint256 compounded,uint256 total,uint256 at)'
];
const EVENTS=new Interface(ABI);
export function isDueV3Position({principal,lastAccruedAt,eligible,now,paused}){
 if(typeof principal!=='bigint'||principal<0n||!Number.isSafeInteger(lastAccruedAt)||
    !Number.isSafeInteger(now)||now<0||lastAccruedAt<0)throw Error('BAD_VERIFIED_V3_POSITION');
 return !paused&&eligible&&principal>0n&&now>=lastAccruedAt+DAY;
}
export function keeperReadiness({balance,privileged,paused}){
 if(typeof balance!=='bigint'||balance<0n||typeof privileged!=='boolean'||typeof paused!=='boolean')
  throw Error('V3_INVALID_KEEPER_READINESS_INPUT');
 return Object.freeze({
  ready:!privileged&&!paused&&balance>=MIN_GAS_BALANCE,
  enoughTestBNB:balance>=MIN_GAS_BALANCE,privileged,paused,
  minimumTestBNB:formatEther(MIN_GAS_BALANCE)
 });
}
const parseJson=filename=>JSON.parse(fs.readFileSync(path.resolve(filename),'utf8'));
function checkedConfig(filename){
 const raw=parseJson(filename);
 if(raw?.network!=='BNB_TESTNET_ONLY'||raw?.chainId!==CHAIN||
   typeof raw?.contract!=='string'||typeof raw?.runtimeHash!=='string'||
   !/^0x[0-9a-fA-F]{64}$/.test(raw.runtimeHash))
  throw Error('V3_PINNED_CHAIN97_CONFIG_REQUIRED');
 const contract=getAddress(raw.contract);
 if(contract===RETIRED_V2)throw Error('NO_V2_REPLACEMENT_OR_BACKDATED_ACCRUAL');
 if(raw.token!==TOKEN)throw Error('V3_ONLY_PINNED_MOCK_TEST_USDT');
 const maxMembers=Math.min(DEFAULT_LIMIT,raw.maxMembers??DEFAULT_LIMIT);
 const maxTransactions=Math.min(DEFAULT_TX_LIMIT,raw.maxTransactions??DEFAULT_TX_LIMIT);
 const maxPositions=Math.min(128,raw.maxPositionsPerMember??128);
 if(![maxMembers,maxTransactions,maxPositions].every(n=>Number.isSafeInteger(n)&&n>0))
  throw Error('INVALID_V3_KEEPER_BOUNDS');
 return {contract,runtimeHash:raw.runtimeHash.toLowerCase(),maxMembers,maxTransactions,maxPositions};
}
export function validateV3KeeperProof(config,proof){
 const hash=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value);
 if(!proof||proof.status!=='VERIFIED_BNB_TESTNET_ONLY'||proof.chainId!==CHAIN||
   !isAddress(proof.contract)||!isAddress(proof.asset)||getAddress(proof.asset)!==TOKEN||
   getAddress(proof.contract)!==config.contract||!hash(proof.runtimeHash)||
   proof.runtimeHash.toLowerCase()!==config.runtimeHash||!hash(proof.txHash)||
   !Number.isSafeInteger(proof.blockNumber)||proof.blockNumber<=0)
  throw Error('ROUTED_KEEPER_CONFIG_DEPLOYMENT_PROOF_MISMATCH');
 return {txHash:proof.txHash.toLowerCase(),blockNumber:proof.blockNumber};
}
function readPrivateProof(filename){
 const stat=fs.lstatSync(filename);
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||
    stat.uid!==process.getuid()||stat.size>30000)
  throw Error('ROUTED_KEEPER_PROOF_MUST_BE_PRIVATE_AND_OWNED_BY_OPERATOR');
 return parseJson(filename);
}
export function v3KeeperCursorPath(profile){
 if(profile===undefined||profile==='')return '/var/lib/globaldroptrade-v3-keeper/cursor.json';
 if(profile==='routed-testnet')return '/var/lib/globaldroptrade-v3-routed-keeper/cursor.json';
 throw Error('V3_RELEASE_PROFILE_INVALID');
}
function readCursor(filename){
 try{
  const parsed=parseJson(filename);
  const position=parsed.position??0;
  if(!Number.isSafeInteger(parsed.cursor)||parsed.cursor<0||
     !Number.isSafeInteger(position)||position<0)throw Error('INVALID_V3_CURSOR');
  return {member:parsed.cursor,position};
 }catch(e){if(e?.code==='ENOENT')return {member:0,position:0};throw e;}
}
function writeCursor(filename,value){
 fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
 fs.writeFileSync(filename+'.new',JSON.stringify({cursor:value.member,position:value.position})+'\n',{mode:0o600});
 fs.renameSync(filename+'.new',filename);
}
async function verifiedProvider(config,proof){
 const urls=['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com'];
 for(const url of urls){
  const req=new FetchRequest(url);req.timeout=9000;
  const provider=new JsonRpcProvider(req,CHAIN,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{
   const chain=await provider.send('eth_chainId',[]);
   const code=await provider.getCode(config.contract,'latest');
   if(Number(BigInt(chain))!==CHAIN||code==='0x'||
      keccak256(code).toLowerCase()!==config.runtimeHash)throw Error('V3_UNVERIFIED_RUNTIME');
   const contract=new Contract(config.contract,ABI,provider);
   if(getAddress(await contract.asset())!==TOKEN)throw Error('V3_TOKEN_NOT_PINNED_TEST_ASSET');
   if(proof){
    const [receipt,height,fee1,fee2,operations,bps]=await Promise.all([
     provider.getTransactionReceipt(proof.txHash),provider.getBlockNumber(),
     contract.FEE_WALLET_1(),contract.FEE_WALLET_2(),contract.OPERATIONS_WALLET(),
     contract.DEPOSIT_FEE_EACH_BPS()
    ]);
    if(!receipt||receipt.status!==1||typeof receipt.hash!=='string'||
       receipt.hash.toLowerCase()!==proof.txHash||!receipt.contractAddress||
       getAddress(receipt.contractAddress)!==config.contract||
       receipt.blockNumber!==proof.blockNumber||height<proof.blockNumber+2||
       getAddress(fee1)!==FEE_1||getAddress(fee2)!==FEE_2||
       getAddress(operations)!==OPERATIONS||bps!==1000n)
     throw Error('ROUTED_KEEPER_CHAIN_RECEIPT_OR_PAYMENT_MAP_MISMATCH');
   }
   return {provider,contract,url};
  }catch{provider.destroy();}
 }
 throw Error('V3_PUBLIC_TESTNET_DEPLOYMENT_NOT_VERIFIED_OR_RPC_UNAVAILABLE');
}
function readDedicatedKey(filename){
 const st=fs.lstatSync(filename);
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.uid!==process.getuid()||st.size>128)
  throw Error('KEEPER_DEDICATED_TESTNET_KEY_MUST_BE_PRIVATE_0600_AND_OWNED_BY_OPERATOR');
 const key=fs.readFileSync(filename,'utf8').trim();
 if(!/^0x[0-9a-f]{64}$/i.test(key))throw Error('INVALID_DEDICATED_GAS_ONLY_TESTNET_KEY');
 return key;
}
export async function scan(contract,head,config,cursor){
 if(await contract.paused())return {members:0,selected:[],start:cursor,next:cursor,paused:true};
 const size=Number(await contract.memberCount());
 if(!Number.isSafeInteger(size)||size<0)throw Error('INVALID_V3_MEMBER_COUNT');
 if(!size)return {members:0,selected:[],start:{member:0,position:0},next:{member:0,position:0},paused:false};
 const start={member:cursor.member%size,position:cursor.position};
 const total=Math.min(config.maxMembers,size),selected=[];
 for(let i=0;i<total;i++){
  const index=(start.member+i)%size;
  const member=getAddress(await contract.memberAt(index));
  if(!(await contract.isEligible(member)))continue;
  const count=Number(await contract.positionCount(member));
  if(!Number.isSafeInteger(count)||count<0)throw Error('INVALID_V3_POSITION_COUNT');
  const first=i===0?start.position:0;
  if(first>count)throw Error('INVALID_V3_POSITION_CURSOR');
  const end=Math.min(count,first+config.maxPositions);
  for(let j=first;j<end;j++){
   const p=await contract.positionOf(member,j);
   if(isDueV3Position({principal:BigInt(p.principal),lastAccruedAt:Number(p.lastAccruedAt),
     eligible:true,now:head.timestamp,paused:false}))selected.push({member,positionId:j});
  }
  if(end<count)return {members:size,selected,start,next:{member:index,position:end},paused:false};
 }
 return {members:size,selected,start,next:{member:(start.member+total)%size,position:0},paused:false};
}
async function main(){
 const args=process.argv.slice(2);
 if(args[0]==='--public-address'){
  if(args.length!==3||args[1]!=='--key-file')throw Error('V3_KEEPER_ADDRESS_USAGE_INVALID');
  const wallet=new Wallet(readDedicatedKey(path.resolve(args[2])));
  console.log('V3_KEEPER_GAS_ONLY_PUBLIC_ADDRESS='+wallet.address);
  return; // Offline public-address display only; never output signing material.
 }
 const [mode,...flags]=args;
 if(!['--check','--run'].includes(mode)||flags.length%2!==0)
  throw Error('V3_KEEPER_ARGUMENTS_INVALID');
 const options={};
 for(let i=0;i<flags.length;i+=2){
  const flag=flags[i],value=flags[i+1];
  if(!['--config','--key-file','--proof'].includes(flag)||!value||options[flag])
   throw Error('V3_KEEPER_ARGUMENTS_INVALID');
  options[flag]=value;
 }
 const configArg=options['--config'],maybeKey=options['--key-file'],proofArg=options['--proof'];
 if(!configArg||(mode==='--run'&&!maybeKey))throw Error('V3_KEEPER_ARGUMENTS_INVALID');
 const config=checkedConfig(configArg);
 const profile=process.env.GLOBAL_V3_RELEASE_PROFILE;
 const cursorPath=v3KeeperCursorPath(profile);
 if((profile==='routed-testnet')!==Boolean(proofArg))throw Error('ROUTED_KEEPER_PROOF_REQUIRED');
 const proof=proofArg?validateV3KeeperProof(config,readPrivateProof(path.resolve(proofArg))):null;
 const {provider,contract,url}=await verifiedProvider(config,proof);
 try{
  const head=await provider.getBlock('latest');
  if(!head||!head.hash)throw Error('NO_VERIFIED_TESTNET_HEAD');
  let signer=null,ready=null;
  if(maybeKey){
   signer=new Wallet(readDedicatedKey(path.resolve(maybeKey)),provider);
   const roles=await Promise.all([
    contract.DEFAULT_ADMIN_ROLE(),contract.MANAGER_ROLE(),contract.FUNDER_ROLE(),contract.GUARDIAN_ROLE()
   ]);
   const privileged=(await Promise.all(roles.map(role=>contract.hasRole(role,signer.address)))).some(Boolean);
   const balance=await provider.getBalance(signer.address);
   ready=keeperReadiness({balance,privileged,paused:Boolean(await contract.paused())});
   console.log('V3_KEEPER_READINESS '+JSON.stringify({
    chainId:97,contract:config.contract,wallet:signer.address,
    testBNB:formatEther(balance),...ready,transactionSent:false
   }));
   if(privileged)throw Error('USE_A_SEPARATE_GAS_ONLY_KEEPER_WITHOUT_ADMIN_ROLES');
   if(ready.paused)throw Error('V3_PAUSED_NO_KEEPER_TX_SENT');
   if(!ready.enoughTestBNB)throw Error('GAS_ONLY_KEEPER_HAS_TOO_LITTLE_TEST_BNB');
  }
  const plan=await scan(contract,head,config,readCursor(cursorPath));
  console.log('V3_AUTO_COMPOUND_PREFLIGHT '+JSON.stringify({
   chainId:CHAIN,contract:config.contract,block:head.number,source:url,
   paused:plan.paused,registered:plan.members,scannedFrom:plan.start,
   dueCount:plan.selected.length,nextCursor:plan.next,duePreview:plan.selected.slice(0,10),
   operatorApprovalRequired:false,profitOnProfitAutomatic:true,transferPerformed:false
  }));
  if(mode==='--check')return;
  if(plan.paused)throw Error('V3_PAUSED_NO_KEEPER_TX_SENT');
  if(!signer||!ready?.ready)throw Error('V3_KEEPER_NOT_READY_TO_SIGN');
  let sent=0,costLimitTotal=0n,failures=0;
  const payable=contract.connect(signer),confirmed=[];
  for(const item of plan.selected.slice(0,config.maxTransactions)){
   let hash=null;
   try{
    await payable.accrueDaily.staticCall(item.member,item.positionId);
    const gas=BigInt(await payable.accrueDaily.estimateGas(item.member,item.positionId));
    const gasLimit=gas*12n/10n;
    if(gas<=0n||gasLimit>MAX_GAS)throw Error('V3_AUTO_ACCRUAL_GAS_TOO_LARGE');
    const price=await provider.getFeeData();
    const gasPrice=price.gasPrice;
    if(!gasPrice||gasPrice<=0n||gasLimit*gasPrice>GAS_LIMIT_PER_TX||
       costLimitTotal+gasLimit*gasPrice>GAS_LIMIT_PER_RUN)
     throw Error('TESTNET_KEEPER_GAS_SPEND_LIMIT');
    if(await provider.getBalance(signer.address)<gasLimit*gasPrice)
     throw Error('GAS_ONLY_KEEPER_HAS_TOO_LITTLE_TEST_BNB');
    costLimitTotal+=gasLimit*gasPrice;
    // Actual signed gas price is bounded, not just a separate estimate.
    const tx=await payable.accrueDaily(item.member,item.positionId,{gasLimit,gasPrice});
    hash=tx.hash;
    console.log('V3_ACCRUAL_BROADCAST '+JSON.stringify({...item,txHash:hash}));
    const receipt=await waitV3KeeperReceipt(provider,hash,{confirmations:2});
    const recorded=receipt.logs.some(log=>{
     if(log.address.toLowerCase()!==config.contract.toLowerCase())return false;
     try{
      const event=EVENTS.parseLog({topics:log.topics,data:log.data});
      return event?.name==='DailyClaimAccrued'&&getAddress(event.args.user)===item.member&&
       BigInt(event.args.positionId)===BigInt(item.positionId);
     }catch{return false;}
    });
    if(!recorded)throw Error('V3_ACCRUAL_EVENT_NOT_VERIFIED_INSPECT_TX');
    sent++;confirmed.push({...item,tx:receipt.hash});
   }catch(e){
    failures++;
    console.error('V3_ACCRUAL_POSITION_SKIPPED '+JSON.stringify({
     ...item,txHash:hash,error:String(e?.shortMessage||e?.message||e).slice(0,150)
    }));
    // Do not broadcast another transaction after an unresolved send/receipt.
    if(hash)break;
   }
  }
  const deferred=plan.selected.length>config.maxTransactions;
  // Keep this member batch until all its due positions have been processed.
  // Already credited positions are no longer due, so they cannot credit twice.
  if(failures===0)writeCursor(cursorPath,deferred?plan.start:plan.next);
  console.log('V3_AUTO_COMPOUND_RUN_RESULT '+JSON.stringify({
   status:failures?'PARTIAL_REVIEW_REQUIRED':plan.selected.length?'SUCCESS':'NO_DUE_POSITIONS',
   chainId:97,due:plan.selected.length,sent,failures,deferred,
   transactionHashes:confirmed,gasBoundWei:costLimitTotal.toString(),
   wallet:signer.address,walletIsManager:false,realAssetTransfers:false
  }));
  if(failures)process.exitCode=2;
 }finally{provider.destroy();}
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 main().catch(e=>{
  console.error('V3_AUTO_COMPOUND_BLOCKED '+String(e?.message||e));
  process.exitCode=1;
 });
}
