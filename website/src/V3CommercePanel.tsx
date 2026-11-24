import {parseUnits} from 'ethers';
import {formatShare} from './v3-format';
import {useEffect,useState} from 'react';
import {ArrowUpRight,RefreshCw,ShoppingBag,TrendingUp} from 'lucide-react';
import {formatUtcTime,parseZonedTimestamp} from './utc-time';
import './v3-commerce.css';

type Status='live'|'not_configured'|'unavailable'|'rate_limited'|'incomplete';
type CurrencyPerformance={currency:string;gross:string;recent:string;netSales:string|null;profit:string|null};
type SellerPerformance={orderCount:number;currencies:CurrencyPerformance[]};
type Summary={version:1;source:'ebay';status:Status;updatedAt:string|null;
 windowStart:string|null;windowEnd:string|null;paidOrders:number|null;
 performance?:SellerPerformance;commercialProfit:null;profitStatus:'unverified_costs_and_fees'};
const statuses:Record<Status,string>={live:'Seller connected',not_configured:'Seller connection required',
 unavailable:'Seller data unavailable',rate_limited:'Seller source rate limited',incomplete:'Too many orders for this summary'};

export function readCommerceSummary(value:unknown,now=Date.now()):Summary|null{
 if(!value||typeof value!=='object')return null;
 const v=value as Summary;
 if(v.version!==1||v.source!=='ebay'||!Object.hasOwn(statuses,v.status)||
  v.commercialProfit!==null||v.profitStatus!=='unverified_costs_and_fees')return null;
 if(v.status!=='live')return v.paidOrders===null?{...v,performance:undefined,updatedAt:null,windowStart:null,windowEnd:null}:null;
 const updated=parseZonedTimestamp(v.updatedAt),start=parseZonedTimestamp(v.windowStart),end=parseZonedTimestamp(v.windowEnd);
 if(typeof v.paidOrders!=='number'||!Number.isSafeInteger(v.paidOrders)||v.paidOrders<0||v.paidOrders>100||
  !Number.isFinite(updated)||!Number.isFinite(start)||!Number.isFinite(end)||
  start>end||end>updated||updated>now+60000||now-updated>120000||end-start>31*86400000)return null;
 if(v.performance!==undefined){
  const p=v.performance,decimal=(n:unknown)=>typeof n==='string'&&/^\d{1,22}(?:\.\d{1,6})?$/.test(n);
  if(!p||!Number.isSafeInteger(p.orderCount)||p.orderCount<v.paidOrders||p.orderCount>100||!Array.isArray(p.currencies)||
   p.currencies.length>p.orderCount||new Set(p.currencies.map(c=>c?.currency)).size!==p.currencies.length)return null;
  for(const c of p.currencies){
   if(!c||!(/^[A-Z]{3}$/.test(c.currency))||!decimal(c.gross)||!decimal(c.recent)||parseUnits(c.recent,6)>parseUnits(c.gross,6))return null;
   if(c.netSales===null&&c.profit===null)continue;
   if(!decimal(c.netSales)||typeof c.profit!=='string'||!(/^-?\d{1,22}(?:\.\d{1,6})?$/.test(c.profit))||
    parseUnits(c.netSales!,6)>parseUnits(c.gross,6)||parseUnits(c.profit,6)>parseUnits(c.netSales!,6))return null;
  }
 }
 return v;
}

export default function V3CommercePanel(){
 const [summary,setSummary]=useState<Summary|null>(null),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let stopped=false,controller:AbortController|null=null,timer:ReturnType<typeof setTimeout>|undefined;
  const load=()=>{
   if(stopped||document.visibilityState==='hidden')return;
   controller?.abort();controller=new AbortController();const active=controller;
   const timeout=setTimeout(()=>active.abort(),10000);
   setLoading(true);setSummary(null);
   fetch('/api/commerce/status',{signal:active.signal,cache:'no-store'}).then(async response=>{
    if(!response.ok)throw Error('Unavailable');
    const data=readCommerceSummary(await response.json());if(!data)throw Error('Invalid seller summary');
    if(!stopped&&controller===active)setSummary(data);
   }).catch(()=>{if(!stopped&&controller===active)setSummary(null);})
    .finally(()=>{clearTimeout(timeout);if(!stopped&&controller===active){setLoading(false);timer=setTimeout(load,60000);}});
  };
  const visible=()=>{if(document.visibilityState==='visible'){clearTimeout(timer);load();}};
  document.addEventListener('visibilitychange',visible);load();
  return()=>{stopped=true;controller?.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
 },[attempt]);
 const performance=summary?.status==='live'?summary.performance:undefined;
 const amount=(value:string)=>{
  const [whole,fraction='']=value.split('.'),tail=fraction.replace(/0+$/,'');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(tail?'.'+tail:'');
 };
 return <section className="gv3-commerce"  aria-labelledby="gv3-commerce-title">
  <div className="gv3-commerce-head"><div><span className="gv3-commerce-kicker">PRODUCTS &amp; SALES</span>
   <h2 id="gv3-commerce-title">Commercial activity</h2><p>Seller orders created in the last 30 days.</p></div>
   <button type="button" onClick={()=>setAttempt(v=>v+1)} disabled={loading} aria-label="Refresh commercial activity"><RefreshCw size={16}/></button></div>
  <div className="gv3-commerce-status" role="status"><span/>{loading?'Checking seller connection…':summary?statuses[summary.status]:'Seller connection unavailable'}</div>
  <div className="gv3-commerce-grid">
   <div><ShoppingBag size={18}/><small>Orders with paid status · last 30 days</small><strong>{summary?.status==='live'?summary.paidOrders:'—'}</strong>
    <span>{performance&&summary?.paidOrders!==null&&summary?.paidOrders!==undefined?formatShare(BigInt(summary.paidOrders),BigInt(performance.orderCount))+' of '+performance.orderCount+' orders':'Paid orders at the latest seller snapshot.'}</span></div>
   {performance?.currencies.length?performance.currencies.map(c=><div key={c.currency}><TrendingUp size={18}/><small>{c.currency} sales volume</small><strong>{amount(c.gross)} {c.currency}</strong>
    <span>{formatShare(parseUnits(c.recent,6),parseUnits(c.gross,6))} of 30-day gross volume came from the last 7 days.</span>
    <small>Commercial profit margin</small><strong>{c.profit!==null&&c.netSales!==null?formatShare(parseUnits(c.profit,6),parseUnits(c.netSales,6)):'—'}</strong>
    <span>{c.profit!==null?'Reconciled profit '+amount(c.profit)+' '+c.currency+' · net sales '+amount(c.netSales!)+' '+c.currency:'Awaiting matched supplier costs, refunds and fees.'}</span></div>):
   <div><TrendingUp size={18}/><small>Verified commercial profit margin</small><strong>—</strong>
    <span>Sales, supplier costs, refunds and fees must be reconciled first.</span></div>}
  </div>
  {summary?.status==='live'&&summary.updatedAt&&<p className="gv3-commerce-updated">Seller snapshot: {formatUtcTime(summary.updatedAt)}</p>}
  <a href="#marketplace">Explore product listings <ArrowUpRight size={15}/></a>
 </section>;
}
