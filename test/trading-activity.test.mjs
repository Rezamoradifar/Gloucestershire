import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

async function privateInputs(t, catalog, orders=[]) {
  const dir=await mkdtemp(join(tmpdir(),'dropshipping-feed-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const productsFile=join(dir,'products.json'), ledgerFile=join(dir,'statements.json');
  await Promise.all([
    writeFile(productsFile,JSON.stringify({version:1,products:catalog}),{mode:0o600}),
    writeFile(ledgerFile,JSON.stringify({version:1,orders}),{mode:0o600}),
  ]);
  return {COMMERCE_PRODUCT_CATALOG_FILE:productsFile,EBAY_SELLER_RECONCILIATION_FILE:ledgerFile};
}

const paidOrder={
  orderId:'private-order-20',orderPaymentStatus:'PAID',creationDate:when,lastModifiedDate:when,
  pricingSummary:{total:{value:'100.00',currency:'USD'}},
  lineItems:[
    {legacyItemId:'111111111111',legacyVariationId:'221122112211',quantity:2,title:'Headline headphones',
      variationAspects:[{name:'Model',value:'Listed M'},{name:'Type',value:'Headset'}],sku:'private-seller-sku'},
    {legacyItemId:'111111111111',legacyVariationId:'332233223322',quantity:1,title:'Portable case',
      variationAspects:[{name:'Model Number',value:'Case-22'},{name:'Type',value:'Case'},{name:'Product type',value:'Sleeve'}],
      compatibilityProperties:[{propertyName:'Model',propertyValue:'private-vehicle'}]},
  ],
};
const statement={orderId:paidOrder.orderId,orderRevision:when,currency:'USD',gross:'100',refunds:'0',supplierCost:'107.30',fees:'2.70',otherCosts:'1.42'};

function saleActivity(env,order=paidOrder) {
  const settings={...sellerEnv,EBAY_SELLER_PUBLIC_ACTIVITY:'1',...env};
  const fetcher=async url=>url.includes('oauth2/token')?ok({access_token:'token',expires_in:7200}):ok({total:1,orders:[order]});
  return createTradingActivity({env:settings,seller:createCommerceStatus({env:settings,now:()=>time,fetcher}),now:()=>time}).get('ebay');
}

test('live sale retains one gross and one reconciled P&L across exact product variations',async t=>{
  const files=await privateInputs(t,[
    {source:'ebay',id:'111111111111',variationId:'221122112211',model:'M42',type:'Headphones',internal:'private memo'},
    {source:'ebay',id:'111111111111',model:'Wrong parent model',type:'Wrong parent type'},
  ],[statement]);
  const feed=await saleActivity({...files,DROPSHIPPING_PUBLIC_DETAILS:'1'});
  assert.equal(feed.status,'connected');
  assert.equal(feed.rows.length,1);
  const [row]=feed.rows;
  assert.equal(row.amount,'100.00');
  assert.equal(row.productCount,2);
  assert.deepEqual(row.products,[
    {name:'Headline headphones',model:'M42',type:'Headphones',quantity:2},
    {name:'Portable case',model:'Case-22',type:null,quantity:1},
  ]);
  assert.deepEqual(row.profit,{net:'-11.42',netSales:'100.0',costs:'111.42'});
  assert.doesNotMatch(JSON.stringify(row),/private|111111111111|332233223322|Wrong parent/);
  const legacy=await saleActivity({...files,EBAY_SELLER_PUBLIC_PERFORMANCE:'1'});
  assert.equal(legacy.rows[0].products,undefined);
  assert.equal(legacy.rows[0].profit,undefined);
});

test('stale, incomplete, duplicate or mismatched reconciliation preserves the sale with P&L withheld',async t=>{
  const files=await privateInputs(t,[],[]);
  const env={...files,DROPSHIPPING_PUBLIC_DETAILS:'1'};
  for(const rows of [
    [{...statement,orderRevision:'2020-01-01T00:00:00Z'}],[{...statement,otherCosts:null}],
    [{...statement,gross:'101'}],[{...statement,currency:'CAD'}],[{...statement,refunds:'5'}],
    [{...statement,orderId:'another-order'}],[statement,statement],
  ]) {
    await writeFile(files.EBAY_SELLER_RECONCILIATION_FILE,JSON.stringify({version:1,orders:rows}));
    const [row]=(await saleActivity(env)).rows;
    assert.equal(row.profit,undefined);
    assert.equal(row.products[0].model,'Listed M');
    assert.equal(row.products[0].type,'Headset');
    assert.equal(row.products[1].type,null);
  }
  await writeFile(files.EBAY_SELLER_RECONCILIATION_FILE,JSON.stringify({version:1,orders:[{...statement,supplierCost:'100',fees:'0',otherCosts:'0'}]}));
  assert.deepEqual((await saleActivity(env)).rows[0].profit,{net:'0.0',netSales:'100.0',costs:'100.0'});
  assert.deepEqual((await saleActivity(env,{...paidOrder,orderPaymentStatus:'PENDING'})).rows,[]);
});

test('opted-in refunded sales retain one original gross with net sales and losses after refunds',async t=>{
  const files=await privateInputs(t,[],[]);
  const env={...files,DROPSHIPPING_PUBLIC_DETAILS:'1'};
  for(const [payment,refundStatus,refunds,netSales,net] of [
    ['PARTIALLY_REFUNDED','partial','20.00','80.0','8.0'],
    ['FULLY_REFUNDED','full','100.00','0.0','-72.0'],
  ]) {
    const order={...paidOrder,orderPaymentStatus:payment};
    const settled={...statement,supplierCost:'63',fees:'7',otherCosts:'2',refunds};
    await writeFile(files.EBAY_SELLER_RECONCILIATION_FILE,JSON.stringify({version:1,orders:[settled]}));
    const feed=await saleActivity(env,order);
    assert.equal(feed.rows.length,1);
    const [sale]=feed.rows;
    assert.equal(sale.side,'sell');
    assert.equal(sale.refundStatus,refundStatus);
    assert.equal(sale.time,when);
    assert.equal(sale.amount,'100.00');
    assert.equal(sale.productCount,2);
    assert.deepEqual(sale.profit,{net,netSales,costs:'72.0'});
    assert.deepEqual((await saleActivity(files,order)).rows,[]);
    assert.deepEqual((await saleActivity(env,{...order,cancelStatus:{cancelState:'CANCEL_CLOSED_WITH_REFUND'}})).rows,[]);
    await writeFile(files.EBAY_SELLER_RECONCILIATION_FILE,JSON.stringify({version:1,orders:[{...settled,refunds:'0.00'}]}));
    const [unsettled]=(await saleActivity(env,order)).rows;
    assert.equal(unsettled.refundStatus,refundStatus);
    assert.equal(unsettled.profit,undefined);
  }
});

test('Amazon reports an actual charge with bounded public catalog lines and quantities, never a sale profit',async t=>{
  const files=await privateInputs(t,[{source:'amazon',id:'B000ABC123',name:'Portable audio',model:'ABC-123',type:'Speaker'}]);
  const tx={transactionId:'private-charge',transactionType:'CHARGE',transactionDate:when,
    amount:{currencyCode:'GBP',amount:'89.97'},transactionLineItems:[
      {asin:'B000ABC123',productTitle:'Source title',itemQuantity:2,unspsc:'52161500',orderId:'private-order',budgetId:'private-budget'},
      ...Array.from({length:12},()=>({asin:'B000XYZ456',productTitle:'Keyboard',itemQuantity:1,unspsc:'43211706',
        merchantLegalName:'private supplier',businessOrderInfo:{model:'private account ref'}})),
    ]};
  const fetcher=async url=>url.includes('auth/o2/token')?ok({access_token:'token',expires_in:3600}):ok({transactions:[tx,{...tx,transactionType:'REFUND'}]});
  const read=(env)=>createTradingActivity({env:{...amazonEnv,...files,...env},now:()=>time,fetcher}).get('amazon');
  const [row]=(await read({DROPSHIPPING_PUBLIC_DETAILS:'1'})).rows;
  assert.equal(row.side,'buy');
  assert.equal(row.amount,'89.97');
  assert.equal(row.unit,'GBP');
  assert.equal(row.profit,undefined);
  assert.equal(row.productCount,13);
  assert.equal(row.products.length,12);
  assert.deepEqual(row.products[0],{name:'Portable audio',model:'ABC-123',type:'Speaker',quantity:2});
  assert.deepEqual(row.products[1],{name:'Keyboard',model:null,type:'UNSPSC 43211706',quantity:1});
  assert.doesNotMatch(JSON.stringify(row),/private|B000ABC123|B000XYZ456/);
  assert.equal((await read({})).rows[0].products,undefined);
  assert.equal((await read({AMAZON_BUSINESS_PUBLIC_ACTIVITY:'0',DROPSHIPPING_PUBLIC_DETAILS:'1'})).status,'not_configured');
});
