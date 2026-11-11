import {useMemo,useState} from 'react';
import {BarChart3,Coins,Download,TrendingUp} from 'lucide-react';
import {displayAmount} from './money';
import type {Asset} from './chain';

export type LedgerEvent={key:string;kind:'deposit'|'profit'|'reinvest'|'withdrawal';wallet:string;amount:bigint;fee:bigint;block:number;tx:string;timestamp:number|null;position?:bigint};
type Category='deposit'|'profit'|'withdrawal';
type Range='week'|'month'|'halfyear';
const labels:Record<Category,string>={deposit:'Deposits',profit:'Profit credited',withdrawal:'Withdrawals'};
const categories:Category[]=['deposit','profit','withdrawal'];
const dateKey=(stamp:number,monthly:boolean)=>new Date(stamp*1000).toISOString().slice(0,monthly?7:10);
export function financialSeries(entries:LedgerEvent[],range:Range,nowMs:number){
 const monthly=range==='halfyear',count=monthly?6:range==='week'?7:30;
 const now=new Date(nowMs),startMonth=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1);
 const dayBase=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
 const keys=Array.from({length:count},(_,i)=>{
  const delta=i-count+1;return monthly?new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+delta,1)).toISOString().slice(0,7):new Date(dayBase+delta*86400000).toISOString().slice(0,10);
 });
 const bins=new Map(keys.map(key=>[key,{key,deposit:0n,profit:0n,withdrawal:0n}]));
 for(const event of entries){if(event.timestamp===null)continue;const key=dateKey(event.timestamp,monthly);const bin=bins.get(key);if(bin&&(event.kind==='deposit'||event.kind==='profit'||event.kind==='withdrawal'))bin[event.kind]+=event.amount;}
 // All figures are in smallest contract-asset units. Return amounts, never guessed USD conversions.
 return [...bins.values()];
}
export default function FinancialInsights({events,asset,decimals,complete}:{events:LedgerEvent[];asset:Asset;decimals:number;complete:boolean}){
 const [range,setRange]=useState<Range>('month'),[selected,setSelected]=useState<Category>('profit');
 const series=useMemo(()=>financialSeries(events,range,Date.now()),[events,range]);
 const max=series.reduce((m,row)=>row[selected]>m?row[selected]:m,0n);
 const total=series.reduce((sum,row)=>sum+row[selected],0n);
 const stamped=events.filter(e=>e.timestamp!==null).length;
 const contains=series.some(row=>row[selected]>0n);
 const amount=(v:bigint)=>displayAmount(v,decimals,2);
 return <section className="v2-financial-insights" aria-labelledby="v2-trends-title">
  <div className="v2-insights-heading"><div><span className="detail-kicker">VERIFIED EVENT ANALYTICS</span><h3 id="v2-trends-title"><BarChart3 size={21}/> Capital activity over time</h3><p>Only confirmed, timestamped events from blocks loaded in this browser.</p></div>
   <label className="v2-period">Time range <select value={range} onChange={e=>setRange(e.target.value as Range)}><option value="week">7 days</option><option value="month">30 days</option><option value="halfyear">6 months</option></select></label></div>
  <div className="v2-insights-tabs" role="group" aria-label="Select chart series">
   {categories.map(category=><button type="button" aria-pressed={selected===category} className={selected===category?'selected':''} key={category} onClick={()=>setSelected(category)}>{labels[category]}</button>)}
  </div>
  <div className="v2-insight-total"><div><small>{labels[selected]} · loaded events only</small><strong>{amount(total)} <em>{asset}</em></strong></div><span><TrendingUp size={16}/>{stamped} timestamped events</span></div>
  <div className="v2-chart-scroller"><div className="v2-bar-chart" role="img" aria-label={'Chart of '+labels[selected]+' from loaded blockchain event records'}>
    {series.map(row=>{const value=row[selected],pct=max>0n?Number(value*100n/max):0;return <div className="v2-chart-column" key={row.key} title={row.key+': '+amount(value)+' '+asset}>
     <div className="v2-chart-bar-slot"><div className={'v2-chart-bar '+selected} style={{height:value>0n?Math.max(3,pct)+'%':'0%'}}/></div>
     <span>{range==='halfyear'?row.key.slice(5):row.key.slice(5)}</span>
     </div>;})}
    </div></div>
  {!contains?<p className="muted">No matching {labels[selected].toLowerCase()} events with known timestamps in the loaded range.</p>:null}
  <p className="v2-chart-disclosure"><Coins size={15}/> Credited profit is an internal contract allocation, not a wallet transfer. {complete?'The recorded scan reached genesis.':'Older blocks have not all been scanned.'} {events.length-stamped>0?String(events.length-stamped)+' loaded events lack verified timestamps and are excluded from the chart.':''} These totals are not account balances or guaranteed returns.</p>
  </section>;
}
