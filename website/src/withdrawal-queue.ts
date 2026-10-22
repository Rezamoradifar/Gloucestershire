import {Contract,ZeroAddress} from 'ethers';
import {session} from './chain';
import {hasApprovalQueue,hasDeferredRewards,queueAbi} from './reward-mode';
export type QueueAction={kind:'approve'|'approveAndPay'|'pay'|'cancel';id:bigint};
export type QueueRow={id:bigint;user:string;asset:string;gross:bigint;fee:bigint;dueAt:bigint;status:number;decimals:number;symbol:string;principal:boolean};
export async function readQueue(who:string,start:bigint,all:boolean){
 const {vault,provider}=await session(who);if(!await hasDeferredRewards(vault))throw Error('This contract does not support withdrawal requests.');
 const block=await provider.getBlock('latest');if(!block)throw Error('Block unavailable.');const o={blockTag:block.number};
 const queue=new Contract(await vault.withdrawalQueue(o),queueAbi,provider);
 if((await queue.vault(o)).toLowerCase()!==String(vault.target).toLowerCase())throw Error('Unexpected withdrawal queue.');
 const approvalRequired=await hasApprovalQueue(queue,o);
 const count:bigint=all?await queue.requestCount(o):await queue.userRequestCount(who,o);const decimals=Number(await vault.tokenDecimals(o));
 const rows:QueueRow[]=[];
 for(let i=start;i<count&&i<start+8n;i++){
  const index=count-1n-i,id=all?index:await queue.userRequestId(who,index,o),r=await queue.requests(id,o);
  const principal=approvalRequired?Boolean((await queue.principalRequests(id,o)).exists):false;
  rows.push({id,user:r.user,asset:r.asset,gross:r.gross,fee:r.fee,dueAt:r.dueAt,status:Number(r.status),decimals:r.asset===ZeroAddress?18:decimals,symbol:r.asset===ZeroAddress?'BNB':'USDT',principal});
 }
 return {rows,count,time:block.timestamp,approvalRequired};
}
export async function executeQueue(who:string,action:QueueAction){
 if(action.id<0n)throw Error('Invalid request.');const {vault,signer}=await session(who);
 if(!await hasDeferredRewards(vault))throw Error('Withdrawal queue not supported.');
 const q=new Contract(await vault.withdrawalQueue(),queueAbi,signer);
 if((await q.vault()).toLowerCase()!==String(vault.target).toLowerCase())throw Error('Unexpected withdrawal queue.');
 if(['approve','approveAndPay'].includes(action.kind)&&(await vault.owner()).toLowerCase()!==who.toLowerCase())throw Error('Only the current administrator can approve withdrawals.');
 await q[action.kind].staticCall(action.id);await session(who);const sent=await q[action.kind](action.id);
 try{const r=await sent.wait();if(r?.status!==1)throw Error('Withdrawal request action failed.');return r.hash as string;}
 catch(e){const x=e as {code?:string;cancelled?:boolean;receipt?:{status:number;hash:string}};if(x.code==='TRANSACTION_REPLACED'&&!x.cancelled&&x.receipt?.status===1)return x.receipt.hash;throw e;}
}
