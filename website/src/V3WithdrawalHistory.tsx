import {useEffect,useRef,useState} from 'react';
import {getWalletProvider} from './wallet';
import {formatV3Amount} from './v3-format';
import {formatUtcTime} from './utc-time';
import {readV3WithdrawalPage,type V3WithdrawalAnchor,type V3WithdrawalPage} from './v3-withdrawal-history';
import type {V3SiteReleaseConfig} from './v3-site-config';

const kinds=['Profit','Principal','Referral','Network milestone'];
const statuses=['Requested','Manager approved','Cash escrowed','Paid','Rejected','Cancelled'];
export default function V3WithdrawalHistory({wallet,config}:{wallet:string;config:V3SiteReleaseConfig}){
 const [page,setPage]=useState(0),[version,setVersion]=useState(0);
 const [data,setData]=useState<V3WithdrawalPage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const anchor=useRef<V3WithdrawalAnchor|null>(null);
 useEffect(()=>{
  let alive=true;
  const provider=getWalletProvider();setLoading(true);setData(null);setError('');
  if(!provider){setError('Reconnect your wallet to load withdrawal requests.');setLoading(false);return;}
  void readV3WithdrawalPage(provider,wallet,config,page,anchor.current).then(result=>{
   if(alive){anchor.current=result.anchor;setData(result);}
  }).catch(()=>{if(alive)setError('Unable to verify withdrawal requests. Refresh and try again.');})
   .finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false;};
 },[wallet,config,page,version]);
 const refresh=()=>{anchor.current=null;setPage(0);setVersion(v=>v+1);};
 return <section className="gv2-panel"><div className="gv2-panel-head"><div><h3>Withdrawal requests</h3>
  <p>Current status from the confirmed test contract.</p></div><button type="button" disabled={loading} onClick={refresh}>Refresh</button></div>
  {loading&&<p role="status">Loading verified requests…</p>}{error&&<p className="gv2-error" role="alert">{error}</p>}
  {data&&<>
   <p className="gv3-history-range">{data.total} total · confirmed block {data.anchor.block.toLocaleString('en-US')}</p>
   {data.items.map(r=><article className="gv3-withdrawal-row" key={r.id}>
    <div><strong>Request #{r.id+1} · {kinds[r.kind]??'Unknown'}</strong>
     <small>{formatUtcTime(r.requestedAt)}</small></div>
    <div><b>{formatV3Amount(r.gross)} USDT</b><small>Net {formatV3Amount(r.gross-r.fee)} · Fee {formatV3Amount(r.fee)}</small></div>
    <div><span className="gv3-request-status">{statuses[r.status]??'Unverified'}</span></div>
   </article>)}
   {!data.items.length&&<p>No confirmed withdrawal requests for this wallet.</p>}
   <div className="gv2-buttons"><button type="button" disabled={loading||page===0} onClick={()=>setPage(p=>p-1)}>Newer requests</button>
    <button type="button" disabled={loading||(page+1)*20>=data.total} onClick={()=>setPage(p=>p+1)}>Older requests</button></div>
  </>}
  <p className="gv2-small">The list shows the status at its confirmed block; use Refresh for a newer status. A request is a payment only when marked Paid.</p>
 </section>;
}
