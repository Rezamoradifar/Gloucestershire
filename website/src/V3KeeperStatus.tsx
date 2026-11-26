import {useEffect,useState} from 'react';
import {getAddress} from 'ethers';
import {V3_EXPLORER} from './v3-chain';
import type {V3SiteReleaseConfig} from './v3-site-config';
import {formatUtcTime} from './utc-time';

type Receipt={kind:'accrual'|'volume';transactionHash:string;block:number};
type Status={status:'running'|'waiting'|'stale'|'unavailable';schedulerActive:boolean|null;serviceFailed?:boolean;checkedAt:string|null;lastSuccessfulAt?:string|null;cycleCompleted?:boolean;receipts:Receipt[]};
const labels={running:'Running',waiting:'Needs attention',stale:'Report overdue',unavailable:'Status unavailable'};
export default function V3KeeperStatus({config}:{config:V3SiteReleaseConfig}){
 const [value,setValue]=useState<Status|null>(null),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true,request:AbortController|null=null;
  async function refresh(){
   if(request)return;
   const ctrl=new AbortController();request=ctrl;
   const timeout=window.setTimeout(()=>ctrl.abort(),30000);
   try{
    const res=await fetch('/api/automation/status?vault='+encodeURIComponent(config.address),{cache:'no-store',signal:ctrl.signal});
    const data=await res.json();
    if((!res.ok&&res.status!==503)||data.version!==2||data.chainId!==97||getAddress(data.vaultAddress)!==config.address||
     data.deploymentTx!==config.deploymentTx||!Object.hasOwn(labels,data.status)||!Array.isArray(data.receipts)||data.receipts.length>2||
     !data.receipts.every((r:Receipt)=>['accrual','volume'].includes(r.kind)&&/^0x[\da-f]{64}$/i.test(r.transactionHash)&&Number.isSafeInteger(r.block)&&r.block>0))throw Error();
    if(active)setValue(data);
   }catch{if(active)setValue({status:'unavailable',schedulerActive:null,checkedAt:null,receipts:[]});}
   finally{clearTimeout(timeout);request=null;}
  }
  void refresh();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30000);
  return()=>{active=false;request?.abort();clearInterval(timer);};
 },[config.address,config.deploymentTx,retry]);
 return <section className="gv2-panel gv3-keeper-status" aria-label="Portfolio automation">
  <div className="gv2-panel-head"><h3>Portfolio automation</h3><button onClick={()=>setRetry(v=>v+1)}>Refresh status</button></div>
  <div role="status"><strong>{value?labels[value.status]:'Checking worker…'}</strong>
   {value?.lastSuccessfulAt&&<p>Last successful cycle · {formatUtcTime(value.lastSuccessfulAt)}</p>}
   {value?.checkedAt&&value.checkedAt!==value.lastSuccessfulAt&&<p>Last check · {formatUtcTime(value.checkedAt)}</p>}
   {value?.schedulerActive!==null&&value?.schedulerActive!==undefined&&<small>{value.schedulerActive?'Timer active':'Timer inactive'}{value.serviceFailed?' · Latest service run failed':''}</small>}
   {value&&value.status==='unavailable'&&<p>The worker could not be verified for this contract.</p>}</div>
  {value?.receipts.map(r=><div key={r.kind}><a href={V3_EXPLORER+'/tx/'+r.transactionHash} target="_blank" rel="noreferrer">{r.kind==='accrual'?'Last verified earnings credit':'Last verified team volume update'}</a> · Block {r.block.toLocaleString('en-US')}</div>)}
  {value&&value.checkedAt&&!value.receipts.length&&<p>No confirmed worker transaction is available in this report.</p>}
 </section>;
}
