// Read-only testnet inquiry. A missing event never excludes a pending or failed transaction.
import {FetchRequest,JsonRpcProvider,Interface,formatEther,getAddress,zeroPadValue} from 'ethers';
import {fileURLToPath} from 'node:url';

export const USER=getAddress('0x63c5B98AEfd69658B652d5F35FFda3C6c06847E3');
export const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
export const VAULT=getAddress('0x4F2777861cc5bDD0d6AED86014cE1370BF823884');
const baseline=142717262, maxBlocks=6000, batch=250, maxLogs=100, confirmations=5;
const maxRequests=120;
const abi=new Interface([
 'event Approval(address indexed owner,address indexed spender,uint256 value)',
 'function approve(address spender,uint256 value)',
 'function allowance(address owner,address spender) view returns(uint256)'
]);
const isHash=s=>typeof s==='string'&&/^0x[0-9a-f]{64}$/i.test(s);
const validateBlock=n=>Number.isSafeInteger(n)&&n>=0;

function rangeLimit(error){
 const pending=[error],seen=new Set(),codes=new Set(),messages=[];
 while(pending.length&&seen.size<12){
  const item=pending.shift();if(!item||typeof item!=='object'||seen.has(item))continue;
  seen.add(item);if(item.code!==undefined)codes.add(item.code);
  if(typeof item.message==='string')messages.push(item.message.slice(0,1000));
  for(const key of ['error','info','cause'])if(item[key])pending.push(item[key]);
 }
 const text=messages.join(' ').toLowerCase();
 if(codes.has(429)||codes.has('429')||/rate[ -]?limit|too many requests|throttl/.test(text))return false;
 return codes.has(-32005)||codes.has('-32005')||/block range|range (?:is )?too (?:large|wide)|query returned more than/.test(text);
}
async function stage(name,fn){
 try{return await fn();}catch(error){
  const message=error?.message;
  if(typeof message==='string'&&/^DIAGNOSTIC_[A-Z_]+$/.test(message))throw error;
  throw Error('DIAGNOSTIC_RPC_'+name);
 }
}

export async function diagnose(provider){
 if(BigInt(await stage('CHAIN',()=>provider.send('eth_chainId',[])))!==97n)throw Error('DIAGNOSTIC_WRONG_CHAIN');
 const tip=await stage('BLOCK',()=>provider.getBlockNumber());
 if(!validateBlock(tip)||tip<confirmations)throw Error('DIAGNOSTIC_INVALID_BLOCK');
 const end=tip-confirmations+1;
 if(end<baseline)throw Error('DIAGNOSTIC_BEFORE_BASELINE');
 const start=Math.max(baseline,end-maxBlocks+1),anchor=await stage('ANCHOR',()=>provider.getBlock(end));
 if(!anchor?.hash||!isHash(anchor.hash))throw Error('DIAGNOSTIC_ANCHOR_UNAVAILABLE');
 if(await stage('TOKEN',()=>provider.getCode(TOKEN,end))==='0x')throw Error('DIAGNOSTIC_TOKEN_UNAVAILABLE');
 const rawAllowance=await stage('ALLOWANCE',()=>provider.call({to:TOKEN,data:abi.encodeFunctionData('allowance',[USER,VAULT]),blockTag:end}));
 const allowance=abi.decodeFunctionResult('allowance',rawAllowance)[0];
 const logs=[];let requests=0;
 const scan=async(first,last)=>{
  if(++requests>maxRequests)throw Error('DIAGNOSTIC_REQUEST_LIMIT');
  let part;
  try{part=await provider.getLogs({address:TOKEN,fromBlock:first,toBlock:last,
   topics:[abi.getEvent('Approval').topicHash,zeroPadValue(USER,32),zeroPadValue(VAULT,32)]});}
  catch(error){
   if(!rangeLimit(error)||first===last)throw Error('DIAGNOSTIC_RPC_LOGS');
   const mid=first+Math.floor((last-first)/2);
   const left=await scan(first,mid),right=await scan(mid+1,last);
   if(left.length+right.length>maxLogs)throw Error('DIAGNOSTIC_TOO_MANY_EVENTS');
   return [...left,...right];
  }
  if(!Array.isArray(part)||part.length>maxLogs)throw Error('DIAGNOSTIC_TOO_MANY_EVENTS');
  return part;
 };
 for(let first=start;first<=end;first+=batch){
  const last=Math.min(end,first+batch-1);
  const part=await scan(first,last);
  if(!Array.isArray(part)||logs.length+part.length>maxLogs)throw Error('DIAGNOSTIC_TOO_MANY_EVENTS');
  logs.push(...part);
 }
 const matched=[];
 for(const log of logs){
  if(log.removed||getAddress(log.address)!==TOKEN||!isHash(log.transactionHash)||!isHash(log.blockHash)||
   !validateBlock(log.blockNumber)||log.blockNumber<start||log.blockNumber>end)throw Error('DIAGNOSTIC_INVALID_LOG');
  const event=abi.parseLog({topics:log.topics,data:log.data});
  if(!event||event.name!=='Approval'||getAddress(event.args.owner)!==USER||getAddress(event.args.spender)!==VAULT)
   throw Error('DIAGNOSTIC_EVENT_MISMATCH');
  const [tx,receipt]=await stage('RECEIPT',()=>Promise.all([provider.getTransaction(log.transactionHash),provider.getTransactionReceipt(log.transactionHash)]));
  if(!tx||!receipt||!isHash(tx.hash)||tx.hash.toLowerCase()!==log.transactionHash.toLowerCase()||
   receipt.status!==1||receipt.blockNumber!==log.blockNumber||!receipt.blockHash||receipt.blockHash.toLowerCase()!==log.blockHash.toLowerCase())
   throw Error('DIAGNOSTIC_RECEIPT_UNAVAILABLE');
  if(!Number.isSafeInteger(log.index)||!Array.isArray(receipt.logs)||!receipt.logs.some(item=>
   item.index===log.index&&getAddress(item.address)===TOKEN&&item.data===log.data&&
   Array.isArray(item.topics)&&item.topics.length===log.topics.length&&
   item.topics.every((value,index)=>value.toLowerCase()===log.topics[index].toLowerCase())))
   throw Error('DIAGNOSTIC_RECEIPT_EVENT_MISMATCH');
  // Approval can also be emitted inside another transaction. Only list an
  // explicit approve submitted from this user to this exact token.
  if(!tx.to||getAddress(tx.from)!==USER||getAddress(tx.to)!==TOKEN)continue;
  let call;
  try{call=abi.parseTransaction({data:tx.data,value:tx.value});}catch{continue;}
  if(!call||call.name!=='approve'||getAddress(call.args.spender)!==VAULT||BigInt(call.args.value)!==BigInt(event.args.value))continue;
  matched.push({hash:tx.hash,block:log.blockNumber,confirmations:tip-log.blockNumber+1,allowanceUnits:event.args.value.toString()});
 }
 const again=await stage('ANCHOR',()=>provider.getBlock(end));
 if(!again?.hash||again.hash.toLowerCase()!==anchor.hash.toLowerCase())throw Error('DIAGNOSTIC_ANCHOR_CHANGED');
 const nonce={};
 try{nonce.latest=await provider.getTransactionCount(USER,'latest');}catch{nonce.latest=null;}
 try{nonce.pending=await provider.getTransactionCount(USER,'pending');}catch{nonce.pending=null;}
 // Optional indicative values only; the wallet may choose a different gas
 // limit or fee. An estimate is not a transaction and cannot prove affordability.
 const gas={note:'Illustrative estimate for approving 10 TEST tokens; wallet fees may differ.'};
 try{gas.testBNB=formatEther(await provider.getBalance(USER));}catch{gas.testBNB='UNAVAILABLE';}
 try{
  const [units,fees]=await Promise.all([
   provider.estimateGas({from:USER,to:TOKEN,data:abi.encodeFunctionData('approve',[VAULT,10n**19n]),value:0n}),
   provider.getFeeData()
  ]);
  if(units<=0n||!fees.gasPrice||fees.gasPrice<=0n)throw Error('UNAVAILABLE');
  gas.approveUnits=units.toString();gas.rpcGasPriceWei=fees.gasPrice.toString();
  gas.illustrativeFeeTestBNB=formatEther(units*fees.gasPrice);
 }catch{gas.estimate='UNAVAILABLE';}
 return {chainId:97,wallet:USER,token:TOKEN,spender:VAULT,tip,fromBlock:start,toBlock:end,
  truncated:start>baseline,allowanceAtAnchorUnits:allowance.toString(),confirmedApprovals:matched,nonce,gas,
  note:'Missing logs or equal nonces do not rule out pending, failed, unseen, or older transactions.'};
}

export async function diagnoseWithFallback(makeProvider,urls){
 const failures=[];
 for(const url of urls){
  const provider=makeProvider(url);
  try{return {result:await diagnose(provider),source:url,failures};}
  catch(error){
   const message=typeof error?.message==='string'&&/^DIAGNOSTIC_[A-Z_]+$/.test(error.message)?error.message:'DIAGNOSTIC_RPC_UNKNOWN';
   failures.push({source:url,stage:message});
  }finally{provider.destroy?.();}
 }
 return {result:null,failures};
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--check')throw Error('DIAGNOSTIC_MODE_REQUIRED');
 const result=await diagnoseWithFallback(url=>{
  const req=new FetchRequest(url);req.timeout=8000;
  return new JsonRpcProvider(req,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 },['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com']);
 if(!result.result){console.error('V3_APPROVAL_DIAGNOSTIC_INCOMPLETE '+JSON.stringify({failures:result.failures,note:'No conclusion. Inspect wallet activity; pending transactions cannot be excluded.'}));process.exitCode=1;return;}
 console.log('V3_APPROVAL_DIAGNOSTIC '+JSON.stringify({...result.result,rpc:result.source}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 main().catch(()=>{console.error('V3_APPROVAL_DIAGNOSTIC_INCOMPLETE No conclusion; check wallet activity or retry with an available RPC.');process.exitCode=1;});
}
