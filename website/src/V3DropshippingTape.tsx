import {useState} from 'react';
import {formatUnits, parseUnits} from 'ethers';
import {ArrowDownLeft, ArrowUpRight, ChevronDown, CirclePause, RefreshCw} from 'lucide-react';
import {formatTradeAmount, type Entry, type Feed, type StoreProduct} from './trading-activity';
import {formatShare} from './v3-format';
import {formatUtcTime} from './utc-time';
import {activityStatuses, useTradingActivity} from './use-trading-activity';

type Store = 'amazon'|'ebay';
type StoreRecord = Entry & {store:Store};
type Filter = 'all'|'buy'|'sell';
const stores = {amazon:'Amazon Business', ebay:'eBay'};
const dateFormat = new Intl.DateTimeFormat('en-GB',{
  timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
});

function ProductFields({product}:{product:StoreProduct|undefined}) {
  return <dl className="gv3-product-fields">
    <div><dt>Model</dt><dd>{product?.model??'Not reported'}</dd></div>
    <div><dt>Type</dt><dd>{product?.type??'Not reported'}</dd></div>
    {product?.quantity!=null&&<div><dt>Qty</dt><dd>{product.quantity}</dd></div>}
  </dl>;
}

function TradeRecord({row}:{row:StoreRecord}) {
  const purchase=row.side==='buy',first=row.products?.[0];
  const count=row.productCount??0, shown=row.products?.length??0;
  const profit=row.profit, net=profit?parseUnits(profit.net,18):null;
  return <li className="gv3-store-row">
    <div className="gv3-store-meta">
      <span className={'gv3-trade-side '+row.side}>{purchase?<ArrowDownLeft size={14}/>:<ArrowUpRight size={14}/>}
        {purchase?'Buy':'Sell'}</span>
      <span>{stores[row.store]}</span>
      {row.refundStatus&&<span className="gv3-store-refund">{row.refundStatus==='full'?'Fully refunded':'Partially refunded'}</span>}
      <time dateTime={row.time} title={formatUtcTime(row.time)}>{purchase?'Charged':'Ordered'} {dateFormat.format(new Date(row.time))} UTC</time>
    </div>
    <div className="gv3-store-body">
      <div className="gv3-store-product"><strong>{first?.name??row.item}</strong><ProductFields product={first}/>
        {count>1&&<details className="gv3-store-items"><summary>{count} product lines</summary>
          {row.products?.slice(1).map((product,i)=><div key={i}><b>{product.name??'Product '+(i+2)}</b><ProductFields product={product}/></div>)}
          {count>shown&&<p>{count-shown} additional product lines without public details.</p>}
        </details>}
      </div>
      <div className="gv3-store-money"><small>{purchase?'Purchase charge':row.refundStatus?'Original order total':'Order total'}</small>
        <strong>{formatTradeAmount(row.amount)} <span>{row.unit}</span></strong></div>
      <div className="gv3-store-money"><small>Net profit</small>
        {net!==null&&profit?<><strong data-result={net<0n?'loss':net>0n?'gain':'flat'}>{net>0n?'+':''}{formatTradeAmount(formatUnits(net,18))} <span>{row.unit}</span></strong>
          <details className="gv3-store-profit"><summary>Margin {formatShare(net,parseUnits(profit.netSales,18))}</summary>
            <span>Net sales {formatTradeAmount(profit.netSales)} {row.unit}</span>
            <span>Matched costs {formatTradeAmount(profit.costs)} {row.unit}</span>
            {parseUnits(profit.netSales,18)===0n&&<span>Margin is undefined on zero net sales.</span>}
          </details></>:
          <span>{purchase?'Reported on sale':'Unverified'}</span>}
      </div>
    </div>
  </li>;
}

function VolumeSummary({rows}:{rows:StoreRecord[]}) {
  const currencies=new Map<string,{buy:bigint;sell:bigint;net:bigint;netSales:bigint;covered:number;sales:number}>();
  for(const row of rows) {
    const totals=currencies.get(row.unit)??{buy:0n,sell:0n,net:0n,netSales:0n,covered:0,sales:0};
    totals[row.side]+=parseUnits(row.amount,18);
    if(row.side==='sell')totals.sales++;
    if(row.profit){
      totals.net+=parseUnits(row.profit.net,18);
      totals.netSales+=parseUnits(row.profit.netSales,18);
      totals.covered++;
    }
    currencies.set(row.unit,totals);
  }
  return <details className="gv3-store-volumes"><summary>Volume and profit for the latest records</summary>
    <p>Based on all {rows.length} loaded {rows.length===1?'record':'records'}, grouped by currency. Gross sales include refunded amounts.</p>
    {[...currencies].map(([currency,t])=><div key={currency}><strong>{currency}</strong>
      <span>Buy {formatTradeAmount(formatUnits(t.buy,18))} · {formatShare(t.buy,t.buy+t.sell)}</span>
      <span>Gross sales {formatTradeAmount(formatUnits(t.sell,18))} · {formatShare(t.sell,t.buy+t.sell)}</span>
      {t.sales>0&&<span>Reconciled profit {t.covered?formatTradeAmount(formatUnits(t.net,18))+' '+currency:'—'}
        {t.covered>0&&' · Margin '+formatShare(t.net,t.netSales)} · {t.covered}/{t.sales} sales</span>}
    </div>)}
  </details>;
}

function emptyText(feeds:(Feed|null)[]) {
  if(feeds.some(f=>!f))return 'Checking store records…';
  if(feeds.every(f=>f?.status==='not_configured'))return 'No connected store feed. Purchase charges and paid orders will appear here when shared by Global.';
  if(feeds.every(f=>f?.status==='connected'))return 'No matching transactions in the past seven days.';
  if(feeds.some(f=>f?.status==='partial'))return 'No matching transactions in the available records.';
  if(feeds.some(f=>f?.status==='connected'))return 'No matching transactions from the available store.';
  return 'Store activity is currently unavailable.';
}

type Props = {amazon:Feed|null; ebay:Feed|null; pending:boolean; onRefresh:()=>void};
export function DropshippingRecords({amazon,ebay,pending,onRefresh}:Props) {
  const [filter,setFilter]=useState<Filter>('all'),[expanded,setExpanded]=useState(false);
  const sources=[['amazon',amazon],['ebay',ebay]] as const;
  const rows:StoreRecord[]=sources.flatMap(([store,feed])=>(feed?.rows??[]).map(row=>({...row,store})))
    .sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||a.id.localeCompare(b.id));
  const updated=sources.flatMap(([,feed])=>feed?.updatedAt?[Date.parse(feed.updatedAt)]:[]);
  const filtered=rows.filter(row=>filter==='all'||row.side===filter);
  const feeds=filter==='all'?[amazon,ebay]:[filter==='buy'?amazon:ebay];
  return <div className="gv3-store-tape">
    <div className="gv3-tape-summary"><div><h3>Product trades</h3><p className="gv3-tape-description">Latest purchases and sales in the past seven days, up to 20 per store.</p></div>
      <button type="button" className="gv3-tape-refresh" disabled={pending} onClick={onRefresh} aria-label="Refresh dropshipping trades"><RefreshCw size={16}/></button>
    </div>
    <div className="gv3-store-sources" role="status">{sources.map(([store,feed])=>
      <div key={store} className="gv3-tape-state" data-state={feed?.status??'loading'} title={feed?.updatedAt?'Checked '+formatUtcTime(feed.updatedAt):undefined}>
        <i aria-hidden="true"/><b>{stores[store]}</b><span>{feed?activityStatuses[feed.status]:'Checking…'}</span>
      </div>)}</div>
    <div className="gv3-store-toolbar">
      <div className="gv3-store-filters" role="group" aria-label="Filter dropshipping trades">
        {([['all','All'],['buy','Buys'],['sell','Sales']] as const).map(([id,label])=>
          <button type="button" key={id} aria-pressed={filter===id} onClick={()=>{setFilter(id);setExpanded(false);}}>{label}</button>)}
      </div>
      <small>{updated.length?'Snapshot '+new Date(Math.max(...updated)).toISOString().slice(11,19)+' UTC':'Time · UTC'}</small>
    </div>
    {filtered.length?<ol className="gv3-store-rows" aria-label="Dropshipping transactions, newest first">
      {(expanded?filtered:filtered.slice(0,6)).map(row=><TradeRecord key={row.store+row.id} row={row}/>)}
    </ol>:<div className="gv3-tape-empty"><CirclePause size={18} aria-hidden="true"/><span>{emptyText(feeds)}</span></div>}
    {filtered.length>6&&<div className="gv3-tape-foot"><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>
      {expanded?'Show fewer':'Show all '+filtered.length} <ChevronDown size={14}/></button></div>}
    {rows.length>0&&<VolumeSummary rows={rows}/>}
  </div>;
}

export default function V3DropshippingTape() {
  const [attempt,setAttempt]=useState(0);
  const amazon=useTradingActivity('amazon',attempt), ebay=useTradingActivity('ebay',attempt);
  return <DropshippingRecords amazon={amazon.feed} ebay={ebay.feed} pending={amazon.pending||ebay.pending}
    onRefresh={()=>setAttempt(n=>n+1)}/>;
}
