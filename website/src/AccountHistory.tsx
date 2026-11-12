import {useCallback,useEffect,useRef,useState} from 'react';
import {Clock3,RefreshCw,ExternalLink,CheckCircle2,AlertCircle,ArrowDown} from 'lucide-react';
import {chainId,configured,explorer,vaultAddress} from './config';
import {fetchAccountHistory,mergeHistoryEntries,type HistoryEntry} from './account-history-api';
import './account-history.css';

type Filter='all'|'BNB'|'USDT'|'general';
const queueLabels:Record<string,string>={
 pending:'Awaiting owner approval',
 approved:'Approved; awaiting payment',
 paid:'Paid',
 cancelled:'Cancelled'
};
const dateTime=(value:string)=>new Date(value).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
const shorten=(value:string)=>value.slice(0,8)+'…'+value.slice(-6);

export default function AccountHistory({
 who,network,compact=false,refreshKey='',onOpenFull
}:{
 who:string;network:number|null;compact?:boolean;refreshKey?:string;onOpenFull?:()=>void
}){
 const [rows,setRows]=useState<HistoryEntry[]>([]);
 const [cursor,setCursor]=useState<string|null>(null);
 const [filter,setFilter]=useState<Filter>('all');
 const [loading,setLoading]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [error,setError]=useState('');
 const [scanned,setScanned]=useState<{from:number|null;to:number|null;head:number}|null>(null);
 const sequence=useRef(0);
 const controller=useRef<AbortController|null>(null);
 const available=configured&&Boolean(who)&&network===chainId;
 const identity=String(chainId)+':'+vaultAddress.toLowerCase()+':'+who.toLowerCase();

 const load=useCallback(async(before:string|null)=>{
  if(!available)return;
  const id=++sequence.current;
  controller.current?.abort();
  const current=new AbortController();controller.current=current;
  setLoading(true);setError('');
  try{
   // The API scans bounded block windows to avoid RPC timeouts. A wallet
   // with no recent events can advance a few pages without repeated clicks.
   let page,after=before,firstScannedTo:number|null=null;
   for(let attempt=0;attempt<4;attempt++){
    page=await fetchAccountHistory({
     wallet:who,chainId,vaultAddress,before:after,limit:30,signal:current.signal
    });
    if(id!==sequence.current||current.signal.aborted)return;
    if(firstScannedTo===null)firstScannedTo=page.scannedTo;
    if(page.items.length||page.nextCursor===null||page.nextCursor===after)break;
    after=page.nextCursor;
   }
   if(!page)throw Error('History page was not available.');
   setRows(old=>before===null?page.items:mergeHistoryEntries(old,page.items));
   setCursor(page.nextCursor);
   setScanned({from:page.scannedFrom,to:firstScannedTo,head:page.confirmedThrough});
   setLoaded(true);
  }catch(cause){
   if(id!==sequence.current||current.signal.aborted)return;
   setError(cause instanceof Error?cause.message:'Account history could not be loaded.');
  }finally{
   if(id===sequence.current&&!current.signal.aborted)setLoading(false);
  }
 },[available,who]);

 useEffect(()=>{
  setRows([]);setCursor(null);setScanned(null);setLoaded(false);setError('');
  if(available)void load(null);
  return()=>{sequence.current++;controller.current?.abort();};
 },[identity,available,load,refreshKey]);

 const visible=rows.filter(row=>filter==='all'||filter==='general'?filter==='all'||row.asset===null:row.asset===filter);
 const shown=compact?visible.slice(0,5):visible;

 return <section className="panel account-history" aria-label="On-chain account history">
  <div className="panel-title account-history-heading">
   <div><h2>{compact?'Recent account history':'Complete account history'}</h2>
    <p className="muted">Confirmed events on the connected contract. Credits are not external-wallet payments.</p>
   </div>
   <button className="small-button" onClick={()=>void load(null)} disabled={!available||loading} aria-label="Refresh account history">
    <RefreshCw size={16} className={loading?'spin':''}/> Refresh
   </button>
  </div>
  {!available?
   <p className="muted" role="status">Connect your wallet on {chainId===97?'BNB Testnet':'BNB Chain'} to view its verified history.</p>
  :<>
   <div className="account-history-filters" role="group" aria-label="History asset filter">
    {([
     ['all','All events'],['USDT','USDT'],['BNB','BNB'],['general','Other events']
    ] as [Filter,string][]).map(([value,label])=>
     <button key={value} className={filter===value?'selected':''}
      aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}
   </div>
   {error&&<div className="history-error" role="alert"><AlertCircle size={17}/><span>{error}</span></div>}
   {!loaded&&loading?<p role="status" className="muted">Reading confirmed on-chain events…</p>:
    !shown.length?<p className="muted" role="status">
     {loaded?'No matching events in the scanned block range. Load older records to continue.':'No history loaded yet.'}
    </p>:<div className="account-history-list">
     {shown.map(row=><article key={row.id} className="account-history-entry">
      <div className="account-history-entry-top">
       <div className="account-history-entry-label"><CheckCircle2 size={17}/><strong>{row.label}</strong></div>
       <time dateTime={row.timestamp}>{dateTime(row.timestamp)}</time>
      </div>
      <div className="account-history-entry-bottom">
       <div className="account-history-value">
        {row.amount!==null?<strong dir="ltr">{row.amount} {row.asset??''}</strong>:<span className="muted">On-chain event</span>}
        {row.fee!==null&&<small dir="ltr">Fee: {row.fee} {row.asset}</small>}
        {row.positionId!==null&&<small>Position #{row.positionId}</small>}
        {row.requestId!==null&&<small>Request #{row.requestId}</small>}
        {row.queueStatus&&<small className="account-history-queue-status">{queueLabels[row.queueStatus]}</small>}
       </div>
       <a href={explorer+'/tx/'+row.transactionHash} target="_blank" rel="noopener noreferrer"
        aria-label={'View transaction '+row.transactionHash+' on the explorer'}>
        {shorten(row.transactionHash)} <ExternalLink size={14}/>
       </a>
      </div>
      {row.detail&&<p className="account-history-note">{row.detail}</p>}
      <small className="account-history-block">Block {row.blockNumber.toLocaleString('en-US')} · {row.confirmations} confirmations</small>
     </article>)}
    </div>}
   {scanned&&<p className="account-history-range">
    Scanned confirmed block range {scanned.from===null?'—':scanned.from.toLocaleString('en-US')}–{scanned.to===null?'—':scanned.to.toLocaleString('en-US')};
    confirmed head {scanned.head.toLocaleString('en-US')}.
   </p>}
   {compact?
    <button className="small-button account-history-more" onClick={onOpenFull}>
     <Clock3 size={16}/> View full on-chain history
    </button>:
    cursor&&<button className="small-button account-history-more" onClick={()=>void load(cursor)} disabled={loading}>
     <ArrowDown size={16}/>{loading?'Loading older history…':'Load older history'}
    </button>}
   {!compact&&loaded&&!cursor&&<p className="muted account-history-end">Beginning of the current contract history reached.</p>}
  </>}
  <p className="account-history-disclaimer">
   This timeline covers the currently connected vault. An approved withdrawal request is not a payment;
   transferred withdrawals appear as separate paid events. Earlier vaults have separate on-chain histories.
  </p>
 </section>;
}
