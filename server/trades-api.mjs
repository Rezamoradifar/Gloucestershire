import http from 'node:http';
import {createMarketplace} from './marketplace.mjs';
import {realpathSync} from 'node:fs';
import {createCommunity} from './community.mjs';
import {pathToFileURL} from 'node:url';
import {Block,Contract,FetchRequest,Interface,JsonRpcProvider,ZeroAddress,formatUnits,isAddress,getAddress} from 'ethers';
import {getCompleteLogs} from '../scripts/complete-rpc-logs.mjs';
import {createAutomationStatusReader} from './automation-status.mjs';
import {createHistoryRelay} from './history-relay.mjs';
import {createTeamRelay} from './team-relay.mjs';

const eventAbi=['event SaleSettled(bytes32 indexed id,address indexed seller,address indexed asset,uint256 grossProfit,uint256 salesUsd,bytes32 evidenceHash)'];
const iface=new Interface(eventAbi);
const source='contract-sales-settlements';
const integer=(value,fallback,min,max)=>{const n=Number(value??fallback);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid API configuration');return n;};
export function readConfig(env=process.env){
 const chainId=integer(env.TRADES_CHAIN_ID,97,1,1000);if(![56,97].includes(chainId))throw Error('Unsupported chain');
 const address=(env.TRADES_VAULT_ADDRESS||'').trim();const primary=(env.TRADES_RPC_URL||'').trim();
 let extra=[];try{extra=env.TRADES_RPC_URLS?JSON.parse(env.TRADES_RPC_URLS):[];}catch{throw Error('Invalid RPC candidates');}
 if(!Array.isArray(extra)||extra.length>4||extra.some(value=>typeof value!=='string'||!value.trim()))throw Error('Invalid RPC candidates');
 const rpcUrls=[...new Set([primary,...extra.map(value=>value.trim())].filter(Boolean))];
 if(rpcUrls.length>4)throw Error('Too many RPC candidates');
 const rpcUrl=rpcUrls[0]||'';
 if(address&&(!isAddress(address)||address.toLowerCase()===ZeroAddress))throw Error('Invalid contract address');
 for(const url of rpcUrls){try{if(!['http:','https:'].includes(new URL(url).protocol))throw Error();}catch{throw Error('Invalid RPC protocol');}}
 return {chainId,address:address?getAddress(address):'',rpcUrl,rpcUrls,confirmations:integer(env.TRADES_CONFIRMATIONS,3,1,100),lookback:integer(env.TRADES_LOOKBACK_BLOCKS,2000,1,20000),startBlock:integer(env.TRADES_START_BLOCK,0,0,Number.MAX_SAFE_INTEGER),pageSize:integer(env.TRADES_LOG_PAGE_SIZE,500,1,1000),port:integer(env.TRADES_PORT,3115,1024,65535)};
}
export function createApiReadProvider(config,{timeoutMs=8000}={}){
 const urls=config.rpcUrls?.length?config.rpcUrls:[config.rpcUrl].filter(Boolean);
 if(!urls.length)return null;
 timeoutMs=integer(timeoutMs,8000,1,60000);
 const address=getAddress(config.address),chainId=BigInt(config.chainId);
 // The private transports use a fixed formatting network to avoid ethers'
 // unbounded bootstrap retries. Actual chain identity is checked on every read.
 const providers=urls.map(url=>{const request=new FetchRequest(url);request.timeout=timeoutMs;
  return new JsonRpcProvider(request,config.chainId,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});});
 const unavailable=()=>Object.assign(Error('API read unavailable'),{code:'API_READ_UNAVAILABLE'});
 const pending=new Set();let destroyed=false;
 async function candidate(provider,method,args){
  let expired=false,timer,cancel;
  const deadline=new Promise((_,reject)=>{cancel=()=>{expired=true;reject(unavailable());};timer=setTimeout(cancel,timeoutMs);timer.unref?.();});
  pending.add(cancel);
  const assertOpen=()=>{if(expired||destroyed)throw unavailable();};
  try{return await Promise.race([deadline,(async()=>{
   assertOpen();
   const actualChain=await provider.send('eth_chainId',[]);assertOpen();
   if(BigInt(actualChain)!==chainId)throw unavailable();
   const code=await provider.getCode(address);assertOpen();
   if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code))throw unavailable();
   const result=await provider[method](...args);assertOpen();
   if(method==='getBlock'){
    if(!result)throw unavailable();
    return new Block({...result,transactions:args[1]?result.prefetchedTransactions:result.transactions},runner);
   }
   return result;
  })()]);}finally{expired=true;clearTimeout(timer);pending.delete(cancel);}
 }
 async function read(method,args){
  if(destroyed)throw unavailable();
  try{const result=await Promise.any(providers.map(provider=>candidate(provider,method,args)));
   if(destroyed)throw unavailable();return result;
  }catch{throw unavailable();}
 }
 const runner={
  getNetwork:()=>read('getNetwork',[]),getBlockNumber:()=>read('getBlockNumber',[]),
  getBlock:(...args)=>read('getBlock',args),getCode:(...args)=>read('getCode',args),call:(...args)=>read('call',args),
  async resolveName(value){if(destroyed||!isAddress(value))throw unavailable();return getAddress(value);},
  destroy(){if(destroyed)return;destroyed=true;for(const cancel of pending)cancel();for(const provider of providers)provider.destroy();}
 };
 runner.provider=runner;return Object.freeze(runner);
}
export function createTradeFeed(config,{provider,providers,metadata,now=Date.now,ttlMs=15000}={}){
 const urls=config.rpcUrls?.length?config.rpcUrls:[config.rpcUrl].filter(Boolean);
 // Race entire verified snapshots, not individual log pages. A broken primary
 // cannot strand a healthy fallback, and no snapshot mixes two RPC histories.
 if((!provider&&urls.length>1)||providers?.length>1){
  const feeds=(providers||urls).map((candidate,index)=>createTradeFeed({...config,rpcUrl:urls[index]||config.rpcUrl,rpcUrls:[]},
   {provider:providers?candidate:undefined,metadata,now,ttlMs}));
  let inflight,cached,response,expires=0;
  return {configured:feeds.every(feed=>feed.configured),publicConfig:feeds[0].publicConfig,
   async get(){
    if(response&&now()<expires)return response;if(inflight)return inflight;
    inflight=(async()=>{
     try{cached=await Promise.any(feeds.map(async feed=>{const result=await feed.get();if(result.status!=='live')throw result;return result;}));response=cached;}
     catch(error){const snapshots=(error.errors||[]).filter(value=>value?.status==='stale').sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
      const previous=cached||snapshots[0];response=previous?{...previous,status:'stale',message:'Connection interrupted. Showing the last confirmed snapshot.'}:
       {source,chainId:config.chainId,testnet:config.chainId===97,contract:config.address||null,requiredConfirmations:config.confirmations,status:'unavailable',trades:[],updatedAt:null,message:'The contract feed is temporarily unavailable.'};}
     expires=now()+ttlMs;return response;
    })().finally(()=>{inflight=null;});return inflight;
   },close(){for(const feed of feeds)feed.close();}};
 }
 let cached,expires=0,inflight;
 const configured=Boolean(config.rpcUrl&&config.address);
 if(configured&&!provider){const request=new FetchRequest(config.rpcUrl);request.timeout=8000;provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});}
 const base={source,chainId:config.chainId,testnet:config.chainId===97,contract:config.address||null,requiredConfirmations:config.confirmations};
 async function refresh(){
  if(!configured)return {...base,status:'not_configured',trades:[],updatedAt:null,message:'The verified contract feed has not been connected yet.'};
  try{
   const network=await provider.getNetwork();if(Number(network.chainId)!==config.chainId)throw Error('Wrong chain');
   if(await provider.getCode(config.address)==='0x')throw Error('Contract unavailable');
   const vault=new Contract(config.address,['function usdt() view returns(address)','function tokenDecimals() view returns(uint8)'],provider);
   const [token,decimals]=metadata?await metadata():await Promise.all([vault.usdt(),vault.tokenDecimals()]);
   if(!isAddress(token)||!Number.isInteger(Number(decimals))||Number(decimals)<0||Number(decimals)>18)throw Error('Invalid asset');
   const head=await provider.getBlockNumber();const toBlock=head-config.confirmations;
   const fromBlock=Math.max(config.startBlock,Math.max(0,toBlock-config.lookback+1));
   const trades=[],seen=new Set(),blocks=new Map();
   for(let end=toBlock;end>=fromBlock&&trades.length<100;){
    const start=Math.max(fromBlock,end-config.pageSize+1);
    const logs=await getCompleteLogs({provider,filter:{address:config.address,topics:[iface.getEvent('SaleSettled').topicHash],fromBlock:start,toBlock:end}});
    logs.sort((a,b)=>b.blockNumber-a.blockNumber||b.index-a.index);
    for(const log of logs){
     if(log.removed||log.address.toLowerCase()!==config.address.toLowerCase()||log.blockNumber<start||log.blockNumber>end)continue;
     const key=log.transactionHash+':'+log.index;if(seen.has(key))continue;seen.add(key);
     const parsed=iface.parseLog(log);if(!parsed)continue;
     const a=parsed.args,native=a.asset===ZeroAddress;
     if(!native&&a.asset.toLowerCase()!==token.toLowerCase())throw Error('Unknown settlement asset');
     if(!blocks.has(log.blockNumber))blocks.set(log.blockNumber,await provider.getBlock(log.blockNumber));
     const block=blocks.get(log.blockNumber);if(!block||block.hash!==log.blockHash)throw Error('Chain changed while reading');
     trades.push({id:key,settlementId:a.id,seller:a.seller,asset:native?'BNB':'USDT',grossProfit:formatUnits(a.grossProfit,native?18:Number(decimals)),salesUsd:formatUnits(a.salesUsd,18),evidenceHash:a.evidenceHash,transactionHash:log.transactionHash,logIndex:log.index,blockNumber:log.blockNumber,timestamp:new Date(Number(block.timestamp)*1000).toISOString(),confirmations:head-log.blockNumber,explorerUrl:`https://${config.chainId===97?'testnet.':''}bscscan.com/tx/${log.transactionHash}`});
     if(trades.length===100)break;
    }
    end=start-1;
   }
   cached={...base,status:'live',trades,updatedAt:new Date(now()).toISOString(),latestBlock:head,confirmedThrough:toBlock,windowStart:fromBlock,message:'Confirmed on-chain sales settlements. Reported sales are not independent proof of marketplace orders.'};
   return cached;
  }catch{
   return {...base,...(cached||{trades:[],updatedAt:null}),status:cached?'stale':'unavailable',message:cached?'Connection interrupted. Showing the last confirmed snapshot.':'The contract feed is temporarily unavailable.'};
  }
 }
 let response;
 return {configured,publicConfig:{version:1,chainId:config.chainId,vaultAddress:config.address||null},async get(){if(response&&now()<expires)return response;if(inflight)return inflight;inflight=refresh().then(value=>{response=value;expires=now()+ttlMs;return value;}).finally(()=>{inflight=null;});return inflight;},close(){provider?.destroy?.();}};
}
export function createApiServer(feed,{responseTimeoutMs=10000,community,marketplace=createMarketplace(),migration,dailyActivity,historyRelay,teamRelay,automationStatus=createAutomationStatusReader({chainId:feed.publicConfig?.chainId,vaultAddress:feed.publicConfig?.vaultAddress})}={}){
 return http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
  if(community&&await community(req,res))return;
  if(dailyActivity&&await dailyActivity(req,res))return;
  if(req.method!=='GET'){res.setHeader('Allow','GET');return send(405,{error:'Method not allowed'});}
  const url=new URL(req.url,'http://localhost');
  if(migration&&await migration(req,res,url))return;
  if(await marketplace(req,res,url))return;
  if(url.pathname==='/api/event-history/window'){
   if(!historyRelay)return send(503,{error:'Verified history service is not configured.'});
   try{return send(200,await historyRelay.get(url.searchParams));}
   catch(error){
    return send(error?.code==='HISTORY_RELAY_BAD_REQUEST'?400:503,{
     error:error?.code==='HISTORY_RELAY_BAD_REQUEST'?
      'Invalid verified history query.':'Verified history is temporarily unavailable.'});
   }
  }
  if(['/api/team/registrations','/api/team/member','/api/team/volume'].includes(url.pathname)){
   if(!teamRelay)return send(503,{error:'Verified team service is not configured.'});
   try{
    const params=new URLSearchParams(url.searchParams);
    const isRegistrations=url.pathname.endsWith('/registrations');
    const isVolume=url.pathname.endsWith('/volume');
    if(isRegistrations?(!params.has('parent')||params.has('wallet')):(!params.has('wallet')||params.has('parent')))
     return send(400,{error:'Invalid team query.'});
    if(isVolume)params.set('mode','volume');
    return send(200,await teamRelay.get(params));
   }catch(error){return send(error?.code==='TEAM_RELAY_BAD_REQUEST'?400:503,{error:error?.code==='TEAM_RELAY_BAD_REQUEST'?'Invalid team query.':'Verified team RPC is temporarily unavailable.'});}
  }
  if(url.pathname==='/api/config')return send(feed.configured&&feed.publicConfig?200:503,feed.configured&&feed.publicConfig?feed.publicConfig:{error:'Contract not configured'});
  if(url.pathname==='/api/health')return send(200,{status:'ok',configured:feed.configured,source});
  if(url.pathname==='/api/automation/status'){
   const status=await automationStatus();return send(['unavailable','stale'].includes(status.status)?503:200,status);
  }
  if(url.pathname!=='/api/trades')return send(404,{error:'Not found'});
  let limit;try{limit=integer(url.searchParams.get('limit')??20,20,1,100);}catch{return send(400,{error:'limit must be an integer from 1 to 100'});}
  let timer;
  try{
   const result=await Promise.race([feed.get(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Feed deadline')),responseTimeoutMs);})]);
   if(!res.destroyed)send(['live','stale'].includes(result.status)?200:503,{...result,trades:result.trades.slice(0,limit)});
  }catch{if(!res.destroyed)send(503,{status:'unavailable',source,trades:[],updatedAt:null});}
  finally{clearTimeout(timer);}
 });
}
async function configuredCommunity(config){
 const provider=config.rpcUrl&&config.address?createApiReadProvider(config):null;
 const vault=provider?new Contract(config.address,['function owner() view returns(address)'],provider):null;
 const handler=await createCommunity({file:process.env.COMMUNITY_DATA_FILE||'/var/lib/globaldroptrade-api/community.json',chainId:config.chainId,contract:config.address,owner:async()=>{if(!vault)throw Error('Contract not configured');if(Number((await provider.getNetwork()).chainId)!==config.chainId)throw Error('Wrong chain');return vault.owner();}});
 handler.close=()=>provider?.destroy();return handler;
}
async function configuredDailyActivity(config){
 if(!config.rpcUrl||!config.address)return null;
 const {createDailyActivity}=await import('./daily-activity.mjs');
 const provider=createApiReadProvider(config),vault=new Contract(config.address,['function users(address) view returns(address referrer,bool registered,bool active,bool vipKyc,uint32 activeDirect,uint256 capitalUsd,uint256 salesUsd)'],provider);
 const file=process.env.DAILY_ACTIVITY_FILE||'/var/lib/globaldroptrade-api/daily-activity.json';
 const origin=process.env.DAILY_ACTIVITY_ORIGIN||'https://globaldroptrade.com';
 const activation=process.env.DAILY_ACTIVITY_ACTIVATION_TIMESTAMP;
 const policy=activation?{version:1,chainId:config.chainId,vaultAddress:config.address,origin,windowSeconds:86400,activationTimestamp:integer(activation,0,1,Number.MAX_SAFE_INTEGER),historyFile:file}:undefined;
 try{const handler=await createDailyActivity({file,chainId:config.chainId,contract:config.address,origin,provider,vault,policy,confirmations:Math.max(3,config.confirmations),trustProxy:process.env.DAILY_ACTIVITY_TRUST_PROXY_IP==='1'});handler.close=()=>provider.destroy();return handler;}
 catch(error){provider.destroy();throw error;}
}
// Stdin and eval callers may have no filesystem entrypoint. Imports must stay inert.
let entrypoint;
try{if(process.argv[1]&&process.argv[1]!=='-')entrypoint=pathToFileURL(realpathSync(process.argv[1])).href;}catch{}
if(import.meta.url===entrypoint){
 try{const config=readConfig();const feed=createTradeFeed(config);const [community,dailyActivity]=await Promise.all([configuredCommunity(config),configuredDailyActivity(config)]);const {createMigrationService}=await import('./migration-service.mjs');const migration=createMigrationService(config,{allowLegacy:process.env.GLOBAL_MIGRATION_ENABLED!=='false'});const automationStatus=createAutomationStatusReader({file:process.env.GLOBAL_AUTOMATION_PUBLIC_STATUS,chainId:config.chainId,vaultAddress:config.address});const historyRelay=createHistoryRelay(config);const teamRelay=createTeamRelay(config);const server=createApiServer(feed,{community,migration,dailyActivity,historyRelay,teamRelay,automationStatus});server.listen(config.port,'127.0.0.1',()=>console.log(`Global settlement API listening on 127.0.0.1:${config.port}; configured=${feed.configured}`));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>{feed.close();community.close?.();dailyActivity?.close?.();historyRelay.close();teamRelay.close();migration.close();process.exit(0);});});}catch(e){console.error('Settlement/support API startup failed:',e.code||e.name||'Unknown error');process.exitCode=1;}
}
