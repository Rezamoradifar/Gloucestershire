import {parseZonedTimestamp} from './utc-time';

export type AccountSource = 'amazon' | 'ebay' | 'kraken';
export type Source = AccountSource | 'market';
export const markets = {
  'BTC/USD': {pair:'XBTUSD', key:'XXBTZUSD', base:'BTC'},
  'ETH/USD': {pair:'ETHUSD', key:'XETHZUSD', base:'ETH'}
} as const;
export type Pair = keyof typeof markets;
export type Entry = {id:string; side:'buy'|'sell'; item:string; time:string; amount:string; unit:string; price?:string};
export type Feed = {source:Source; status:'live'|'delayed'|'connected'|'partial'|'not_configured'|'unavailable'|'rate_limited';
  updatedAt:string|null; rows:Entry[]};

function decimal(value:unknown):value is string {
  return typeof value==='string' && /^\d{1,24}(?:\.\d{1,18})?$/.test(value) && Number(value)>0;
}
function requireData(condition:unknown):asserts condition {
  if (!condition) throw Error('Invalid activity response');
}
export function formatTradeAmount(value:string):string {
  const [whole, fraction='']=value.split('.');
  const digits=fraction.replace(/0+$/,'');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(digits?'.'+digits:'');
}
export function readAccountFeed(value:unknown, source:AccountSource, now=Date.now()):Feed {
  const feed=value as Feed;
  requireData(feed?.source===source && Array.isArray(feed.rows) && feed.rows.length<=20);
  if (feed.status!=='connected' && feed.status!=='partial') {
    requireData(['not_configured','rate_limited','unavailable'].includes(feed.status) && feed.rows.length===0 && feed.updatedAt===null);
    return {source, status:feed.status, updatedAt:null, rows:[]};
  }
  const updated=parseZonedTimestamp(feed.updatedAt);
  requireData(Number.isFinite(updated) && updated<=now+60000 && updated>=now-120000);
  const ids=new Set<string>();
  for (const row of feed.rows) {
    const time=parseZonedTimestamp(row?.time);
    requireData(row && /^[0-9a-f]{24}$/.test(row.id) && !ids.has(row.id) && decimal(row.amount) &&
      typeof row.unit==='string' && /^[A-Z0-9]{2,12}$/.test(row.unit) && typeof row.item==='string' && row.item.length<=40 &&
      Number.isFinite(time) && time<=updated && time>=updated-7*86400000-60000);
    if(source==='amazon') requireData(row.side==='buy' && row.item==='Purchase charge');
    if(source==='ebay') requireData(row.side==='sell' && row.item==='Paid order');
    if(source==='kraken') requireData(['buy','sell'].includes(row.side) && /^[A-Z0-9. /-]{3,32}$/i.test(row.item));
    ids.add(row.id);
  }
  return {...feed, rows:[...feed.rows].sort((a,b)=>Date.parse(b.time)-Date.parse(a.time))};
}

export function readMarketFeed(value:unknown, pair:Pair, now=Date.now()):Feed {
  const data=value as {error?:unknown[];result?:Record<string,unknown>};
  const trades=data?.result?.[markets[pair].key];
  requireData(Array.isArray(data?.error) && !data.error.length && Array.isArray(trades) && trades.length<=20);
  const ids=new Set<string>(), rows:Entry[]=[];
  for(const trade of trades) {
    requireData(Array.isArray(trade) && decimal(trade[0]) && decimal(trade[1]) &&
      typeof trade[2]==='number' && Number.isFinite(trade[2]) && trade[2]>0 && trade[2]*1000<=now+30000 &&
      (trade[3]==='b'||trade[3]==='s') && Number.isSafeInteger(trade[6]) && trade[6]>0);
    const id=String(trade[6]);
    if(ids.has(id)) continue;
    ids.add(id);
    rows.push({id,side:trade[3]==='b'?'buy':'sell',item:pair,time:new Date(trade[2]*1000).toISOString(),
      price:trade[0],amount:trade[1],unit:markets[pair].base});
  }
  rows.sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||Number(b.id)-Number(a.id));
  return {source:'market',status:rows.length && now-Date.parse(rows[0].time)<=90000?'live':'delayed',
    updatedAt:new Date(now).toISOString(),rows};
}

export async function loadActivity(source:Source,pair:Pair,signal:AbortSignal):Promise<Feed> {
  const url=source==='market'?'https://api.kraken.com/0/public/Trades?pair='+markets[pair].pair+'&count=20':
    '/api/commerce/activity?source='+source;
  const response=await fetch(url,{signal,cache:'no-store',credentials:source==='market'?'omit':'same-origin',referrerPolicy:'no-referrer'});
  if(response.status===429) return {source,status:'rate_limited',updatedAt:null,rows:[]};
  if(!response.ok) throw Error('Activity unavailable');
  const data:unknown=await response.json();
  return source==='market'?readMarketFeed(data,pair):readAccountFeed(data,source);
}
