import {Contract,ZeroAddress,getAddress,isAddress} from 'ethers';
import {hasApprovalQueue,hasDeferredRewards,queueAbi} from './reward-mode';
import {readOnlySession} from './read-only-session';
import {vaultAddress} from './config';

export type WithdrawalHistoryRow={
 id:bigint;user:string;asset:'BNB'|'USDT';gross:bigint;fee:bigint;net:bigint;
 dueAt:number;status:0|1|2|3;principal:boolean;decimals:number;block:number
};
export type WithdrawalHistoryPage={
 supported:boolean;count:bigint;page:number;rows:WithdrawalHistoryRow[];
 approvalRequired:boolean;checkedAtBlock:number;blockTime:number;queueAddress:string|null
};

export function withdrawalState(status:number,dueAt:number,blockTime:number,approvalRequired:boolean):string{
 if(status===1)return 'Paid in queue';
 if(status===2)return 'Cancelled';
 if(status===3)return 'Approved — awaiting payment';
 if(status===0)return approvalRequired
  ?(blockTime>=dueAt?'Overdue — approval pending':'Awaiting approval')
  :(blockTime>=dueAt?'Overdue — pending processing':'Awaiting processing');
 return 'Unknown — verify on chain';
}

/** User wallet only. Read-only RPC, verified vault and queue; never signs or approves. */
export async function readWithdrawalHistory(who:string,page=0,pageSize=8):Promise<WithdrawalHistoryPage>{
 if(!isAddress(who)||!Number.isSafeInteger(page)||page<0||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>12)
  throw Error('Invalid withdrawal history request.');
 const {provider,vault}=await readOnlySession(who);
 const block=await provider.getBlock('latest');
 if(!block)throw Error('Latest block is unavailable.');
 const confirmed=Math.max(0,block.number-3),options={blockTag:confirmed};
 if(!await hasDeferredRewards(vault,options))
  return {supported:false,count:0n,page,rows:[],approvalRequired:false,checkedAtBlock:confirmed,blockTime:block.timestamp,queueAddress:null};
 const queueAddress=getAddress(await vault.withdrawalQueue(options));
 const queue=new Contract(queueAddress,queueAbi,provider);
 if(getAddress(await queue.vault(options))!==getAddress(vaultAddress))
  throw Error('The withdrawal queue does not match this contract.');
 const approvalRequired=await hasApprovalQueue(queue,options);
 const count=BigInt(await queue.userRequestCount(who,options));
 const start=BigInt(page)*BigInt(pageSize);
 const rows:WithdrawalHistoryRow[]=[];
 if(start>=count)return {supported:true,count,page,rows,approvalRequired,checkedAtBlock:confirmed,blockTime:block.timestamp,queueAddress};
 const decimals=Number(await vault.tokenDecimals(options));
 for(let i=start;i<count&&i<start+BigInt(pageSize);i++){
  const index=count-1n-i,id=BigInt(await queue.userRequestId(who,index,options));
  const row=await queue.requests(id,options);
  if(getAddress(row.user).toLowerCase()!==who.toLowerCase())throw Error('Withdrawal queue returned another wallet’s request.');
  const principal=approvalRequired?Boolean((await queue.principalRequests(id,options)).exists):false;
  const gross=BigInt(row.gross),fee=BigInt(row.fee),status=Number(row.status);
  if(gross<0n||fee<0n||fee>gross||![0,1,2,3].includes(status))throw Error('Unrecognized withdrawal record.');
  const asset=getAddress(row.asset)===getAddress(ZeroAddress)?'BNB':'USDT';
  if(asset==='USDT'&&getAddress(row.asset)!==getAddress(await vault.usdt(options)))
   throw Error('Unsupported withdrawal request asset.');
  rows.push({id,user:getAddress(row.user),asset,gross,fee,net:gross-fee,
   dueAt:Number(row.dueAt),status:status as 0|1|2|3,principal,decimals:asset==='BNB'?18:decimals,block:confirmed});
 }
 return {supported:true,count,page,rows,approvalRequired,checkedAtBlock:confirmed,blockTime:block.timestamp,queueAddress};
}
