// Read-only, opt-in public aggregate from the operator's own eBay seller.
// It never places an order, exposes a buyer or invents business profit.
const TOKEN_URL='https://api.ebay.com/identity/v1/oauth2/token';
const ORDERS_URL='https://api.ebay.com/sell/fulfillment/v1/order';
const SCOPE='https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly';
const WINDOW_MS=30*24*60*60*1000;
const PAGE_LIMIT=100;

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
 async function load(){
  if(!enabled)return blank('not_configured');
  try{
   const bearer=await token();
   // Leave a one-minute margin against differences between server clocks.
   const end=now()-60000,start=end-WINDOW_MS;
   if(!Number.isFinite(start)||start<0)throw Error('Invalid clock');
   const params=new URLSearchParams({filter:`creationdate:[${new Date(start).toISOString()}..${new Date(end).toISOString()}]`,limit:String(PAGE_LIMIT),offset:'0'});
   const payload=await request(ORDERS_URL+'?'+params,{method:'GET',headers:{Authorization:'Bearer '+bearer}});
   if(!Number.isSafeInteger(payload.total)||payload.total<0)throw Error('Invalid order count');
   // An incomplete page must never be presented as a complete sales total.
   if(payload.total>PAGE_LIMIT)return blank('incomplete');
   const orders=payload.orders??(payload.total===0?[]:null);
   if(!Array.isArray(orders)||orders.length!==payload.total)throw Error('Incomplete seller orders');
   const ids=new Set();let paid=0;
   for(const order of orders){
    if(!order||typeof order.orderId!=='string'||!order.orderId||order.orderId.length>120||
      typeof order.orderPaymentStatus!=='string'||ids.has(order.orderId))throw Error('Invalid seller order');
    const created=Date.parse(order.creationDate);
    if(!Number.isFinite(created)||created<start||created>end)throw Error('Order outside requested range');
    ids.add(order.orderId);
    if(order.orderPaymentStatus==='PAID')paid++;
   }
   return {version:1,source:'ebay',status:'live',updatedAt:new Date(now()).toISOString(),
    windowStart:new Date(start).toISOString(),windowEnd:new Date(end).toISOString(),paidOrders:paid,
    commercialProfit:null,profitStatus:'unverified_costs_and_fees'};
  }catch(error){
   if(error?.status===401)access=null;
   return blank(error?.status===429?'rate_limited':'unavailable');
  }
 }
 return Object.freeze({
  async get(){
   if(cached&&expires>now())return cached;
   if(inflight)return inflight;
   inflight=load().then(value=>{cached=value;expires=now()+(value.status==='live'?60000:15000);return value;})
    .finally(()=>{inflight=null;});
   return inflight;
  }
 });
}
