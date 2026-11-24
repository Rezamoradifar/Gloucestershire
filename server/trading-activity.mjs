import {createHash, createHmac} from 'node:crypto';

const DAY = 86400000;
const SOURCES = ['amazon', 'ebay', 'kraken'];
const MAX_PAGES = 4;
const MAX_ROWS = 20;

function requireValue(condition) {
  if (!condition) throw Error('Invalid provider response');
}

function publicRow(source, id, side, item, when, amount, unit) {
  const time = typeof when === 'number' ? when :
    (typeof when === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(when) ? Date.parse(when) : NaN);
  requireValue(typeof id === 'string' && id.length > 0 && id.length <= 180 && Number.isFinite(time));
  requireValue(typeof amount === 'string' && /^\d{1,24}(?:\.\d{1,18})?$/.test(amount) && Number(amount) > 0);
  requireValue(typeof unit === 'string' && /^[A-Z0-9]{2,12}$/.test(unit));
  return {id: createHash('sha256').update(source+'|'+id).digest('hex').slice(0,24),
    side, item, time: new Date(time).toISOString(), amount, unit};
}

async function readJson(fetcher, url, options = {}) {
  const response = await fetcher(url, {...options, redirect: 'error', signal: AbortSignal.timeout(6000)});
  if (!response.ok) throw Object.assign(Error('Provider unavailable'), {status: response.status});
  return response.json();
}

const businessRegions = {na:'na', eu:'eu', fe:'jp'};
function amazonPurchases(env, fetcher, now) {
  const {AMAZON_BUSINESS_CLIENT_ID: clientId, AMAZON_BUSINESS_CLIENT_SECRET: secret,
    AMAZON_BUSINESS_REFRESH_TOKEN: refreshToken} = env;
  if (env.AMAZON_BUSINESS_PUBLIC_ACTIVITY !== '1' || !clientId || !secret || !refreshToken) return null;
  const region = env.AMAZON_BUSINESS_REGION || 'na';
  let token, expires = 0;
  return async (start, end) => {
    requireValue(Object.hasOwn(businessRegions, region));
    if (!token || expires <= now()) {
      const auth = await readJson(fetcher, 'https://api.amazon.com/auth/o2/token', {method:'POST',
        body: new URLSearchParams({grant_type:'refresh_token', refresh_token:refreshToken, client_id:clientId, client_secret:secret})});
      requireValue(typeof auth.access_token === 'string' && auth.access_token && Number(auth.expires_in) > 60);
      token = auth.access_token;
      expires = now() + (Number(auth.expires_in)-60)*1000;
    }
    const rows = [], tokens = new Set();
    let next;
    for (let page=0; page<MAX_PAGES; page++) {
      const query = new URLSearchParams({feedStartDate:new Date(start).toISOString(), feedEndDate:new Date(end).toISOString()});
      if (next) query.set('nextPageToken', next);
      let data;
      try {
        data = await readJson(fetcher, 'https://'+businessRegions[region]+'.business-api.amazon.com/reconciliation/2021-01-08/transactions?'+query,
          {headers:{'x-amz-access-token':token, Accept:'application/json'}});
      } catch (error) { if (error.status === 401 || error.status === 403) token = null; throw error; }
      requireValue(Array.isArray(data.transactions));
      for (const tx of data.transactions) {
        requireValue(tx && typeof tx.transactionType==='string');
        if (tx.transactionType === 'CHARGE') rows.push(publicRow('amazon', tx.transactionId, 'buy', 'Purchase charge',
          tx.transactionDate, tx.amount?.amount, tx.amount?.currencyCode));
      }
      next = data.nextPageToken;
      if (!next) break;
      requireValue(typeof next === 'string' && !tokens.has(next));
      tokens.add(next);
    }
    return {rows, partial:Boolean(next)};
  };
}

function ebaySales(orderPage) {
  if (!orderPage) return null;
  return async (start, end) => {
    const rows = [];
    let offset=0, total=0;
    for (let page=0; page<MAX_PAGES; page++) {
      const data = await orderPage(start, end, offset, 100);
      requireValue(Number.isSafeInteger(data.total) && data.total >= 0);
      total = data.total;
      const orders = data.orders ?? (total===0 ? [] : null);
      requireValue(Array.isArray(orders) && orders.length<=100 && (orders.length>0 || total===0));
      for (const order of orders) {
        requireValue(order && typeof order.orderPaymentStatus==='string');
        if (order.orderPaymentStatus === 'PAID' && (!order.cancelStatus || order.cancelStatus.cancelState === 'NONE_REQUESTED'))
          rows.push(publicRow('ebay', order.orderId, 'sell', 'Paid order', order.creationDate,
            order.pricingSummary?.total?.value, order.pricingSummary?.total?.currency));
      }
      offset += orders.length;
      if (offset >= total) break;
    }
    return {rows, partial:offset<total};
  };
}

function krakenFills(env, fetcher, now) {
  const key = env.KRAKEN_ACTIVITY_KEY, secret = env.KRAKEN_ACTIVITY_SECRET;
  if (env.KRAKEN_PUBLIC_ACCOUNT_ACTIVITY !== '1' || !key || !secret) return null;
  const path = '/0/private/TradesHistory';
  let lastNonce = 0;
  return async (start) => {
    lastNonce = Math.max(lastNonce+1, now());
    const nonce = String(lastNonce);
    const body = new URLSearchParams({nonce, type:'all', start:String(Math.floor(start/1000)), consolidate_taker:'false'}).toString();
    const digest = createHash('sha256').update(nonce+body).digest();
    const signature = createHmac('sha512', Buffer.from(secret,'base64')).update(path).update(digest).digest('base64');
    const payload = await readJson(fetcher, 'https://api.kraken.com'+path, {method:'POST',body,
      headers:{'API-Key':key,'API-Sign':signature,'Content-Type':'application/x-www-form-urlencoded'}});
    requireValue(Array.isArray(payload.error));
    if (payload.error.some(message => /rate limit|throttled/i.test(message))) throw Object.assign(Error('Rate limited'), {status:429});
    requireValue(!payload.error.length && payload.result?.trades && typeof payload.result.trades==='object' && !Array.isArray(payload.result.trades));
    const rows = Object.entries(payload.result.trades).map(([id, trade]) => {
      requireValue(['buy','sell'].includes(trade.type) && typeof trade.time==='number' && typeof trade.pair==='string' &&
        /^[A-Z0-9. /-]{3,32}$/i.test(trade.pair));
      const pair=trade.pair.toUpperCase();
      const base=pair.includes('/')?pair.split('/')[0]:({XXBTZUSD:'BTC',XBTUSD:'BTC',BTCUSD:'BTC',XETHZUSD:'ETH',ETHUSD:'ETH'})[pair];
      const unit=base==='XBT'?'BTC':base && /^[A-Z0-9]{2,12}$/.test(base)?base:'BASE';
      return publicRow('kraken', id, trade.type, pair, trade.time*1000, trade.vol, unit);
    });
    return {rows, partial:false};
  };
}

export function createTradingActivity({env=process.env, fetcher=fetch, now=Date.now, seller}={}) {
  const readers = {amazon:amazonPurchases(env,fetcher,now), ebay:ebaySales(seller?.activityOrderPage), kraken:krakenFills(env,fetcher,now)};
  const cache = new Map(), pending = new Map();
  const blank = (source,status) => ({source,status,updatedAt:null,rows:[]});
  async function load(source) {
    const reader = readers[source];
    if (!reader) return blank(source,'not_configured');
    try {
      const end = now(), start = end-7*DAY;
      const result = await reader(start,end);
      const seen = new Set();
      const rows = result.rows.filter(row => {
        const time = Date.parse(row.time);
        if (time<start || time>end || seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      }).sort((a,b)=>b.time.localeCompare(a.time)).slice(0, MAX_ROWS);
      return {source,status:result.partial?'partial':'connected',updatedAt:new Date(now()).toISOString(),rows};
    } catch (error) { return blank(source,error.status===429?'rate_limited':'unavailable'); }
  }
  return {supports: source => SOURCES.includes(source), async get(source) {
    if (!SOURCES.includes(source)) throw Error('Unknown activity source');
    const cached=cache.get(source);
    if (cached && cached.expires>now()) return cached.value;
    if (pending.has(source)) return pending.get(source);
    const task=load(source).then(value => {
      cache.set(source,{value,expires:now()+(value.status==='rate_limited'?90000:30000)});
      return value;
    }).finally(()=>pending.delete(source));
    pending.set(source,task);
    return task;
  }};
}
