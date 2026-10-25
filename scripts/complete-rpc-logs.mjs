// Complete bounded log windows using one provider and one immutable filter.
import {getAddress,ZeroAddress} from 'ethers';
import {Buffer} from 'node:buffer';

const learnedSpans=new WeakMap();
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const errorCodes=new Set(['CALL_EXCEPTION','NETWORK_ERROR','SERVER_ERROR','TIMEOUT','BAD_DATA','UNKNOWN_ERROR','UNSUPPORTED_OPERATION','INVALID_ARGUMENT','NUMERIC_FAULT','BUFFER_OVERRUN','CANCELLED']);
const reasons=new Set(['BLOCK_RANGE_LIMIT','RESULT_LIMIT','RATE_LIMITED','AUTHENTICATION_REQUIRED','HISTORICAL_STATE_UNAVAILABLE','TIMEOUT','METHOD_UNAVAILABLE','TRANSPORT_UNAVAILABLE','INVALID_REQUEST','INVALID_RESPONSE','UNKNOWN','CANONICAL_MISMATCH','CONFLICTING_DUPLICATE','REQUEST_BUDGET_EXCEEDED']);
const operations=new Set(['eth_getLogs','getBlock','validate-logs']);
const fatalReasons=new Set(['CANONICAL_MISMATCH','CONFLICTING_DUPLICATE','INVALID_RESPONSE']);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rpcCode=value=>Number.isSafeInteger(value)&&value>=-2147483648&&value<=2147483647;

function rpcErrorDetails(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!rpcCode(value.code)||typeof value.message!=='string'||value.message.length>8192||!value.message.trim())return null;
 return {code:value.code,message:value.message};
}

function httpRpcError(error,httpStatus){
 if(httpStatus===null||httpStatus<400)return null;
 let body;
 try{body=error?.info?.responseBody??error?.response?.bodyText??error?.info?.response?.bodyText;}catch{return null;}
 if(typeof body!=='string'||body.length>65536||Buffer.byteLength(body,'utf8')>65536)return null;
 let envelope;try{envelope=JSON.parse(body);}catch{return null;}
 if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.hasOwn(envelope,'result')||(Object.hasOwn(envelope,'jsonrpc')&&envelope.jsonrpc!=='2.0'))return null;
 return rpcErrorDetails(envelope.error);
}

export function sanitizeCompleteLogDiagnostic(value){
 return {operation:operations.has(value?.operation)?value.operation:'eth_getLogs',fromBlock:integer(value?.fromBlock)?value.fromBlock:null,toBlock:integer(value?.toBlock)?value.toBlock:null,errorCode:errorCodes.has(value?.errorCode)?value.errorCode:null,rpcCode:typeof value?.rpcCode==='number'&&Number.isSafeInteger(value.rpcCode)&&value.rpcCode>=-2147483648&&value.rpcCode<=2147483647?value.rpcCode:null,httpStatus:Number.isSafeInteger(value?.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599?value.httpStatus:null,reason:reasons.has(value?.reason)?value.reason:'UNKNOWN',requests:integer(value?.requests)&&value.requests<=1024?value.requests:null};
}

function rpcFailure(error){
 const rawStatus=error?.info?.response?.statusCode??error?.info?.responseStatus??error?.response?.statusCode??error?.response?.status??error?.status;
 const parsed=typeof rawStatus==='string'&&/^[1-5][0-9]{2}(?:\s|$)/.test(rawStatus)?Number(rawStatus.slice(0,3)):rawStatus;
 const httpStatus=Number.isSafeInteger(parsed)&&parsed>=100&&parsed<=599?parsed:null;
 const selected=rpcErrorDetails(error?.info?.error)??rpcErrorDetails(error?.error)??rpcErrorDetails(error)??httpRpcError(error,httpStatus);
 const rpcCode=selected?.code??null;
 const text=(selected?.message??(typeof error?.message==='string'?error.message.slice(0,8192):'')).toLowerCase();
 const rpcText=selected?.message.toLowerCase()??'';
 let reason='UNKNOWN',split=false,limit=null;
 if(httpStatus===429)reason='RATE_LIMITED';
 else if([401,403].includes(httpStatus))reason='AUTHENTICATION_REQUIRED';
 else if(rpcCode===429)reason='RATE_LIMITED';
 else if(/unauthorized|forbidden|invalid api key|api key.*invalid/.test(text))reason='AUTHENTICATION_REQUIRED';
 else if(/rate limit|too many requests/.test(text))reason='RATE_LIMITED';
 else if(/missing trie|pruned|historical.*unavailable|header not found|state (?:is )?not available|unknown state/.test(text))reason='HISTORICAL_STATE_UNAVAILABLE';
 else if(error?.code==='TIMEOUT'||/\btimeout\b|timed out/.test(text))reason='TIMEOUT';
 else if([-32601,-32004].includes(rpcCode))reason='METHOD_UNAVAILABLE';
 else if([-32600,-32602,-32000,-32005,-32603].includes(rpcCode)){
  const range=/block range.*(?:limit|exceed|maximum|max )|(?:maximum|max) block range|(?:up to|limited to|at most) (?:a )?\d+ blocks?(?: range)?|range (?:is )?too (?:large|wide)/.test(rpcText);
  const result=/too many (?:results|logs)|query returned more than|(?:log |response |result )size (?:limit|exceed)|(?:response|result) (?:is )?too large|result limit|maximum (?:number of )?(?:results|logs)/.test(rpcText);
  if(range||result){reason=range?'BLOCK_RANGE_LIMIT':'RESULT_LIMIT';split=true;}
  else if(rpcCode===-32600)reason='INVALID_REQUEST';
  else if(rpcCode===-32005)reason='RATE_LIMITED';
  const match=rpcText.match(/(?:up to|limited to|at most) (?:a )?(\d+) blocks?(?: range)?|(?:maximum|max) block range(?: is| of|:)?\s*(\d+)|block range limit(?: is| of|:)?\s*(\d+)/);
  if(range&&match){const value=Number(match[1]??match[2]??match[3]);if(Number.isSafeInteger(value)&&value>=1&&value<=1000)limit=value;}
 }
 if(reason==='UNKNOWN'&&['NETWORK_ERROR','SERVER_ERROR'].includes(error?.code))reason='TRANSPORT_UNAVAILABLE';
 if(reason==='UNKNOWN'&&['BAD_DATA','BUFFER_OVERRUN'].includes(error?.code))reason='INVALID_RESPONSE';
 return {errorCode:errorCodes.has(error?.code)?error.code:null,rpcCode,httpStatus,reason,split,limit,confirmed429:reason==='RATE_LIMITED'&&(httpStatus===429||rpcCode===429)};
}

function fixedFilter(filter){
 if(!filter||typeof filter!=='object'||Object.keys(filter).some(key=>!['address','topics','fromBlock','toBlock'].includes(key))||!integer(filter.fromBlock)||!integer(filter.toBlock)||filter.toBlock<filter.fromBlock||filter.toBlock-filter.fromBlock+1>1000)throw Error('COMPLETE_LOG_FILTER_REQUIRED');
 let address;try{address=getAddress(filter.address);}catch{throw Error('COMPLETE_LOG_FILTER_REQUIRED');}
 const topic=value=>value===null||hash(value)||(Array.isArray(value)&&value.length>0&&value.length<=16&&value.every(hash));
 if(address===ZeroAddress||!Array.isArray(filter.topics)||filter.topics.length<1||filter.topics.length>4||!hash(filter.topics[0])||!filter.topics.every(topic))throw Error('COMPLETE_LOG_FILTER_REQUIRED');
 return {address:filter.address,topics:structuredClone(filter.topics),fromBlock:filter.fromBlock,toBlock:filter.toBlock};
}

function matchesTopics(expected,actual){
 return Array.isArray(actual)&&actual.length>=expected.length&&actual.length<=4&&actual.every(hash)&&expected.every((value,index)=>value===null||(Array.isArray(value)?value.some(topic=>topic.toLowerCase()===actual[index].toLowerCase()):value.toLowerCase()===actual[index].toLowerCase()));
}

export async function getCompleteLogs({provider,filter,maxRequests=1024,maxTimeoutRetries=0,maxConcurrency=4,onRequest=()=>{},waitForRetry=wait}){
 const scope=fixedFilter(filter);
 if(!provider||typeof provider.getLogs!=='function'||typeof provider.getBlock!=='function'||!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>1024||!Number.isSafeInteger(maxTimeoutRetries)||maxTimeoutRetries<0||maxTimeoutRetries>2||!Number.isSafeInteger(maxConcurrency)||maxConcurrency<1||maxConcurrency>4||typeof onRequest!=='function'||typeof waitForRetry!=='function')throw Error('COMPLETE_LOG_REQUEST_LIMIT_REQUIRED');
 let requests=0,limit=learnedSpans.get(provider)??null,adapted=false;
 const internalFailures=new WeakSet();
 const failure=(message,error,range,reason,operation='eth_getLogs')=>{
  const details=rpcFailure(error),wrapped=Error(message);
  wrapped.logProbeDiagnostic=sanitizeCompleteLogDiagnostic({operation,fromBlock:range.fromBlock,toBlock:range.toBlock,...details,...(reason?{reason}:{}),requests});
  if(wrapped.logProbeDiagnostic.errorCode&&!fatalReasons.has(wrapped.logProbeDiagnostic.reason))wrapped.code=wrapped.logProbeDiagnostic.errorCode;
  if(wrapped.logProbeDiagnostic.rpcCode!==null)wrapped.info={error:{code:wrapped.logProbeDiagnostic.rpcCode}};
  internalFailures.add(wrapped);
  return wrapped;
 };
 const canonical=async number=>{
  let block;try{block=await provider.getBlock(number);}catch(error){throw failure('COMPLETE_LOG_CANONICAL_READ_FAILED',error,scope,null,'getBlock');}
  if(block?.number!==number||!hash(block.hash))throw failure('COMPLETE_LOG_CANONICAL_MISMATCH',null,scope,'CANONICAL_MISMATCH','getBlock');
  return block;
 };
 const anchor=await canonical(scope.toBlock),queue=[{fromBlock:scope.fromBlock,toBlock:scope.toBlock}],collected=[];
 const query=async range=>{
  for(let retry=0;;retry++){
   if(requests>=maxRequests)throw failure('COMPLETE_LOG_REQUEST_BUDGET_EXCEEDED',null,range,'REQUEST_BUDGET_EXCEEDED');
   requests++;onRequest({fromBlock:range.fromBlock,toBlock:range.toBlock,request:requests});
   try{return await provider.getLogs({...scope,topics:structuredClone(scope.topics),...range});}
   catch(error){
    const details=rpcFailure(error);
    if(details.confirmed429&&retry<2){await waitForRetry(retry===0?250:750);continue;}
    if(error?.code==='TIMEOUT'&&details.reason==='TIMEOUT'&&details.rpcCode===null&&details.httpStatus===null&&retry<maxTimeoutRetries){await waitForRetry(retry===0?500:1500);continue;}
    throw error;
   }
  }
 };
 while(queue.length){
  const wave=[];
  while(queue.length&&wave.length<maxConcurrency){
   const range=queue.shift(),size=range.toBlock-range.fromBlock+1;
   if(limit&&size>limit){
    const children=[];for(let start=range.fromBlock;start<=range.toBlock;start+=limit)children.push({fromBlock:start,toBlock:Math.min(start+limit-1,range.toBlock)});
    queue.unshift(...children);continue;
   }
   wave.push(range);
  }
  const results=await Promise.allSettled(wave.map(query));
  let fatal;
  for(let i=0;i<results.length;i++){
   const result=results[i],range=wave[i],size=range.toBlock-range.fromBlock+1;
   if(result.status==='fulfilled'){
    if(!Array.isArray(result.value)){fatal??=failure('COMPLETE_LOG_RESPONSE_INVALID',null,range,'INVALID_RESPONSE','validate-logs');continue;}
    collected.push(...result.value.map(log=>({log,range})));continue;
   }
   const error=result.reason;
   if(internalFailures.has(error)){fatal??=error;continue;}
   const details=rpcFailure(error);
   if(details.split&&size>1){
    const next=details.limit&&details.limit<size?details.limit:Math.max(1,Math.floor(size/2));
    limit=Math.min(limit??Infinity,next);adapted=true;queue.push(range);
   }else fatal??=failure('COMPLETE_LOG_QUERY_FAILED',error,range);
  }
  if(fatal)throw fatal;
 }
 const logs=[],seen=new Map(),blocks=new Map([[anchor.number,anchor]]);
 for(const {log,range}of collected){
  let address;try{address=getAddress(log?.address);}catch{}
  const index=log?.index??log?.logIndex;
  if(address!==getAddress(scope.address)||log?.removed||!integer(log?.blockNumber)||log.blockNumber<range.fromBlock||log.blockNumber>range.toBlock||!integer(index)||!hash(log?.blockHash)||!hash(log?.transactionHash)||typeof log?.data!=='string'||!/^0x(?:[0-9a-f]{2})*$/i.test(log.data)||!matchesTopics(scope.topics,log.topics))throw failure('COMPLETE_LOG_RESPONSE_INVALID',null,range,'INVALID_RESPONSE','validate-logs');
  if(!blocks.has(log.blockNumber))blocks.set(log.blockNumber,await canonical(log.blockNumber));
  if(blocks.get(log.blockNumber).hash.toLowerCase()!==log.blockHash.toLowerCase())throw failure('COMPLETE_LOG_CANONICAL_MISMATCH',null,range,'CANONICAL_MISMATCH','validate-logs');
  const key=log.transactionHash.toLowerCase()+':'+index;
  const signature=JSON.stringify([address,log.blockNumber,log.blockHash.toLowerCase(),log.transactionHash.toLowerCase(),index,log.topics.map(value=>value.toLowerCase()),log.data.toLowerCase()]);
  if(seen.has(key)){if(seen.get(key)!==signature)throw failure('COMPLETE_LOG_CONFLICTING_DUPLICATE',null,range,'CONFLICTING_DUPLICATE','validate-logs');continue;}
  seen.set(key,signature);logs.push(log);
 }
 const final=await canonical(scope.toBlock);
 if(final.hash.toLowerCase()!==anchor.hash.toLowerCase())throw failure('COMPLETE_LOG_CANONICAL_MISMATCH',null,scope,'CANONICAL_MISMATCH','getBlock');
 if(adapted&&limit)learnedSpans.set(provider,Math.min(learnedSpans.get(provider)??Infinity,limit));
 return logs.sort((a,b)=>a.blockNumber-b.blockNumber||(a.index??a.logIndex)-(b.index??b.logIndex));
}
