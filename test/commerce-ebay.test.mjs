import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommerceStatus} from '../server/commerce-ebay.mjs';
import {createApiServer} from '../server/trades-api.mjs';

const clock=Date.parse('2026-11-14T12:00:00Z');
const env={EBAY_CLIENT_ID:'seller-client',EBAY_CLIENT_SECRET:'private-secret',
 EBAY_SELLER_REFRESH_TOKEN:'private-refresh',EBAY_SELLER_PUBLIC_SUMMARY:'1'};
const order=(id,status='PAID')=>({orderId:id,orderPaymentStatus:status,
 creationDate:'2026-11-10T10:00:00Z',buyer:{email:'private@example.test'}});
const ok=value=>({ok:true,json:async()=>value});

test('never fetches without explicit seller consent and public-summary opt-in',async()=>{
 let calls=0;
 for(const settings of [{}, {...env,EBAY_SELLER_PUBLIC_SUMMARY:'0'}, {...env,EBAY_SELLER_REFRESH_TOKEN:''}]){
  const result=await createCommerceStatus({env:settings,fetcher:async()=>{calls++;throw Error();},now:()=>clock}).get();
  assert.equal(result.status,'not_configured');assert.equal(result.paidOrders,null);assert.equal(result.commercialProfit,null);
 }
 assert.equal(calls,0);
});
test('reads the seller orders using scoped user OAuth and exposes only aggregates',async()=>{
 const requests=[];
 const service=createCommerceStatus({env,now:()=>clock,fetcher:async(url,options)=>{
  requests.push({url,options});
  return url.includes('/identity/')?ok({access_token:'private-access',expires_in:7200}):
   ok({total:3,orders:[order('A'),order('B','FULLY_REFUNDED'),order('C')]});
 }});
 const [a,b]=await Promise.all([service.get(),service.get()]);
 assert.deepEqual(a,b);assert.equal(a.status,'live');assert.equal(a.paidOrders,2);
 assert.equal(a.commercialProfit,null);assert.equal(a.profitStatus,'unverified_costs_and_fees');
 assert.equal(requests.length,2);
 assert.match(requests[0].options.body,/sell.fulfillment.readonly/);
 assert.equal(requests[0].options.redirect,'error');
 assert.match(requests[1].url,/sell\/fulfillment\/v1\/order/);
 assert.equal(requests[1].options.headers.Authorization,'Bearer private-access');
 const publiclyVisible=JSON.stringify(a);
 for(const secret of ['private-access','private-refresh','private-secret','private@example.test','"A"','"B"'])
  assert.equal(publiclyVisible.includes(secret),false);
});
test('empty complete results can be zero; incomplete or duplicate pages cannot',async()=>{
 for(const [data,status,count] of [
  [{total:0},'live',0],
  [{total:101,orders:[order('A')]},'incomplete',null],
  [{total:2,orders:[order('A')]},'incomplete',null],
  [{total:2,orders:[order('A'),order('A')]},'incomplete',null],
  [{total:1,orders:[{...order('A'),creationDate:'2026-11-10T10:00:00'}]},'unavailable',null],
  [{total:1,orders:[{...order('A'),creationDate:'2026-11-10T13:30:00+03:30'}]},'live',1]
 ]){
  const service=createCommerceStatus({env,now:()=>clock,fetcher:async url=>url.includes('/identity/')?
   ok({access_token:'token',expires_in:7200}):ok(data)});
  const result=await service.get();assert.equal(result.status,status);assert.equal(result.paidOrders,count);
  assert.equal(result.commercialProfit,null);
 }
});
test('aggregates every monthly page in a fixed window, sharing the scan across public requests',async()=>{
 const orders=Array.from({length:451},(_,i)=>({...order(String(i),i%3===0?'PENDING':'PAID'),
  pricingSummary:{total:{currency:i%2===0?'EUR':'USD',value:'5.00'}}}));
 const pages=[];
 let time=clock,authCalls=0;
 const service=createCommerceStatus({env:{...env,EBAY_SELLER_PUBLIC_PERFORMANCE:'1'},now:()=>time,fetcher:async url=>{
  if(url.includes('/identity/')){authCalls++;return ok({access_token:'access',expires_in:3600});}
  const params=new URL(url).searchParams;
  const offset=Number(params.get('offset')),limit=Number(params.get('limit'));
  pages.push({offset,limit,filter:params.get('filter')});
  time+=500;
  return ok({total:orders.length,offset,orders:orders.slice(offset,offset+limit)});
 }});
 const [summary,concurrent]=await Promise.all([service.get(),service.get()]);
 assert.deepEqual(summary,concurrent);
 assert.equal(summary.status,'live');assert.equal(summary.paidOrders,300);
 assert.equal(summary.performance.orderCount,451);
 assert.deepEqual(summary.performance.currencies,[
  {currency:'EUR',gross:'750.0',recent:'750.0',netSales:null,profit:null},
  {currency:'USD',gross:'750.0',recent:'750.0',netSales:null,profit:null}
 ]);
 assert.equal(authCalls,1);
 assert.deepEqual(pages.map(p=>[p.offset,p.limit]),[[0,200],[200,200],[400,200]]);
 assert.equal(new Set(pages.map(p=>p.filter)).size,1);
 assert.equal(JSON.stringify(summary).includes('private@example.test'),false);
 assert.deepEqual(await service.get(),summary);assert.equal(pages.length,3);
});

test('a bad later page never publishes partial counts or monetary totals',async()=>{
 const first=Array.from({length:200},(_,i)=>order(String(i)));
 for(const later of [
  {total:203,orders:[order('200'),order('201'),order('202')]},
  {total:202,orders:[order('200')]},
  {total:202,orders:[order('0'),order('201')]},
  {total:202,offset:100,orders:[order('200'),order('201')]}
 ]){
  const client=createCommerceStatus({env,now:()=>clock,fetcher:async url=>{
   if(url.includes('/identity/'))return ok({access_token:'token',expires_in:7200});
   return ok(new URL(url).searchParams.get('offset')==='0'?{total:202,offset:0,orders:first}:later);
  }});
  const summary=await client.get();assert.equal(summary.status,'incomplete');
  assert.equal(summary.performance,undefined);assert.equal(summary.paidOrders,null);
 }
});

test('obeys Retry-After across monthly scans and activity calls before retrying',async()=>{
 let now=clock,calls=0;
 const client=createCommerceStatus({env:{...env,EBAY_SELLER_PUBLIC_ACTIVITY:'1'},now:()=>now,fetcher:async url=>{
  if(url.includes('/identity/'))return ok({access_token:'token',expires_in:7200});
  calls++;return calls===1?{ok:false,status:429,headers:new Headers({'retry-after':'180'})}:ok({total:0});
 }});
 assert.equal((await client.get()).status,'rate_limited');
 now+=90000;
 assert.equal((await client.get()).status,'rate_limited');
 await assert.rejects(client.activityOrderPage(now-60000,now,0,100),{status:429});
 assert.equal(calls,1);now+=90001;
 assert.equal((await client.get()).paidOrders,0);assert.equal(calls,2);
});

test('revoked opt-ins or changed credentials do not serve cached account data',async()=>{
 const settings={...env,EBAY_SELLER_PUBLIC_ACTIVITY:'1',EBAY_SELLER_PUBLIC_PERFORMANCE:'1'};
 const client=createCommerceStatus({env:settings,now:()=>clock,fetcher:async url=>url.includes('/identity/')?
  ok({access_token:'token',expires_in:3600}):ok({total:0})});
 assert.equal(typeof client.activityOrderPage,'function');assert.equal((await client.get()).performance.orderCount,0);
 settings.EBAY_SELLER_PUBLIC_PERFORMANCE='0';
 assert.equal((await client.get()).performance,undefined);
 settings.EBAY_SELLER_PUBLIC_ACTIVITY='0';assert.equal(client.activityOrderPage,null);
 settings.EBAY_SELLER_PUBLIC_ACTIVITY='1';settings.EBAY_SELLER_REFRESH_TOKEN='replacement';
 assert.equal(client.activityOrderPage,null);assert.equal((await client.get()).status,'not_configured');
});
test('never reports stale sales after authorization or provider failure',async()=>{
 let time=clock,failed=false;
 const service=createCommerceStatus({env,now:()=>time,fetcher:async url=>{
  if(failed)return {ok:false,status:401};
  return url.includes('/identity/')?ok({access_token:'token',expires_in:7200}):ok({total:1,orders:[order('A')]});
 }});
 assert.equal((await service.get()).paidOrders,1);
 time+=61000;failed=true;
 const result=await service.get();assert.equal(result.status,'unavailable');assert.equal(result.paidOrders,null);
});
test('rejects orders outside the requested window and rate limits safely',async()=>{
 const old={...order('A'),creationDate:'2026-01-01T00:00:00Z'};
 const service=createCommerceStatus({env,now:()=>clock,fetcher:async url=>url.includes('/identity/')?
  ok({access_token:'token',expires_in:7200}):ok({total:1,orders:[old]})});
 assert.equal((await service.get()).status,'unavailable');
 const limited=createCommerceStatus({env,now:()=>clock,fetcher:async()=>({ok:false,status:429})});
 assert.equal((await limited.get()).status,'rate_limited');
});
test('site API exposes only the aggregate via GET',async()=>{
 const commerce=createCommerceStatus({env:{},now:()=>clock});
 const server=createApiServer({configured:false,publicConfig:{chainId:97,vaultAddress:null}},{commerce});
 const call=method=>new Promise(resolve=>{
  const headers={};let status=200;
  const res={setHeader:(key,value)=>{headers[key]=value;},writeHead:code=>{status=code;},
   end:body=>resolve({status,headers,body:JSON.parse(body)})};
  server.emit('request',{method,url:'/api/commerce/status',headers:{}},res);
 });
 const get=await call('GET');assert.equal(get.status,200);assert.equal(get.body.status,'not_configured');
 assert.equal(get.body.commercialProfit,null);assert.equal(get.headers['Cache-Control'],'no-store');
 assert.equal((await call('POST')).status,405);
});

test('publishes currency-specific volume and reconciled margins only with the separate opt-in',async()=>{
 const {sellerPerformance}=await import('../server/commerce-ebay.mjs');
 const revision='2026-11-12T08:00:00Z';
 const sample=(id,currency,gross,status,created)=>({...order(id,status),creationDate:created,lastModifiedDate:revision,pricingSummary:{total:{value:gross,currency}}});
 const orders=[sample('A','USD','100','PAID','2026-11-10T01:00:00Z'),sample('B','USD','50','FULLY_REFUNDED','2026-11-02T00:00:00Z'),
  sample('C','EUR','80','PAID','2026-11-03T00:00:00Z')];
 const statement=(orderId,currency,gross,refunds,supplierCost,fees)=>({orderId,currency,gross,refunds,supplierCost,fees,otherCosts:'0',orderRevision:revision});
 const reconciled=new Map([['A',statement('A','USD','100','0','90','2')],['B',statement('B','USD','50','50','10','0')]]);
 const metrics=sellerPerformance(orders,clock,reconciled);
 assert.deepEqual(metrics,{orderCount:3,currencies:[
  {currency:'EUR',gross:'80.0',recent:'0.0',netSales:null,profit:null},
  {currency:'USD',gross:'150.0',recent:'100.0',netSales:'100.0',profit:'-2.0'}]});
 reconciled.get('B').orderRevision='2026-11-01T00:00:00Z';
 assert.equal(sellerPerformance(orders,clock,reconciled).currencies[1].profit,null);
 const fetcher=async url=>url.includes('/identity/')?ok({access_token:'access',expires_in:7200}):ok({total:3,orders});
 const summary=await createCommerceStatus({env,now:()=>clock,fetcher}).get();
 assert.equal(summary.performance,undefined);
 const publicResult=await createCommerceStatus({env:{...env,EBAY_SELLER_PUBLIC_PERFORMANCE:'1'},now:()=>clock,fetcher}).get();
 assert.equal(publicResult.performance.orderCount,3);assert.equal(publicResult.performance.currencies.length,2);
 assert.ok(publicResult.performance.currencies.every(c=>c.profit===null));
});
