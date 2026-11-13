// V3 TESTNET-ONLY keeper: permissionlessly triggers due daily + automatic
// profit-on-profit accrual. NO manager approvals, no ERC20 transfers, no
// withdrawal signatures, no minting, no privately held mainnet funds.
// NOT RUNNABLE until an independently verified NEW V3 chain-97 deployment is
// pinned by an operator in a separate file outside this repository.
import fs from 'node:fs';
import path from 'node:path';
import {Contract,FetchRequest,JsonRpcProvider,Wallet,getAddress,keccak256,parseEther,Interface} from 'ethers';

const CHAIN=97,DAY=86400,MAX_GAS=500000n,DEFAULT_LIMIT=100,DEFAULT_TX_LIMIT=30;
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const RETIRED_V2=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
const GAS_LIMIT_PER_TX=parseEther('0.005');
const GAS_LIMIT_PER_RUN=parseEther('0.15');
const ABI=[
 'function asset() view returns(address)',
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
const checkedPath=(filename)=>path.resolve(filename);
const parseJson=(filename)=>JSON.parse(fs.readFileSync(checkedPath(filename),'utf8'));
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
function readCursor(filename){
 try{
  const parsed=parseJson(filename);
  if(!Number.isSafeInteger(parsed.cursor)||parsed.cursor<0)throw Error('INVALID_V3_CURSOR');
  return parsed.cursor;
 }catch(e){
  if(e?.code==='ENOENT')return 0;
  throw e;
 }
}
function writeCursor(filename,value){
 fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
 const name=filename+'.new';
 fs.writeFileSync(name,JSON.stringify({cursor:value})+'\n',{mode:0o600});
 fs.renameSync(name,filename);
}
async function verifiedProvider(config){
 const urls=[
  'https://bsc-testnet-dataseed.bnbchain.org',
  'https://bsc-testnet-rpc.publicnode.com'
 ];
 for(const url of urls){
  const req=new FetchRequest(url);req.timeout=9000;
  const provider=new JsonRpcProvider(req,CHAIN,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{
   const [chain,code]=await Promise.all([
    provider.send('eth_chainId',[]),provider.getCode(config.contract,'latest')
   ]);
   if(Number(BigInt(chain))!==CHAIN||code==='0x'||
      keccak256(code).toLowerCase()!==config.runtimeHash)throw Error('V3_UNVERIFIED_RUNTIME');
   const contract=new Contract(config.contract,ABI,provider);
   if(getAddress(await contract.asset())!==TOKEN)throw Error('V3_TOKEN_NOT_PINNED_TEST_ASSET');
   return {provider,contract,url};
  }catch{provider.destroy();}
 }
 throw Error('V3_PUBLIC_TESTNET_DEPLOYMENT_NOT_VERIFIED_OR_RPC_UNAVAILABLE');
}
function readDedicatedKey(filename){
 const st=fs.lstatSync(filename);
 if(!st.isFile()||(st.mode&0o077)!==0||st.uid!==process.getuid()||st.size>128)
  throw Error('KEEPER_DEDICATED_TESTNET_KEY_MUST_BE_PRIVATE_0600_AND_OWNED_BY_OPERATOR');
 const key=fs.readFileSync(filename,'utf8').trim();
 if(!/^0x[0-9a-f]{64}$/i.test(key))throw Error('INVALID_DEDICATED_GAS_ONLY_TESTNET_KEY');
 return key;
}
const recentCount=(n)=>Number(n);
async function scan(contract,head,config,cursor){
 if(await contract.paused())return {members:0,selected:[],start:cursor,next:cursor,paused:true};
 const size=recentCount(await contract.memberCount());
 if(!Number.isSafeInteger(size)||size<0)throw Error('INVALID_V3_MEMBER_COUNT');
 if(!size)return {members:0,selected:[],start:0,next:0,paused:false};
 const start=cursor%size,total=Math.min(config.maxMembers,size),selected=[];
 for(let i=0;i<total;i++){
  const index=(start+i)%size;
  const member=getAddress(await contract.memberAt(index));
  if(!(await contract.isEligible(member)))continue;
  const count=recentCount(await contract.positionCount(member));
  if(!Number.isSafeInteger(count)||count<0||count>config.maxPositions)
   throw Error('V3_TOO_MANY_POSITIONS_FOR_SAFE_KEEPER_SCAN');
  for(let j=0;j<count;j++){
   const p=await contract.positionOf(member,j);
   if(isDueV3Position({
    principal:BigInt(p.principal),lastAccruedAt:Number(p.lastAccruedAt),
    eligible:true,now:head.timestamp,paused:false
   }))selected.push({member,positionId:j});
  }
 }
 return {members:size,selected,start,next:(start+total)%size,paused:false};
}

async function main(){
 const [mode,flag,configArg,extra,maybeKey]=process.argv.slice(2);
 if(!['--check','--run'].includes(mode)||flag!=='--config'||!configArg||
    (extra!==undefined&&(mode!=='--run'||extra!=='--key-file'||!maybeKey))||
    (mode==='--run'&&!maybeKey))
  throw Error('Usage: --check --config /abs/v3-keeper.json OR --run --config /abs/v3-keeper.json --key-file /abs/dedicated-GAS-ONLY-testnet.key');
 const config=checkedConfig(configArg);
 const cursorPath='/var/lib/globaldroptrade-v3-keeper/cursor.json';
 const {provider,contract,url}=await verifiedProvider(config);
 try{
  const head=await provider.getBlock('latest');
  if(!head||!head.hash)throw Error('NO_VERIFIED_TESTNET_HEAD');
  const cursor=readCursor(cursorPath);
  const plan=await scan(contract,head,config,cursor);
  console.log('V3_AUTO_COMPOUND_PREFLIGHT '+JSON.stringify({
   chainId:CHAIN,contract:config.contract,block:head.number,source:url,
   paused:plan.paused,registered:plan.members,scannedFrom:plan.start,
   dueCount:plan.selected.length,nextCursor:plan.next,
   duePreview:plan.selected.slice(0,10),operatorApprovalRequired:false,
   profitOnProfitAutomatic:true,transferPerformed:false
  }));
  if(mode==='--check')return;
  if(plan.paused)throw Error('V3_PAUSED_NO_KEEPER_TX_SENT');
  const signer=new Wallet(readDedicatedKey(checkedPath(maybeKey)),provider);
  // A designated permissionless gas-only signer; never the role-holding admin
  // or wallet that controls customer funds.
  const roles=await Promise.all([
   contract.MANAGER_ROLE(),contract.FUNDER_ROLE(),contract.GUARDIAN_ROLE()
  ]);
  if((await Promise.all(roles.map(role=>contract.hasRole(role,signer.address)))).some(Boolean))
   throw Error('USE_A_SEPARATE_GAS_ONLY_KEEPER_WITHOUT_ADMIN_ROLES');
  const balance=await provider.getBalance(signer.address);
  if(balance<parseEther('0.001'))throw Error('GAS_ONLY_KEEPER_HAS_TOO_LITTLE_TEST_BNB');
  let sent=0,costLimitTotal=0n,failures=0;
  const payable=contract.connect(signer);
  const confirmed=[];
  for(const item of plan.selected.slice(0,config.maxTransactions)){
   try{
    // Simulation re-checks eligibility, paused state and cooldown after the scan.
    await payable.accrueDaily.staticCall(item.member,item.positionId);
    const gas=BigInt(await payable.accrueDaily.estimateGas(item.member,item.positionId));
    if(gas<=0n||gas*12n/10n>MAX_GAS)throw Error('V3_AUTO_ACCRUAL_GAS_TOO_LARGE');
    const price=await provider.getFeeData();
    const maxFee=price.maxFeePerGas??price.gasPrice;
    if(!maxFee||maxFee<=0n||gas*12n/10n*maxFee>GAS_LIMIT_PER_TX||
        costLimitTotal+gas*12n/10n*maxFee>GAS_LIMIT_PER_RUN)
     throw Error('TESTNET_KEEPER_GAS_SPEND_LIMIT');
    costLimitTotal+=gas*12n/10n*maxFee;
    const tx=await payable.accrueDaily(item.member,item.positionId,{gasLimit:gas*12n/10n});
    const receipt=await tx.wait(2);
    if(receipt?.status!==1)throw Error('V3_ACCRUAL_NOT_CONFIRMED');
    const recorded=receipt.logs.some(log=>{
     if(log.address.toLowerCase()!==config.contract.toLowerCase())return false;
     try{
      const e=EVENTS.parseLog({topics:log.topics,data:log.data});
      return e?.name==='DailyClaimAccrued'&&
       getAddress(e.args.user)===item.member&&
       BigInt(e.args.positionId)===BigInt(item.positionId);
     }catch{return false;}
    });
    if(!recorded)throw Error('V3_ACCRUAL_EVENT_NOT_VERIFIED_INSPECT_TX');
    sent++;
    confirmed.push({member:item.member,positionId:item.positionId,tx:receipt.hash});
   }catch(e){
    failures++;
    console.error('V3_ACCRUAL_POSITION_SKIPPED '+JSON.stringify({
     member:item.member,positionId:item.positionId,
     error:String(e?.shortMessage||e?.message||e).slice(0,150)
    }));
   }
  }
  // Fail closed: do NOT move cursor on errors; a retry will only attempt
  // currently eligible positions and the contract enforces one period / day.
  if(failures===0)writeCursor(cursorPath,plan.next);
  console.log('V3_AUTO_COMPOUND_RUN_RESULT '+JSON.stringify({
   status:failures?'PARTIAL_REVIEW_REQUIRED':'SUCCESS',chainId:97,
   due:plan.selected.length,sent,failures,transactionHashes:confirmed,
   gasBoundWei:costLimitTotal.toString(),wallet:signer.address,
   walletIsManager:false,realAssetTransfers:false
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
