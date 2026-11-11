import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,Clock3,ExternalLink,FileClock,RefreshCw} from 'lucide-react';
import {readWithdrawalHistory,withdrawalState,type WithdrawalHistoryPage} from './history-queue';
import {displayAmount} from './money';
import {explorer} from './config';
import {errorText} from './chain';

export default function WithdrawalHistoryPanel({who,connected}:{who:string;connected:boolean}){
 const [page,setPage]=useState(0),[reload,setReload]=useState(0);
 const [history,setHistory]=useState<WithdrawalHistoryPage|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{setPage(0);setHistory(null);setError('');},[who,connected]);
 useEffect(()=>{
  if(!connected||!who)return;
  let cancelled=false;setBusy(true);setError('');
  readWithdrawalHistory(who,page).then(value=>{if(!cancelled)setHistory(value);})
   .catch(reason=>{if(!cancelled){setHistory(null);setError(errorText(reason));}})
   .finally(()=>{if(!cancelled)setBusy(false);});
  return()=>{cancelled=true;};
 },[who,connected,page,reload]);
 const total=history?.count??0n;
 const pages=total===0n?0n:(total+7n)/8n;
 const rows=history?.rows??[];
 const shown=rows.length>0?String(page*8+1)+'–'+String(page*8+rows.length):'0';
 return <section className="panel history-queue-panel" aria-labelledby="history-withdrawal-title">
  <div className="panel-title"><div><span className="detail-kicker">WITHDRAWAL REQUEST LIFECYCLE</span><h2 id="history-withdrawal-title"><FileClock size={21}/> Withdrawal request history</h2>
   <p>Actual request status from the contract queue, including approvals, payments and cancellations.</p></div>
   <button className="small-button" type="button" disabled={!connected||busy} onClick={()=>setReload(n=>n+1)}><RefreshCw size={16} className={busy?'spin':''}/> Refresh</button>
  </div>
  {!connected?<p className="muted">Connect your wallet to view your private request list. No wallet signature is requested for reading.</p>:null}
  {busy&&<p role="status" className="muted">Reading confirmed queue records…</p>}
  {error&&<p role="alert" className="inline-error">{error}</p>}
  {history&&!history.supported?<p className="ledger-note">This contract uses direct withdrawals instead of an approval queue. Check the verified Withdrawal transaction events above.</p>:null}
  {history?.supported&&<>
   <div className="history-queue-summary"><span>Total requests in queue <strong>{total.toString()}</strong></span><span>Displayed <strong>{shown}</strong></span><span>Snapshot block <strong>{history.checkedAtBlock.toLocaleString('en-US')}</strong></span></div>
   {rows.length?<div className="history-queue-list">{rows.map(row=><article key={row.id.toString()} className="history-queue-row">
    <div className="history-queue-row-head"><strong>Request #{(row.id+1n).toString()} · {row.principal?'Principal':'Profit'}</strong><span className={'history-queue-status status-'+row.status}>{withdrawalState(row.status,row.dueAt,history.blockTime,history.approvalRequired)}</span></div>
    <div className="history-queue-row-body"><span>Requested <bdi>{displayAmount(row.gross,row.decimals,6)} {row.asset}</bdi></span><span>Fee <bdi>{displayAmount(row.fee,row.decimals,6)} {row.asset}</bdi></span><span>Net requested <bdi>{displayAmount(row.net,row.decimals,6)} {row.asset}</bdi></span></div>
    <div className="history-queue-row-foot"><span><Clock3 size={15}/> Deadline: <time dateTime={new Date(row.dueAt*1000).toISOString()}>{new Date(row.dueAt*1000).toLocaleString()}</time></span>
    {history.queueAddress&&<a href={explorer+'/address/'+history.queueAddress} target="_blank" rel="noopener noreferrer">View queue contract <ExternalLink size={14}/></a>}</div>
   </article>)}</div>:!busy?<p className="muted">No withdrawal requests are recorded for this wallet on this contract.</p>:null}
   <div className="history-queue-pagination"><button type="button" className="small-button" disabled={busy||page<=0} onClick={()=>setPage(p=>p-1)}><ArrowLeft size={16}/> Newer</button>
    <span>Page {pages===0n?'0':String(page+1)} / {pages.toString()}</span>
    <button type="button" className="small-button" disabled={busy||BigInt(page+1)>=pages} onClick={()=>setPage(p=>p+1)}>Older <ArrowRight size={16}/></button></div>
   <p className="ledger-note">A queue status of Paid reflects the queue's recorded state. This screen does not invent a payment transaction hash or payment timestamp; verify transfers and receipts separately on BscScan.</p>
  </>}
 </section>;
}
