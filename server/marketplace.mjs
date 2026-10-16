// Official catalog APIs only. No scraping, synthetic sales, or order placement.
const safeUrl=(value,hosts)=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:null;}catch{return null;}};
const money=(value,currency)=>typeof value!=='undefined'&&/^\d+(\.\d+)?$/.test(String(value))&&/^[A-Z]{3}$/.test(currency)?{amount:String(value),currency}:null;
const text=(value,max=250)=>typeof value==='string'?value.slice(0,max):'';
export function normalizeAmazon(item){
 const offer=item?.offersV2?.listings?.find(x=>x.isBuyBoxWinner)||item?.offersV2?.listings?.[0];
 const url=safeUrl(item?.detailPageURL,['amazon.com']);
 if(!item?.asin||!item?.itemInfo?.title?.displayValue||!url)return null;
 return {id:'amazon:'+text(item.asin),provider:'amazon',title:text(item.itemInfo.title.displayValue),url,image:safeUrl(item.images?.primary?.large?.url,['media-amazon.com','ssl-images-amazon.com']),price:offer?.violatesMAP?null:money(offer?.price?.money?.amount,offer?.price?.money?.currency),condition:text(offer?.condition?.value,60)};
}
export function normalizeEbay(item){
 const url=safeUrl(item?.itemWebUrl,['ebay.com']);
 if(!item?.itemId||!item?.title||!url)return null;
 return {id:'ebay:'+text(item.itemId),provider:'ebay',title:text(item.title),url,image:safeUrl(item.image?.imageUrl,['ebayimg.com']),price:money(item.price?.value,item.price?.currency),condition:text(item.condition,60)};
}
export function createMarketplace({env=process.env,fetcher=fetch,now=Date.now}={}){
 const credentials={amazon:!!(env.AMAZON_CLIENT_ID&&env.AMAZON_CLIENT_SECRET&&env.AMAZON_PARTNER_TAG),ebay:!!(env.EBAY_CLIENT_ID&&env.EBAY_CLIENT_SECRET)};
 const tokens=new Map(),tokenJobs=new Map(),cache=new Map(),pending=new Map(),budgets=new Map();
 const maxDaily=Math.max(1,Math.min(2000,Number(env.MARKETPLACE_DAILY_LIMIT)||500));
 async function request(url,options={}){
  const response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(4500)});
  if(!response.ok){const error=Error('Provider request failed');error.status=response.status;throw error;}
  return response.json();
 }
 async function token(provider){
  const stored=tokens.get(provider);if(stored&&stored.expires>now())return stored.value;
  if(tokenJobs.has(provider))return tokenJobs.get(provider);
  const job=(async()=>{
   const amazon=provider==='amazon';
   const result=await request(amazon?'https://api.amazon.com/auth/o2/token':'https://api.ebay.com/identity/v1/oauth2/token',{
    method:'POST',headers:amazon?{'Content-Type':'application/json'}:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(env.EBAY_CLIENT_ID+':'+env.EBAY_CLIENT_SECRET).toString('base64')},
    body:amazon?JSON.stringify({grant_type:'client_credentials',client_id:env.AMAZON_CLIENT_ID,client_secret:env.AMAZON_CLIENT_SECRET,scope:'creatorsapi::default'}):new URLSearchParams({grant_type:'client_credentials',scope:'https://api.ebay.com/oauth/api_scope'}).toString()
   });
   if(typeof result.access_token!=='string'||!Number.isFinite(Number(result.expires_in)))throw Error('Invalid token');
   tokens.set(provider,{value:result.access_token,expires:now()+Math.max(0,Number(result.expires_in)-60)*1000});return result.access_token;
  })().finally(()=>tokenJobs.delete(provider));tokenJobs.set(provider,job);return job;
 }
 async function search(provider,q,sort){
  const base={provider,status:'not_configured',items:[],updatedAt:null};
  if(!credentials[provider])return base;
  const key=JSON.stringify([provider,q.toLowerCase(),sort]);
  const existing=cache.get(key);if(existing&&existing.expires>now())return existing.value;
  if(pending.has(key))return pending.get(key);
  const job=(async()=>{
   const day=Math.floor(now()/86400000);let budget=budgets.get(provider);
   if(!budget||budget.day!==day){budget={day,count:0,next:0};budgets.set(provider,budget);}
   // Bound public endpoint quota usage globally, independent of spoofable IP headers.
   if(budget.count>=maxDaily||budget.next>now())return {...base,status:'rate_limited'};
   budget.count++;budget.next=now()+1100;
   let value;
   try{
    const bearer=await token(provider);let result,items;
    if(provider==='amazon'){
     result=await request('https://creatorsapi.amazon/catalog/v1/searchItems',{method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json','x-marketplace':'www.amazon.com'},body:JSON.stringify({keywords:q,itemCount:8,partnerTag:env.AMAZON_PARTNER_TAG,marketplace:'www.amazon.com',sortBy:sort==='price'?'Price:LowToHigh':'Relevance',resources:['images.primary.large','itemInfo.title','offersV2.listings.price','offersV2.listings.condition','offersV2.listings.isBuyBoxWinner']})});
     if(!Array.isArray(result.searchResult?.items)){if(result.searchResult?.totalResultCount===0)items=[];else throw Error('Invalid catalog');}else items=result.searchResult.items.map(normalizeAmazon).filter(Boolean);
    }else{
     const query=new URLSearchParams({q,limit:'8'});if(sort==='price')query.set('sort','price');
     result=await request('https://api.ebay.com/buy/browse/v1/item_summary/search?'+query,{headers:{Authorization:'Bearer '+bearer,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US'}});
     if(!Array.isArray(result.itemSummaries)&&result.total!==0)throw Error('Invalid catalog');items=(result.itemSummaries||[]).map(normalizeEbay).filter(Boolean);
    }
    value={provider,status:'live',items:items.slice(0,8),updatedAt:new Date(now()).toISOString()};
   }catch(error){
    if(error.status===401)tokens.delete(provider);
    if(error.status===429)budget.next=now()+60000;
    value={...base,status:error.status===429?'rate_limited':'unavailable'};
   }
   if(cache.size>=100)cache.delete(cache.keys().next().value);
   cache.set(key,{value,expires:now()+(value.status==='live'?60000:15000)});return value;
  })().finally(()=>pending.delete(key));pending.set(key,job);return job;
 }
 return async(req,res,url)=>{
  if(url.pathname!=='/api/marketplace')return false;
  const send=(code,data)=>{res.writeHead(code);res.end(JSON.stringify(data));return true;};
  const provider=url.searchParams.get('provider')||'all',q=(url.searchParams.get('q')||'wireless headphones').trim(),sort=url.searchParams.get('sort')||'relevance';
  if(!['all','amazon','ebay'].includes(provider)||q.length<2||q.length>80||/[\u0000-\u001f]/.test(q)||!['relevance','price'].includes(sort))return send(400,{error:'Invalid search parameters'});
  const providers=await Promise.all((provider==='all'?['amazon','ebay']:[provider]).map(p=>search(p,q,sort)));
  return send(200,{query:q,market:'US',providers,checkout:'merchant',ordersAvailable:false});
 };
}
