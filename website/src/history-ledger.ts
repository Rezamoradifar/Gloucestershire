import {Interface,formatUnits,type Log} from 'ethers';

export type HistoryKind='deposit'|'profit'|'withdrawal'|'reinvest'|'networkReward';
export type HistoryFilter={kind:'all'|HistoryKind;query:string;from:string;to:string;sort:'newest'|'oldest'};
export type LedgerEvent={
 key:string;kind:HistoryKind;wallet:string;amount:bigint;fee:bigint;block:number;index:number;tx:string;timestamp:number|null;
 position?:bigint;principal?:boolean;creditId?:string;depositUsd?:bigint;volumeUsd?:bigint;group?:bigint;stage?:number;
};

export const historyLabels:Record<HistoryKind,string>={
 deposit:'Capital deposited',profit:'Profit credited',withdrawal:'Withdrawal paid',
 reinvest:'Profit reinvested',networkReward:'Network milestone recorded'
};
export const historyAbi=new Interface([
 'event Deposited(address indexed user,address indexed asset,uint256 indexed position,uint256 amount,uint256 usd,uint256 feeEach)',
 'event ProfitCredited(address indexed user,address indexed asset,uint256 amount,bytes32 indexed id)',
 'event Reinvested(address indexed user,address indexed asset,uint256 amount,uint256 position)',
 'event Withdrawal(address indexed user,address indexed asset,uint256 gross,uint256 fee,bool principal)',
 'event NetworkRewardEarned(address indexed user,uint256 indexed group,uint8 stage,uint256 volumeUsd,uint256 rewardUsd)'
]);
export const financialTopics=['Deposited','ProfitCredited','Reinvested','Withdrawal'].map(name=>historyAbi.getEvent(name)!.topicHash);
export const networkRewardTopic=historyAbi.getEvent('NetworkRewardEarned')!.topicHash;

export function parseFinancialLog(log:Log):LedgerEvent|null{
 let parsed;try{parsed=historyAbi.parseLog(log);}catch{return null;}
 if(!parsed)return null;
 const {name,args}=parsed;
 const kind:HistoryKind=name==='Deposited'?'deposit':
  name==='ProfitCredited'?'profit':name==='Reinvested'?'reinvest':
  name==='Withdrawal'?'withdrawal':name==='NetworkRewardEarned'?'networkReward':'deposit';
 if(!['Deposited','ProfitCredited','Reinvested','Withdrawal','NetworkRewardEarned'].includes(name))return null;
 return {key:log.transactionHash+':'+log.index,kind,wallet:String(args.user),
  amount:BigInt(kind==='withdrawal'?args.gross:kind==='networkReward'?args.rewardUsd:args.amount),
  fee:kind==='withdrawal'?BigInt(args.fee):0n,
  block:log.blockNumber,index:log.index,tx:log.transactionHash,timestamp:null,
  ...(kind==='withdrawal'?{principal:Boolean(args.principal)}:{}),
  ...(kind==='profit'?{creditId:String(args.id)}:{}),
  ...(kind==='deposit'?{depositUsd:BigInt(args.usd),position:BigInt(args.position)}:{}),
  ...(kind==='reinvest'?{position:BigInt(args.position)}:{}),
  ...(kind==='networkReward'?{volumeUsd:BigInt(args.volumeUsd),group:BigInt(args.group),stage:Number(args.stage)}:{})
 };
}

export function filterHistory(events:LedgerEvent[],filter:HistoryFilter):LedgerEvent[]{
 const query=filter.query.trim().toLowerCase();
 const rows=events.filter(row=>{
  if(filter.kind!=='all'&&row.kind!==filter.kind)return false;
  if(query&&!([row.tx,row.wallet,row.creditId??'',row.position===undefined?'':'#'+(row.position+1n).toString()].some(v=>v.toLowerCase().includes(query))))return false;
  if(filter.from||filter.to){
   if(row.timestamp===null)return false;
   const day=new Date(row.timestamp*1000).toISOString().slice(0,10);
   if(filter.from&&day<filter.from)return false;
   if(filter.to&&day>filter.to)return false;
  }
  return true;
 });
 rows.sort((a,b)=>filter.sort==='oldest'?a.block-b.block||a.index-b.index:b.block-a.block||b.index-a.index);
 return rows;
}

export function historyTotals(events:LedgerEvent[]){
 const totals:Record<HistoryKind,bigint>={deposit:0n,profit:0n,withdrawal:0n,reinvest:0n,networkReward:0n};
 for(const event of events)totals[event.kind]+=event.amount;
 return totals;
}
function safeCsv(value:unknown):string{
 let out=String(value??'');
 if(/^[\s]*[=+@-]/.test(out))out="'"+out;
 return '"'+out.replace(/"/g,'""')+'"';
}
export function historyCsv(records:LedgerEvent[],asset:'BNB'|'USDT',decimals:number,chain:number,contract:string,complete:boolean):string{
 const header=['timestamp_utc','block','event_type','description','asset','amount_exact','fee_exact','net_withdrawal_exact',
  'wallet','transaction_hash','event_index','position_number','batch_id','deposit_value_usd','network_volume_usd','reward_group','reward_stage','contract','chain_id','history_scan_complete'];
 const rows=[header,...records.map(row=>{
  const precision=row.kind==='networkReward'?18:decimals;
  const amt=formatUnits(row.amount,precision),fee=formatUnits(row.fee,precision);
  const net=row.kind==='withdrawal'?formatUnits(row.amount-row.fee,precision):'';
  return [row.timestamp===null?'':new Date(row.timestamp*1000).toISOString(),row.block,row.kind,
   row.kind==='withdrawal'?(row.principal?'Principal withdrawal':'Profit withdrawal'):historyLabels[row.kind],
   row.kind==='networkReward'?'USD':asset,amt,fee,net,row.wallet,row.tx,row.index,
   row.position===undefined?'':(row.position+1n).toString(),row.creditId??'',
   row.depositUsd===undefined?'':formatUnits(row.depositUsd,18),
   row.volumeUsd===undefined?'':formatUnits(row.volumeUsd,18),row.group===undefined?'':(row.group+1n).toString(),row.stage??'',contract,chain,complete?'yes':'no'];
 })];
 return '\ufeff'+rows.map(row=>row.map(safeCsv).join(',')).join('\r\n')+'\r\n';
}
