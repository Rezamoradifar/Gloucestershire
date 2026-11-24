// Read-only, opt-in public aggregate from the operator's own eBay seller.
// It never places an order, exposes a buyer or invents business profit.
import {open} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {formatUnits,parseUnits} from 'ethers';

const TOKEN_URL='https://api.ebay.com/identity/v1/oauth2/token';
const ORDERS_URL='https://apiz.ebay.com/sell/fulfillment/v1/order';
const SCOPE='https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly';
const WINDOW_MS=30*24*60*60*1000;
const PAGE_LIMIT=100;

const paidStates=new Set(['PAID','PARTIALLY_REFUNDED','FULLY_REFUNDED']);
const moneyUnits=value=>typeof value==='string'&&/^\d{1,18}(?:\.\d{1,6})?$/.test(value)?parseUnits(value,6):null;

// The operator's reconciled rows stay private. Match both the order amount
// and its eBay revision so refunds cannot reuse a stale cost statement.
async function loadReconciliation(file){
 if(!file||!isAbsolute(file))return new Map();
 let handle;
 try{
  handle=await open(file,'r');
  const stats=await handle.stat();
  if(!stats.isFile()||stats.size>4*1024*1024)return new Map();
  const ledger=JSON.parse(await handle.readFile('utf8'));
  if(ledger.version!==1||!Array.isArray(ledger.orders))return new Map();
  const rows=new Map();
  for(const row of ledger.orders){
   if(typeof row?.orderId!=='string'||rows.has(row.orderId))return new Map();
   rows.set(row.orderId,row);
  }
  return rows;
 }catch{return new Map();}finally{await handle?.close();}
}

export function sellerPerformance(orders,windowEnd,reconciled){
 const groups=new Map();
 for(const o of orders){
  if(!paidStates.has(o.orderPaymentStatus)){
   if(!['PENDING','FAILED'].includes(o.orderPaymentStatus))return null;
   continue;
  }
  const price=o.pricingSummary?.total,currency=price?.currency,gross=moneyUnits(price?.value);
  if(!/^[A-Z]{3}$/.test(currency??'')||gross===null)return null;
  const g=groups.get(currency)??{currency,gross:0n,recent:0n,refunds:0n,costs:0n,complete:true};
  groups.set(currency,g);g.gross+=gross;
  if(Date.parse(o.creationDate)>=windowEnd-7*86400000)g.recent+=gross;
  const row=reconciled.get(o.orderId);
  const refunds=moneyUnits(row?.refunds),cost=moneyUnits(row?.supplierCost),fees=moneyUnits(row?.fees),other=moneyUnits(row?.otherCosts);
  if(!row||row.currency!==currency||moneyUnits(row.gross)!==gross||!Number.isFinite(Date.parse(o.lastModifiedDate))||
    row.orderRevision!==o.lastModifiedDate||refunds===null||refunds>gross||cost===null||fees===null||other===null||
    (o.orderPaymentStatus==='FULLY_REFUNDED'&&refunds!==gross)||(o.orderPaymentStatus==='PARTIALLY_REFUNDED'&&(refunds===0n||refunds>=gross))||
    (o.orderPaymentStatus==='PAID'&&refunds!==0n))g.complete=false;
  else{g.refunds+=refunds;g.costs+=cost+fees+other;}
 }
 const display=n=>formatUnits(n,6);
 return {orderCount:orders.length,currencies:[...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(g=>({
  currency:g.currency,gross:display(g.gross),recent:display(g.recent),
  netSales:g.complete?display(g.gross-g.refunds):null,profit:g.complete?display(g.gross-g.refunds-g.costs):null
 }))};
}

export function createCommerceStatus({env=process.env,fetcher=fetch,now=Date.now}={}){
 const clientId=env.EBAY_SELLER_CLIENT_ID||env.EBAY_CLIENT_ID||'';
 const clientSecret=env.EBAY_SELLER_CLIENT_SECRET||env.EBAY_CLIENT_SECRET||'';
 const refreshToken=env.EBAY_SELLER_REFRESH_TOKEN||'';
 const enabled=env.EBAY_SELLER_PUBLIC_SUMMARY==='1'&&Boolean(clientId&&clientSecret&&refreshToken);
 let cached=null,expires=0,inflight=null,access=null;
 const blank=status=>({version:1,source:'ebay',status,updatedAt:null,windowStart:null,windowEnd:null,
  paidOrders:null,commercialProfit:null,profitStatus:'unverified_costs_and_fees'});
 async function request(url,options){
  const response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(6000)});
  if(!response.ok){const error=Error('Seller source unavailable');error.status=response.status;throw error;}
  return response.json();
 }
 async function token(){
  if(access&&access.expires>now())return access.value;
  const payload=await request(TOKEN_URL,{
   method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',
    Authorization:'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64')},
   body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken,scope:SCOPE}).toString()
  });
  if(typeof payload.access_token!=='string'||!payload.access_token||
   !Number.isFinite(Number(payload.expires_in))||Number(payload.expires_in)<=60)throw Error('Invalid seller token');
  access={value:payload.access_token,expires:now()+(Number(payload.expires_in)-60)*1000};
  return access.value;
 }
 async function orderPage(start,end,offset,limit){
  try{
   const bearer=await token();
   const params=new URLSearchParams({filter:`creationdate:[${new Date(start).toISOString()}..${new Date(end).toISOString()}]`,limit:String(limit),offset:String(offset)});
   return await request(ORDERS_URL+'?'+params,{method:'GET',headers:{Authorization:'Bearer '+bearer}});
  }catch(error){if(error?.status===401)access=null;throw error;}
 }
 async function load(){
  if(!enabled)return blank('not_configured');
  try{
   // Leave a one-minute margin against differences between server clocks.
   const end=now()-60000,start=end-WINDOW_MS;
   if(!Number.isFinite(start)||start<0)throw Error('Invalid clock');
   const payload=await orderPage(start,end,0,PAGE_LIMIT);
   if(!Number.isSafeInteger(payload.total)||payload.total<0)throw Error('Invalid order count');
   // An incomplete page must never be presented as a complete sales total.
   if(payload.total>PAGE_LIMIT)return blank('incomplete');
   const orders=payload.orders??(payload.total===0?[]:null);
   if(!Array.isArray(orders)||orders.length!==payload.total)throw Error('Incomplete seller orders');
   const ids=new Set();let paid=0;
   for(const order of orders){
    if(!order||typeof order.orderId!=='string'||!order.orderId||order.orderId.length>120||
      typeof order.orderPaymentStatus!=='string'||ids.has(order.orderId))throw Error('Invalid seller order');
    if(typeof order.creationDate!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(order.creationDate))
     throw Error('Seller order timestamp needs a timezone');
    const created=Date.parse(order.creationDate);
    if(!Number.isFinite(created)||created<start||created>end)throw Error('Order outside requested range');
    ids.add(order.orderId);
    if(order.orderPaymentStatus==='PAID')paid++;
   }
   const performance=env.EBAY_SELLER_PUBLIC_PERFORMANCE==='1'?
    sellerPerformance(orders,end,await loadReconciliation(env.EBAY_SELLER_RECONCILIATION_FILE)):null;
   return {version:1,source:'ebay',status:'live',updatedAt:new Date(now()).toISOString(),
    windowStart:new Date(start).toISOString(),windowEnd:new Date(end).toISOString(),paidOrders:paid,
    ...(performance?{performance}:{}),commercialProfit:null,profitStatus:'unverified_costs_and_fees'};
  }catch(error){
   if(error?.status===401)access=null;
   return blank(error?.status===429?'rate_limited':'unavailable');
  }
 }
 return Object.freeze({
  // Detailed activity has a separate opt-in from the existing count-only summary.
  activityOrderPage:env.EBAY_SELLER_PUBLIC_ACTIVITY==='1'&&clientId&&clientSecret&&refreshToken?orderPage:null,
  async get(){
   if(cached&&expires>now())return cached;
   if(inflight)return inflight;
   inflight=load().then(value=>{cached=value;expires=now()+(value.status==='live'?60000:15000);return value;})
    .finally(()=>{inflight=null;});
   return inflight;
  }
 });
}
