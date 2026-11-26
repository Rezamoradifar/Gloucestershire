import {get as httpsGet} from 'node:https';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {getAddress} from 'ethers';

const exec=promisify(execFile);
const hash=value=>typeof value==='string' && /^0x[\da-f]{64}$/i.test(value);
const accrualStates=['IDLE_CHECKPOINT_RECORDED','CONFIRMED_CHECKPOINT_RECORDED'];
const volumeStates=['NO_DUE_VOLUME','VOLUME_CONFIRMED','VOLUME_SCAN_CONTINUES','NO_PENDING_VOLUME'];

export function primaryFromHtml(html){
 if(!/<div\b[^>]*\bid=["']root["']/.test(html))throw Error('Primary site unavailable');
 const tags=html.match(/<meta\b[^>]*\bname=["']global-portfolio-vault["'][^>]*>/gi)??[];
 if(!tags.length)return null;
 if(tags.length!==1)throw Error('Ambiguous primary site');
 return getAddress(tags[0].match(/\bcontent=["'](0x[\da-f]{40})["']/i)?.[1]);
}
// Read the index actually served at the configured TLS origin, including after a rollback.
// Neither the host nor the destination can be supplied by an API caller.
export function readPrimaryVault(){
 return new Promise((resolve,reject)=>{
  const req=httpsGet({hostname:'globaldroptrade.com',family:4,lookup:(_h,_o,cb)=>cb(null,'127.0.0.1',4),path:'/',
   timeout:3500,agent:false},res=>{
    if(res.statusCode!==200){res.resume();reject(Error('Primary site unavailable'));return;}
    let body='';res.setEncoding('utf8');res.on('data',part=>{body+=part;if(body.length>65536)req.destroy(Error('Index too large'));});
    res.on('error',reject);res.on('end',()=>{try{resolve(primaryFromHtml(body));}catch(e){reject(e);}});
   });req.on('timeout',()=>req.destroy(Error('Primary site timed out')));req.on('error',reject);
 });
}
async function localState(profile){
 const unit=profile.timer.replace(/\.timer$/,'');
 const [timer,service]=await Promise.all([exec('systemctl',['show',profile.timer,'-p','ActiveState','--value'],{timeout:2200}),
  exec('systemctl',['show',unit+'.service','-p','Result','-p','ExecMainStatus'],{timeout:2200})]);
 const handle=await open('/var/lib/'+unit+'-public/run.json',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const info=await handle.stat();if(!info.isFile()||info.size>8192||(info.mode&0o022)!==0)throw Error('Invalid worker report');
  return {timer:timer.stdout.trim()==='active',lastFailed:!/^Result=success$/m.test(service.stdout)||!/^ExecMainStatus=0$/m.test(service.stdout),
   run:JSON.parse(await handle.readFile('utf8'))};
 }finally{await handle.close();}
}

export function createPortfolioStatus(history,legacy,{primary=readPrimaryVault,local=localState,now=Date.now}={}){
 let selector;const cache=new Map();
 function cached(key,read){
  const current=cache.get(key);if(current&&now()<current.until)return current.job;
  const job=read().catch(error=>{cache.delete(key);throw error;});cache.set(key,{job,until:now()+10000});return job;
 }
 return async(params)=>{
  if([...params.keys()].some(k=>k!=='vault')||params.getAll('vault').length>1)return {code:400,data:{error:'Invalid automation target.'}};
  const entries=history?.portfolioProfiles??[],override=params.get('vault');
  if(override==='legacy'||(override===null&&!entries.length))return legacy();
  let address;
  try{
   if(override!==null)address=getAddress(override);
   else{
    if(!selector||selector.until<now())selector={job:primary(),until:now()+5000};
    address=await selector.job;
    if(address===null)return legacy();
   }
  }catch{return {code:override!==null?400:503,data:{error:'Unable to identify the active automation target.'}};}
  const entry=entries.find(e=>getAddress(e.proof.vault)===address);
  if(!entry)return {code:override?404:503,data:{error:'Unknown portfolio automation target.'}};
  const base={version:2,chainId:97,vaultAddress:address,deploymentTx:entry.proof.deploymentTx,profile:entry.profile.mode};
  try{return await cached(address,async()=>{
   const {timer,lastFailed,run}=await local(entry.profile),timestamp=Date.parse(run.checkedAt);
   if(run.version!==1||run.chainId!==97||getAddress(run.vault)!==address||run.deploymentTx!==base.deploymentTx||!Number.isFinite(timestamp)||timestamp>now()+30000||
    ![run.lastAccrual,run.lastVolume].every(v=>v===null||hash(v)))throw Error('Worker identity mismatch');
   const operator=getAddress(run.operator);
   if(operator!==getAddress(entry.proof.keeper) || (run.lastSuccessfulAt!==null &&
    (!Number.isFinite(Date.parse(run.lastSuccessfulAt))||Date.parse(run.lastSuccessfulAt)>timestamp)))throw Error('Invalid run identity');
   const receipts=await history.keeperReceipts(address,operator,run.lastAccrual,run.lastVolume);
   const fresh=now()-timestamp<=10*60000;
   const completed=(run.accrual===null||accrualStates.includes(run.accrual))&&(run.volume===null||volumeStates.includes(run.volume))&&(run.accrual!==null||run.volume!==null);
   const status=!fresh?'stale':!timer||lastFailed||!completed?'waiting':'running';
   return {code:status==='running'?200:503,data:{...base,status,fresh,schedulerActive:timer,serviceFailed:lastFailed,checkedAt:run.checkedAt,lastSuccessfulAt:run.lastSuccessfulAt,
    cycleCompleted:completed,accrual:accrualStates.includes(run.accrual)?run.accrual:null,volume:volumeStates.includes(run.volume)?run.volume:null,
    receipts}};
  });}catch{return {code:503,data:{...base,status:'unavailable',checkedAt:null,fresh:false,schedulerActive:null,receipts:[]}};}
 };
}
