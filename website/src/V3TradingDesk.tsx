import {useEffect, useRef, useState} from 'react';
import {Activity, ArrowDownLeft, ArrowUpRight, ChevronDown, CirclePause, Radio, RefreshCw} from 'lucide-react';
import {formatTradeAmount, loadActivity, markets, type Entry, type Feed, type Pair, type Source} from './trading-activity';
import {formatUtcTime} from './utc-time';
import V3CommercePanel from './V3CommercePanel';
import './v3-trading-desk.css';

const labels = {market:'Kraken public market', kraken:'Global exchange account', amazon:'Global purchases', ebay:'Global sales'};
const statuses = {live:'Live market', delayed:'Last market snapshot', connected:'Account connected', partial:'Partial history',
  not_configured:'Account not connected', unavailable:'Feed unavailable', rate_limited:'Provider rate limited'};
const descriptions = {market:'Completed trades on Kraken’s public order book.', kraken:'Fills from Global’s Kraken account over the past seven days.',
  amazon:'Purchase charges from Global’s Amazon Business account over the past seven days.',
  ebay:'Paid orders from Global’s eBay seller account over the past seven days. Times reflect order creation.'};
const priceFormat=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
const dateFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});

function MarketTrace({rows}:{rows:Entry[]}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const node=canvas.current;
    if(!node) return;
    const prices=rows.slice().reverse().map(row=>Number(row.price));
    if(prices.length<2) return;
    const min=Math.min(...prices), max=Math.max(...prices);
    function draw() {
      if(!node) return;
      const width=node.clientWidth, height=node.clientHeight, ratio=Math.min(window.devicePixelRatio||1,2);
      node.width=Math.round(width*ratio); node.height=Math.round(height*ratio);
      const ctx=node.getContext('2d');
      if(!ctx || width<2 || height<4) return;
      ctx.scale(ratio,ratio);
      ctx.beginPath();
      prices.forEach((price,i)=>{
        const x=2+i/(prices.length-1)*(width-4), y=max===min?height/2:height-4-(price-min)/(max-min)*(height-8);
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      });
      ctx.lineWidth=2; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.strokeStyle=getComputedStyle(node).color; ctx.stroke();
    }
    draw();
    const resize=new ResizeObserver(draw); resize.observe(node);
    const theme=new MutationObserver(draw); theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    return ()=>{resize.disconnect();theme.disconnect();};
  },[rows]);
  return <canvas ref={canvas} className="gv3-trace" role="img" aria-label={'Price movement across the last '+rows.length+' trades'}/>;
}

function ActivityTape({source,pair}:{source:Source;pair:Pair}) {
  const [feed,setFeed]=useState<Feed|null>(null), [attempt,setAttempt]=useState(0), [pending,setPending]=useState(true);
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>{
    let disposed=false, timer:ReturnType<typeof setTimeout>|undefined, current:AbortController|undefined;
    function stop() { clearTimeout(timer); current?.abort(); current=undefined; }
    async function refresh() {
      if(disposed || document.hidden) return;
      const controller=new AbortController();
      current=controller; setPending(true);
      const timeout=setTimeout(()=>controller.abort(),12000);
      let delay=source==='market'?10000:30000;
      try {
        const next=await loadActivity(source,pair,controller.signal);
        if(next.status==='rate_limited') delay=90000;
        if(!disposed && controller===current) setFeed(next);
      } catch {
        if(!disposed && controller===current) setFeed(previous=>source==='market' && previous?.rows.length?
          {...previous,status:'delayed'}:{source,status:'unavailable',updatedAt:null,rows:[]});
      } finally {
        clearTimeout(timeout);
        if(!disposed && controller===current) {setPending(false);timer=setTimeout(refresh,delay);}
      }
    }
    function visibility() {
      stop();
      if(!document.hidden) {setFeed(null);void refresh();}
    }
    void refresh();document.addEventListener('visibilitychange',visibility);
    return ()=>{disposed=true;stop();document.removeEventListener('visibilitychange',visibility);};
  },[source,pair,attempt]);

  const rows=feed?.rows??[], publicMarket=source==='market', latest=rows[0];
  const visible=expanded?rows:rows.slice(0,4);
  const heading=publicMarket?pair:source==='kraken'?'Kraken':source==='amazon'?'Amazon Business':'eBay';
  return <div className="gv3-tape">
    <div className="gv3-tape-summary">
      <div><small>{labels[source]}</small><h3>{heading}</h3>
        <div className="gv3-tape-state" role="status" data-state={feed?.status??'loading'}><i aria-hidden="true"/>
          {feed?statuses[feed.status]:'Connecting…'}</div></div>
      {publicMarket && latest?.price && <div className="gv3-tape-quote"><span>Last trade</span>
        <strong>{priceFormat.format(Number(latest.price))}</strong>
        {rows.length>1&&<MarketTrace rows={rows}/>}</div>}
      <button type="button" className="gv3-tape-refresh" disabled={pending} onClick={()=>setAttempt(v=>v+1)}
        aria-label="Refresh trading activity" title="Refresh trading activity"><RefreshCw size={16}/></button>
    </div>
    <p className="gv3-tape-description">{descriptions[source]}</p>
    {rows.length>0?<div className="gv3-tape-table" role="table" aria-label={heading+' recent trades'}>
      <div className="gv3-tape-row gv3-tape-columns" role="row">
        <span role="columnheader">Side</span><span role="columnheader">{publicMarket?'Price':source==='kraken'?'Pair':'Record'}</span>
        <span role="columnheader">{publicMarket||source==='kraken'?'Quantity':'Amount'}</span><span role="columnheader">Time · UTC</span>
      </div>
      {visible.map(row=><div className="gv3-tape-row" role="row" key={row.id}>
        <span role="cell"><span className={'gv3-trade-side '+row.side}>{row.side==='buy'?<ArrowDownLeft size={13}/>:<ArrowUpRight size={13}/>}
          {row.side==='buy'?'Buy':'Sell'}</span></span>
        <strong role="cell">{publicMarket?priceFormat.format(Number(row.price)):row.item}</strong>
        <span role="cell">{formatTradeAmount(row.amount)} <small>{row.unit==='BASE'?'base units':row.unit}</small></span>
        <time role="cell" dateTime={row.time} title={formatUtcTime(row.time)}>{publicMarket?row.time.slice(11,19):dateFormat.format(new Date(row.time))}</time>
      </div>)}
    </div>:<div className="gv3-tape-empty"><CirclePause size={19} aria-hidden="true"/><span>{!feed?'Retrieving records…':
      feed.status==='not_configured'?'Activity will appear when this account is connected.':
      feed.status==='connected'?'No matching records in the past seven days.':
      feed.status==='partial'?'No matching records in the available pages.':
      feed.status==='delayed'?'No recent trades returned.':'Waiting for the source to respond.'}</span></div>}
    <div className="gv3-tape-foot">
      <span>{feed?.updatedAt?'Checked '+formatUtcTime(feed.updatedAt):publicMarket?'Market data from Kraken':'Source: '+heading}</span>
      {rows.length>4&&<button type="button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>
        {expanded?'Show fewer':'Show all '+rows.length} <ChevronDown size={14}/></button>}
    </div>
  </div>;
}

export default function V3TradingDesk() {
  const [section,setSection]=useState<'market'|'exchange'|'stores'>('market');
  const [pair,setPair]=useState<Pair>('BTC/USD'), [store,setStore]=useState<'amazon'|'ebay'>('amazon');
  const source=section==='stores'?store:section==='exchange'?'kraken':'market';
  return <section className="gv3-trading-desk" aria-labelledby="gv3-trading-title">
    <div className="gv3-desk-head"><h2 id="gv3-trading-title"><Activity size={20} aria-hidden="true"/> Trading activity</h2>
      {section==='market'?<label><span className="gv3-sr-only">Market pair</span><select value={pair} onChange={e=>setPair(e.target.value as Pair)}>
        {Object.keys(markets).map(name=><option key={name}>{name}</option>)}</select></label>:
       section==='stores'?<label><span className="gv3-sr-only">Store account</span><select value={store} onChange={e=>setStore(e.target.value as 'amazon'|'ebay')}>
        <option value="amazon">Amazon Business</option><option value="ebay">eBay</option></select></label>:<Radio size={17} aria-hidden="true"/>}</div>
    <div className="gv3-desk-tabs" role="group" aria-label="Activity source">
      {([['market','Public market'],['exchange','Global exchange'],['stores','Global stores']] as const).map(([id,label])=>
        <button type="button" key={id} aria-pressed={section===id} onClick={()=>setSection(id)}>{label}</button>)}
    </div>
    <ActivityTape key={source+(section==='market'?pair:'')} source={source} pair={pair}/>
    {section==='stores'&&<details className="gv3-seller-summary"><summary>Seller summary and product listings</summary><V3CommercePanel/></details>}
  </section>;
}
