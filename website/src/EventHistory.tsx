import {useEffect,useRef,useState} from 'react';
import {Interface,zeroPadValue,formatUnits,type Log} from 'ethers';
import {Clock3,ExternalLink,History,RefreshCw} from 'lucide-react';
import {session,errorText,type Asset} from './chain';
import {chainId,explorer,vaultAddress} from './config';

const events=new Interface([
 'event Deposited(address indexed user,address indexed asset,uint256 indexed position,uint256 amount,uint256 usd,uint256 feeEach)',
 'event ProfitCredited(address indexed user,address indexed asset,uint256 amount,bytes32 indexed id)',
 'event Reinvested(address indexed user,address indexed asset,uint256 amount,uint256 position)',
 'event Withdrawal(address indexed user,address indexed asset,uint256 gross,uint256 fee,bool principal)'
]);
const names=['Deposited','ProfitCredited','Reinvested','Withdrawal'];
const topics=names.map(name=>events.getEvent(name)!.topicHash);
type Kind='deposit'|'profit'|'reinvest'|'withdrawal';
type Entry={key:string;kind:Kind;wallet:string;amount:bigint;fee:bigint;block:number;tx:string;timestamp:number|null;position?:bigint};
const label:Record<Kind,string>={deposit:'Deposit',profit:'Profit credited',reinvest:'Reinvestment',withdrawal:'Withdrawal'};
const format=(amount:bigint,decimals:number)=>Number(formatUnits(amount,decimals)).toLocaleString('en-US',{maximumFractionDigits:6});
const short=(value:string)=>value.slice(0,8)+'…'+value.slice(-6);

export function parseFinancialLog(log:Log):Entry|null{
 const parsed=events.parseLog(log);
 if(!parsed)return null;
 const {name,args}=parsed;
 if(!names.includes(name))return null;
 const kind:Kind=name==='Deposited'?'deposit':name==='ProfitCredited'?'profit':name==='Reinvested'?'reinvest':'withdrawal';
 return {key:log.transactionHash+':'+log.index,kind,wallet:String(args.user),amount:BigInt(kind==='withdrawal'?args.gross:args.amount),
  fee:kind==='withdrawal'?BigInt(args.fee):0n,block:log.blockNumber,tx:log.transactionHash,timestamp:null,
  ...(kind==='deposit'||kind==='reinvest'?{position:BigInt(args.position)}:{})};
}

/** A bounded read-only scan. Cursor is a block, not an event count. No ledger balance is inferred from logs. */
export default function EventHistory({who,asset,token,decimals,block,connected,scope='wallet'}:
 {who:string;asset:Asset;token:string;decimals:number;block:number;connected:boolean;scope?:'wallet'|'global'}){
 const [entries,setEntries]=useState<Entry[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [cursor,setCursor]=useState<number|null>(null),[filtered,setFiltered]=useState<Kind|'all'>('all'),[visible,setVisible]=useState(15);
 const cursorRef=useRef<number|null>(null),generation=useRef(0),running=useRef(false);
 const started=useRef(false);
 const load=async()=>{
  const startCursor=cursorRef.current;
  if(!connected||!who||!token||startCursor===null||running.current)return;
  const id=generation.current;running.current=true;setBusy(true);setError('');
  try{
   const {provider}=await session(who);
   if(id!==generation.current)return;
   const checked=await provider.getBlock('latest');
   if(!checked||checked.number<startCursor)throw Error('Chain head changed; refresh the history.');
   const from=Math.max(0,startCursor-15999);
   const collected:Entry[]=[];
   let current=startCursor,queries=0;
   const filterTopics=[topics,scope==='wallet'?zeroPadValue(who,32):null,zeroPadValue(token,32)];
   while(current>=from&&queries<40){
    if(id!==generation.current)return;
    let span=2000,part:Log[]|null=null,first=0;
    while(part===null){
     first=Math.max(from,current-span+1);
     try{part=await provider.getLogs({address:vaultAddress,fromBlock:first,toBlock:current,topics:filterTopics});}
     catch(err){if(span<=125)throw err;span=Math.max(125,Math.floor(span/2));}
    }
    for(const log of part){const entry=parseFinancialLog(log);if(entry)collected.push(entry);}
    current=first-1;queries++;
   }
   if(id!==generation.current)return;
   collected.sort((a,b)=>b.block-a.block||b.key.localeCompare(a.key));
   const recentBlocks=[...new Set(collected.slice(0,35).map(x=>x.block))];
   const blockTimes=new Map<number,number>();
   for(let i=0;i<recentBlocks.length;i+=5){
    const group=recentBlocks.slice(i,i+5);
    const values=await Promise.allSettled(group.map(value=>provider.getBlock(value)));
    if(id!==generation.current)return;
    values.forEach((value,j)=>{if(value.status==='fulfilled'&&value.value)blockTimes.set(group[j],value.value.timestamp);});
   }
   const withTimes=collected.map(row=>({...row,timestamp:blockTimes.get(row.block)??null}));
   setEntries(old=>{const map=new Map(old.map(row=>[row.key,row]));for(const row of withTimes)map.set(row.key,row);
    return [...map.values()].sort((a,b)=>b.block-a.block||b.key.localeCompare(a.key));});
   cursorRef.current=current>=0?current:null;setCursor(cursorRef.current);
  }catch(reason){if(id===generation.current)setError(errorText(reason));}
  finally{if(id===generation.current){running.current=false;setBusy(false);}}
 };
 useEffect(()=>{
  generation.current++;running.current=false;started.current=false;cursorRef.current=connected&&block>0?Math.max(0,block-3):null;
  setEntries([]);setCursor(cursorRef.current);setFiltered('all');setVisible(15);setError('');
  if(cursorRef.current!==null){started.current=true;void load();}
  return()=>{generation.current++;};
  // New snapshot blocks do not restart an in-progress historical scan.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[who,asset,token,connected,scope]);
 const items=entries.filter(entry=>filtered==='all'||entry.kind===filtered);
 const complete=cursor===null&&started.current&&connected;
 return <section className="panel global-ledger" aria-labelledby={scope==='global'?'global-network-ledger-title':'global-ledger-title'}>
  <div className="panel-title"><div><span className="detail-kicker">VERIFIABLE ON-CHAIN RECORDS</span>
   <h2 id={scope==='global'?'global-network-ledger-title':'global-ledger-title'}><History size={21}/> {scope==='global'?'Recent platform activity':'Profit & deposit history'}</h2>
   <p>Confirmed events for {asset} · {chainId===97?'BNB Testnet':'BNB Smart Chain'}</p></div>
   <span className="ledger-count">{entries.length.toLocaleString('en-US')} loaded</span></div>
  <div className="ledger-filter" role="group" aria-label="Filter history">{(['all','deposit','profit','withdrawal','reinvest'] as const).map(kind=>
   <button type="button" key={kind} className={filtered===kind?'selected':''} aria-pressed={filtered===kind} onClick={()=>{setFiltered(kind);setVisible(15);}}>
    {kind==='all'?'All':label[kind]}</button>)}</div>
  {!connected?<p className="muted">Connect the correct wallet and network to load verified records.</p>:null}
  {scope==='wallet'&&<p className="ledger-note">Profit credits are allocations inside the contract, not transfers to your wallet. Withdrawals are shown separately. Figures are not an investment return guarantee.</p>}
  {scope==='global'&&<p className="ledger-note">This view lists recent public contract events for the selected asset, not every member or an accounting reconciliation.</p>}
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {items.length?<div className="ledger-history-list">{items.slice(0,visible).map(entry=><article className="ledger-history-entry" key={entry.key}>
   <div className={'ledger-history-icon '+entry.kind}>{entry.kind==='profit'?'₮':entry.kind==='deposit'?'↓':entry.kind==='withdrawal'?'↑':'↻'}</div>
   <div className="ledger-history-main"><strong>{label[entry.kind]}</strong><small>{entry.timestamp?new Date(entry.timestamp*1000).toLocaleString('en-US'):'Block '+entry.block.toLocaleString('en-US')}{scope==='global'?' · '+short(entry.wallet):''}{entry.position!==undefined?' · Position #'+(entry.position+1n).toString():''}</small></div>
   <div className="ledger-history-amount"><bdi>{entry.kind==='withdrawal'?'-':'+'}{format(entry.amount,decimals)} {asset}</bdi>{entry.fee>0n&&<small>Fee: {format(entry.fee,decimals)}</small>}</div>
   <a href={explorer+'/tx/'+entry.tx} target="_blank" rel="noopener noreferrer" aria-label={'View transaction '+short(entry.tx)} title={short(entry.tx)}><ExternalLink size={17}/></a>
  </article>)}</div>:connected&&!busy?<p className="muted">No matching events found in the scanned range. Older blocks may contain records.</p>:null}
  <div className="ledger-history-footer"><span><Clock3 size={15}/> {complete?'Scanned back to block 0':cursor!==null?'Older blocks not scanned yet · next block '+cursor.toLocaleString('en-US'):'History is not loaded'}</span>
   <div>{items.length>visible&&<button className="small-button" type="button" onClick={()=>setVisible(v=>v+20)}>Show more loaded</button>}
   {cursor!==null&&connected&&<button className="small-button" type="button" disabled={busy} onClick={()=>void load()}>{busy?<RefreshCw className="spin" size={15}/>:<RefreshCw size={15}/>} {busy?'Reading chain…':'Load older blocks'}</button>}</div>
  </div>
 </section>;
}
