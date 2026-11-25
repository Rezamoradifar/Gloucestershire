import {createHash, createHmac} from 'node:crypto';
import {formatUnits} from 'ethers';
import {loadReconciliation, readCommerceInput, reconciledSale} from './commerce-ebay.mjs';

const DAY = 86400000;
const SOURCES = ['amazon', 'ebay', 'kraken'];
const MAX_PAGES = 4;
const MAX_ROWS = 20;
const MAX_PRODUCT_LINES = 12;
const STORE_SNAPSHOT_LIFETIME = 10 * 60 * 1000;

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

function publicLabel(value, limit) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}<>@]|https?:\/\//iu.test(value)) return null;
  return value.trim().replace(/\s+/g, ' ').slice(0,limit).replace(/[\uD800-\uDBFF]$/, '').trim() || null;
}

function productKey(source, id, variationId) {
  if (typeof id !== 'string') return null;
  if (source === 'amazon' && /^[A-Z0-9]{10}$/.test(id) && variationId == null) return 'amazon:'+id;
  if (source !== 'ebay' || !/^\d{1,20}$/.test(id)) return null;
  if (variationId != null && (typeof variationId !== 'string' || !/^\d{1,20}$/.test(variationId))) return null;
  return 'ebay:'+id+':'+(variationId ?? '');
}

async function productCatalog(file) {
  const data = await readCommerceInput(file);
  const products = new Map();
  if (data?.version !== 1 || !Array.isArray(data.products)) return products;
  for (const p of data.products) {
    const key = productKey(p?.source,p?.id,p?.variationId);
    if (!key || products.has(key)) return new Map();
    products.set(key, {name:publicLabel(p.name,160), model:publicLabel(p.model,100), type:publicLabel(p.type,100)});
  }
  return products;
}

function variationLabel(aspects, names) {
  if (!Array.isArray(aspects)) return null;
  const values = new Set();
  for (const aspect of aspects) {
    if (typeof aspect?.name === 'string' && names.includes(aspect.name.trim().toLowerCase())) {
      const value = publicLabel(aspect.value,100);
      if (!value) return null;
      values.add(value);
    }
  }
  return values.size === 1 ? [...values][0] : null;
}

function productDetails(source, lines, catalog) {
  if (!Array.isArray(lines)) return {products:[],productCount:0};
  const amazon = source === 'amazon';
  const products = lines.slice(0,MAX_PRODUCT_LINES).map(line => {
    const key = amazon ? productKey(source,line?.asin) : productKey(source,line?.legacyItemId,line?.legacyVariationId);
    const known = catalog.get(key);
    const name = known?.name ?? publicLabel(amazon ? line?.productTitle : line?.title,160);
    const model = known?.model ?? (amazon ? null : variationLabel(line?.variationAspects,['model','model number']));
    const type = known?.type ?? (amazon
      ? (typeof line?.unspsc === 'string' && /^\d{8}$/.test(line.unspsc) ? 'UNSPSC '+line.unspsc : null)
      : variationLabel(line?.variationAspects,['type','product type']));
    const quantity = amazon ? line?.itemQuantity : line?.quantity;
    return {name, model, type, quantity:Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null};
  });
  return {products,productCount:lines.length};
}

const businessRegions = {na:'na', eu:'eu', fe:'jp'};
function amazonPurchases(env, fetcher, now) {
  const {AMAZON_BUSINESS_CLIENT_ID: clientId, AMAZON_BUSINESS_CLIENT_SECRET: secret,
    AMAZON_BUSINESS_REFRESH_TOKEN: refreshToken} = env;
  const region = env.AMAZON_BUSINESS_REGION || 'na';
  let token, expires = 0;
  async function read(start, end, details) {
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
        if (tx.transactionType !== 'CHARGE') continue;
        const row = publicRow('amazon', tx.transactionId, 'buy', 'Purchase charge',
          tx.transactionDate, tx.amount?.amount, tx.amount?.currencyCode);
        if (details) Object.assign(row,productDetails('amazon',tx.transactionLineItems,details.catalog));
        rows.push(row);
      }
      next = data.nextPageToken;
      if (!next) break;
      requireValue(typeof next === 'string' && !tokens.has(next));
      tokens.add(next);
    }
    return {rows, partial:Boolean(next)};
  }
  return () => env.AMAZON_BUSINESS_PUBLIC_ACTIVITY === '1' && clientId && secret && refreshToken &&
    env.AMAZON_BUSINESS_CLIENT_ID === clientId && env.AMAZON_BUSINESS_CLIENT_SECRET === secret &&
    env.AMAZON_BUSINESS_REFRESH_TOKEN === refreshToken && (env.AMAZON_BUSINESS_REGION || 'na') === region ? read : null;
}

function ebaySales(orderPage) {
  if (!orderPage) return null;
  return async (start, end, details) => {
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
        const refundStatus = order.orderPaymentStatus === 'PARTIALLY_REFUNDED' ? 'partial' :
          order.orderPaymentStatus === 'FULLY_REFUNDED' ? 'full' : null;
        if ((order.orderPaymentStatus !== 'PAID' && !(details && refundStatus)) ||
            (order.cancelStatus && order.cancelStatus.cancelState !== 'NONE_REQUESTED')) continue;
        const row = publicRow('ebay', order.orderId, 'sell', 'Paid order', order.creationDate,
          order.pricingSummary?.total?.value, order.pricingSummary?.total?.currency);
        if (details) {
          if (refundStatus) row.refundStatus = refundStatus;
          Object.assign(row,productDetails('ebay',order.lineItems,details.catalog));
          const sale = reconciledSale(order,details.statements.get(order.orderId));
          if (sale) row.profit = {net:formatUnits(sale.net,6), netSales:formatUnits(sale.netSales,6), costs:formatUnits(sale.costs,6)};
        }
        rows.push(row);
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
  const amazonReader = amazonPurchases(env,fetcher,now);
  const readers = {get amazon(){return amazonReader();}, get ebay(){return ebaySales(seller?.activityOrderPage);}, kraken:krakenFills(env,fetcher,now)};
  const states = new Map();
  const blank = (source,status) => ({source,status,updatedAt:null,rows:[]});
  const disclose = source => source !== 'kraken' && env.DROPSHIPPING_PUBLIC_DETAILS === '1';

  async function load(source,reader,withDetails) {
    const end = now(), start = end-7*DAY;
    let details;
    if (withDetails) {
      const [catalog, statements] = await Promise.all([
        productCatalog(env.COMMERCE_PRODUCT_CATALOG_FILE),
        source === 'ebay' ? loadReconciliation(env.EBAY_SELLER_RECONCILIATION_FILE) : null,
      ]);
      details = {catalog,statements};
    }
    const result = await reader(start,end,details);
    const seen = new Set();
    const rows = result.rows.filter(row => {
      const time = Date.parse(row.time);
      if (time<start || time>end || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    }).sort((a,b)=>b.time.localeCompare(a.time)).slice(0, MAX_ROWS);
    return {source,status:result.partial?'partial':'connected',updatedAt:new Date(now()).toISOString(),rows};
  }

  return {supports: source => SOURCES.includes(source), async get(source) {
    if (!SOURCES.includes(source)) throw Error('Unknown activity source');
    const reader=readers[source], withDetails=disclose(source);
    if (!reader) {states.delete(source);return blank(source,'not_configured');}
    let state=states.get(source);
    if (!state || state.withDetails!==withDetails) {
      state={withDetails,confirmed:null,cached:null,expires:0,pending:null};
      states.set(source,state);
    }
    if (state.cached && state.expires>now()) return state.cached;
    if (state.pending) return state.pending;
    state.pending=load(source,reader,withDetails).then(feed=>{
      if (source!=='kraken') state.confirmed=feed;
      return feed;
    }).catch(error=>{
      const failure=blank(source,error?.status===429?'rate_limited':'unavailable');
      const transient=[408,429].includes(error?.status) || (error?.status>=500 && error.status<600) ||
        ['AbortError','TimeoutError'].includes(error?.name) || (error instanceof TypeError && error.message==='fetch failed');
      const snapshot=state.confirmed;
      if (snapshot && transient && now() < Date.parse(snapshot.updatedAt)+STORE_SNAPSHOT_LIFETIME) {
        failure.lastConfirmed=snapshot;
      } else {state.confirmed=null;}
      return failure;
    }).then(value=>{
      if (!readers[source] || disclose(source)!==withDetails || states.get(source)!==state) {
        if (states.get(source)===state) states.delete(source);
        return blank(source,readers[source]?'unavailable':'not_configured');
      }
      const retryAt=now()+(value.status==='rate_limited'?90000:30000);
      state.expires=value.lastConfirmed ? Math.min(retryAt,Date.parse(value.lastConfirmed.updatedAt)+STORE_SNAPSHOT_LIFETIME) : retryAt;
      state.cached=value;
      return value;
    }).finally(()=>{state.pending=null;});
    return state.pending;
  }};
}
