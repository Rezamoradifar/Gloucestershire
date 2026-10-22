// Read-only preflight and private staging. Never loads a signer or broadcasts.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,JsonRpcProvider,getAddress} from 'ethers';
import {deferredPolicy,verifyDeferredImport,assertDeferredSnapshotStable} from './deferred-migration-core.mjs';
import {renderSettings} from './connect-settlement-feed.mjs';

export async function prepareDeferredConnection({provider,artifact,hash,seed,original,policy=deferredPolicy}){
 const settings=parseEnv(original);
 if(settings.TRADES_CHAIN_ID!=='97'||!settings.TRADES_RPC_URL||!settings.TRADES_VAULT_ADDRESS)throw Error('EXISTING_TESTNET_CONFIGURATION_REQUIRED');
 const report=await verifyDeferredImport({provider,artifact,hash,seed,policy});
 const active=getAddress(settings.TRADES_VAULT_ADDRESS),target=new Contract(report.target,artifact.abi,provider);
 if(active!==policy.source&&active!==report.target)throw Error('UNRELATED_ACTIVE_TARGET');
 if(!await target.paused())throw Error('COPIED_TARGET_MUST_BE_PAUSED_FOR_CUTOVER');
 report.sourceFrozenThroughBlock=await assertDeferredSnapshotStable({provider,report,policy});
 const env=renderSettings(original,{...settings,TRADES_CHAIN_ID:'97',TRADES_VAULT_ADDRESS:report.target,TRADES_START_BLOCK:String(report.block),TRADES_PORT:'3115'});
 return {env,report};
}

async function main(){
 const [mode,directory]=process.argv.slice(2);
 if(!['prepare','check','publish'].includes(mode)||!directory)throw Error('USAGE_PREPARE_CHECK_OR_PUBLISH_OUTPUT_DIRECTORY');
 if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
 const envfile='/etc/globaldroptrade/trades.env',original=fs.readFileSync(envfile,'utf8'),settings=parseEnv(original);
 const hash=process.env.MIGRATED_VAULT_TX;if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw Error('MIGRATED_VAULT_TX_REQUIRED');
 const request=new FetchRequest(settings.TRADES_RPC_URL);request.timeout=12000;
 const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 try{
  const artifact=JSON.parse(fs.readFileSync('artifacts/TestnetDeferredMigrationVault.json'));
  const seed=JSON.parse(fs.readFileSync('/var/www/globaldroptrade/migration-data/deferred-seed.json','utf8'));
  const {env,report}=await prepareDeferredConnection({provider,artifact,hash,seed,original});
  if(mode==='prepare'){
   fs.mkdirSync(directory,{recursive:true,mode:0o700});
   fs.writeFileSync(path.join(directory,'trades.env'),env,{mode:0o600,flag:'wx'});
   fs.writeFileSync(path.join(directory,'deferred-connection.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
   console.log('COPIED_TARGET_PREFLIGHT_OK '+report.target);
  }else if(mode==='publish'){
   if(getAddress(settings.TRADES_VAULT_ADDRESS)!==report.target)throw Error('SITE_TARGET_NOT_CONNECTED');
   const directory='/var/www/globaldroptrade/migration-data',s=fs.lstatSync(directory);
   if(!s.isDirectory()||s.uid!==0||(s.mode&0o022)!==0)throw Error('UNSAFE_PUBLIC_REPORT_DIRECTORY');
   const temporary=directory+'/deferred-connection.json.tmp';
   const fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o644);
   try{fs.writeFileSync(fd,JSON.stringify({...report,siteConnected:true,connectedAtBlock:report.sourceFrozenThroughBlock},null,2)+'\n');fs.fchmodSync(fd,0o644);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   fs.renameSync(temporary,directory+'/deferred-connection.json');
   console.log('COPIED_TARGET_CONNECTION_PUBLISHED '+report.target);
  }else console.log('COPIED_SOURCE_SNAPSHOT_STILL_MATCHES');
 }finally{provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
 console.error('MIGRATED_CONNECTION_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message||'')?e.message:'RPC_OR_VERIFICATION_FAILED'));process.exitCode=1;
});
