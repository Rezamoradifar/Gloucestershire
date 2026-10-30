// Read-only mainnet preparation. No wallet, signer, broadcast or activation.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,JsonRpcProvider,id,keccak256} from 'ethers';
import {prepareMainnet,parseMainnetPreparationArgs,readMainnetPreparationRpc,validateMainnetConfiguration} from './server-mainnet.mjs';
import {getCompleteLogs,sanitizeCompleteLogDiagnostic} from './complete-rpc-logs.mjs';
const feedAbi=['function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)'];
const validBlock=b=>Number.isSafeInteger(b?.number)&&b.number>=0&&Number.isSafeInteger(b.timestamp)&&/^0x[0-9a-f]{64}$/i.test(b.hash||'');
export async function inspectMainnetHistory({provider,config,checkpoint}){
 const c=validateMainnetConfiguration(config);
 if((await provider.getNetwork()).chainId!==56n)throw Error('MAINNET_CHAIN_56_REQUIRED');
 if(!validBlock(checkpoint)||checkpoint.timestamp<86400)throw Error('MAINNET_HISTORY_CHECKPOINT_REQUIRED');
 const anchor=await provider.getBlock(checkpoint.number);
 if(!validBlock(anchor)||anchor.number!==checkpoint.number||anchor.hash!==checkpoint.hash||anchor.timestamp!==checkpoint.timestamp)throw Error('MAINNET_HISTORY_CHECKPOINT_CHANGED');
 const target=checkpoint.timestamp-86400;let low=0,high=checkpoint.number;
 while(low<high){const mid=Math.ceil((low+high)/2),b=await provider.getBlock(mid);if(!validBlock(b)||b.number!==mid)throw Error('MAINNET_HISTORY_HEADER_REQUIRED');if(b.timestamp<=target)low=mid;else high=mid-1;}
 const historical=await provider.getBlock(low);
 if(!validBlock(historical)||historical.number!==low||historical.timestamp>target)throw Error('MAINNET_HISTORY_HEADER_REQUIRED');
 const at={blockTag:historical.number},contracts=[];
 for(const key of ['usdt','bnbUsdFeed','usdtUsdFeed']){
  const code=await provider.getCode(c[key],historical.number);
  if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code))throw Error('MAINNET_HISTORY_CODE_REQUIRED');
  contracts.push({role:key,address:c[key],runtimeHash:keccak256(code)});
 }
 const token=new Contract(c.usdt,['function decimals() view returns(uint8)'],provider);
 if(await token.decimals(at)!==18n)throw Error('MAINNET_HISTORY_TOKEN_MISMATCH');
 const rounds=[];
 for(const key of ['bnbUsdFeed','usdtUsdFeed']){
  const [round,answer,,updated,answered]=await new Contract(c[key],feedAbi,provider).latestRoundData(at);
  if(round<=0n||answer<=0n||updated<=0n||updated>BigInt(historical.timestamp)||answered<round)throw Error('MAINNET_HISTORY_STATE_INVALID_OR_LATEST_SUBSTITUTED');
  rounds.push({role:key,round:round.toString(),updatedAt:updated.toString()});
 }
 const logs=await getCompleteLogs({provider,filter:{address:c.usdt,topics:[id('Transfer(address,address,uint256)')],fromBlock:historical.number,toBlock:Math.min(historical.number+9,checkpoint.number)},maxBlockSpan:10,maxRequests:16});
 const [again,oldAgain,network]=await Promise.all([provider.getBlock(checkpoint.number),provider.getBlock(historical.number),provider.getNetwork()]);
 if(network.chainId!==56n||again?.hash!==anchor.hash||oldAgain?.hash!==historical.hash)throw Error('MAINNET_HISTORY_CHECKPOINT_CHANGED');
 return {status:'verified-at-probed-blocks',requiredRetentionSeconds:86400,checkpoint:{block:anchor.number,hash:anchor.hash,timestamp:anchor.timestamp},historical:{block:historical.number,hash:historical.hash,timestamp:historical.timestamp},contracts,rounds,logCount:logs.length,scope:'production-token-and-feed-history-before-deployment',futureVaultHistoryVerified:false,fullArchiveRetentionGuaranteed:false};
}
export function mainnetReadinessFailure(e,phase){
 const rpc=e?.info?.error??e?.error,number=rpc?.code;
 const rpcCode=Number.isSafeInteger(number)&&number>=-2147483648&&number<=2147483647?number:null;
 const unsupported=phase==='HISTORICAL_RPC_PROBE'&&([-32601,-32004].includes(rpcCode)||(rpcCode===-32000&&/not supported|unsupported|pruned|missing trie|historical.*unavailable/i.test(rpc?.message||'')));
 return {phase:['ARGUMENT_VALIDATION','PRIVATE_RPC_SELECTION','PRODUCTION_PREFLIGHT','HISTORICAL_RPC_PROBE'].includes(phase)?phase:'UNKNOWN',errorCode:['TIMEOUT','NETWORK_ERROR','SERVER_ERROR','CALL_EXCEPTION','BAD_DATA','UNKNOWN_ERROR','UNSUPPORTED_OPERATION'].includes(e?.code)?e.code:null,rpcCode,...(e?.logProbeDiagnostic?{logProbeDiagnostic:sanitizeCompleteLogDiagnostic(e.logProbeDiagnostic)}:{}),blocker:unsupported?'MAINNET_HISTORICAL_RPC_UNSUPPORTED':/^(?:MAINNET|COMPLETE_LOG)_[A-Z0-9_]{2,100}$/.test(e?.message||'')?e.message:'MAINNET_RPC_OR_HISTORY_READ_FAILED',readyToDeploy:false,keysRead:false,signerOpened:false,transactionsSent:0};
}
async function main(){
 let provider,phase='ARGUMENT_VALIDATION';
 try{
  const args=parseMainnetPreparationArgs(['prepare',...process.argv.slice(2)]);
  if(!args.rpcFile)throw Error('MAINNET_EXPLICIT_PRIVATE_RPC_REQUIRED');
  phase='PRIVATE_RPC_SELECTION';
  const selected=readMainnetPreparationRpc(args.rpcFile),request=new FetchRequest(selected.url);request.timeout=15000;
  provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});
  const config=JSON.parse(fs.readFileSync(new URL('../config.mainnet.json',import.meta.url))),artifact=JSON.parse(fs.readFileSync(new URL('../artifacts/AutomaticGroupVault.json',import.meta.url)));
  phase='PRODUCTION_PREFLIGHT';
  const result=await prepareMainnet(provider,config,artifact,args.from),b=result.report.checkpoint;
  phase='HISTORICAL_RPC_PROBE';
  const history=await inspectMainnetHistory({provider,config,checkpoint:{number:b.block,hash:b.blockHash,timestamp:b.timestamp}});selected.assertCurrent();
  const report={...result.report,checkedAt:new Date().toISOString(),rpc:selected.proof,history,readyToDeploy:false};
  const directory=path.resolve('.mainnet-preparation');fs.mkdirSync(directory,{mode:0o700,recursive:true});const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700)throw Error('MAINNET_PRIVATE_PREPARATION_DIRECTORY_REQUIRED');
  const file=path.join(directory,'rpc-readiness-'+randomUUID()+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('MAINNET_RPC_AND_24H_HISTORY_PREFLIGHT_PASSED');
  console.log(JSON.stringify({chainId:56,readyToDeploy:false,periodSeconds:86400,history,blockers:report.blockers,report:file,keysRead:false,signerOpened:false,transactionsSent:0}));
 }catch(e){console.log('MAINNET_RPC_READINESS_BLOCKED');console.log(JSON.stringify(mainnetReadinessFailure(e,phase)));process.exitCode=1;}
 finally{await provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
