import http from 'node:http';
import {createMarketplace} from './marketplace.mjs';
import {realpathSync} from 'node:fs';
import {createCommunity} from './community.mjs';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,Interface,JsonRpcProvider,ZeroAddress,formatUnits,isAddress,getAddress} from 'ethers';

const eventAbi=['event SaleSettled(bytes32 indexed id,address indexed seller,address indexed asset,uint256 grossProfit,uint256 salesUsd,bytes32 evidenceHash)'];
const iface=new Interface(eventAbi);
const source='contract-sales-settlements';
const integer=(value,fallback,min,max)=>{const n=Number(value??fallback);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid API configuration');return n;};
export function readConfig(env=process.env){
 const chainId=integer(env.TRADES_CHAIN_ID,97,1,1000);if(![56,97].includes(chainId))throw Error('Unsupported chain');
 const address=(env.TRADES_VAULT_ADDRESS||'').trim();const rpcUrl=(env.TRADES_RPC_URL||'').trim();
 if(address&&(!isAddress(address)||address.toLowerCase()===ZeroAddress))throw Error('Invalid contract address');
 if(rpcUrl&&!['http:','https:'].includes(new URL(rpcUrl).protocol))throw Error('Invalid RPC protocol');
 return {chainId,address:address?getAddress(address):'',rpcUrl,confirmations:integer(env.TRADES_CONFIRMATIONS,3,1,100),lookback:integer(env.TRADES_LOOKBACK_BLOCKS,2000,1,20000),startBlock:integer(env.TRADES_START_BLOCK,0,0,Number.MAX_SAFE_INTEGER),pageSize:integer(env.TRADES_LOG_PAGE_SIZE,500,1,1000),port:integer(env.TRADES_PORT,3115,1024,65535)};
}
export function createTradeFeed(config,{provider,metadata,now=Date.now,ttlMs=15000}={}){
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
    const logs=await provider.getLogs({address:config.address,topics:[iface.getEvent('SaleSettled').topicHash],fromBlock:start,toBlock:end});
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
export function createApiServer(feed,{responseTimeoutMs=10000,community,marketplace=createMarketplace(),migration}={}){
 return http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
  if(community&&await community(req,res))return;
  if(req.method!=='GET'){res.setHeader('Allow','GET');return send(405,{error:'Method not allowed'});}
  const url=new URL(req.url,'http://localhost');
  if(migration&&await migration(req,res,url))return;
  if(await marketplace(req,res,url))return;
  if(url.pathname==='/api/config')return send(feed.configured&&feed.publicConfig?200:503,feed.configured&&feed.publicConfig?feed.publicConfig:{error:'Contract not configured'});
  if(url.pathname==='/api/health')return send(200,{status:'ok',configured:feed.configured,source});
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
 const provider=config.rpcUrl&&config.address?new JsonRpcProvider(config.rpcUrl,undefined,{batchMaxCount:1}):null;
 const vault=provider?new Contract(config.address,['function owner() view returns(address)'],provider):null;
 return createCommunity({file:process.env.COMMUNITY_DATA_FILE||'/var/lib/globaldroptrade-api/community.json',chainId:config.chainId,contract:config.address,owner:async()=>{if(!vault)throw Error('Contract not configured');if(Number((await provider.getNetwork()).chainId)!==config.chainId)throw Error('Wrong chain');return vault.owner();}});
}
// Stdin and eval callers may have no filesystem entrypoint. Imports must stay inert.
let entrypoint;
try{if(process.argv[1]&&process.argv[1]!=='-')entrypoint=pathToFileURL(realpathSync(process.argv[1])).href;}catch{}
if(import.meta.url===entrypoint){
 try{const config=readConfig();const feed=createTradeFeed(config);const community=configuredCommunity(config);const {createMigrationService}=await import('./migration-service.mjs');const migration=createMigrationService(config,{allowLegacy:process.env.GLOBAL_MIGRATION_ENABLED!=='false'});const server=createApiServer(feed,{community:await community,migration});server.listen(config.port,'127.0.0.1',()=>console.log(`Global settlement API listening on 127.0.0.1:${config.port}; configured=${feed.configured}`));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>{feed.close();migration.close();process.exit(0);});});}catch(e){console.error('Settlement/support API startup failed:',e.code||e.name||'Unknown error');process.exitCode=1;}
}
