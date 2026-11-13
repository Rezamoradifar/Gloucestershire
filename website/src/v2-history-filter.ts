// Filter only previously fetched, wallet-attributed NEW V2 blockchain events.
// No old account state, synthetic records or financial totals are introduced.
import type {V2WalletEvent} from './v2-audit';

export type V2HistoryKind='all'|'deposit'|'profit'|'withdrawal'|'reinvest'|'funding'|'activity';
export type V2HistoryOrder='newest'|'oldest';
export type V2HistoryFilters={
 query:string;kind:V2HistoryKind;from:string;to:string;order:V2HistoryOrder;
};

export const initialV2HistoryFilters:V2HistoryFilters={
 query:'',kind:'all',from:'',to:'',order:'newest'
};

export function v2HistoryKind(row:V2WalletEvent):Exclude<V2HistoryKind,'all'>{
 switch(row.name){
  case 'DepositRouted':
  case 'PositionOpened':return 'deposit';
  case 'PersonalProfitCredited':
  case 'ReferralProfitCredited':return 'profit';
  case 'WithdrawalRequested':return 'withdrawal';
  case 'Reinvested':return 'reinvest';
  case 'EarningsFunded':
  case 'PrincipalLiquidityFunded':return 'funding';
  default:return 'activity';
 }
}

export function filterV2History(
 rows:readonly V2WalletEvent[],filters:V2HistoryFilters,times:Readonly<Record<number,number>>
):V2WalletEvent[]{
 if(filters.from&&filters.to&&filters.from>filters.to)return [];
 const query=filters.query.trim().toLowerCase();
 return rows.filter(row=>{
  if(filters.kind!=='all'&&v2HistoryKind(row)!==filters.kind)return false;
  if(query&&![
   row.tx,row.wallet,row.source??'',row.proof??'',row.details,
   row.requestId===null?'':String(row.requestId),
   row.block.toString(),row.name
  ].some(value=>value.toLowerCase().includes(query)))return false;
  if(filters.from||filters.to){
   const timestamp=times[row.block];
   if(!Number.isSafeInteger(timestamp)||timestamp<=0)return false;
   const date=new Date(timestamp*1000).toISOString().slice(0,10);
   if(filters.from&&date<filters.from)return false;
   if(filters.to&&date>filters.to)return false;
  }
  return true;
 }).sort((a,b)=>filters.order==='newest'
  ? b.block-a.block||b.index-a.index
  : a.block-b.block||a.index-b.index);
}
