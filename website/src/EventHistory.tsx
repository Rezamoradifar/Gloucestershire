import {useEffect,useMemo,useRef,useState} from 'react';
import type {Log} from 'ethers';
import {ArrowDown,ArrowLeft,ArrowRight,CalendarClock,Check,Clock3,Download,ExternalLink,FileClock,History,RefreshCw,Search,ShieldCheck,Wallet} from 'lucide-react';
import {displayAmount} from './money';
import FinancialInsights from './FinancialInsights';
import WithdrawalHistoryPanel from './WithdrawalHistoryPanel';
import {filterHistory,historyCsv,historyLabels,historyTotals,parseFinancialLog,type HistoryFilter,type LedgerEvent} from './history-ledger';
import {errorText,type Asset} from './chain';
import {readOnlySession} from './read-only-session';
import {requestVerifiedHistory} from './server-event-history';
import {chainId,explorer,vaultAddress} from './config';
import './history-center.css';

export {parseFinancialLog} from './history-ledger';
type Scan='finance'|'reward';
type ScanSession={rows:LedgerEvent[];head:number;financeCursor:number|null;rewardCursor:number|null;rewardStarted:boolean};
const historyCache=new Map<string,ScanSession>();
const PAGE_SIZE=20;
const initialFilter:HistoryFilter={kind:'all',query:'',from:'',to:'',sort:'newest'};
const abbreviated=(value:string)=>value.slice(0,10)+'…'+value.slice(-7);
const money=(value:bigint,decimals:number)=>displayAmount(value,decimals,6);
const niceTime=(timestamp:number|null,block:number)=>timestamp===null?'Block '+block.toLocaleString('en-US')+' · time unavailable':new Date(timestamp*1000).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
const rowTitle=(entry:LedgerEvent)=>entry.kind==='withdrawal'?(entry.principal?'Principal withdrawn':'Profit withdrawn'):historyLabels[entry.kind];

export default function EventHistory({who,asset,token,decimals,block,connected,scope='wallet'}:{
 who:string;asset:Asset;token:string;decimals:number;block:number;connected:boolean;scope?:'wallet'|'global'
}){
 const key=[chainId,vaultAddress.toLowerCase(),who.toLowerCase(),asset,token.toLowerCase(),scope].join(':');
 const [records,setRecords]=useState<LedgerEvent[]>([]);
 const [financeCursor,setFinanceCursor]=useState<number|null>(null);
 const [rewardCursor,setRewardCursor]=useState<number|null>(null);
 const [head,setHead]=useState<number|null>(null),[rewardStarted,setRewardStarted]=useState(false);
 const [loading,setLoading]=useState<Scan|null>(null),[progress,setProgress]=useState('');
 const [error,setError]=useState(''),[rewardError,setRewardError]=useState('');
 const [filter,setFilter]=useState<HistoryFilter>(initialFilter),[page,setPage]=useState(0);
 const generation=useRef(0),busy=useRef(false),cursorRef=useRef<{finance:number|null;reward:number|null}>({finance:null,reward:null});
 const headRef=useRef<number|null>(null),rewardStartedRef=useRef(false);
 const cacheFor=()=>historyCache.get(key);
 const sync=(session:ScanSession)=>{
  cursorRef.current={finance:session.financeCursor,reward:session.rewardCursor};
  headRef.current=session.head;rewardStartedRef.current=session.rewardStarted;
  setRecords(session.rows);setFinanceCursor(session.financeCursor);setRewardCursor(session.rewardCursor);
  setHead(session.head);setRewardStarted(session.rewardStarted);
 };
 const scan=async(kind:Scan,mode:'recent'|'older'|'deep'='older')=>{
  const cursor=cursorRef.current[kind];
  if(!connected||!who||!token||cursor===null||busy.current)return;
  busy.current=true;setLoading(kind);setProgress('Reading verified blockchain history from the Global server…');
  if(kind==='finance')setError('');else setRewardError('');
  const identity=generation.current;
  const targetBlocks=mode==='recent'?1024:mode==='deep'?12000:4096;
  const pageLimit=mode==='recent'?30:mode==='deep'?150:75;
  const floor=Math.max(0,cursor-targetBlocks+1);
  const collected:LedgerEvent[]=[];
  let current=cursor,requests=0;
  try{
   // The wallet is only used to confirm the selected account and chain.
   // The server owns the historical RPC log reads, never the wallet provider.
   await readOnlySession(who);
   const verifiedHead=await requestVerifiedHistory({wallet:who,asset:token,scope,kind});
   if(verifiedHead.confirmedHead<cursor)
    throw Error('Verified server head is behind this scan. Restart history after the blocks confirm.');
   while(current>=floor&&requests<pageLimit){
    if(generation.current!==identity)return;
    const first=Math.max(floor,current-95);
    const result=await requestVerifiedHistory({wallet:who,asset:token,scope,kind,from:first,to:current});
    for(const log of result.logs){
     const row=parseFinancialLog(log as unknown as Log);
     if(row&&(kind==='reward'?row.kind==='networkReward':row.kind!=='networkReward'))
      collected.push({...row,timestamp:log.timestamp});
    }
    current=first-1;requests++;
    if(requests%4===0){
     setProgress('Scanning confirmed blocks '+Math.max(0,current+1).toLocaleString('en-US')+' – '+cursor.toLocaleString('en-US')+' · '+collected.length+' events found');
    }
   }
   const annotated=collected;
   if(generation.current!==identity)return;
   const previous=cacheFor();
   if(!previous||previous.head!==headRef.current)throw Error('History session changed; reload to continue.');
   const dedup=new Map(previous.rows.map(row=>[row.key,row]));
   annotated.forEach(row=>dedup.set(row.key,row));
   const rows=[...dedup.values()].sort((a,b)=>b.block-a.block||b.index-a.index);
   const nextCursor=current>=0?current:null;
   const next={...previous,rows,...(kind==='finance'?{financeCursor:nextCursor}:{rewardCursor:nextCursor,rewardStarted:true})};
   historyCache.set(key,next);sync(next);
   setProgress('Read '+requests+' history windows. Next older block: '+(nextCursor===null?'genesis reached':nextCursor.toLocaleString('en-US')));
  }catch(reason){
   if(generation.current!==identity)return;
   if(kind==='finance')setError(errorText(reason));else setRewardError(errorText(reason));
  }finally{
   if(generation.current===identity){busy.current=false;setLoading(null);}
  }
 };
 useEffect(()=>{
  generation.current++;busy.current=false;
  setRecords([]);setFinanceCursor(null);setRewardCursor(null);setHead(null);
  setError('');setRewardError('');setProgress('');setLoading(null);
  setFilter(initialFilter);setPage(0);
  if(connected&&who&&token&&block>0){
   const existing=historyCache.get(key);
   if(existing){sync(existing);}
   else{
    const identity=generation.current;
    void (async()=>{
     try{
      await readOnlySession(who);
      const info=await requestVerifiedHistory({wallet:who,asset:token,scope,kind:'finance'});
      if(generation.current!==identity)return;
      const start=Math.max(0,Math.min(block-3,info.confirmedHead));
      const initial:ScanSession={rows:[],head:start,financeCursor:start,rewardCursor:start,rewardStarted:false};
      historyCache.set(key,initial);sync(initial);void scan('finance','recent');
     }catch(reason){if(generation.current===identity)setError(errorText(reason));}
    })();
   }
  }
  return()=>{generation.current++;};
  // A new snapshot block does not discard an incremental history scan.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,connected]);
 useEffect(()=>{
  if(scope!=='wallet'||filter.kind!=='networkReward'||!connected||rewardStartedRef.current||cursorRef.current.reward===null||busy.current)return;
  const current=cacheFor();
  if(!current)return;
  const next={...current,rewardStarted:true};historyCache.set(key,next);rewardStartedRef.current=true;setRewardStarted(true);
  void scan('reward','recent');
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[filter.kind,connected,key,loading]);
 const filterRows=useMemo(()=>filterHistory(records,filter),[records,filter]);
 const totals=useMemo(()=>historyTotals(filterRows),[filterRows]);
 const pages=Math.max(1,Math.ceil(filterRows.length/PAGE_SIZE));
 const visible=filterRows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
 const allFinances=financeCursor===null&&head!==null;
 const fullLedger=allFinances&&(scope==='global'||rewardCursor===null);
 const dayFilter=Boolean(filter.from||filter.to);
 const unknownTimeCount=records.filter(row=>row.timestamp===null).length;
 const invalidDates=Boolean(filter.from&&filter.to&&filter.from>filter.to);
 const updateFilter=(next:Partial<HistoryFilter>)=>{setFilter(old=>({...old,...next}));setPage(0);};
 const refresh=()=>{
  if(!connected||!who||!token||block<=0||busy.current)return;
  generation.current++;busy.current=false;
  setError('');setRewardError('');setFilter(initialFilter);setPage(0);setProgress('');
  const identity=generation.current;
  void (async()=>{
   try{
    await readOnlySession(who);
    const info=await requestVerifiedHistory({wallet:who,asset:token,scope,kind:'finance'});
    if(generation.current!==identity)return;
    const start=Math.max(0,Math.min(block-3,info.confirmedHead));
    const updated:ScanSession={rows:[],head:start,financeCursor:start,rewardCursor:start,rewardStarted:false};
    historyCache.set(key,updated);sync(updated);void scan('finance','recent');
   }catch(reason){if(generation.current===identity)setError(errorText(reason));}
  })();
 };
 const download=()=>{
  if(filterRows.length===0||invalidDates)return;
  const content=historyCsv(filterRows,asset,decimals,chainId,vaultAddress,fullLedger);
  const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='global-'+asset.toLowerCase()+'-history-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
 };
 const coverage=!connected||head===null?'No history scanned — connect your wallet':financeCursor===null?'Scanned back to genesis (for this snapshot)':'Finance events scanned down through block '+(financeCursor+1).toLocaleString('en-US')+'; older blocks remain.';
 return <div className="history-center">
  <section className="panel global-ledger history-full" aria-labelledby={scope==='global'?'global-network-ledger-title':'global-ledger-title'}>
   <div className="panel-title history-header">
    <div><span className="detail-kicker">VERIFIABLE FINANCIAL RECORDS</span>
     <h2 id={scope==='global'?'global-network-ledger-title':'global-ledger-title'}><History size={23}/> {scope==='global'?'Platform event explorer':'Complete history center'}</h2>
     <p>Deposits · profit credits · withdrawals · reinvestment{scope==='wallet'?' · network milestones':''} · {asset} · {chainId===97?'BNB Testnet':'BNB Smart Chain'}</p>
    </div>
    <div className="history-header-actions"><button className="small-button" type="button" disabled={!connected||loading!==null} onClick={refresh} title="Restart history from the latest confirmed block; previously loaded pages in this tab are cleared"><RefreshCw size={16} className={loading?'spin':''}/> Restart scan</button>
     <button className="small-button history-export" type="button" disabled={!filterRows.length||invalidDates} onClick={download}><Download size={16}/> Export loaded CSV</button>
    </div>
   </div>
   {scope==='wallet'&&<p className="ledger-note">Credited profit is recorded inside the contract, not sent to the wallet until withdrawal. Network milestones are recorded USD metrics, not USDT deposits. Values and dates below come from verified contract events.</p>}
   {scope==='global'&&<p className="ledger-note">This is a public event browser for the selected asset, not a reconciliation or a complete customer accounting statement.</p>}
   <p className="ledger-note">Source: confirmed contract events from the Global server RPC. When available, database-indexed pages are rechecked against the canonical blockchain before display. Missing RPC history is shown as unavailable, never as zero activity.</p>
   <div className="history-coverage"><ShieldCheck size={18}/><div><strong>{coverage}</strong><span>{head!==null?'Confirmed snapshot up to block '+head.toLocaleString('en-US')+' (3-block safety buffer)':'Connect your wallet to load verified records'}</span></div><span className="history-scan-state">{!connected?'NOT CONNECTED':loading?'SCANNING':fullLedger?'GENESIS REACHED':'PARTIAL INDEX'}</span></div>
   <div className="history-summary" aria-label="Totals among loaded matching records">
    {([{kind:'deposit',title:'Deposits'},{kind:'profit',title:'Profit credited'},{kind:'withdrawal',title:'Withdrawals · gross'},{kind:'reinvest',title:'Reinvested'}] as const).map(({kind,title})=>
     <div className="history-summary-card" key={kind}><small>{title}</small><strong>{connected?money(totals[kind],decimals):'—'} <em>{asset}</em></strong><span>Loaded matching records only</span></div>)}
    {scope==='wallet'&&rewardStarted&&<div className="history-summary-card"><small>Network milestones</small><strong>{connected?money(totals.networkReward,18):'—'} <em>USD</em></strong><span>Not a wallet transfer</span></div>}
   </div>
   {scope==='wallet'&&connected&&<FinancialInsights events={records.filter(row=>row.kind!=='networkReward')} asset={asset} decimals={decimals} complete={allFinances}/>}
   <div className="history-filters" aria-label="History filters">
    <label><span><Search size={14}/> Search hash, wallet, batch or position</span><input type="search" value={filter.query} placeholder="0x… or #position" onChange={event=>updateFilter({query:event.target.value})}/></label>
    <label><span>Event type</span><select value={filter.kind} onChange={event=>updateFilter({kind:event.target.value as HistoryFilter['kind']})}>
     <option value="all">All loaded events</option><option value="deposit">Deposits</option><option value="profit">Profit credited</option><option value="withdrawal">Withdrawals</option><option value="reinvest">Reinvested</option>
     {scope==='wallet'&&<option value="networkReward">Network reward milestones · USD</option>}
    </select></label>
    <label><span>From (UTC)</span><input type="date" value={filter.from} onChange={event=>updateFilter({from:event.target.value})}/></label>
    <label><span>To (UTC)</span><input type="date" value={filter.to} onChange={event=>updateFilter({to:event.target.value})}/></label>
    <label><span>Order</span><select value={filter.sort} onChange={event=>updateFilter({sort:event.target.value as HistoryFilter['sort']})}>
     <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
    </select></label>
   </div>
   {invalidDates&&<p role="alert" className="inline-error">The start date cannot be later than the end date.</p>}
   {dayFilter&&unknownTimeCount>0&&<p className="muted">Date filters exclude {unknownTimeCount} loaded events whose block timestamps could not be verified.</p>}
   <div className="history-table-toolbar"><strong>{filterRows.length.toLocaleString('en-US')} matching loaded events</strong>
    <button type="button" className="history-clear-filter" onClick={()=>{setFilter(initialFilter);setPage(0);}}>Clear filters</button>
   </div>
   {loading&&<p className="history-working" role="status"><RefreshCw size={15} className="spin"/>{progress}</p>}
   {error&&<p className="inline-error" role="alert">{error}</p>}
   {rewardError&&<p className="inline-error" role="alert">Network milestone history could not be scanned: {rewardError}</p>}
   {visible.length?<div className="history-events">{visible.map(entry=><article key={entry.key} className="history-event">
    <div className={'history-event-mark kind-'+entry.kind}>{entry.kind==='deposit'?<ArrowDown size={19}/>:entry.kind==='withdrawal'?<ArrowRight size={19}/>:entry.kind==='profit'?<Check size={19}/>:entry.kind==='reinvest'?<RefreshCw size={19}/>:<ShieldCheck size={19}/>}</div>
    <div className="history-event-main"><strong>{rowTitle(entry)}</strong><span><CalendarClock size={13}/> {niceTime(entry.timestamp,entry.block)}</span>
     <small>Block {entry.block.toLocaleString('en-US')}{entry.position!==undefined?' · Position #'+(entry.position+1n).toString():''}</small></div>
    <div className="history-event-value"><strong className={entry.kind==='withdrawal'?'outgoing':'incoming'}>
     {entry.kind==='withdrawal'?'−':'+'}{money(entry.amount,entry.kind==='networkReward'?18:decimals)} <small>{entry.kind==='networkReward'?'USD':asset}</small></strong>
     <span>{entry.kind==='networkReward'?'Recorded milestone · not paid':entry.kind==='profit'?'Credited within contract':entry.kind==='withdrawal'?'On-chain withdrawal':'Confirmed contract event'}</span></div>
    <a className="history-explorer-link" target="_blank" rel="noopener noreferrer" href={explorer+'/tx/'+entry.tx} aria-label={'Open transaction '+abbreviated(entry.tx)} title={'Transaction '+entry.tx}><ExternalLink size={18}/></a>
    <details className="history-event-details"><summary>View transaction details</summary>
     <div><span>Full transaction hash</span><code>{entry.tx}</code></div>
     <div><span>Wallet</span><code>{entry.wallet}</code></div>
     {entry.kind==='withdrawal'&&<><div><span>Gross amount</span><b>{money(entry.amount,decimals)} {asset}</b></div><div><span>Contract fee</span><b>{money(entry.fee,decimals)} {asset}</b></div><div><span>Net after fee</span><b>{money(entry.amount-entry.fee,decimals)} {asset}</b></div></>}
     {entry.depositUsd!==undefined&&<div><span>Recorded deposit USD basis</span><b>{money(entry.depositUsd,18)} USD</b></div>}
     {entry.creditId&&<div><span>Credit batch ID</span><code>{entry.creditId}</code></div>}
     {entry.group!==undefined&&<><div><span>Reward group</span><b>#{(entry.group+1n).toString()}; stage {entry.stage}</b></div><div><span>Recorded network volume</span><b>{money(entry.volumeUsd??0n,18)} USD</b></div></>}
     <div><span>Source</span><b>Confirmed contract event, block {entry.block}</b></div>
    </details>
   </article>)}</div>:!loading&&connected&&!invalidDates&&!error?<p className="history-empty">No matching events were found in the blocks scanned so far. Older blocks may contain records.</p>:!connected?<p className="history-empty"><Wallet size={20}/> Connect your wallet on the configured chain to browse contract history.</p>:null}
   <div className="history-page-controls">
    <button className="small-button" type="button" disabled={page===0} onClick={()=>setPage(p=>p-1)}><ArrowLeft size={15}/> Previous</button>
    <span>Page {filterRows.length?String(Math.min(page+1,pages)):'0'} of {filterRows.length?String(pages):'0'}</span>
    <button className="small-button" type="button" disabled={(page+1)*PAGE_SIZE>=filterRows.length} onClick={()=>setPage(p=>p+1)}>Next <ArrowRight size={15}/></button>
   </div>
   <div className="history-scan-actions">
    <div><strong><FileClock size={18}/> Need older history?</strong><p>Load more verified block ranges on demand. Full historical coverage depends on the verified server RPC's archive and log access.</p></div>
    <div className="history-scan-buttons">
     <button className="small-button" type="button" disabled={!connected||loading!==null||financeCursor===null} onClick={()=>void scan('finance','older')}><ArrowDown size={15}/> Load older finance events</button>
     <button className="small-button" type="button" disabled={!connected||loading!==null||financeCursor===null} onClick={()=>void scan('finance','deep')}>Deep scan older blocks</button>
     {scope==='wallet'&&<button className="small-button" type="button" disabled={!connected||loading!==null||rewardCursor===null} onClick={()=>void scan('reward','older')}>Load older network milestones</button>}
    </div>
   </div>
   <p className="ledger-note">Totals, charts and CSV files include only records that have been retrieved and pass the selected filters. They are not a certified lifetime statement until all relevant block ranges have been indexed. CSV contains exact decimal amounts, UTC dates, transaction hashes and scan-completeness metadata.</p>
  </section>
  {scope==='wallet'&&<WithdrawalHistoryPanel who={who} connected={connected}/>}
 </div>;
}
