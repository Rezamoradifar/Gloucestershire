import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowDown,ArrowLeft,ArrowRight,CalendarClock,ExternalLink,FileClock,History,RefreshCw,Search} from 'lucide-react';
import {BrowserProvider,ZeroAddress,type Eip1193Provider} from 'ethers';
import {getWalletProvider} from './wallet';
import {V2_EXPLORER,v2Money,v2Short} from './v2-chain';
import {readV2History,type V2WalletEvent} from './v2-audit';
import {filterV2History,initialV2HistoryFilters,v2HistoryKind,type V2HistoryFilters} from './v2-history-filter';
import './v2-history-classic.css';

type HistoryResult=Awaited<ReturnType<typeof readV2History>>;
const PAGE_SIZE=10;
const kind=(row:V2WalletEvent)=>{
 if(row.name==='PersonalProfitCredited')return 'Personal profit credited';
 if(row.name==='ReferralProfitCredited')return 'Referral profit credited';
 if(row.name==='EarningsFunded')return 'Earnings funded';
 if(row.name==='DepositRouted')return 'Deposit';
 if(row.name==='PositionOpened')return 'Position opened';
 if(row.name==='WithdrawalRequested')return 'Withdrawal request';
 if(row.name==='Reinvested')return 'Reinvestment';
 if(row.name==='CheckIn')return 'Daily activity';
 return row.name.replace(/([a-z])([A-Z])/g,'$1 $2');
};

export default function V2HistoryPanel({
 requester,subject,token,decimals=18
}:{requester:string;subject:string;token:string;decimals?:number}){
 const [rows,setRows]=useState<V2WalletEvent[]>([]);
 const [times,setTimes]=useState<Record<number,number>>({});
 const [filters,setFilters]=useState<V2HistoryFilters>(initialV2HistoryFilters);
 const [viewPage,setViewPage]=useState(0);
 const [nextOffset,setNextOffset]=useState(0);
 const [range,setRange]=useState<Pick<HistoryResult,'from'|'to'>|null>(null);
 const [hasOlder,setHasOlder]=useState(true);
 const [scanned,setScanned]=useState(false);
 const [loading,setLoading]=useState(false);
 const [progress,setProgress]=useState('');
 const [error,setError]=useState('');
 const revision=useRef(0);
 const connected=Boolean(requester&&subject&&token);
 useEffect(()=>{
  revision.current++;
  setRows([]);setTimes({});setFilters(initialV2HistoryFilters);setViewPage(0);
  setNextOffset(0);setRange(null);setHasOlder(true);setScanned(false);setLoading(false);
  setError('');setProgress('');
  return()=>{revision.current++;};
 },[requester,subject,token,decimals]);

 // Timestamp lookup is optional; never invent a time if the RPC cannot verify a block.
 async function enrichTimes(walletProvider:Eip1193Provider,events:V2WalletEvent[],version:number){
  const numbers=[...new Set(events.map(event=>event.block))].slice(0,40);
  if(!numbers.length)return;
  const reader=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
  try{
   const found:Record<number,number>={};
   for(let n=0;n<numbers.length;n+=6){
    if(version!==revision.current||getWalletProvider()!==walletProvider)return;
    const part=numbers.slice(n,n+6);
    const results=await Promise.allSettled(part.map(block=>reader.getBlock(block)));
    results.forEach((item,i)=>{
     if(item.status==='fulfilled'&&item.value&&Number.isSafeInteger(item.value.timestamp)){
      found[part[i]]=Number(item.value.timestamp);
     }
    });
   }
   if(version===revision.current&&getWalletProvider()===walletProvider)
    setTimes(old=>({...old,...found}));
  }catch{/* Event block numbers remain valid even if timestamp reads are unavailable. */}
  finally{reader.destroy();}
 }

 async function scanFrom(start:number,depth:number,reset=false){
  if(loading)return;
  const walletProvider=getWalletProvider() as Eip1193Provider|null;
  if(!walletProvider||!connected){
   setError('Connect your wallet on BNB Testnet to read your V2 history.');return;
  }
  const version=revision.current;
  setLoading(true);setError('');
  if(reset){setRows([]);setTimes({});setViewPage(0);setHasOlder(true);}
  try{
   for(let i=0;i<depth;i++){
    const offset=start+i;
    setProgress('Loading confirmed V2 block window '+(offset+1)+'…');
    const data=await readV2History(walletProvider,requester,subject,offset);
    if(revision.current!==version||walletProvider!==getWalletProvider())return;
    setRows(old=>{
     const entries=new Map<string,V2WalletEvent>((reset&&i===0?[]:old).map(row=>[row.key,row] as const));
     for(const row of data.events)entries.set(row.key,row);
     return [...entries.values()].sort((a,b)=>b.block-a.block||b.index-a.index);
    });
    setScanned(true);
    setRange({from:data.from,to:data.to});
    setNextOffset(offset+1);
    setHasOlder(data.hasOlder);
    void enrichTimes(walletProvider,data.events,version);
    if(!data.hasOlder)break;
   }
  }catch(e){
   if(revision.current===version){
    const message=e instanceof Error?e.message:'The wallet RPC could not retrieve historical V2 events.';
    setError(message);
   }
  }finally{
   if(revision.current===version){setLoading(false);setProgress('');}
  }
 }

 const filtered=useMemo(()=>filterV2History(rows,filters,times),[rows,filters,times]);
 const pages=Math.ceil(filtered.length/PAGE_SIZE);
 const currentPage=Math.min(viewPage,Math.max(0,pages-1));
 const visible=filtered.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
 const badDates=Boolean(filters.from&&filters.to&&filters.from>filters.to);
 const unknownTimes=(filters.from||filters.to)?rows.filter(row=>!times[row.block]).length:0;
 const change=(patch:Partial<V2HistoryFilters>)=>{setFilters(old=>({...old,...patch}));setViewPage(0);};
 const asset=(row:V2WalletEvent)=>{
  if(!row.asset)return '—';
  const native=row.asset.toLowerCase()===ZeroAddress.toLowerCase();
  if(!native&&row.asset.toLowerCase()!==token.toLowerCase())return v2Short(row.asset);
  return (row.amount===null?'':v2Money(row.amount,native?18:decimals)+' ')+(native?'BNB':'USDT');
 };

 return <section className="gv2-panel gv2-classic-history" aria-label="V2 on-chain transaction history">
  <div className="gv2-history-header">
   <div><small>VERIFIABLE ON-CHAIN RECORDS · V2 TESTNET</small>
    <h2><History size={20}/> Profit & deposit history</h2>
    <p>Confirmed V2 blockchain events only. Older ranges load on demand; accounting credits are not wallet payments.</p>
   </div>
   <button type="button" onClick={()=>void scanFrom(0,1,true)} disabled={loading||!connected}><RefreshCw size={16}/> Refresh history</button>
  </div>
  <div className="gv2-history-summary">
   <div><small>Loaded events</small><strong>{rows.length.toLocaleString('en-US')}</strong><span>Confirmed V2 records</span></div>
   <div><small>Windows scanned</small><strong>{scanned?nextOffset:0}</strong><span>Limited RPC coverage</span></div>
   <div><small>Most recent inspected blocks</small><strong>{range?range.from.toLocaleString('en-US')+' – '+range.to.toLocaleString('en-US'):'—'}</strong><span>Not a lifetime statement</span></div>
  </div>
  <div className="gv2-history-filters" aria-label="History filters">
   <label><span><Search size={14}/> Search hash, wallet, proof or request</span>
    <input type="search" placeholder="0x… or request ID" value={filters.query} onChange={e=>change({query:e.target.value})}/></label>
   <label><span>Event type</span>
    <select value={filters.kind} onChange={e=>change({kind:e.target.value as V2HistoryFilters['kind']})}>
     <option value="all">All loaded events</option>
     <option value="deposit">Deposits</option>
     <option value="profit">Funded profit / referrals</option>
     <option value="withdrawal">Withdrawal requests</option>
     <option value="reinvest">Reinvestments</option>
     <option value="funding">Funding events</option>
     <option value="activity">Activity and registration</option>
    </select></label>
   <label><span>From (UTC)</span><input type="date" value={filters.from} onChange={e=>change({from:e.target.value})}/></label>
   <label><span>To (UTC)</span><input type="date" value={filters.to} onChange={e=>change({to:e.target.value})}/></label>
   <label className="gv2-history-order"><span>Order</span>
    <select value={filters.order} onChange={e=>change({order:e.target.value as V2HistoryFilters['order']})}>
     <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
    </select></label>
  </div>
  {badDates&&<p className="gv2-error" role="alert">The start date cannot be later than the end date.</p>}
  {unknownTimes>0&&<p className="gv2-history-note">Date filters exclude {unknownTimes} loaded events whose block timestamps could not be verified.</p>}
  <div className="gv2-history-table-toolbar"><strong>{filtered.length.toLocaleString('en-US')} matching loaded events</strong>
   <button type="button" onClick={()=>{setFilters(initialV2HistoryFilters);setViewPage(0);}}>Clear filters</button>
  </div>
  {loading&&<p className="gv2-history-working" role="status"><RefreshCw size={15}/>{progress}</p>}
  {error&&<p className="gv2-history-rpc-error" role="alert">
   Historical events are unavailable from this wallet RPC. Use an RPC with eth_getLogs support or try again later.
   <small>{error}</small>
  </p>}
  {!connected&&<p className="gv2-history-note">Connect your V2 wallet to load genuine account history. No demo entries are shown.</p>}
  {visible.length?<div className="gv2-history-events">{visible.map(row=><article key={row.key} className="gv2-history-event">
   <div className={'gv2-history-event-mark kind-'+v2HistoryKind(row)}><History size={18}/></div>
   <div className="gv2-history-event-info"><strong>{kind(row)}</strong>
    <small><CalendarClock size={13}/> {times[row.block]?new Date(times[row.block]*1000).toLocaleString('en-US',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC':'Block '+row.block.toLocaleString('en-US')}</small>
    <span>{row.details}</span></div>
   <div className="gv2-history-event-value"><b>{asset(row)}</b><small>{row.level!==null?'Level '+row.level+' · '+(row.rateBps??0)/100+'%':row.name==='PersonalProfitCredited'?'Credited inside the contract':'Verified event'}</small></div>
   <a href={V2_EXPLORER+'/tx/'+row.tx} target="_blank" rel="noopener noreferrer" aria-label="View transaction on BscScan"><ExternalLink size={17}/></a>
  </article>)}</div>:
  <div className="gv2-history-empty">No matching events were found in the blocks scanned so far. Older blocks may contain records.</div>}
  <div className="gv2-history-pages">
   <button type="button" disabled={currentPage===0} onClick={()=>setViewPage(p=>Math.max(0,p-1))}><ArrowLeft size={16}/> Previous</button>
   <span>Page {pages?currentPage+1:0} of {pages}</span>
   <button type="button" disabled={currentPage+1>=pages} onClick={()=>setViewPage(p=>p+1)}>Next <ArrowRight size={16}/></button>
  </div>
  <div className="gv2-history-scan-actions">
   <div><strong><FileClock size={19}/> Need older history?</strong>
    <p>Load more verified block ranges on demand. Full historical coverage depends on the connected wallet RPC's archive and log access.</p></div>
   <div className="gv2-history-scan-buttons">
    <button type="button" disabled={!connected||loading||scanned&&!hasOlder} onClick={()=>void scanFrom(nextOffset,1)}><ArrowDown size={16}/> Load older finance events</button>
    <button type="button" disabled={!connected||loading||scanned&&!hasOlder} onClick={()=>void scanFrom(nextOffset,3)}>Deep scan older blocks</button>
   </div>
  </div>
  <p className="gv2-history-note">Only records actually loaded from the new V2 contract appear here. No legacy contract records or fabricated balances are imported.</p>
 </section>;
}
