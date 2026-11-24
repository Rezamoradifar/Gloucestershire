import {useEffect,useRef,useState} from 'react';
import {ArrowDownLeft,ArrowUpRight,CheckCircle2,ExternalLink,History,RefreshCw} from 'lucide-react';
import {getWalletProvider} from './wallet';
import {V3_EXPLORER} from './v3-chain';
import {readV3HistoryPage,type V3HistoryAnchor,type V3HistoryCategory,type V3HistoryPage} from './v3-history';
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
 const anchor=useRef<V3HistoryAnchor|null>(null);
 useEffect(()=>{
  let alive=true;
  const provider=getWalletProvider();
  setLoading(true);setError('');setData(null);
  if(!provider){setError('Wallet disconnected. Reconnect to load account activity.');setLoading(false);return;}
  void readV3HistoryPage(provider,wallet,config,page,anchor.current).then(result=>{
   if(alive){anchor.current=result.anchor;setData(result);}
  }).catch(e=>{if(alive)setError(e instanceof Error&&safeHistoryMessages.has(e.message)?e.message:
   'Unable to load verified activity. Please retry or use the block explorer.');})
   .finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false;};
 },[wallet,config,page,version]);
 const refresh=()=>{anchor.current=null;setPage(0);setVersion(v=>v+1);};
 const needle=search.toLowerCase().trim();
 const cutoff=period==='all'?0:Date.now()/1000-Number(period)*86400;
 const visible=data?.items.filter(item=>(category==='all'||item.category===category)&&
  (!needle||[item.transaction,item.title,item.detail].some(v=>v.toLowerCase().includes(needle)))&&
  (period==='all'||(item.timestamp??0)>=cutoff))??[];
 const filters=[['all','All'],['deposits','Deposits'],['earnings','Earnings'],['withdrawals','Withdrawals'],['account','Account']] as const;
 return <section className="gv2-panel gv3-history" aria-labelledby="gv3-history-title">
  <div className="gv2-panel-head"><div><h3 id="gv3-history-title"><History size={19}/> Transaction history</h3>
   <p>Confirmed activity for your connected wallet on this test contract.</p></div>
   <button type="button" disabled={loading} onClick={refresh}><RefreshCw size={15}/> Refresh</button></div>
  {loading&&<p role="status">Loading confirmed activity from BNB Testnet…</p>}
  {error&&<p className="gv2-error" role="alert">{error}</p>}
  {data&&<>
   <p className="gv3-history-range">Blocks {data.from.toLocaleString('en-US')}–{data.to.toLocaleString('en-US')} · anchored to block {data.anchor.block.toLocaleString('en-US')}</p>
   <div className="gv3-history-filters" aria-label="Filter activity in these blocks">{filters.map(([id,label])=><button type="button" key={id} aria-pressed={category===id} onClick={()=>setCategory(id)}>{label}</button>)}</div>
   <div className="gdp-filters"><label>Search these blocks<input type="search" value={search} placeholder="Transaction ID or activity" onChange={e=>setSearch(e.target.value)}/></label>
    <label>Period<select value={period} onChange={e=>setPeriod(e.target.value)}><option value="all">All dates</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label></div>
   <p className="gv3-history-count">{visible.length} {visible.length===1?'event':'events'} in these blocks{category!=='all'?' · filter applies to this page':''}</p>
   {period!=='all'&&data.items.some(item=>!item.timestamp)&&<p>Some block times are unavailable. Choose All dates to include those events.</p>}
   {visible.length?<div className="gdp-ledger">{visible.map(item=><details className="gdp-ledger-entry" key={item.key}>
    <summary><i aria-hidden="true">{item.category==='withdrawals'?<ArrowUpRight size={17}/>:item.category==='account'?<CheckCircle2 size={16}/>:<ArrowDownLeft size={17}/>}</i>
     <span><strong>{item.title}</strong><small>{item.timestamp?formatUtcTime(item.timestamp):'Block '+item.block.toLocaleString('en-US')}</small></span>
     <span><b>{item.value??'—'}</b><small>{item.title==='Withdrawal paid'?'Paid':item.title.includes('withdrawal requested')||item.title==='Withdrawal requested'?'Requested':'Confirmed'}</small></span></summary>
    <div className="gdp-ledger-detail"><p>{item.detail}</p><small>Block {item.block.toLocaleString('en-US')} · Log {item.index}</small><code>{item.transaction}</code>
     <div><a href={V3_EXPLORER+'/tx/'+item.transaction} target="_blank" rel="noreferrer">View transaction <ExternalLink size={13}/></a>
      <button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(item.transaction);setCopied(item.key);}catch{setCopied(item.key+'-manual');}}}>
       {copied===item.key?'Copied':copied===item.key+'-manual'?'Select ID above to copy':'Copy ID'}</button></div></div>
   </details>)}</div>:<p>No matching events in these blocks. Choose All or browse older blocks.</p>}
   <div className="gv2-buttons"><button type="button" disabled={loading||page===0} onClick={()=>setPage(p=>p-1)}>Newer blocks</button>
    <button type="button" disabled={loading||data.from===data.anchor.firstBlock} onClick={()=>setPage(p=>p+1)}>Older blocks</button></div>
  </>}
  <p className="gv2-small">Claims are account credits, not wallet payments. Approval is permission, not a deposit. Browse older blocks to review earlier confirmed events from this test contract. Pending and failed transactions remain in your wallet or the explorer.</p>
  <div className="gv3-history-links"><a className="gv2-explorer" href={V3_EXPLORER+'/address/'+wallet} target="_blank" rel="noreferrer">Open wallet on explorer <ExternalLink size={14}/></a>
  <a className="gv2-explorer" href={V3_EXPLORER+'/address/'+config.address+'#events'} target="_blank" rel="noreferrer">Open contract events <ExternalLink size={14}/></a></div>
 </section>;
}
