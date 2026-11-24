import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {createCommerceStatus} from '../server/commerce-ebay.mjs';
import {createTradingActivity} from '../server/trading-activity.mjs';
import {createApiServer} from '../server/trades-api.mjs';

const time=Date.parse('2026-11-24T10:00:00Z'), when=new Date(time-1000).toISOString();
const ok=data=>({ok:true,json:async()=>data});
const sellerEnv={EBAY_SELLER_CLIENT_ID:'seller',EBAY_SELLER_CLIENT_SECRET:'secret',EBAY_SELLER_REFRESH_TOKEN:'refresh'};
const amazonEnv={AMAZON_BUSINESS_PUBLIC_ACTIVITY:'1',AMAZON_BUSINESS_CLIENT_ID:'client',
  AMAZON_BUSINESS_CLIENT_SECRET:'secret',AMAZON_BUSINESS_REFRESH_TOKEN:'refresh'};

test('accounts remain unpublished with absent credentials or count-only consent',async()=>{
  const fail=async()=>{throw Error('Unexpected provider request');};
  const seller=createCommerceStatus({env:{...sellerEnv,EBAY_SELLER_PUBLIC_SUMMARY:'1'},fetcher:fail});
  const desk=createTradingActivity({seller,env:{},fetcher:fail});
  for(const source of ['ebay','amazon','kraken']) {
    assert.deepEqual(await desk.get(source),{source,status:'not_configured',updatedAt:null,rows:[]});
  }
  assert.equal(desk.supports('market'),false);
});

test('only exposes opted-in paid eBay sales, with the order time and no private identifiers',async()=>{
  const order={orderId:'private-order-id',orderPaymentStatus:'PAID',creationDate:when,pricingSummary:{total:{value:'12.50',currency:'USD'}},buyer:{email:'private@example.test'}};
  const fetcher=async url=>url.includes('oauth2/token')?ok({access_token:'token',expires_in:7200}):ok({total:4,orders:[
    order,{...order,orderId:'unpaid',orderPaymentStatus:'PENDING'},{...order,orderId:'refund',orderPaymentStatus:'FULLY_REFUNDED'},
    {...order,orderId:'cancelled',cancelStatus:{cancelState:'CANCELED'}}]});
  const seller=createCommerceStatus({env:{...sellerEnv,EBAY_SELLER_PUBLIC_ACTIVITY:'1'},now:()=>time,fetcher});
  const feed=await createTradingActivity({env:{},seller,now:()=>time}).get('ebay');
  assert.equal(feed.rows.length,1);assert.equal(feed.rows[0].side,'sell');assert.equal(feed.rows[0].amount,'12.50');
  assert.doesNotMatch(JSON.stringify(feed),/private|unpaid|cancelled/);
});

test('Amazon Business pages are read once per refresh, excluding returns, duplicates and buyer details',async()=>{
  let reads=0, calls=0, clock=time;
  const tx={transactionId:'private-ledger-id',transactionType:'CHARGE',transactionDate:when,amount:{currencyCode:'USD',amount:'25.00'},customerEmail:'private@example.test'};
  const desk=createTradingActivity({env:amazonEnv,now:()=>clock,fetcher:async(url,opts)=>{
    if(url.includes('auth/o2/token')) {calls++;return ok({access_token:'secret',expires_in:3600});}
    assert.equal(opts.headers['x-amz-access-token'],'secret');
    assert.match(url,/^https:\/\/na\.business-api\.amazon\.com\//);reads++;
    if(reads>2) return {ok:false,status:403};
    return url.includes('nextPageToken=two')?ok({transactions:[tx,{...tx,transactionType:'REFUND'}]}):
      ok({transactions:[tx],nextPageToken:'two'});
  }});
  const [first,duplicate]=await Promise.all([desk.get('amazon'),desk.get('amazon')]);
  assert.deepEqual(first,duplicate);assert.equal(calls,1);assert.equal(reads,2);assert.equal(first.rows.length,1);
  assert.equal(first.rows[0].side,'buy');assert.equal(first.rows[0].unit,'USD');assert.doesNotMatch(JSON.stringify(first),/private|secret/);
  clock+=31000;
  assert.deepEqual((await desk.get('amazon')).rows,[]);
});

test('Kraken signs only a trade-history read, preserves fill sides and clears records when rate limited',async()=>{
  const secret=Buffer.from('local-test-only').toString('base64');
  let clock=time;
  const env={KRAKEN_PUBLIC_ACCOUNT_ACTIVITY:'1',KRAKEN_ACTIVITY_KEY:'read-only',KRAKEN_ACTIVITY_SECRET:secret};
  const desk=createTradingActivity({env,now:()=>clock,fetcher:async(url,opts)=>{
    if(clock>time) return ok({error:['EAPI:Rate limit exceeded']});
    const path=new URL(url).pathname;assert.equal(path,'/0/private/TradesHistory');
    const nonce=new URLSearchParams(opts.body).get('nonce');
    const digest=createHash('sha256').update(nonce+opts.body).digest();
    assert.equal(opts.headers['API-Sign'],createHmac('sha512',Buffer.from(secret,'base64')).update(path).update(digest).digest('base64'));
    return ok({error:[],result:{trades:{'private-fill':{pair:'BTC/USD',type:'buy',time:time/1000-1,vol:'0.31'},
      'private-sell':{pair:'ETH/USD',type:'sell',time:time/1000-2,vol:'1.23'}}}});
  }});
  const feed=await desk.get('kraken');
  assert.equal(feed.status,'connected');assert.deepEqual(feed.rows.map(r=>r.side),['buy','sell']);
  assert.doesNotMatch(JSON.stringify(feed),/private|read-only/);
  clock+=31000;assert.equal((await desk.get('kraken')).status,'rate_limited');
});

test('same-origin activity endpoint accepts only GET and the named account sources',async()=>{
  const desk=createTradingActivity({env:{}});
  const api=createApiServer({configured:false,publicConfig:{}},{activity:desk});
  const call=(method,source)=>new Promise(resolve=>{
    let status;const res={setHeader(){},writeHead(code){status=code;},end(body){resolve({status,body:JSON.parse(body)});}};
    api.emit('request',{method,url:'/api/commerce/activity?source='+source,headers:{}},res);
  });
  assert.equal((await call('POST','ebay')).status,405);assert.equal((await call('GET','other')).status,400);
  assert.equal((await call('GET','amazon')).body.status,'not_configured');
});
