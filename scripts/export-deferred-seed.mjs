import fs from 'node:fs';
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {deferredPolicy,guardDeferredSource,scanDeferredInventory} from './deferred-migration-core.mjs';
import {writePrivateJson} from './migration-journal.mjs';

// Read-only index. Never opens a key, pauses a contract or broadcasts a transaction.
const directory='/var/lib/globaldroptrade/deferred-migration-index';
const publicDirectory='/var/www/globaldroptrade/migration-data';
let provider;
try{
 if(process.getuid?.()!==0||process.env.TRADES_CHAIN_ID!=='97'||!process.env.TRADES_RPC_URL)throw Error('TESTNET_SERVER_CONFIGURATION_REQUIRED');
 for(const [folder,mode]of [[directory,0o700],[publicDirectory,0o755]]){
  fs.mkdirSync(folder,{recursive:true,mode});const s=fs.lstatSync(folder);
  if(!s.isDirectory()||s.uid!==0||(folder===directory&&(s.mode&0o077)!==0)||(s.mode&0o022)!==0)throw Error('UNSAFE_INDEX_DIRECTORY');
 }
 const request=new FetchRequest(process.env.TRADES_RPC_URL);request.timeout=15000;
 provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 await guardDeferredSource(provider);
 const published=publicDirectory+'/deferred-seed.json';
 if(fs.existsSync(published)){
  const s=fs.lstatSync(published);if(!s.isFile()||s.uid!==0||(s.mode&0o022)!==0)throw Error('UNSAFE_EVENT_SEED_FILE');
  const seed=JSON.parse(fs.readFileSync(published,'utf8'));
  await scanDeferredInventory({provider,seed,through:seed.through,state:{},maxPages:0});
  console.log('EVENT_SEED_ALREADY_READY users='+seed.members.length);process.exitCode=0;
 }else{
  const file=directory+'/registry.json';
  if(fs.existsSync(file)){const s=fs.lstatSync(file);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error('UNSAFE_INDEX_STATE');}
  const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
  const save=()=>writePrivateJson(file,state);
  let complete=false,pages=0;
  while(!complete){
   const found=await scanDeferredInventory({provider,state,save,maxPages:1000,log:message=>{if(++pages%10===0)console.log(message);}});
   complete=found.complete;
  }
  const receipt=await provider.getTransactionReceipt(deferredPolicy.creationHash);
  const seed={version:1,chainId:97,source:deferredPolicy.source,creationHash:deferredPolicy.creationHash,creationBlock:receipt.blockNumber,through:state.through,blockHash:state.hash,members:state.members,settlements:state.settlements,creditIds:state.creditIds};
  const temporary=publicDirectory+'/deferred-seed.json.tmp';
  const fd=fs.openSync(temporary,fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o644);
  try{fs.writeFileSync(fd,JSON.stringify(seed,null,2)+'\n');fs.fsyncSync(fd);fs.fchmodSync(fd,0o644);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,published);
  console.log('DEFERRED_EVENT_SEED_READY users='+seed.members.length+' through='+seed.through);
 }
}catch(e){console.error('DEFERRED_INDEX_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message||'')?e.message:'RPC_OR_HISTORY_UNAVAILABLE'));process.exitCode=1;}
finally{provider?.destroy();}
