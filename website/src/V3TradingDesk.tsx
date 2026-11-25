import {useEffect, useRef, useState} from 'react';
import {formatUnits,parseUnits} from 'ethers';
import {formatShare} from './v3-format';
import {Activity, ArrowDownLeft, ArrowUpRight, ChevronDown, CirclePause, Radio, RefreshCw} from 'lucide-react';
import {formatTradeAmount, markets, type Entry, type Pair} from './trading-activity';
import {formatUtcTime} from './utc-time';
import V3CommercePanel from './V3CommercePanel';
import V3PortfolioOverview from './V3PortfolioOverview';
import type {V3Snapshot} from './v3-chain';
import {activityStatuses, useTradingActivity} from './use-trading-activity';
import V3DropshippingTape from './V3DropshippingTape';
import './v3-trading-desk.css';

const labels = {market:'Kraken public market', kraken:'Global exchange account'};
const descriptions = {market:'Completed trades on Kraken’s public order book.', kraken:'Fills from Global’s Kraken account over the past seven days.'};
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

function ActivityTape({source,pair}:{source:'market'|'kraken';pair:Pair}) {
  const [attempt,setAttempt]=useState(0), [expanded,setExpanded]=useState(false);
  const {feed,pending}=useTradingActivity(source,attempt,pair);
  const rows=feed?.rows??[], publicMarket=source==='market', latest=rows[0];
  const volumes=new Map<string,{buy:bigint;sell:bigint;count:number}>();
  for(const row of rows){
    const label=source==='market'?markets[pair].base:row.item;
    const totals=volumes.get(label)??{buy:0n,sell:0n,count:0};
    totals.count++;totals[row.side]+=parseUnits(row.amount,18);volumes.set(label,totals);
  }
  const visible=expanded?rows:rows.slice(0,4);
  const heading=publicMarket?pair:'Kraken';
  return <div className="gv3-tape">
    <div className="gv3-tape-summary">
      <div><small>{labels[source]}</small><h3>{heading}</h3>
        <div className="gv3-tape-state" role="status" data-state={feed?.status??'loading'}><i aria-hidden="true"/>
          {feed?activityStatuses[feed.status]:'Connecting…'}</div></div>
      {publicMarket && latest?.price && <div className="gv3-tape-quote"><span>Last trade</span>
        <strong>{priceFormat.format(Number(latest.price))}</strong>
        {rows.length>1&&<MarketTrace rows={rows}/>}</div>}
      <button type="button" className="gv3-tape-refresh" disabled={pending} onClick={()=>setAttempt(v=>v+1)}
        aria-label="Refresh trading activity" title="Refresh trading activity"><RefreshCw size={16}/></button>
    </div>
    <p className="gv3-tape-description">{descriptions[source]}</p>
    {volumes.size>0&&<div className="gdp-market-volumes" aria-label="Volume by side">{[...volumes].map(([label,{buy,sell,count}])=><div key={label}>
      <span>{formatTradeAmount(formatUnits(buy+sell,18))} {label}{source==='kraken'?' base units':''} · {count} records</span>
      <div><b>Buy {formatShare(buy,buy+sell)}</b><b>Sell {formatShare(sell,buy+sell)}</b></div>
      <div className="gdp-market-bar" aria-hidden="true"><i style={{width:Number(buy*10000n/(buy+sell))/100+'%'}}/></div>
    </div>)}</div>}
    {rows.length>0?<div className="gv3-tape-table"  role="table" aria-label={heading+' recent trades'}>
      <div className="gv3-tape-row gv3-tape-columns" role="row">
        <span role="columnheader">Side</span><span role="columnheader">{publicMarket?'Price':'Pair'}</span>
        <span role="columnheader">Quantity</span><span role="columnheader">Time · UTC</span>
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

export default function V3TradingDesk({view}:{view?:V3Snapshot|null}={}) {
  const [section,setSection]=useState<'market'|'exchange'|'stores'>('stores');
  const [pair,setPair]=useState<Pair>('BTC/USD'), [showSummary,setShowSummary]=useState(false);
  const source=section==='exchange'?'kraken':'market';
  return <>{view&&<V3PortfolioOverview view={view}/>}<section className="gv3-trading-desk" aria-labelledby="gv3-trading-title">
    <div className="gv3-desk-head"><h2 id="gv3-trading-title"><Activity size={20} aria-hidden="true"/> Live trading activity</h2>
      {section==='market'?<label><span className="gv3-sr-only">Market pair</span><select value={pair} onChange={e=>setPair(e.target.value as Pair)}>
        {Object.keys(markets).map(name=><option key={name}>{name}</option>)}</select></label>:
       <Radio size={17} aria-hidden="true"/>}</div>
    <div className="gv3-desk-tabs" role="group" aria-label="Activity source">
      {([['stores','Dropshipping'],['market','Public market'],['exchange','Global exchange']] as const).map(([id,label])=>
        <button type="button" key={id} aria-pressed={section===id} onClick={()=>{setSection(id);setShowSummary(false);}}>{label}</button>)}
    </div>
    {section==='stores'?<>
      <V3DropshippingTape/>
      <details className="gv3-seller-summary" open={showSummary} onToggle={e=>setShowSummary(e.currentTarget.open)}><summary>Seller summary and product listings</summary>{showSummary&&<V3CommercePanel/>}</details>
    </>:<ActivityTape key={source+(section==='market'?pair:'')} source={source} pair={pair}/>}
  </section></>;
}
