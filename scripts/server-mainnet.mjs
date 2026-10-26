// Preparation is deliberately key-free. This entrypoint cannot sign or deploy.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,ZeroAddress,getAddress,keccak256,parseEther} from 'ethers';

export const mainnetPreparationPolicy=Object.freeze({
 chainId:56,releaseId:'global-fresh-mainnet-v1',artifact:'AutomaticGroupVault',
 artifactHash:'0x64f24990045d9ef3d268e97657ed6e6af013cb73fc8ec39b9a862929c069e8cf',
 owner:'0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632',
 usdt:'0x55d398326f99059fF775485246999027B3197955',
 bnbUsdFeed:'0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE',
 usdtUsdFeed:'0xB97Ad0E74fa7d920791E90258A6E2085088b4320',
 dailyPeriodSeconds:86400,maxOracleAge:3600,runtimeBytes:24181,maximumGasWei:parseEther('0.02').toString()
});
const sha256=value=>createHash('sha256').update(value).digest('hex');
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const noSigning={signerOpened:false,keysRead:false,transactionsSigned:0,transactionsSent:0};
const blockers=[
 'MAINNET_DEPLOYMENT_DISABLED_PREPARATION_ONLY',
 'LIVE_TESTNET_CREDIT_AND_APPROVED_PAYOUT_EVIDENCE_REQUIRED',
 'MAINNET_CONNECTION_AND_WORKER_ACTIVATION_REQUIRED',
 'MAINNET_REWARD_FUNDING_AND_ARCHIVE_PROOF_REQUIRED',
 'MAINNET_SERVER_REPORTER_GOVERNANCE_REQUIRED',
 'MAINNET_RECIPIENT_CONFIRMATION_REQUIRED',
 'OWNER_LIQUIDITY_AUTHORITY_REQUIRES_REVIEW'
];
function address(value){let result;try{result=getAddress(value);}catch{throw Error('MAINNET_PUBLIC_ADDRESS_REQUIRED');}if(result===ZeroAddress)throw Error('MAINNET_PUBLIC_ADDRESS_REQUIRED');return result;}
export function validateMainnetConfiguration(config){
 const allowed=['version','releaseId','chainId','artifact','artifactHash','initialOwner','usdt','bnbUsdFeed','usdtUsdFeed','maxOracleAge','dailyPeriodSeconds','partners','dropshippingWallet'];
 if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(key=>!allowed.includes(key))||config.version!==1||config.releaseId!==mainnetPreparationPolicy.releaseId||config.chainId!==56||config.artifact!=='AutomaticGroupVault'||config.artifactHash!==mainnetPreparationPolicy.artifactHash||config.dailyPeriodSeconds!==86400)throw Error('MAINNET_ORDINARY_FRESH_CONFIGURATION_REQUIRED');
 if(address(config.initialOwner)!==mainnetPreparationPolicy.owner)throw Error('MAINNET_APPROVED_OWNER_REQUIRED');
 for(const key of ['usdt','bnbUsdFeed','usdtUsdFeed'])if(address(config[key])!==mainnetPreparationPolicy[key])throw Error('MAINNET_PRODUCTION_ASSET_AND_FEEDS_REQUIRED');
 if(config.maxOracleAge!==mainnetPreparationPolicy.maxOracleAge||!Array.isArray(config.partners)||config.partners.length!==7)throw Error('MAINNET_CONFIGURATION_INVALID');
 const partners=config.partners.map(address),operations=address(config.dropshippingWallet);
 if(new Set(partners).size!==7||['0x7037cc199499d7a3431285a01e435454eae51265',mainnetPreparationPolicy.owner.toLowerCase(),'0x74015dedf36677485793f1714ec7bd4893907b26'].includes(operations.toLowerCase()))throw Error('MAINNET_CONFIGURATION_INVALID');
 return {...config,initialOwner:address(config.initialOwner),usdt:address(config.usdt),bnbUsdFeed:address(config.bnbUsdFeed),usdtUsdFeed:address(config.usdtUsdFeed),partners,dropshippingWallet:operations};
}
function validateArtifact(artifact){
 const bytecode=artifact?.evm?.bytecode?.object,runtime=artifact?.evm?.deployedBytecode?.object;
 if(typeof bytecode!=='string'||!/^([0-9a-f]{2})+$/i.test(bytecode)||keccak256('0x'+bytecode)!==mainnetPreparationPolicy.artifactHash||typeof runtime!=='string'||!/^([0-9a-f]{2})+$/i.test(runtime)||runtime.length/2!==mainnetPreparationPolicy.runtimeBytes||runtime.length/2>24576||bytecode.length/2>49152||!Array.isArray(artifact.abi)||!String(artifact.compiler).startsWith('0.8.30+'))throw Error('MAINNET_ORDINARY_FRESH_ARTIFACT_REQUIRED');
 const constructor=artifact.abi.find(item=>item.type==='constructor');
 if(JSON.stringify(constructor?.inputs?.map(item=>item.type))!==JSON.stringify(['address','address','address','address','uint256','address[]','address'])||constructor.stateMutability!=='nonpayable'||!['AUTO_REWARD_GROUP_VERSION','REWARD_ACCRUAL_VERSION','withdrawalQueue','claimNetworkRewards'].every(name=>artifact.abi.some(item=>item.type==='function'&&item.name===name))||artifact.abi.some(item=>item.name==='FAST_TESTNET_VERSION'))throw Error('MAINNET_ORDINARY_FRESH_ARTIFACT_REQUIRED');
 return {bytecode:'0x'+bytecode,runtimeBytes:runtime.length/2};
}
export async function planMainnet(config,artifact,simulationFrom){
 const c=validateMainnetConfiguration(config),compiled=validateArtifact(artifact),from=simulationFrom===undefined?null:address(simulationFrom);
 const args=[c.initialOwner,c.usdt,c.bnbUsdFeed,c.usdtUsdFeed,c.maxOracleAge,c.partners,c.dropshippingWallet];
 const request=await new ContractFactory(artifact.abi,compiled.bytecode).getDeployTransaction(...args);
 if(request.to!==undefined||BigInt(request.value??0)!==0n||typeof request.data!=='string'||request.data.length/2-1>49152)throw Error('MAINNET_UNSIGNED_CONSTRUCTOR_REQUIRED');
 return {config:c,args,request,report:{
  version:1,kind:'fresh-mainnet-preparation',releaseId:c.releaseId,chainId:56,status:'offline-plan',preparationOnly:true,readyToDeploy:false,
  artifact:'AutomaticGroupVault',artifactHash:c.artifactHash,compiler:artifact.compiler,runtimeBytes:compiled.runtimeBytes,
  configurationHash:sha256(JSON.stringify(c)),simulationFrom:from,constructorArguments:args,
  unsignedDeployment:{chainId:56,to:null,value:'0',data:request.data,initcodeHash:keccak256(request.data)},
  economics:{periodSeconds:86400,basis:'period-start-active-principal',includeCompletedReinvestment:true,automaticReinvestment:false,withdrawalApprovalRequired:true,initialReporters:[c.initialOwner],serverReporterPartnerVotes:2,serverReporterDelaySeconds:172800},
  trustModel:{ownerMayWithdrawAllLiquidAssets:true,rewardFundingIsNotGuaranteed:true,partnerAndOperationsAddressesReconfirmed:false,depositRouting:{feesEachBps:1000,operationsBps:8000,principalRetainedBps:0},dailyReporterCanAllocateWithinBudget:true,unfundedNetworkClaimsPossible:true},
  blockers:['MAINNET_RPC_PREFLIGHT_REQUIRED',...blockers],...noSigning
 }};
}
export async function prepareMainnet(provider,config,artifact,simulationFrom){
 if(simulationFrom===undefined)throw Error('MAINNET_PUBLIC_SIMULATION_FROM_REQUIRED');
 const plan=await planMainnet(config,artifact,simulationFrom),c=plan.config,from=address(simulationFrom);
 if((await provider.getNetwork()).chainId!==56n)throw Error('MAINNET_CHAIN_56_REQUIRED');
 const head=await provider.getBlockNumber();
 if(!integer(head)||head<3)throw Error('MAINNET_CHECKPOINT_REQUIRED');
 const block=await provider.getBlock(head-3);
 if(block?.number!==head-3||!hash(block.hash)||!integer(block.timestamp))throw Error('MAINNET_CHECKPOINT_REQUIRED');
 const at={blockTag:block.number},contracts=[];
 for(const key of ['usdt','bnbUsdFeed','usdtUsdFeed']){
  const code=await provider.getCode(c[key],block.number);
  if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code))throw Error('MAINNET_PRODUCTION_CODE_REQUIRED');
  contracts.push({role:key,address:c[key],runtimeHash:keccak256(code)});
 }
 const token=new Contract(c.usdt,['function decimals() view returns(uint8)','function symbol() view returns(string)'],provider);
 if(await token.decimals(at)!==18n||await token.symbol(at)!=='USDT')throw Error('MAINNET_TOKEN_METADATA_MISMATCH');
 const feeds=[];
 for(const [key,description]of [['bnbUsdFeed','BNB / USD'],['usdtUsdFeed','USDT / USD']]){
  const feed=new Contract(c[key],['function description() view returns(string)','function decimals() view returns(uint8)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)'],provider);
  const [desc,decimals,round]=await Promise.all([feed.description(at),feed.decimals(at),feed.latestRoundData(at)]),[id,answer,,updatedAt,answeredInRound]=round;
  if(desc!==description||decimals!==8n||id===0n||answer<=0n||updatedAt===0n||updatedAt>BigInt(block.timestamp)||BigInt(block.timestamp)-updatedAt>BigInt(c.maxOracleAge)||answeredInRound<id)throw Error('MAINNET_LIVE_ORACLE_INVALID_OR_STALE');
  feeds.push({address:c[key],description:desc,decimals:8,round:id.toString(),answer:answer.toString(),updatedAt:updatedAt.toString(),answeredInRound:answeredInRound.toString(),ageSeconds:(BigInt(block.timestamp)-updatedAt).toString(),maxOracleAge:c.maxOracleAge});
 }
 const gas=await provider.estimateGas({...plan.request,from,value:0}),fees=await provider.getFeeData();
 if(typeof gas!=='bigint'||gas<=0n||typeof fees.gasPrice!=='bigint'||fees.gasPrice<=0n)throw Error('MAINNET_GAS_ESTIMATE_REQUIRED');
 const gasLimit=gas*120n/100n,cost=gasLimit*fees.gasPrice;
 if(cost>BigInt(mainnetPreparationPolicy.maximumGasWei))throw Error('MAINNET_GAS_SAFETY_LIMIT_EXCEEDED');
 const final=await provider.getBlock(block.number);
 if(final?.number!==block.number||final.hash!==block.hash||final.timestamp!==block.timestamp||(await provider.getNetwork()).chainId!==56n)throw Error('MAINNET_CHECKPOINT_CHANGED');
 const report={...plan.report,status:'rpc-preflight-passed',checkpoint:{block:block.number,blockHash:block.hash,timestamp:block.timestamp,observedHead:head,confirmations:3},contracts,feeds,simulationFrom:from,
  unsignedDeployment:{...plan.report.unsignedDeployment,from,gasLimit:gasLimit.toString(),gasPrice:fees.gasPrice.toString(),maximumGasCostWei:cost.toString(),gasCostLimitWei:mainnetPreparationPolicy.maximumGasWei},
  blockers:[...blockers],proofScope:'selected-rpc-read-only-constructor-and-live-asset-validation',independentCanonicalProof:false};
 return {...plan,gasLimit,gasPrice:fees.gasPrice,cost,feeds,report};
}
export function parseMainnetPreparationArgs(args){
 if(!Array.isArray(args)||!args.every(value=>typeof value==='string'))throw Error('MAINNET_PREPARATION_ARGUMENTS_REQUIRED');
 const action=args[0]??'plan';
 if(action==='deploy')throw Error('MAINNET_DEPLOYMENT_DISABLED_PREPARATION_ONLY');
 if(!['plan','prepare'].includes(action))throw Error('MAINNET_PREPARATION_ARGUMENTS_REQUIRED');
 let from,rpcFile;
 for(let i=1;i<args.length;i++){
  if(args[i]==='--from'&&from===undefined&&args[i+1]){from=address(args[++i]);continue;}
  if(args[i]==='--rpc-file'&&rpcFile===undefined&&args[i+1]&&path.isAbsolute(args[i+1])){rpcFile=args[++i];continue;}
  throw Error('MAINNET_PREPARATION_ARGUMENTS_REQUIRED');
 }
 if(action==='prepare'&&from===undefined)throw Error('MAINNET_PUBLIC_SIMULATION_FROM_REQUIRED');
 if(action==='plan'&&rpcFile!==undefined)throw Error('MAINNET_OFFLINE_PLAN_DOES_NOT_USE_RPC');
 return {action,from,rpcFile};
}
function readJson(file){
 let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const s=fs.fstatSync(fd);if(!s.isFile()||s.size>8*1024*1024)throw Error();return JSON.parse(fs.readFileSync(fd,'utf8'));}catch{throw Error('MAINNET_REVIEWED_JSON_REQUIRED');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function readMainnetPreparationRpc(file){
 if(file===undefined)return {url:'https://bsc-dataseed-public.bnbchain.org',proof:{kind:'public',urlSha256:sha256('https://bsc-dataseed-public.bnbchain.org')},assertCurrent:()=>{}};
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('MAINNET_PRIVATE_RPC_FILE_REQUIRED');
 const read=()=>{
  let fd;try{
   fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const s=fs.fstatSync(fd);
   if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o777)!==0o600||s.size<1||s.size>16384)throw Error();
   const bytes=fs.readFileSync(fd),text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))throw Error();
   const url=text.endsWith('\r\n')?text.slice(0,-2):text.endsWith('\n')?text.slice(0,-1):text,parsed=new URL(url);
   if(!url||/[\s\p{Cc}"'\\]/u.test(url)||parsed.protocol!=='https:'||!/^https:\/\//i.test(url)||!parsed.hostname||parsed.username||parsed.password||parsed.hash||url.includes('#'))throw Error();
   return {url,bytes};
  }catch{throw Error('MAINNET_PRIVATE_RPC_FILE_REQUIRED');}finally{if(fd!==undefined)fs.closeSync(fd);}
 };
 const selected=read();return {url:selected.url,proof:{kind:'private',urlSha256:sha256(selected.url),fileSha256:sha256(selected.bytes)},assertCurrent:()=>{if(!read().bytes.equals(selected.bytes))throw Error('MAINNET_PRIVATE_RPC_FILE_CHANGED');}};
}
function writeReport(name,value){
 const directory=path.resolve('.mainnet-preparation');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});const d=fs.lstatSync(directory);
 if(!d.isDirectory()||d.isSymbolicLink()||d.uid!==process.getuid()||(d.mode&0o777)!==0o700)throw Error('MAINNET_PRIVATE_PREPARATION_DIRECTORY_REQUIRED');
 const file=path.join(directory,name);
 try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o600)throw Error('MAINNET_PRIVATE_PREPARATION_REPORT_REQUIRED');}catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=file+'.'+randomUUID()+'.tmp';let fd;
 try{fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,file);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
 return file;
}
async function main(){
 let provider,parsed;
 try{
  parsed=parseMainnetPreparationArgs(process.argv.slice(2));
  const config=readJson(new URL('../config.mainnet.json',import.meta.url)),artifact=readJson(new URL('../artifacts/AutomaticGroupVault.json',import.meta.url));
  let result;
  if(parsed.action==='plan')result=await planMainnet(config,artifact,parsed.from);
  else{
   const selected=readMainnetPreparationRpc(parsed.rpcFile),transport=new FetchRequest(selected.url);transport.timeout=20000;
   provider=new JsonRpcProvider(transport,undefined,{cacheTimeout:-1,batchMaxCount:1});
   result=await prepareMainnet(provider,config,artifact,parsed.from);selected.assertCurrent();result.report.rpc=selected.proof;
  }
  result.report.checkedAt=new Date().toISOString();
  const reportFile=writeReport(parsed.action==='plan'?'unsigned-plan-public.json':'preflight-public.json',result.report);
  console.log(parsed.action==='plan'?'MAINNET_UNSIGNED_FRESH_PLAN_PREPARED':'MAINNET_READ_ONLY_PREFLIGHT_PASSED');
  console.log(JSON.stringify({version:1,kind:result.report.kind,status:result.report.status,chainId:56,artifact:result.report.artifact,owner:result.config.initialOwner,simulationFrom:result.report.simulationFrom,artifactHash:result.report.artifactHash,initcodeHash:result.report.unsignedDeployment.initcodeHash,readyToDeploy:false,blockers:result.report.blockers,report:reportFile,...noSigning}));
 }catch(error){
  const blocker=/^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message??'')?error.message:'MAINNET_READ_ONLY_PREFLIGHT_FAILED';
  const failure={version:1,kind:'fresh-mainnet-preparation-error',status:'blocked',chainId:56,readyToDeploy:false,blocker,checkedAt:new Date().toISOString(),...noSigning};
  if(parsed){try{writeReport(parsed.action==='plan'?'unsigned-plan-public.json':'preflight-public.json',failure);}catch{}}
  console.log('MAINNET_PREPARATION_STOPPED');console.log(JSON.stringify(failure));process.exitCode=1;
 }finally{provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
