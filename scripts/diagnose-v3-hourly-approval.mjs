// Read-only testnet inquiry. A missing event never excludes a pending or failed transaction.
import {FetchRequest,JsonRpcProvider,Interface,getAddress,zeroPadValue} from 'ethers';
import {fileURLToPath} from 'node:url';

export const USER=getAddress('0x63c5B98AEfd69658B652d5F35FFda3C6c06847E3');
export const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
export const VAULT=getAddress('0x4F2777861cc5bDD0d6AED86014cE1370BF823884');
const baseline=142717262, maxBlocks=6000, batch=250, maxLogs=100, confirmations=5;
const abi=new Interface([
 'event Approval(address indexed owner,address indexed spender,uint256 value)',
 'function approve(address spender,uint256 value)',
 'function allowance(address owner,address spender) view returns(uint256)'
]);
const isHash=s=>typeof s==='string'&&/^0x[0-9a-f]{64}$/i.test(s);
const validateBlock=n=>Number.isSafeInteger(n)&&n>=0;

export async function diagnose(provider){
 if(BigInt(await provider.send('eth_chainId',[]))!==97n)throw Error('DIAGNOSTIC_WRONG_CHAIN');
 const tip=await provider.getBlockNumber();
 if(!validateBlock(tip)||tip<confirmations)throw Error('DIAGNOSTIC_INVALID_BLOCK');
 const end=tip-confirmations+1;
 if(end<baseline)throw Error('DIAGNOSTIC_BEFORE_BASELINE');
 const start=Math.max(baseline,end-maxBlocks+1),anchor=await provider.getBlock(end);
 if(!anchor?.hash||!isHash(anchor.hash))throw Error('DIAGNOSTIC_ANCHOR_UNAVAILABLE');
 if(await provider.getCode(TOKEN,end)==='0x')throw Error('DIAGNOSTIC_TOKEN_UNAVAILABLE');
 const rawAllowance=await provider.call({to:TOKEN,data:abi.encodeFunctionData('allowance',[USER,VAULT]),blockTag:end});
 const allowance=abi.decodeFunctionResult('allowance',rawAllowance)[0];
 const logs=[];
 for(let first=start;first<=end;first+=batch){
  const last=Math.min(end,first+batch-1);
  const part=await provider.getLogs({address:TOKEN,fromBlock:first,toBlock:last,
   topics:[abi.getEvent('Approval').topicHash,zeroPadValue(USER,32),zeroPadValue(VAULT,32)]});
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
  const [tx,receipt]=await Promise.all([provider.getTransaction(log.transactionHash),provider.getTransactionReceipt(log.transactionHash)]);
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
 const again=await provider.getBlock(end);
 if(!again?.hash||again.hash.toLowerCase()!==anchor.hash.toLowerCase())throw Error('DIAGNOSTIC_ANCHOR_CHANGED');
 const nonce={};
 try{nonce.latest=await provider.getTransactionCount(USER,'latest');}catch{nonce.latest=null;}
 try{nonce.pending=await provider.getTransactionCount(USER,'pending');}catch{nonce.pending=null;}
 return {chainId:97,wallet:USER,token:TOKEN,spender:VAULT,tip,fromBlock:start,toBlock:end,
  truncated:start>baseline,allowanceAtAnchorUnits:allowance.toString(),confirmedApprovals:matched,nonce,
  note:'Missing logs or equal nonces do not rule out pending, failed, unseen, or older transactions.'};
}

async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--check')throw Error('DIAGNOSTIC_MODE_REQUIRED');
 const req=new FetchRequest('https://bsc-testnet-dataseed.bnbchain.org');req.timeout=8000;
 const provider=new JsonRpcProvider(req,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 try{console.log('V3_APPROVAL_DIAGNOSTIC '+JSON.stringify(await diagnose(provider)));}
 finally{provider.destroy();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 main().catch(()=>{console.error('V3_APPROVAL_DIAGNOSTIC_INCOMPLETE No conclusion; check wallet activity or retry with an available RPC.');process.exitCode=1;});
}
