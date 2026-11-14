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
  [{total:2,orders:[order('A')]},'unavailable',null],
  [{total:2,orders:[order('A'),order('A')]},'unavailable',null]
 ]){
  const service=createCommerceStatus({env,now:()=>clock,fetcher:async url=>url.includes('/identity/')?
   ok({access_token:'token',expires_in:7200}):ok(data)});
  const result=await service.get();assert.equal(result.status,status);assert.equal(result.paidOrders,count);
  assert.equal(result.commercialProfit,null);
 }
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
