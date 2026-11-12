import {getAddress,isAddress,ZeroAddress} from 'ethers';

export type HistoryAsset='BNB'|'USDT'|null;
export type QueueStatus='pending'|'approved'|'paid'|'cancelled'|null;
export type HistoryEntry={
 id:string;transactionHash:string;blockNumber:number;logIndex:number;
 timestamp:string;confirmations:number;label:string;kind:string;
 asset:HistoryAsset;amount:string|null;fee:string|null;detail:string|null;
 positionId:string|null;requestId:string|null;queueStatus:QueueStatus;
 source:'vault'|'queue';confirmed:true
};
export type AccountHistoryPage={
 version:1;chainId:number;vaultAddress:string;wallet:string;
 confirmedThrough:number;scannedFrom:number|null;scannedTo:number|null;
 items:HistoryEntry[];nextCursor:string|null
};
const hash=/^0x[0-9a-fA-F]{64}$/;
const cursor=/^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)$/;
const decimal=/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const kinds=new Set(['Registered','Deposited','Reinvested','ProfitCredited','Withdrawal',
 'Funded','OwnerCapitalWithdrawn','CustomerStatus','NetworkRewardEarned','SaleSettled','Requested']);
const queueStatuses=new Set(['pending','approved','paid','cancelled']);
const validNumber=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const validAmount=(v:unknown)=>v===null||(typeof v==='string'&&decimal.test(v)&&v.length<=90);
export function parseAccountHistoryPage(value:unknown,{wallet,chainId,vaultAddress}:{
 wallet:string;chainId:number;vaultAddress:string
}):AccountHistoryPage{
 const invalid=():never=>{throw Error('The historical transaction response was invalid. Please retry.');};
 if(value===null||typeof value!=='object'||Array.isArray(value))invalid();
 const v=value as Record<string,any>;
 if(v.version!==1||v.version!==1||v.chainId!==chainId||!isAddress(v.vaultAddress)||!isAddress(v.wallet)||
  getAddress(v.vaultAddress)!==getAddress(vaultAddress)||getAddress(v.wallet)!==getAddress(wallet)||
  !validNumber(v.confirmedThrough)||!Array.isArray(v.items)||v.items.length>50||
  (v.nextCursor!==null&&(typeof v.nextCursor!=='string'||!cursor.test(v.nextCursor)))||
  (v.scannedFrom!==null&&!validNumber(v.scannedFrom))||
  (v.scannedTo!==null&&!validNumber(v.scannedTo))||
  v.scannedFrom!==null&&v.scannedTo!==null&&v.scannedFrom>v.scannedTo)invalid();
 const seen=new Set<string>();
 let previousBlock=Number.MAX_SAFE_INTEGER,previousIndex=Number.MAX_SAFE_INTEGER;
 for(const row of v.items){
  if(!row||typeof row!=='object'||!hash.test(row.transactionHash)||!validNumber(row.blockNumber)||
   !validNumber(row.logIndex)||row.blockNumber>v.confirmedThrough||!validNumber(row.confirmations)||
   row.confirmations<1||typeof row.id!=='string'||row.id!==row.transactionHash.toLowerCase()+':'+row.logIndex||
   !kinds.has(row.kind)||typeof row.label!=='string'||row.label.length>100||
   ![null,'BNB','USDT'].includes(row.asset)||!validAmount(row.amount)||!validAmount(row.fee)||
   (row.detail!==null&&(typeof row.detail!=='string'||row.detail.length>300))||
   (row.positionId!==null&&(typeof row.positionId!=='string'||!(/^(0|[1-9][0-9]*)$/).test(row.positionId)))||
   (row.requestId!==null&&(typeof row.requestId!=='string'||!(/^(0|[1-9][0-9]*)$/).test(row.requestId)))||
   (row.queueStatus!==null&&!queueStatuses.has(row.queueStatus))||
   !['vault','queue'].includes(row.source)||row.confirmed!==true||
   !Number.isFinite(Date.parse(row.timestamp))||seen.has(row.id)||
   row.blockNumber>previousBlock||row.blockNumber===previousBlock&&row.logIndex>=previousIndex)invalid();
  seen.add(row.id);previousBlock=row.blockNumber;previousIndex=row.logIndex;
 }
 return v as AccountHistoryPage;
}
export function mergeHistoryEntries(existing:HistoryEntry[],newRows:HistoryEntry[]):HistoryEntry[]{
 const dedup=new Map<string,HistoryEntry>();
 for(const row of [...existing,...newRows])dedup.set(row.id,row);
 return [...dedup.values()].sort((a,b)=>b.blockNumber-a.blockNumber||b.logIndex-a.logIndex);
}
export async function fetchAccountHistory({
 wallet,chainId,vaultAddress,before=null,limit=30,signal,fetcher=fetch
}:{
 wallet:string;chainId:number;vaultAddress:string;before?:string|null;limit?:number;
 signal?:AbortSignal;fetcher?:typeof fetch
}):Promise<AccountHistoryPage>{
 if(!isAddress(wallet)||getAddress(wallet)===ZeroAddress||!isAddress(vaultAddress)||!Number.isSafeInteger(limit)||
  limit<1||limit>50||(before!==null&&!cursor.test(before)))throw Error('Invalid account history request.');
 const params=new URLSearchParams({wallet:getAddress(wallet),limit:String(limit)});
 if(before!==null)params.set('before',before);
 const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(35000)]):AbortSignal.timeout(35000);
 const response=await fetcher('/api/account-history?'+params.toString(),{cache:'no-store',signal:requestSignal});
 if(!response.ok)throw Error(response.status===400?'Invalid history request.':'History is temporarily unavailable. Please retry.');
 return parseAccountHistoryPage(await response.json(),{wallet,chainId,vaultAddress});
}
