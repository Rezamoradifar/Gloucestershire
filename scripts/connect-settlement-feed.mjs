// Read-only connection preflight. Never opens wallet keys, signs, or broadcasts.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {Contract,FetchRequest,JsonRpcProvider,getAddress,parseEther} from 'ethers';
import {readConfig,createTradeFeed} from '../server/trades-api.mjs';

const rates=[[800,400,200,0],[1000,500,300,0],[1200,600,400,0],[1400,700,500,0],[1600,800,600,400]];
const goals=[500,1000,3000,5000,10000,30000,50000,100000,300000,500000,1000000,3000000,5000000,10000000];
const rewards=[35,70,210,350,700,1800,3000,6000,15000,25000,50000,90000,150000,300000];
const keys=['TRADES_RPC_URL','TRADES_CHAIN_ID','TRADES_VAULT_ADDRESS','TRADES_START_BLOCK','TRADES_CONFIRMATIONS','TRADES_LOOKBACK_BLOCKS','TRADES_LOG_PAGE_SIZE','TRADES_PORT'];
const readEnv=file=>fs.existsSync(file)?parseEnv(fs.readFileSync(file,'utf8')):{};

export function discoverSettings({source,installed={},env={},read=readEnv,exists=fs.existsSync,readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'))}){
 const current={...installed};
 for(const key of keys)if(env[key]?.trim())current[key]=env[key].trim();
 // An explicit or already active target takes precedence over historical reports.
 if(!current.TRADES_VAULT_ADDRESS){
  const web=Object.assign({},...['.env','.env.local','.env.production','.env.production.local'].map(name=>read(path.join(source,'website',name))));
  if(web.VITE_VAULT_ADDRESS?.trim()){
   current.TRADES_VAULT_ADDRESS=web.VITE_VAULT_ADDRESS.trim();
   current.TRADES_CHAIN_ID=web.VITE_CHAIN_ID||'97';
  }else{
   const reports=[];
   for(const [folder,chain]of [['.testnet-server',97],['.mainnet-server',56]]){
    const file=path.join(source,folder,'deployment-public.json');if(!exists(file))continue;
    const report=readJson(file);
    if(Number(report.chainId)!==chain||!report.contractAddress)throw Error('Invalid saved public deployment report.');
    reports.push({address:getAddress(report.contractAddress),chainId:chain});
   }
   if(reports.length>1)throw Error('Both testnet and mainnet reports exist. Set TRADES_CHAIN_ID and TRADES_VAULT_ADDRESS on the server to choose the intended target.');
   if(reports.length){current.TRADES_VAULT_ADDRESS=reports[0].address;current.TRADES_CHAIN_ID=String(reports[0].chainId);}
  }
 }
 if(current.TRADES_VAULT_ADDRESS&&!current.TRADES_CHAIN_ID)throw Error('Set the chain ID explicitly for this contract.');
 // A requested chain must never be silently replaced by a discovered report.
 if(env.TRADES_CHAIN_ID&&current.TRADES_CHAIN_ID!==env.TRADES_CHAIN_ID.trim())throw Error('Requested chain conflicts with the saved deployment target.');
 const old=read(path.join(source,'.env'));
 const rpcKey=Number(current.TRADES_CHAIN_ID)===56?'BSC_MAINNET_RPC':'BSC_TESTNET_RPC';
 current.TRADES_RPC_URL ||= env[rpcKey]||old[rpcKey]||'';
 current.TRADES_PORT='3115';
 return current;
}

export async function verifyConnection(config,{provider,feedFactory=createTradeFeed,contractFactory=(address,p)=>new Contract(address,[
 'function owner() view returns(address)',
 'function NETWORK_PLAN_VERSION() view returns(uint256)',
 'function tierConfig(uint256) view returns(tuple(uint256 minUsd,uint16 baseDailyBps,uint16 maxDailyBps,uint32 requiredDirect,uint256 requiredSalesUsd,uint16[4] referrals))',
 'function branchCapBps(uint256) view returns(uint16)',
 'function rewardStage(uint256) view returns(uint256,uint256)',
 ],p)}={}){
 if(!config.rpcUrl||!config.address)throw Error('RPC URL and contract address are required.');
 let owned=false,feed;
 if(!provider){const request=new FetchRequest(config.rpcUrl);request.timeout=8000;provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});owned=true;}
 try{
  feed=feedFactory(config,{provider});
  const snapshot=await feed.get();
  if(snapshot.status!=='live')throw Error('RPC connection check failed. Check the chain, contract address and eth_getLogs access; the previous configuration was not changed.');
  const vault=contractFactory(config.address,provider);
  let owner;
  try{owner=getAddress(await vault.owner());}catch{throw Error('The selected address does not expose the expected vault owner.');}
  let planMatches=false;
  try{
   const tiers=await Promise.all(rates.map((_,i)=>vault.tierConfig(i)));
   const caps=await Promise.all(['10000','100000','1000000'].map(n=>vault.branchCapBps(parseEther(n))));
   const stages=await Promise.all(goals.map((_,i)=>vault.rewardStage(i)));
   planMatches=tiers.every((t,i)=>Array.from(t.referrals,Number).every((n,j)=>n===rates[i][j]))&&caps.every((n,i)=>Number(n)===[6000,4500,3500][i])&&stages.every((s,i)=>s[0]===parseEther(String(goals[i]))&&s[1]===parseEther(String(rewards[i])));
  }catch{ /* Older immutable contracts remain readable; never call them upgraded. */ }
  let networkControlsSupported=false;
  try{networkControlsSupported=await vault.NETWORK_PLAN_VERSION()===2n;}catch{ /* A matching economic schedule does not imply guarded client methods exist. */ }
  return {chainId:config.chainId,contractAddress:config.address,owner,feedStatus:snapshot.status,latestBlock:snapshot.latestBlock,settlementsInWindow:snapshot.trades.length,requestedPlanChecksMatch:planMatches,networkControlsSupported,checkedAt:new Date().toISOString(),transactionsSent:0};
 }finally{if(owned)provider.destroy();}
}

export function renderSettings(original,settings){
 const retained=original.split(/\r?\n/).filter(line=>!keys.some(key=>new RegExp('^\\s*(?:export\\s+)?'+key+'\\s*=').test(line)));
 const values=keys.filter(key=>settings[key]!==undefined).map(key=>{
  const value=String(settings[key]);if(/[\r\n"'`\x00]/.test(value))throw Error('Unsupported characters in API settings.');
  return `${key}="${value}"`;
 });
 return retained.join('\n').trimEnd()+'\n'+values.join('\n')+'\n';
}

async function main(){
 const [sourceArg,outputArg]=process.argv.slice(2);
 if(!sourceArg||!outputArg)throw Error('Usage: node scripts/connect-settlement-feed.mjs EXISTING_PROJECT PRIVATE_OUTPUT_DIR');
 const source=path.resolve(sourceArg),output=path.resolve(outputArg),envfile='/etc/globaldroptrade/trades.env';
 const original=fs.existsSync(envfile)?fs.readFileSync(envfile,'utf8'):'';
 const settings=discoverSettings({source,installed:parseEnv(original),env:process.env});
 if(process.stdin.isTTY){
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try{
   if(!settings.TRADES_CHAIN_ID)settings.TRADES_CHAIN_ID=(await rl.question('Chain ID (97 testnet / 56 mainnet, read-only): ')).trim();
   if(!settings.TRADES_VAULT_ADDRESS)settings.TRADES_VAULT_ADDRESS=(await rl.question('Existing Global vault contract address: ')).trim();
   if(!settings.TRADES_RPC_URL)settings.TRADES_RPC_URL=(await rl.question('Read-only RPC URL with eth_getLogs access (enter only on this server): ')).trim();
  }finally{rl.close();}
 }
 if(!settings.TRADES_VAULT_ADDRESS||!settings.TRADES_RPC_URL)throw Error('Missing connection settings. Run interactively on the server, or set TRADES_RPC_URL, TRADES_CHAIN_ID and TRADES_VAULT_ADDRESS there.');
 const config=readConfig(settings);
 const timer=setTimeout(()=>{console.error('Connection preflight timed out; configuration was not changed.');process.exit(1);},55000);
 let report;try{report=await verifyConnection(config);}finally{clearTimeout(timer);}
 fs.mkdirSync(output,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(output,'trades.env'),renderSettings(original,settings),{mode:0o600,flag:'wx'});
 fs.writeFileSync(path.join(output,'connection-public.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify(report,null,2));
 if(!report.requestedPlanChecksMatch)console.log('EXISTING CONTRACT PLAN DIFFERS: connecting this feed does not deploy the requested new contract rules.');
 if(!report.networkControlsSupported)console.log('NETWORK CONTROLS UNAVAILABLE: the guarded reward interface requires a new compatible deployment.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{
 // RPC/provider exceptions can include private URLs. Print only controlled local diagnostics.
 const message=String(error.message||'');
 const allowed=['Usage:','Invalid saved','Both testnet','Set the chain','Requested chain','Missing connection','RPC connection check failed','The selected address','Unsupported characters'];
 console.error(allowed.some(prefix=>message.startsWith(prefix))?message:'Connection configuration or verification failed. Existing settings were not changed.');process.exitCode=1;
});
