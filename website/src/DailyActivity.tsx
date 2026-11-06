import {useEffect,useRef,useState} from 'react';
import {Check,Clock3,ExternalLink,LoaderCircle,RefreshCw} from 'lucide-react';
import {chainId,configured,explorer} from './config';
import {errorText} from './chain';
import {readDailyActivityStatus,signDailyActivity,readAllocationStatus,type DailyActivityStatus,type AllocationStatus} from './daily-activity-client';
import './daily-activity.css';

const time=(seconds:number)=>new Date(seconds*1000).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});

export default function DailyActivity({who,network,registered,disabled}:{who:string;network:number|null;registered:boolean;disabled:boolean}){
 const [status,setStatus]=useState<DailyActivityStatus|null>(null),[allocation,setAllocation]=useState<AllocationStatus|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[clock,setClock]=useState(Date.now);
 const generation=useRef(0),running=useRef(false),request=useRef(0);
 const connected=configured&&Boolean(who)&&network===chainId;
 useEffect(()=>{
  const id=++generation.current;setStatus(null);setAllocation(null);setError('');setBusy(false);running.current=false;
  const refresh=async()=>{
   if(running.current)return;
   const read=++request.current;setLoading(true);
   const [activity,system]=await Promise.allSettled([connected?readDailyActivityStatus(who):Promise.resolve(null),readAllocationStatus()]);
   if(generation.current!==id||request.current!==read)return;
   if(activity.status==='fulfilled'){setStatus(activity.value);setError('');}else{setStatus(null);setError(errorText(activity.reason));}
   setAllocation(system.status==='fulfilled'?system.value:null);setLoading(false);setClock(Date.now());
  };
  void refresh();const timer=setInterval(()=>{setClock(Date.now());if(document.visibilityState==='visible')void refresh();},60000);
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);
  return()=>{generation.current++;request.current++;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[who,network,connected]);
 async function checkIn(){
  if(!connected||!registered||disabled||running.current)return;
  const id=generation.current,valid=()=>generation.current===id;request.current++;running.current=true;setBusy(true);setLoading(false);setError('');
  try{const value=await signDailyActivity(who,valid);if(valid()){setStatus(value);setClock(Date.now());}}
  catch(failure){if(valid())setError(errorText(failure));}
  finally{if(valid()){running.current=false;setBusy(false);}}
 }
 const active=Boolean(status?.activityCurrent&&status.activeUntil&&status.activeUntil*1000>clock);
 const recentlyRecorded=Boolean(active&&status?.nextCheckInAt&&status.nextCheckInAt*1000>clock);
 const latestBatch=allocation?.lastCredit?.batches[0]?.transactionHash;
 return <section className="panel daily-activity" aria-labelledby="daily-activity-heading" aria-busy={busy||loading}>
  <div className="panel-title"><div><h2 id="daily-activity-heading">Daily activity</h2><p>Check in with one wallet signature to keep your activity current for 24 hours.</p></div><span className="round-icon"><Clock3 size={22}/></span></div>
  <div className="daily-activity-action"><button className="primary-button" type="button" disabled={!connected||!registered||disabled||busy||recentlyRecorded} onClick={()=>void checkIn()}>{busy?<LoaderCircle className="spin" size={18}/>:active?<Check size={18}/>:<RefreshCw size={18}/>}<span>{busy?'Confirm the message in your wallet':recentlyRecorded?'Check-in recorded':'Check in for 24 hours'}</span></button><span className="muted">No gas fee or funds transfer.</span></div>
  {!connected?<p>Connect your wallet on the configured network to check in.</p>:!registered?<p>Register your account before checking in.</p>:null}
  <div className="daily-activity-state" role="status" aria-live="polite">
   {active&&status?.activeUntil?<p className="daily-activity-current"><Check size={17}/> Activity current until <time dateTime={new Date(status.activeUntil*1000).toISOString()}>{time(status.activeUntil)}</time>.</p>:status&&registered?<p>{status.lastCheckInAt?'Your previous activity window ended. Check in to renew it.':'Your daily activity has not been recorded yet.'}</p>:null}
   {status?.requirementEnabled&&status.activationTimestamp&&!status.requirementActive?<p>The activity requirement starts with earning periods beginning from {time(status.activationTimestamp)}. Earlier periods keep their existing rules.</p>:status&&!status.requirementEnabled?<p>The activity requirement has not been enabled for payouts yet.</p>:null}
  </div>
  {error?<p className="inline-error" role="alert">{error}</p>:null}
  <p className="muted">A check-in records activity. Credited profit appears in your account after a funded allocation is confirmed; plan and account conditions still apply.</p>
  <div className="daily-activity-payment">
   {latestBatch?<p><a href={`${explorer}/tx/${latestBatch}`} target="_blank" rel="noreferrer">Latest confirmed system allocation <ExternalLink size={14}/></a><span className="muted">{allocation?.checkedAt?' · status checked '+new Date(allocation.checkedAt).toLocaleString('en-US'):''}{allocation&&!allocation.fresh?' · update pending':''}</span></p>:<p className="muted">{allocation?.fresh?allocation.status==='waiting'?'The allocation service is waiting.':'No confirmed allocation batch is reported yet.':'Current allocation status is unavailable.'}</p>}
  </div>
 </section>;
}
