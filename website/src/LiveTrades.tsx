import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,RefreshCw} from 'lucide-react';
import {chainId,configured,loadRuntimeConfig,vaultAddress} from './config';
import {failedTradeFeed,parseTradeFeed,TradeTargetMismatchError,type TradeFeed} from './trades-feed';
const messages={live:'Confirmed contract settlements',stale:'Connection interrupted · Last confirmed snapshot',unavailable:'The live feed is temporarily unavailable.',not_configured:'The live contract feed has not been connected yet.'};
const amount=(value:string)=>{const [whole,fraction='']=value.split('.');return BigInt(whole).toLocaleString('en-US')+(fraction?'.'+fraction:'');};
export default function LiveTrades(){
 const [feed,setFeed]=useState<TradeFeed|null>(null),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const section=useRef<HTMLElement>(null),failures=useRef(0);
 const [visible,setVisible]=useState(false),[foreground,setForeground]=useState(document.visibilityState==='visible');
 useEffect(()=>{
  const element=section.current;if(!element)return;
  if(!('IntersectionObserver' in window)){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{rootMargin:'250px'});
  observer.observe(element);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{const change=()=>setForeground(document.visibilityState==='visible');document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change);},[]);
 useEffect(()=>{
  if(!visible||!foreground){setBusy(false);return;}
  let stopped=false,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  async function load(){
   setBusy(true);const timeout=setTimeout(()=>controller.abort(),12000);
   try{
    if(!configured)await loadRuntimeConfig();
    if(stopped)return;
    const response=await fetch('/api/trades?limit=12',{signal:controller.signal,cache:'no-store'});
    if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Invalid content type');
    if(!response.ok&&response.status!==503)throw Error('Invalid feed response');
    const data=parseTradeFeed(await response.json(),{chainId,vaultAddress});
    if(!stopped){setFeed(data);failures.current=['unavailable','stale'].includes(data.status)?Math.min(failures.current+1,3):0;}
   }catch(error){if(!stopped){failures.current=Math.min(failures.current+1,3);setFeed(previous=>failedTradeFeed(previous,configured?{chainId,vaultAddress}:null,!(error instanceof TradeTargetMismatchError)));}}
   finally{clearTimeout(timeout);if(!stopped){setBusy(false);timer=setTimeout(()=>setRefresh(n=>n+1),Math.min(120000,30000*2**failures.current));}}
  }
  void load();return()=>{stopped=true;controller.abort();clearTimeout(timer);};
 },[refresh,visible,foreground]);
 return <section ref={section} className="gdt-wrap gdt-section gdt-trades" id="transactions" aria-labelledby="trades-title"><div className="gdt-section-top"><div className="gdt-eyebrow"><span/>TRANSACTION TRANSPARENCY</div><span className={'gdt-feed-status '+(feed?.status||'loading')} role="status"><i/>{!feed?(visible?'Connecting':'READY'):feed.status==='live'?(feed.testnet?'LIVE · TESTNET':'LIVE · BNB CHAIN'):feed.status==='stale'?'STALE SNAPSHOT':'NOT CONNECTED'}</span></div><div className="gdt-split"><h2 id="trades-title">Transactions.<br/><em>On the record.</em></h2><div><p>Sales settlements recorded by the platform's contract, with transaction links you can verify. These are reported settlements, not independently verified marketplace orders.</p><button className="gdt-feed-refresh" disabled={busy} onClick={()=>{failures.current=0;setRefresh(n=>n+1);}}><RefreshCw size={15} className={busy?'spin':''}/>Refresh</button></div></div><div className="gdt-trade-panel">{feed?.trades.length?<div className="gdt-trade-scroll"><table><thead><tr><th>Recorded</th><th>Sales volume · USD</th><th>Funded gross profit</th><th>Transaction</th></tr></thead><tbody>{feed.trades.map(trade=><tr key={trade.id}><td><time dateTime={trade.timestamp}>{new Date(trade.timestamp).toLocaleString()}</time></td><td>${amount(trade.salesUsd)}</td><td>{amount(trade.grossProfit)} <span>{trade.asset}</span></td><td><a href={/^https:\/\/(testnet\.)?bscscan\.com\/tx\/0x[0-9a-fA-F]{64}$/.test(trade.explorerUrl)?trade.explorerUrl:undefined} target="_blank" rel="noopener noreferrer">{trade.transactionHash.slice(0,8)}…{trade.transactionHash.slice(-6)}<ArrowUpRight size={14}/></a></td></tr>)}</tbody></table></div>:<div className="gdt-trade-empty"><span className="gdt-overline">{feed?.status==='live'?'AWAITING SETTLEMENTS':'CONTRACT FEED'}</span><h3>{!feed?(visible?'Connecting to the transaction feed…':'Transaction feed loads when visible.'):feed.status==='live'?'No confirmed settlements in the scanned block window.':messages[feed.status]}</h3><p>{feed?.status==='live'?'New confirmed records will appear here automatically.':'Only real contract records appear here when the feed is connected.'}</p></div>}</div><div className="gdt-trade-foot"><span role="status">{feed?messages[feed.status]:'Connecting…'}{feed?.testnet?' · Test network amounts':''}</span>{feed?.updatedAt&&<time dateTime={feed.updatedAt}>Updated {new Date(feed.updatedAt).toLocaleTimeString()}</time>}</div></section>;
}
