import {useEffect,useState} from 'react';
import {Activity,ArrowUpRight,ExternalLink,Landmark,ShieldCheck,Users,Wallet} from 'lucide-react';
import {type Asset,type Snapshot} from './chain';
import {readAllocationStatus,type AllocationStatus} from './daily-activity-client';
import {explorer,chainId,vaultAddress} from './config';
import AdminWalletLookup from './AdminWalletLookup';
import AdminUserDirectory from './AdminUserDirectory';
import {displayAmount} from './money';

const short=(a:string)=>a.slice(0,8)+'…'+a.slice(-6);
export default function AdminOverview({data,asset,onNavigate,onReviewUser}:{data:Snapshot;asset:Asset;onNavigate:(page:'tickets'|'announcements')=>void;onReviewUser:(wallet:string)=>void}){
 const [report,setReport]=useState<AllocationStatus|null>(null),[failure,setFailure]=useState('');
 const [ops,setOps]=useState<{checkedAt:string|null;dailyStatus:string|null;blockers:string[];errors:string[];schedulerActive:boolean|null}|null>(null);
 useEffect(()=>{
  let cancelled=false;
  const refresh=async()=>{
   const [allocation,operation]=await Promise.allSettled([
     readAllocationStatus(),
     fetch('/api/automation/status',{cache:'no-store',signal:AbortSignal.timeout(12000)}).then(async res=>{if(!res.ok)throw Error('Status unavailable');return res.json();})
   ]);
   if(cancelled)return;
   if(allocation.status==='fulfilled'){setReport(allocation.value);setFailure('');}
   else{setReport(null);setFailure('Automation data unavailable; do not assume payments are healthy.');}
   const value=operation.status==='fulfilled'?operation.value:null;
   if(value?.chainId===chainId&&String(value?.vaultAddress).toLowerCase()===vaultAddress.toLowerCase()){
    setOps({checkedAt:typeof value.checkedAt==='string'?value.checkedAt:null,dailyStatus:typeof value.dailyStatus==='string'?value.dailyStatus:null,
     blockers:Array.isArray(value.blockers)?value.blockers.filter((x:unknown):x is string=>typeof x==='string').slice(0,12):[],
     errors:Array.isArray(value.errors)?value.errors.filter((x:unknown):x is string=>typeof x==='string').slice(0,12):[],
     schedulerActive:typeof value.schedulerActive==='boolean'?value.schedulerActive:null});
   }else setOps(null);
  };
  void refresh();
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60000);
  return()=>{cancelled=true;clearInterval(timer);};
 },[]);
 const money=(value:bigint)=>displayAmount(value,data.decimals,2)+' '+asset;
 const current=Boolean(report?.fresh),indexed=report?.indexProgress;
 return <section className="global-admin" aria-label="Administrator monitoring">
  <div className="admin-hero">
   <div><span className="detail-kicker">OPERATIONS CONTROL CENTER</span><h2><Landmark size={24}/> Treasury & network oversight</h2>
    <p>Read-only operational monitoring based on your connected wallet, the contract and published worker report. Every financial action below still requires its existing wallet review.</p></div>
   <div className="admin-role"><ShieldCheck size={20}/><strong>{data.owner?'Contract owner':data.reporter?'Authorized reporter':'No administration role'}</strong><small>Verified at block {data.blockNumber.toLocaleString('en-US')}</small></div>
  </div>
  <div className="admin-metrics">
   <article><small>Recorded principal · {asset}</small><strong>{money(data.totalPrincipal)}</strong><span>Ledger liability; not cash</span></article>
   <article><small>Recorded profit · {asset}</small><strong>{money(data.totalProfit)}</strong><span>Credits do not prove wallet settlement</span></article>
   <article><small>Contract asset balance · {asset}</small><strong>{money(data.liquidBalance)}</strong><span>Shared cash; not all is withdrawable</span></article>
   <article><small>Reported liquidity shortfall · {asset}</small><strong>{money(data.shortfall)}</strong><span>{data.shortfall>0n?'Funding review required':'No shortfall at snapshot'}</span></article>
   <article><small>Owner capital outstanding</small><strong>{money(data.ownerOutstanding)}</strong><span>Not available for user withdrawal</span></article>
   <article><small>Reward ledger · {asset}</small><strong>{money(data.rewards)}</strong><span>Check funding before new allocation</span></article>
  </div>
  {ops&&(ops.blockers.length>0||ops.errors.length>0||ops.schedulerActive===false)&&<div className="notice error" role="alert">Operational review required: {[...ops.blockers,...ops.errors,...(ops.schedulerActive===false?['Scheduler inactive']:[])].join(' · ')}</div>}
  <div className="admin-detail-grid">
   <section className="panel admin-monitoring">
    <div className="panel-title"><h3><Activity size={19}/> Automation monitor</h3><span className={'admin-signal '+(current?'ok':'uncertain')}>{current?'Fresh report':'Not verified fresh'}</span></div>
    {failure&&<p className="inline-error" role="alert">{failure}</p>}
    <div className="plan-detail"><span>Worker report</span><strong>{report?.status??'Unavailable'}</strong></div>
    <div className="plan-detail"><span>Scheduler reported active</span><strong>{ops?.schedulerActive===true?'Yes · last report':ops?.schedulerActive===false?'No':'Not reported'}</strong></div>
    <div className="plan-detail"><span>Worker blockers</span><strong>{ops?ops.blockers.length?ops.blockers.join(', '):'None reported':'Unavailable'}</strong></div>
    <div className="plan-detail"><span>Worker errors</span><strong>{ops?ops.errors.length?ops.errors.join(', '):'None reported':'Unavailable'}</strong></div>
    <div className="plan-detail"><span>Daily allocation state</span><strong>{report?.dailyStatus??'Not reported'}</strong></div>
    <div className="plan-detail"><span>Last report received</span><strong>{report?.checkedAt?new Date(report.checkedAt).toLocaleString('en-US'):'Unknown'}</strong></div>
    <div className="plan-detail"><span>Member / position scan block</span><strong>{indexed?`${indexed.memberThrough??'—'} / ${indexed.positionThrough??'—'}`:'Not reported'}</strong></div>
    <div className="plan-detail"><span>Confirmed batch links</span><strong>{report?.lastCredit?.batches.length??0}</strong></div>
    {report?.lastCredit?.batches.slice(0,3).map(batch=><a key={batch.transactionHash} className="admin-tx" href={explorer+'/tx/'+batch.transactionHash} target="_blank" rel="noopener noreferrer">{short(batch.transactionHash)} <ExternalLink size={15}/></a>)}
    <p className="muted">A fresh worker report or recorded transaction hash does not guarantee every member was credited. Check transaction receipts, funding and ledger reconciliation.</p>
   </section>
   <section className="panel admin-monitoring">
    <div className="panel-title"><h3><Users size={19}/> Governance & access</h3></div>
    <div className="plan-detail"><span>Contract owner</span><strong>{data.owner?'Your connected wallet':'Another wallet'}</strong></div>
    <div className="plan-detail"><span>Reporter role</span><strong>{data.reporter?'Granted':'Not granted'}</strong></div>
    <div className="plan-detail"><span>Deposits & operations</span><strong>{data.paused?'Paused':'Not paused'}</strong></div>
    <div className="plan-detail"><span>Partner votes required</span><strong>{data.partnerQuorum} / {data.partners.length}</strong></div>
    <div className="admin-partner-list">{data.partners.map((wallet,index)=><a key={wallet+index} href={explorer+'/address/'+wallet} target="_blank" rel="noopener noreferrer"><span>Partner {index+1}</span><bdi>{short(wallet)}</bdi><ExternalLink size={14}/></a>)}</div>
    <p className="muted">Governance partners are distinct from your referral network. Partner permissions and contract economics are unchanged.</p>
   </section>
  </div>
  <AdminWalletLookup admin={data.who} data={data}/>
  <AdminUserDirectory who={data.who} owner={data.owner} onReviewStatus={onReviewUser}/>
  <div className="admin-shortcuts">{data.deferredRewards&&<button className="small-button" type="button" onClick={()=>document.getElementById('global-withdrawal-queue')?.scrollIntoView({behavior:'smooth',block:'start'})}><Wallet size={16}/> Review withdrawal requests <ArrowUpRight size={16}/></button>}<button className="small-button" type="button" onClick={()=>onNavigate('tickets')}><Wallet size={16}/> Support queue <ArrowUpRight size={16}/></button>
   {data.owner&&<button className="small-button" type="button" onClick={()=>onNavigate('announcements')}><ShieldCheck size={16}/> Publish announcements <ArrowUpRight size={16}/></button>}</div>
 </section>;
}
