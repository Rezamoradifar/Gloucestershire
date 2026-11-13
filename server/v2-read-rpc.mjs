// Strictly read-only same-origin BNB Testnet V2 gateway.
// The former contract, keys, financial journals and balances are never queried or changed.
import {FetchRequest,JsonRpcProvider,keccak256,getAddress,isAddress} from 'ethers';

export const V2_RPC_CHAIN=97;
export const V2_RPC_VAULT=getAddress('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
export const V2_RPC_TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
export const V2_RPC_CODE_HASH='0x3e1f99305bf7edbb12d4d9870124f84ece95bb23b6bf890470e94d06a336bf99';
export const V2_RPC_DEPLOY_BLOCK=142416836;
export const V2_RPC_SOURCES=Object.freeze([
 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
 'https://bsc-testnet-dataseed.bnbchain.org',
 'https://bsc-testnet-rpc.publicnode.com'
]);


// Server tools use separate V2 RPC connections and never inherit the retired
// vault's TRADES_RPC_URL, which can be 403 or have a different service policy.
export async function openVerifiedV2ReadProvider({preferred=process.env.GLOBAL_V2_RPC_URL,
 sources=V2_RPC_SOURCES,timeoutMs=10000}={}){
 const urls=[...new Set([preferred,...sources].filter(Boolean))];
 if(!urls.length||urls.some(url=>typeof url!=='string'||!url.startsWith('https://')))
  throw Error('V2_VERIFIED_RPC_CONFIG_INVALID');
 for(const url of urls){
  let provider;
  try{
   const request=new FetchRequest(url);request.timeout=timeoutMs;
   provider=new JsonRpcProvider(request,V2_RPC_CHAIN,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
   const [chain,code]=await Promise.all([
    provider.send('eth_chainId',[]),provider.getCode(V2_RPC_VAULT,'latest')
   ]);
   if(Number(BigInt(chain))!==97||code==='0x'||keccak256(code).toLowerCase()!==V2_RPC_CODE_HASH)
    throw Error('V2_VERIFIED_RPC_IDENTITY_MISMATCH');
   return provider;
  }catch{provider?.destroy();}
 }
 throw Error('V2_READ_RPC_ALL_SOURCES_UNAVAILABLE');
}

const invalid=()=>Object.assign(Error('Invalid V2 read request.'),{status:400});
const hex=(value,max=8192)=>typeof value==='string'&&/^0x(?:[0-9a-fA-F]{2})*$/.test(value)&&value.length<=max;
const idOK=value=>(Number.isSafeInteger(value)&&value>=0&&value<1e9)||
 (typeof value==='string'&&/^[a-zA-Z0-9_-]{1,40}$/.test(value));
const blockTag=value=>
 value==='latest'||value==='safe'||value==='finalized'||
 (typeof value==='string'&&/^0x[0-9a-fA-F]{1,16}$/.test(value)&&BigInt(value)>=BigInt(V2_RPC_DEPLOY_BLOCK));
const pair=(value)=>Array.isArray(value)&&value.length===2;
function same(a,b){return typeof a==='string'&&isAddress(a)&&getAddress(a)===b;}

// Only ordinary reads. Never accept eth_send*, personal_sign, eth_estimateGas,
// arbitrary-contract calls, custom URLs, state overrides, wallet keys or batches.
export function validateV2ReadRequest(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.jsonrpc!=='2.0'||
  !idOK(value.id)||typeof value.method!=='string'||!Array.isArray(value.params))throw invalid();
 const p=value.params,m=value.method;
 if(m==='eth_chainId'||m==='eth_blockNumber'){
  if(p.length)throw invalid();
 }else if(m==='eth_getBlockByNumber'){
  if(!pair(p)||!blockTag(p[0])||p[1]!==false)throw invalid();
 }else if(m==='eth_getCode'){
  if(!pair(p)||!same(p[0],V2_RPC_VAULT)||p[1]!=='latest')throw invalid();
 }else if(m==='eth_call'){
  if(!pair(p)||!p[0]||typeof p[0]!=='object'||Array.isArray(p[0])||
   !Object.keys(p[0]).every(key=>['to','data'].includes(key))||
   !(same(p[0].to,V2_RPC_VAULT)||same(p[0].to,V2_RPC_TOKEN))||
   !hex(p[0].data,4098)||!blockTag(p[1]))throw invalid();
 }else if(m==='eth_getLogs'){
  if(p.length!==1||!p[0]||typeof p[0]!=='object'||Array.isArray(p[0]))throw invalid();
  const q=p[0];
  if(!Object.keys(q).every(key=>['address','fromBlock','toBlock','topics'].includes(key))||
   !same(q.address,V2_RPC_VAULT)||!blockTag(q.fromBlock)||!blockTag(q.toBlock)||
   q.fromBlock==='latest'||q.toBlock==='latest'||q.fromBlock==='safe'||q.toBlock==='safe'||
   q.fromBlock==='finalized'||q.toBlock==='finalized')throw invalid();
  const from=BigInt(q.fromBlock),to=BigInt(q.toBlock);
  if(to<from||to-from>1799n)throw invalid();
  if(q.topics!==undefined){
   if(!Array.isArray(q.topics)||q.topics.length>4||
    !q.topics.every(item=>item===null||
     (typeof item==='string'&&/^0x[0-9a-fA-F]{64}$/.test(item))||
     (Array.isArray(item)&&item.length<=8&&item.every(x=>typeof x==='string'&&/^0x[0-9a-fA-F]{64}$/.test(x)))))throw invalid();
  }
 }else throw invalid();
 return {jsonrpc:'2.0',id:value.id,method:m,params:p};
}

async function readBody(req){
 let size=0,text='';
 for await(const chunk of req){
  size+=chunk.length;
  if(size>8192)throw Object.assign(Error('Request too large.'),{status:413});
  text+=chunk;
 }
 try{return JSON.parse(text);}catch{throw invalid();}
}

export function createV2ReadGateway({sources=V2_RPC_SOURCES,fetcher=fetch,now=Date.now,perMinute=240}={}){
 if(!Array.isArray(sources)||!sources.length||sources.length>5||
  sources.some(url=>typeof url!=='string'||!url.startsWith('https://')))throw Error('V2_RPC_SOURCE_LIST_INVALID');
 const verified=new Map(),rates=new Map();
 async function call(url,method,params){
  const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(6500)});
  if(!response.ok)throw Error('V2_RPC_UPSTREAM_HTTP_ERROR');
  const value=await response.json();
  if(!value||value.error||!('result' in value))throw Error('V2_RPC_UPSTREAM_RESULT_ERROR');
  return value.result;
 }
 async function trusted(url){
  const until=verified.get(url)||0;
  if(until>now())return;
  const [chain,code]=await Promise.all([
   call(url,'eth_chainId',[]),call(url,'eth_getCode',[V2_RPC_VAULT,'latest'])
  ]);
  if(Number(BigInt(chain))!==97||typeof code!=='string'||code==='0x'||
   keccak256(code).toLowerCase()!==V2_RPC_CODE_HASH)throw Error('V2_RPC_TARGET_MISMATCH');
  verified.set(url,now()+25000);
 }
 async function dispatch(method,params){
  // Sequential failover avoids multiplying public RPC traffic for each wallet read.
  for(const url of sources){
   try{
    await trusted(url);
    const value=await call(url,method,params);
    if(method==='eth_chainId'&&Number(BigInt(value))!==97)throw Error('Wrong chain');
    if(method==='eth_getCode'&&keccak256(value).toLowerCase()!==V2_RPC_CODE_HASH)
     throw Error('Different contract code');
    if(method==='eth_getLogs'){
     if(!Array.isArray(value)||value.length>1500||
      value.some(item=>!same(item.address,V2_RPC_VAULT)))throw Error('Invalid returned logs');
    }
    return value;
   }catch{verified.delete(url);}
  }
  throw Object.assign(Error('V2 read RPC unavailable.'),{status:503});
 }
 return async function v2ReadGateway(req,res){
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname!=='/api/v2/rpc')return false;
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  const send=(code,data)=>{res.writeHead(code);res.end(JSON.stringify(data));};
  if(req.method!=='POST'){res.setHeader('Allow','POST');send(405,{error:'POST only'});return true;}
  const ip=String(req.socket?.remoteAddress||'unknown');
  const current=now();
  if(rates.size>5000)for(const [key,r] of rates)if(r.expires<current)rates.delete(key);
  const rate=rates.get(ip)||{count:0,expires:current+60000};
  if(current>rate.expires){rate.count=0;rate.expires=current+60000;}
  rate.count++;rates.set(ip,rate);
  if(rate.count>perMinute){send(429,{error:'V2 read RPC rate limited.'});return true;}
  let request;
  try{request=validateV2ReadRequest(await readBody(req));}
  catch(error){send(error.status||400,{error:'Invalid V2 read request.'});return true;}
  try{
   const result=await dispatch(request.method,request.params);
   send(200,{jsonrpc:'2.0',id:request.id,result});
  }catch{send(503,{jsonrpc:'2.0',id:request.id,
    error:{code:-32000,message:'V2 testnet read service unavailable; retry later.'}});}
  return true;
 };
}
