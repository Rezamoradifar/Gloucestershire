// Verified, signer-free RPC failover for BNB Testnet new-user diagnostics.
// A complete report uses exactly one endpoint, never mixed historical reads.
import {FetchRequest,JsonRpcProvider,getAddress,keccak256} from 'ethers';
const hash=/^0x[0-9a-fA-F]{64}$/;
const fail=code=>{throw Error(code);};

export function classifyDiagnosticRpcFailure(error){
 const code=error?.code;
 const text=String(error?.shortMessage??error?.message??'').toLowerCase();
 if(code==='TIMEOUT'||/timeout|timed out/.test(text))return 'TIMEOUT';
 if(code==='NETWORK_ERROR'||/network|socket|connection|fetch failed|bad gateway/.test(text))return 'TRANSPORT_UNAVAILABLE';
 if(/missing trie|pruned|historical|header not found|unknown block|state unavailable|archive/.test(text))return 'HISTORICAL_STATE_UNAVAILABLE';
 if(/rate limit|too many requests|quota|http 429/.test(text))return 'RATE_LIMITED';
 if(/unauthorized|invalid api key|http 401|http 403|forbidden/.test(text))return 'AUTHENTICATION_REQUIRED';
 if(code==='CALL_EXCEPTION'||code==='BAD_DATA')return 'INVALID_HISTORICAL_RESPONSE';
 return 'RPC_READ_UNAVAILABLE';
}
export function selectDiagnosticRpcUrls(config){
 const urls=config?.rpcUrls?.length?config.rpcUrls:[config?.rpcUrl].filter(Boolean);
 if(config?.chainId!==97||!Array.isArray(urls)||!urls.length||urls.length>4||
   urls.some(url=>typeof url!=='string'||!url.trim()||
    !['https:','http:'].includes(new URL(url).protocol)))fail('NEW_USER_DIAGNOSTIC_RPC_CONFIG_REQUIRED');
 return [...new Set(urls)];
}
export async function verifyDiagnosticCandidate(provider,{expectedVault,runtimeHash,deploymentBlock,confirmations=3}){
 if(!Number.isSafeInteger(deploymentBlock)||deploymentBlock<1||
    !Number.isSafeInteger(confirmations)||confirmations<3||confirmations>100||!hash.test(runtimeHash||''))fail('NEW_USER_DIAGNOSTIC_RPC_BINDING_INVALID');
 const vault=getAddress(expectedVault);
 if(Number(await provider.send('eth_chainId',[]))!==97)fail('NEW_USER_DIAGNOSTIC_RPC_WRONG_CHAIN');
 const tip=await provider.getBlockNumber(),number=tip-confirmations;
 if(number<deploymentBlock)fail('NEW_USER_DIAGNOSTIC_RPC_HEAD_BEHIND');
 const [head,deployment,code,oldCode]=await Promise.all([
  provider.getBlock(number),provider.getBlock(deploymentBlock),
  provider.getCode(vault,number),provider.getCode(vault,deploymentBlock)
 ]);
 if(!head||head.number!==number||!deployment||deployment.number!==deploymentBlock||
  typeof head.hash!=='string'||!hash.test(head.hash)||!hash.test(deployment.hash||'')||
  !/^0x(?:[0-9a-f]{2})+$/i.test(code)||!/^0x(?:[0-9a-f]{2})+$/i.test(oldCode))
  fail('NEW_USER_DIAGNOSTIC_RPC_ARCHIVE_REQUIRED');
 if(keccak256(code).toLowerCase()!==runtimeHash.toLowerCase()||
   keccak256(oldCode).toLowerCase()!==runtimeHash.toLowerCase())
  fail('NEW_USER_DIAGNOSTIC_RPC_RUNTIME_MISMATCH');
 const result=await provider.getBlock(number);
 if(!result||result.hash?.toLowerCase()!==head.hash.toLowerCase())fail('NEW_USER_DIAGNOSTIC_RPC_REORG');
 return head;
}
export async function withVerifiedDiagnosticRpc({config,expectedVault,runtimeHash,deploymentBlock,read,
 providerFactory=url=>{
  const request=new FetchRequest(url);request.timeout=12000;
  return new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 },onAttempt=()=>{}}){
 if(typeof read!=='function'||typeof providerFactory!=='function'||typeof onAttempt!=='function')fail('NEW_USER_DIAGNOSTIC_RPC_OPTIONS_REQUIRED');
 const urls=selectDiagnosticRpcUrls(config),statuses=[];
 for(let i=0;i<urls.length;i++){
  let provider;
  try{
   provider=providerFactory(urls[i]);
   const head=await verifyDiagnosticCandidate(provider,{expectedVault,runtimeHash,deploymentBlock,
    confirmations:Math.max(3,config.confirmations??3)});
   const output=await read(provider,head);
   const event={candidate:i+1,status:'verified'};
   statuses.push(event);onAttempt(event);
   return {output,usedCandidate:i+1,statuses};
  }catch(error){
   // An identity mismatch or invalid activity history must NOT be silently
   // papered over by switching RPC endpoints.
   const name=String(error?.message??'');
   if(name==='NEW_USER_DIAGNOSTIC_RPC_WRONG_CHAIN'||
      name==='NEW_USER_DIAGNOSTIC_RPC_RUNTIME_MISMATCH'||
      name==='NEW_USER_DIAGNOSTIC_RPC_REORG'||
      name==='NEW_USER_DIAGNOSTIC_RPC_BINDING_INVALID'||
      name.startsWith('DAILY_ACTIVITY_')&&name!=='DAILY_ACTIVITY_CANONICAL_BLOCK_UNAVAILABLE'||
      name.startsWith('NEW_USER_DIAGNOSTIC_')&&!name.startsWith('NEW_USER_DIAGNOSTIC_RPC_'))throw error;
   const reason=name==='NEW_USER_DIAGNOSTIC_RPC_ARCHIVE_REQUIRED'?'HISTORICAL_STATE_UNAVAILABLE':
    name==='NEW_USER_DIAGNOSTIC_RPC_HEAD_BEHIND'?'LAGGING_NODE':
    classifyDiagnosticRpcFailure(error);
   const event={candidate:i+1,status:'unavailable',reason};
   statuses.push(event);onAttempt(event);
  }finally{provider?.destroy?.();}
 }
 // None of the configured RPCs could prove the complete report.
 const problem=Error('NEW_USER_DIAGNOSTIC_NO_VERIFIED_ARCHIVE_RPC');
 problem.statuses=statuses;
 throw problem;
}
