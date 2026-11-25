// Read-only, opt-in public aggregate from the operator's own eBay seller.
// It never places an order, exposes a buyer or invents business profit.
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {formatUnits,parseUnits} from 'ethers';

const TOKEN_URL='https://api.ebay.com/identity/v1/oauth2/token';
const ORDERS_URL='https://apiz.ebay.com/sell/fulfillment/v1/order';
const SCOPE='https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly';
const WINDOW_MS=30*24*60*60*1000;
const PAGE_LIMIT=200;

const paidStates=new Set(['PAID','PARTIALLY_REFUNDED','FULLY_REFUNDED']);
const moneyUnits=value=>typeof value==='string'&&/^\d{1,18}(?:\.\d{1,6})?$/.test(value)?parseUnits(value,6):null;

export async function readCommerceInput(file){
 if(typeof file!=='string'||!isAbsolute(file))return null;
 let handle;
 try{
  handle=await open(file,constants.O_RDONLY|constants.O_NONBLOCK);
  const stats=await handle.stat();
  if(!stats.isFile()||stats.size<1||stats.size>4*1024*1024)return null;
  const buffer=Buffer.alloc(stats.size+1);
  const {bytesRead}=await handle.read(buffer);
  if(bytesRead!==stats.size)return null;
  return JSON.parse(buffer.toString('utf8',0,bytesRead));
 }catch{return null;}finally{await handle?.close();}
}

export async function loadReconciliation(file){
 const ledger=await readCommerceInput(file);
 const rows=new Map();
 if(ledger?.version!==1||!Array.isArray(ledger.orders))return rows;
 for(const row of ledger.orders){
  if(typeof row?.orderId!=='string'||rows.has(row.orderId))return new Map();
  rows.set(row.orderId,row);
 }
 return rows;
}

// Match the complete cost statement to the exact provider revision and gross.
export function reconciledSale(order,row){
 const price=order.pricingSummary?.total,gross=moneyUnits(price?.value);
 if(!paidStates.has(order.orderPaymentStatus)||!row||row.orderId!==order.orderId||
    !/^[A-Z]{3}$/.test(price?.currency??'')||row.currency!==price.currency||gross===null||moneyUnits(row.gross)!==gross||
    typeof order.lastModifiedDate!=='string'||!Number.isFinite(Date.parse(order.lastModifiedDate))||
    row.orderRevision!==order.lastModifiedDate)return null;
 const refunds=moneyUnits(row.refunds),supplier=moneyUnits(row.supplierCost),fees=moneyUnits(row.fees),other=moneyUnits(row.otherCosts);
 if(refunds===null||refunds>gross||supplier===null||fees===null||other===null||
    (order.orderPaymentStatus==='FULLY_REFUNDED'&&refunds!==gross)||
    (order.orderPaymentStatus==='PARTIALLY_REFUNDED'&&(refunds===0n||refunds>=gross))||
    (order.orderPaymentStatus==='PAID'&&refunds!==0n))return null;
 const costs=supplier+fees+other,netSales=gross-refunds;
 return {refunds,netSales,costs,net:netSales-costs};
}

function addOrderPerformance(groups,order,windowEnd,reconciled){
 if(!paidStates.has(order.orderPaymentStatus))return ['PENDING','FAILED'].includes(order.orderPaymentStatus);
 const price=order.pricingSummary?.total,currency=price?.currency,gross=moneyUnits(price?.value);
 if(!/^[A-Z]{3}$/.test(currency??'')||gross===null)return false;
 const group=groups.get(currency)??{currency,gross:0n,recent:0n,refunds:0n,costs:0n,complete:true};
 groups.set(currency,group);
 group.gross+=gross;
 if(Date.parse(order.creationDate)>=windowEnd-7*86400000)group.recent+=gross;
 const sale=reconciledSale(order,reconciled.get(order.orderId));
 if(!sale)group.complete=false;
 else{group.refunds+=sale.refunds;group.costs+=sale.costs;}
 return true;
}

function formatPerformance(groups,orderCount){
 const display=n=>formatUnits(n,6);
 return {orderCount,currencies:[...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(g=>({
  currency:g.currency,gross:display(g.gross),recent:display(g.recent),
  netSales:g.complete?display(g.gross-g.refunds):null,profit:g.complete?display(g.gross-g.refunds-g.costs):null
 }))};
}

export function sellerPerformance(orders,windowEnd,reconciled){
 const groups=new Map();
 return orders.every(order=>addOrderPerformance(groups,order,windowEnd,reconciled))?formatPerformance(groups,orders.length):null;
}

export function createCommerceStatus({env=process.env,fetcher=fetch,now=Date.now}={}){
 const clientId=env.EBAY_SELLER_CLIENT_ID||env.EBAY_CLIENT_ID||'';
 const clientSecret=env.EBAY_SELLER_CLIENT_SECRET||env.EBAY_CLIENT_SECRET||'';
 const refreshToken=env.EBAY_SELLER_REFRESH_TOKEN||'';
 const authorized=setting=>env[setting]==='1'&&Boolean(clientId&&clientSecret&&refreshToken)&&
  clientId===(env.EBAY_SELLER_CLIENT_ID||env.EBAY_CLIENT_ID)&&
  clientSecret===(env.EBAY_SELLER_CLIENT_SECRET||env.EBAY_CLIENT_SECRET)&&refreshToken===env.EBAY_SELLER_REFRESH_TOKEN;
 const summaryAllowed=()=>authorized('EBAY_SELLER_PUBLIC_SUMMARY');
 let cached=null,expires=0,inflight=null,access=null,tokenRequest=null,rateLimitedUntil=0;
 const blank=status=>({version:1,source:'ebay',status,updatedAt:null,windowStart:null,windowEnd:null,
  paidOrders:null,commercialProfit:null,profitStatus:'unverified_costs_and_fees'});
 async function request(url,options){
  const response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(6000)});
  if(!response.ok){
   if(response.status===429){
    const retry=response.headers?.get?.('retry-after');
    const until=retry&&/^\d+$/.test(retry)?now()+Number(retry)*1000:Date.parse(retry);
    rateLimitedUntil=Math.max(now()+60000,Number.isFinite(until)?until:0);
   }
   const error=Error('Seller source unavailable');error.status=response.status;throw error;
  }
  return response.json();
 }
 async function refreshTokenValue(){
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
 function token(){
  if(access&&access.expires>now())return access.value;
  if(!tokenRequest)tokenRequest=refreshTokenValue().finally(()=>{tokenRequest=null;});
  return tokenRequest;
 }
 async function orderPage(start,end,offset,limit){
  try{
   if(now()<rateLimitedUntil)throw Object.assign(Error('Seller source rate limited'),{status:429});
   const bearer=await token();
   const params=new URLSearchParams({filter:`creationdate:[${new Date(start).toISOString()}..${new Date(end).toISOString()}]`,limit:String(limit),offset:String(offset)});
   return await request(ORDERS_URL+'?'+params,{method:'GET',headers:{Authorization:'Bearer '+bearer}});
  }catch(error){if(error?.status===401)access=null;throw error;}
 }
 async function load(){
  try{
   // Leave a one-minute margin against differences between server clocks.
   const end=now()-60000,start=end-WINDOW_MS;
   if(!Number.isFinite(start)||start<0)throw Error('Invalid clock');
   const ids=new Set();
   const statements=env.EBAY_SELLER_PUBLIC_PERFORMANCE==='1'?await loadReconciliation(env.EBAY_SELLER_RECONCILIATION_FILE):null;
   let groups=statements?new Map():null;
   let expected=null,offset=0,paid=0;
   do{
    if(!summaryAllowed())return blank('not_configured');
    const page=await orderPage(start,end,offset,PAGE_LIMIT);
    if(!Number.isSafeInteger(page?.total)||page.total<0)throw Error('Invalid order count');
    expected??=page.total;
    if(page.total!==expected||(page.offset!==undefined&&page.offset!==offset))return blank('incomplete');
    const orders=page.orders??(expected===0?[]:null);
    if(!Array.isArray(orders))throw Error('Invalid seller orders');
    if(orders.length!==Math.min(PAGE_LIMIT,expected-offset))return blank('incomplete');
    for(const order of orders){
     if(!order||typeof order.orderId!=='string'||!order.orderId||order.orderId.length>120||
       typeof order.orderPaymentStatus!=='string')throw Error('Invalid seller order');
     if(ids.has(order.orderId))return blank('incomplete');
     if(typeof order.creationDate!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(order.creationDate))
      throw Error('Seller order timestamp needs a timezone');
     const created=Date.parse(order.creationDate);
     if(!Number.isFinite(created)||created<start||created>end)throw Error('Order outside requested range');
     ids.add(order.orderId);
     if(order.orderPaymentStatus==='PAID')paid++;
     if(groups&&!addOrderPerformance(groups,order,end,statements))groups=null;
    }
    offset+=orders.length;
   }while(offset<expected);
   const performance=groups&&env.EBAY_SELLER_PUBLIC_PERFORMANCE==='1'?formatPerformance(groups,offset):null;
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
  get activityOrderPage(){return authorized('EBAY_SELLER_PUBLIC_ACTIVITY')?orderPage:null;},
  async get(){
   if(!summaryAllowed()){
    cached=null;inflight=null;return blank('not_configured');
   }
   const publicSummary=value=>{
    if(!value.performance||env.EBAY_SELLER_PUBLIC_PERFORMANCE==='1')return value;
    const {performance,...summary}=value;
    return summary;
   };
   if(cached&&expires>now())return publicSummary(cached);
   if(inflight)return inflight;
   const scan=load().then(value=>{
    if(inflight!==scan||!summaryAllowed())return blank('not_configured');
    cached=publicSummary(value);
    expires=now()+(value.status==='live'?60000:15000);
    return cached;
   }).finally(()=>{if(inflight===scan)inflight=null;});
   inflight=scan;
   return scan;
  }
 });
}
