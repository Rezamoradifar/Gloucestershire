import {useEffect,useRef,useState} from 'react';
import {ArrowDownLeft,ArrowUpRight,CheckCircle2,ExternalLink,History,RefreshCw} from 'lucide-react';
import {getWalletProvider} from './wallet';
import {V3_EXPLORER} from './v3-chain';
import {readV3HistoryPage,type V3HistoryAnchor,type V3HistoryCategory,type V3HistoryItem,type V3HistoryPage} from './v3-history';
import {searchV3History,type V3HistoryQuery,type V3SearchProgress} from './v3-history-search';
import type {V3SiteReleaseConfig} from './v3-site-config';
import {formatUtcTime} from './utc-time';
import './v3-history.css';

const safeHistoryMessages=new Set([
 'The confirmed history block changed. Refresh history.',
 'The history block changed while loading. Refresh history.',
 'Too many events in this range. Open the contract explorer for this block range.',
 'Unable to load the complete activity for these blocks. Please retry or use the block explorer.',
 'History anchor or deployment block is no longer verified.',
 'No earlier V3 block range is available.'
]);

export default function V3HistoryPanel({wallet,config}:{wallet:string;config:V3SiteReleaseConfig}){
 const [page,setPage]=useState(0),[version,setVersion]=useState(0);
 const [category,setCategory]=useState<'all'|V3HistoryCategory>('all');
 const [data,setData]=useState<V3HistoryPage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [search,setSearch]=useState(''),[period,setPeriod]=useState('all'),[copied,setCopied]=useState('');
 const [startDay,setStartDay]=useState(''),[endDay,setEndDay]=useState(''),[formError,setFormError]=useState('');
 const [query,setQuery]=useState<V3HistoryQuery|null>(null),[matches,setMatches]=useState<V3HistoryItem[]>([]);
 const [progress,setProgress]=useState<V3SearchProgress|null>(null),[stopped,setStopped]=useState(false);
 const anchor=useRef<V3HistoryAnchor|null>(null),controller=useRef<AbortController|null>(null);
 const browsePage=query?0:page;
 useEffect(()=>{
  const abort=new AbortController();
  controller.current=abort;
  const provider=getWalletProvider();
  setLoading(true);setError('');setData(null);setStopped(false);setMatches([]);setProgress(null);
  if(!provider){setError('Wallet disconnected. Reconnect to load account activity.');setLoading(false);return;}
  const work=query?searchV3History(provider,wallet,config,query,abort.signal,result=>{
   if(abort.signal.aborted)return;
   anchor.current=result.anchor;
   if(result.items.length)setMatches(previous=>[...previous,...result.items]);
   setProgress(result);
  },anchor.current):readV3HistoryPage(provider,wallet,config,browsePage,anchor.current).then(result=>{
   if(!abort.signal.aborted){anchor.current=result.anchor;setData(result);}
  });
  void work.catch(e=>{
   if(!abort.signal.aborted)setError(e instanceof Error&&safeHistoryMessages.has(e.message)?e.message:
    'Unable to load verified activity. Please retry or use the block explorer.');
  }).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return()=>{abort.abort();};
 },[wallet,config,query,browsePage,version]);
 const refresh=()=>{anchor.current=null;setPage(0);setVersion(v=>v+1);};
 function submit(selected=category){
  let start:number|undefined,end:number|undefined;
  if(period==='custom'){
   if(startDay)start=Date.parse(startDay+'T00:00:00Z')/1000;
   if(endDay)end=Date.parse(endDay+'T00:00:00Z')/1000+86400;
   if((start===undefined&&end===undefined)||[start,end].some(t=>t!==undefined&&!Number.isSafeInteger(t))||
    (start!==undefined&&end!==undefined&&start>=end)){setFormError('Choose a valid UTC date range.');return;}
  }else if(period!=='all')start=Math.floor(Date.now()/1000)-Number(period)*86400;
  setLoading(true);setError('');setMatches([]);setProgress(null);setStopped(false);
  setFormError('');setCategory(selected);setPage(0);setQuery({text:search.trim(),category:selected,start,end});
 }
 const browse=()=>{setQuery(null);setPage(0);setCategory('all');setSearch('');setPeriod('all');setFormError('');};
 const cancel=()=>{controller.current?.abort();setLoading(false);setStopped(true);};
 const pageSize=20;
 const visible=query?matches.slice(page*pageSize,(page+1)*pageSize):data?.items??[];
 const filters=[['all','All'],['deposits','Deposits'],['earnings','Earnings'],['withdrawals','Withdrawals'],['account','Account']] as const;
 return <section className="gv2-panel gv3-history" aria-labelledby="gv3-history-title">
  <div className="gv2-panel-head"><div><h3 id="gv3-history-title"><History size={19}/> Transaction history</h3>
   <p>Confirmed activity for your connected wallet on this test contract.</p></div>
   <button type="button" disabled={loading} onClick={refresh}><RefreshCw size={15}/> Refresh</button></div>
  <form onSubmit={e=>{e.preventDefault();submit();}} aria-label="Search full transaction history">
   <div className="gv3-history-filters" aria-label="Activity type">{filters.map(([id,label])=><button type="button" key={id}
    aria-pressed={category===id} onClick={()=>submit(id)}>{label}</button>)}</div>
   <div className="gdp-filters"><label>Search full history<input type="search" value={search} placeholder="Transaction ID or activity" onChange={e=>setSearch(e.target.value)}/></label>
    <label>Period<select aria-label="Period" value={period} onChange={e=>setPeriod(e.target.value)}><option value="all">All dates</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="custom">Custom UTC dates</option></select></label>
    {period==='custom'&&<><label>From (UTC)<input type="date" value={startDay} onChange={e=>setStartDay(e.target.value)}/></label>
     <label>Through (UTC)<input type="date" value={endDay} onChange={e=>setEndDay(e.target.value)}/></label></>}
   </div>
   {formError&&<p role="alert">{formError}</p>}
   <div className="gv2-buttons"><button type="submit">Search full history</button>
    {query&&loading&&<button type="button" onClick={cancel}>Stop search</button>}
    {query&&<button type="button" onClick={browse}>Browse latest blocks</button>}</div>
  </form>
  {error&&<p className="gv2-error" role="alert">{error}</p>}
  {query?<div className="gv3-history-count" role="status">
   <strong>{stopped?'Search stopped':error?'Search incomplete':loading?'Searching verified activity…':'Search complete'}</strong>
   {' · '+matches.length+' '+(matches.length===1?'match':'matches')}
   {progress&&<small> {progress.scanned.toLocaleString('en-US')} of {Math.max(0,progress.range.to-progress.range.from+1).toLocaleString('en-US')} blocks checked · confirmed through block {progress.anchor.block.toLocaleString('en-US')}</small>}
  </div>:loading?<p role="status">Loading confirmed activity from BNB Testnet…</p>:
   data&&<p className="gv3-history-range">Blocks {data.from.toLocaleString('en-US')}–{data.to.toLocaleString('en-US')} · {data.items.length} events</p>}
  {(query||data)&&<>
   {visible.length?<div className="gdp-ledger">{visible.map(item=><details className="gdp-ledger-entry" key={item.key}>
    <summary><i aria-hidden="true">{item.category==='withdrawals'?<ArrowUpRight size={17}/>:item.category==='account'?<CheckCircle2 size={16}/>:<ArrowDownLeft size={17}/>}</i>
     <span><strong>{item.title}</strong><small>{item.timestamp?formatUtcTime(item.timestamp):'Block '+item.block.toLocaleString('en-US')}</small></span>
     <span><b>{item.value??'—'}</b><small>{item.title==='Withdrawal paid'?'Paid':item.title.includes('withdrawal requested')||item.title==='Withdrawal requested'?'Requested':'Confirmed'}</small></span></summary>
    <div className="gdp-ledger-detail"><p>{item.detail}</p><small>Block {item.block.toLocaleString('en-US')} · Log {item.index}</small><code>{item.transaction}</code>
     <div><a href={V3_EXPLORER+'/tx/'+item.transaction} target="_blank" rel="noreferrer">View transaction <ExternalLink size={13}/></a>
      <button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(item.transaction);setCopied(item.key);}catch{setCopied(item.key+'-manual');}}}>
       {copied===item.key?'Copied':copied===item.key+'-manual'?'Select ID above to copy':'Copy ID'}</button></div></div>
   </details>)}</div>:query?(loading||error||stopped?null:<p>No matching confirmed events in the selected contract history.</p>):<p>No wallet events in these blocks.</p>}
   {query?matches.length>pageSize&&<div className="gv2-buttons">
    <button type="button" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous results</button>
    <span>Page {page+1} of {Math.ceil(matches.length/pageSize)}</span>
    <button type="button" disabled={(page+1)*pageSize>=matches.length} onClick={()=>setPage(p=>p+1)}>Next results</button>
   </div>:data&&<div className="gv2-buttons"><button type="button" disabled={loading||page===0} onClick={()=>setPage(p=>p-1)}>Newer blocks</button>
    <button type="button" disabled={loading||data.from===data.anchor.firstBlock} onClick={()=>setPage(p=>p+1)}>Older blocks</button></div>}
  </>}
  <p className="gv2-small">History includes confirmed wallet events since this contract was deployed. Pending and failed transactions remain in your wallet or the explorer.</p>
  <div className="gv3-history-links"><a className="gv2-explorer" href={V3_EXPLORER+'/address/'+wallet} target="_blank" rel="noreferrer">Open wallet on explorer <ExternalLink size={14}/></a>
  <a className="gv2-explorer" href={V3_EXPLORER+'/address/'+config.address+'#events'} target="_blank" rel="noreferrer">Open contract events <ExternalLink size={14}/></a></div>
 </section>;
}
