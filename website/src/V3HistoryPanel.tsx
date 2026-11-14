import {useEffect,useRef,useState} from 'react';
import {ExternalLink,History,RefreshCw} from 'lucide-react';
import {getWalletProvider} from './wallet';
import {V3_EXPLORER} from './v3-chain';
import {readV3HistoryPage,type V3HistoryAnchor,type V3HistoryPage} from './v3-history';
import type {V3SiteReleaseConfig} from './v3-site-config';
import './v3-history.css';

export default function V3HistoryPanel({wallet,config}:{wallet:string;config:V3SiteReleaseConfig}){
 const [page,setPage]=useState(0),[version,setVersion]=useState(0);
 const [data,setData]=useState<V3HistoryPage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const anchor=useRef<V3HistoryAnchor|null>(null);
 useEffect(()=>{
  let alive=true;
  const provider=getWalletProvider();
  setLoading(true);setError('');setData(null);
  if(!provider){setError('Wallet disconnected. Reconnect to load account activity.');setLoading(false);return;}
  void readV3HistoryPage(provider,wallet,config,page,anchor.current).then(result=>{
   if(alive){anchor.current=result.anchor;setData(result);}
  }).catch(e=>{if(alive)setError(e instanceof Error?e.message:'V3 history is unavailable.');})
   .finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false;};
 },[wallet,config,page,version]);
 const refresh=()=>{anchor.current=null;setPage(0);setVersion(v=>v+1);};
 return <section className="gv2-panel gv3-history" aria-labelledby="gv3-history-title">
  <div className="gv2-panel-head"><div><h3 id="gv3-history-title"><History size={19}/> On-chain account activity</h3>
   <p>Confirmed V3 test-token events for this connected wallet.</p></div>
   <button type="button" disabled={loading} onClick={refresh}><RefreshCw size={15}/> Refresh</button></div>
  {loading&&<p role="status">Loading confirmed activity from BNB Testnet…</p>}
  {error&&<p className="gv2-error" role="alert">{error}</p>}
  {data&&<>
   <p className="gv3-history-range">Blocks {data.from.toLocaleString('en-US')}–{data.to.toLocaleString('en-US')} · anchored to block {data.anchor.block.toLocaleString('en-US')}</p>
   {data.items.length?<div className="gv3-history-list">{data.items.map(item=><article className="gv3-history-row" key={item.key}>
    <div><strong>{item.title}</strong><small>{item.detail}</small><small>Block {item.block.toLocaleString('en-US')}</small></div>
    <div>{item.value&&<b>{item.value}</b>}<a href={V3_EXPLORER+'/tx/'+item.transaction} target="_blank" rel="noreferrer">Transaction <ExternalLink size={14}/></a></div>
   </article>)}</div>:<p>No matching events in these blocks. Earlier blocks may contain activity.</p>}
   <div className="gv2-buttons"><button type="button" disabled={loading||page===0} onClick={()=>setPage(p=>p-1)}>Newer blocks</button>
    <button type="button" disabled={loading||data.from===data.anchor.firstBlock} onClick={()=>setPage(p=>p+1)}>Older blocks</button></div>
  </>}
  <p className="gv2-small">Accrued claims are not payments. Only a paid withdrawal event records a token transfer to the beneficiary. The displayed range is limited; use the explorer for complete history.</p>
  <a className="gv2-explorer" href={V3_EXPLORER+'/address/'+config.address+'#events'} target="_blank" rel="noreferrer">Open V3 contract events <ExternalLink size={14}/></a>
 </section>;
}
