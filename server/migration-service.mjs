import fs from 'node:fs';
import {Contract,FetchRequest,JsonRpcProvider,ZeroAddress,keccak256} from 'ethers';
import {deferredPolicy,guardDeferredSource,scanDeferredInventory,verifyDeferredImport,assertDeferredSnapshotStable,discoverDeferredCopies} from '../scripts/deferred-migration-core.mjs';

// Public read-only verification. No key loading, signing, configuration writes or arbitrary RPC proxy.
export function createMigrationService(config,{provider,artifact,seedReader=()=>JSON.parse(fs.readFileSync('/var/www/globaldroptrade/migration-data/deferred-seed.json','utf8')),connectionReader=()=>JSON.parse(fs.readFileSync('/var/www/globaldroptrade/migration-data/deferred-connection.json','utf8')),policy=deferredPolicy,now=Date.now}={}){
 const enabled=config.chainId===97&&Boolean(config.rpcUrl&&config.address);let owned=false;
 if(enabled&&!provider){const request=new FetchRequest(config.rpcUrl);request.timeout=12000;provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});owned=true;}
 artifact??=enabled?JSON.parse(fs.readFileSync(new URL('../artifacts/TestnetDeferredMigrationVault.json',import.meta.url))):null;
 let metadata=null,metadataTime=0,metadataJob=null,inventory=null,indexState={},indexJob=null,indexError=null,indexTime=0;
 const jobs=new Map();
 let discovery=null,discoveryState={},discoveryJob=null,discoveryTime=0,discoveryError=null;
 const safe=e=>/^[A-Z][A-Z0-9_]{2,100}$/.test(e?.message||'')?e.message:'RPC_OR_HISTORY_UNAVAILABLE';
 const metadataRefresh=()=>{
  if(metadataJob)return;
  metadataJob=(async()=>{
   const source=await guardDeferredSource(provider,policy),token=await source.usdt();
   const queue=new Contract(await source.withdrawalQueue(),['function pending(address) view returns(uint256)','function requestCount() view returns(uint256)'],provider);
   const tokenDecimals=Number(await new Contract(token,['function decimals() view returns(uint8)'],provider).decimals());
   const assets=await Promise.all([ZeroAddress,token].map(async asset=>({asset,ledger:Array.from(await source.ledgers(asset),String),cash:(await source.assetBalance(asset)).toString(),pending:(await queue.pending(asset)).toString()})));
   metadata={ready:true,chainId:97,source:policy.source,owner:policy.owner,operator:policy.operator,sourcePaused:await source.paused(),apiTarget:config.address,token,tokenDecimals,queue:await source.withdrawalQueue(),requestCount:Number(await queue.requestCount()),head:await provider.getBlockNumber(),assets};
   metadataTime=now();
  })().catch(e=>{metadata={ready:false,error:safe(e)};metadataTime=now();}).finally(()=>{metadataJob=null;});
 };
 const handler=async(req,res,url)=>{
  if(!url.pathname.startsWith('/api/migration/'))return false;
  const send=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));return true;};
  if(req.method!=='GET')return send(405,{error:'READ_ONLY_MIGRATION_SERVICE'});
  if(!enabled)return send(503,{error:'TESTNET_MIGRATION_SERVICE_UNAVAILABLE'});
  try{
   if(url.pathname==='/api/migration/connection'){
    let report;try{report=connectionReader();}catch{return send(404,{error:'MIGRATED_CONNECTION_NOT_INSTALLED'});}
    if(report.source!==policy.source||report.chainId!==97||report.target?.toLowerCase()!==config.address.toLowerCase()||!/^0x[0-9a-f]{64}$/i.test(report.hash||''))return send(404,{error:'MIGRATED_CONNECTION_NOT_INSTALLED'});
    return send(200,{source:policy.source,target:config.address,hash:report.hash,chainId:97});
   }
   if(url.pathname==='/api/migration/status'){
    if(!metadata||now()-metadataTime>5000)metadataRefresh();
    return send(metadata?.ready?200:202,metadata||{ready:false,status:'checking_source'});
   }
   if(url.pathname==='/api/migration/inventory'){
    const after=Number(url.searchParams.get('afterBlock')||0);
    if(!Number.isSafeInteger(after)||after<0)return send(400,{error:'INVALID_REQUIRED_BLOCK'});
    if(inventory&&inventory.block>=after&&now()-indexTime<5000)return send(200,{ready:true,inventory});
    if(!indexJob&&now()-indexTime>=1000){
     indexError=null;
     indexJob=(async()=>{
      await guardDeferredSource(provider,policy);
      let seed;try{seed=seedReader();}catch{throw Error('EVENT_INDEX_NOT_READY');}
      const through=(await provider.getBlockNumber())-3;if(through<after)return;
      const found=await scanDeferredInventory({provider,policy,seed,state:indexState,through,maxPages:100});
      if(found.complete)inventory=found.inventory;
     })().catch(e=>{indexError=safe(e);}).finally(()=>{indexTime=now();indexJob=null;});
    }
    return send(202,{ready:false,status:indexError||'indexing',through:indexState.through||0,users:indexState.members?.length||0});
   }
   if(url.pathname==='/api/migration/discover'){
    const after=Number(url.searchParams.get('afterBlock')||0);
    if(!Number.isSafeInteger(after)||after<0)return send(400,{error:'INVALID_REQUIRED_BLOCK'});
    if(discovery?.complete&&discovery.through>=after&&now()-discoveryTime<1000)return send(200,{ready:true,...discovery});
    if(!discoveryJob){
     discoveryError=null;
     discoveryJob=(async()=>{let seed;try{seed=seedReader();}catch{throw Error('EVENT_INDEX_NOT_READY');}discovery=await discoverDeferredCopies({provider,artifact,seed,policy,state:discoveryState});})().catch(e=>{discoveryError=safe(e);}).finally(()=>{discoveryTime=now();discoveryJob=null;});
    }
    return send(202,{ready:false,status:discoveryError||'looking_for_existing_copies',through:discoveryState.through||0});
   }
   if(url.pathname==='/api/migration/verify'||url.pathname==='/api/migration/stability'){
    const hash=url.searchParams.get('hash');
    if(!/^0x[0-9a-f]{64}$/i.test(hash||''))return send(400,{error:'INVALID_TRANSACTION_HASH'});
    const stable=url.pathname.endsWith('/stability'),key=hash+':'+stable;
    let job=jobs.get(key);
    if(job?.done&&now()-job.time<15000)return send(job.error?422:200,job.error?{ready:false,error:job.error}:{ready:true,...job.result});
    if(!job||job.done){
     if([...jobs.values()].some(j=>!j.done))return send(202,{ready:false,status:'verification_busy'});
     while(jobs.size>=10)jobs.delete(jobs.keys().next().value);
     job={done:false,time:now()};jobs.set(key,job);
     (async()=>{
      let seed;try{seed=seedReader();}catch{throw Error('EVENT_INDEX_NOT_READY');}
      const report=await verifyDeferredImport({provider,artifact,hash,seed,policy});
      if(stable)report.sourceFrozenThroughBlock=await assertDeferredSnapshotStable({provider,report,policy});
      const target=new Contract(report.target,artifact.abi,provider);
      report.targetPaused=await target.paused();report.siteConnected=config.address.toLowerCase()===report.target.toLowerCase();
      report.serverReporterAuthorized=await target.reporters(policy.operator);
      const calldata=target.interface.encodeFunctionData('setReporter',[policy.operator,true]),proposal=keccak256(calldata),round=await target.configRound(proposal);
      const partners=await Promise.all(Array.from({length:7},(_,i)=>target.partnerWallets(i)));
      report.reporterAuthorization={operator:policy.operator,calldata,hash:proposal,round:round.toString(),eta:Number(await target.queuedConfig(proposal)),votes:Number(await target.configVotes(proposal)),quorum:Number(await target.partnerVotesRequired()),partners:await Promise.all(partners.map(async address=>({address,voted:await target.hasConfigVoted(proposal,round,address)})))};
      job.result={report};
     })().catch(e=>{job.error=safe(e);}).finally(()=>{job.done=true;job.time=now();});
    }
    return send(202,{ready:false,status:stable?'checking_source_snapshot':'verifying_constructor_copy'});
   }
   return send(404,{error:'UNKNOWN_MIGRATION_ENDPOINT'});
  }catch(e){return send(503,{ready:false,error:safe(e)});}
 };
 handler.close=()=>{if(owned)provider?.destroy();};return handler;
}
