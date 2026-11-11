import {useEffect,useRef,useState} from 'react';
import {Bell,CheckCheck,Clock3,ExternalLink,Info,ShieldCheck} from 'lucide-react';
import {Interface,zeroPadValue} from 'ethers';
import {configured,chainId,vaultAddress,explorer} from './config';
import {readDailyActivityStatus} from './daily-activity-client';
import {session,type Snapshot} from './chain';
type Notice={id:string;title:string;detail:string;when:string;href?:string;kind:'chain'|'activity'|'announcement'|'request'};
const activityEvents=new Interface([
 'event Deposited(address indexed user,address indexed asset,uint256 indexed position,uint256 amount,uint256 usd,uint256 feeEach)',
 'event ProfitCredited(address indexed user,address indexed asset,uint256 amount,bytes32 indexed id)',
 'event Withdrawal(address indexed user,address indexed asset,uint256 gross,uint256 fee,bool principal)'
]);
const topics=['Deposited','ProfitCredited','Withdrawal'].map(x=>activityEvents.getEvent(x)!.topicHash);
const storageKey=(who:string)=>'global-notification-view-v2:'+chainId+':'+vaultAddress.toLowerCase()+':'+(who||'guest').toLowerCase();
function readSeen(who:string):string[]{try{const d=JSON.parse(localStorage.getItem(storageKey(who))||'[]');return Array.isArray(d)?d.filter(x=>typeof x==='string').slice(-150):[];}catch{return [];}}
export default function NotificationCenter({who,data,connected}:{who:string;data:Snapshot|null;connected:boolean}){
 const [open,setOpen]=useState(false),[items,setItems]=useState<Notice[]>([]),[seen,setSeen]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const root=useRef<HTMLDivElement>(null),generation=useRef(0);
 useEffect(()=>{setOpen(false);setItems([]);setSeen(readSeen(who));setMessage('');},[who]);
 useEffect(()=>{
  if(!open)return;const dismiss=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};
  const outside=(e:MouseEvent)=>{if(root.current&&!root.current.contains(e.target as Node))setOpen(false);};
  document.addEventListener('keydown',dismiss);document.addEventListener('mousedown',outside);
  return()=>{document.removeEventListener('keydown',dismiss);document.removeEventListener('mousedown',outside);};
 },[open]);
 useEffect(()=>{
  const id=++generation.current;
  async function refresh(){
   if(document.visibilityState==='hidden')return;
   setBusy(true);const next:Notice[]=[];const faults:string[]=[];
   try{
    const response=await fetch('/api/community/announcements',{cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('announcement API unavailable');
    const json=await response.json();
    if(!Array.isArray(json.items))throw Error('invalid announcements');
    for(const row of json.items.slice(0,6)){
     if(typeof row.id!=='string'||typeof row.title!=='string')continue;
     next.push({id:'news-'+row.id,title:row.title.slice(0,90),detail:typeof row.message==='string'?row.message.slice(0,180):'Published platform notice',when:typeof row.createdAt==='string'?row.createdAt:'',kind:'announcement'});
    }
   }catch{faults.push('announcements');}
   if(connected&&configured&&who){
    if(data?.pendingWithdrawal)next.push({id:'request-'+who.toLowerCase(),title:'Withdrawal request pending',detail:'Your request is awaiting processing. View the withdrawal section for the latest on-chain status.',when:'',kind:'request'});
    try{
     const activity=await readDailyActivityStatus(who);
     if(activity.requirementActive){
      const deadline=activity.activeUntil??0,now=Math.floor(Date.now()/1000);
      if(!activity.activityCurrent||deadline<=now)next.push({id:'activity-expired-'+String(activity.lastCheckInAt??0),title:'Daily activity needs renewal',detail:'The activity condition is enabled. Check in with a wallet signature to renew your 24-hour window.',when:'',kind:'activity'});
      else if(deadline-now<7200)next.push({id:'activity-near-'+deadline,title:'Activity window ending soon',detail:'Your recorded activity window expires at '+new Date(deadline*1000).toLocaleString()+'.',when:'',kind:'activity'});
     }
    }catch{faults.push('activity');}
    try{
     const {provider}=await session(who),head=(await provider.getBlockNumber())-3;
     if(head>=0){
      const min=Math.max(0,head-199),records:Notice[]=[];
      for(let end=head;end>=min&&records.length<10;end-=50){
       const from=Math.max(min,end-49);
       // A bounded topic filter only for the connected wallet. No signer writes.
       const logs=await provider.getLogs({address:vaultAddress,fromBlock:from,toBlock:end,topics:[topics,zeroPadValue(who,32)]});
       for(const log of logs){
        const p=activityEvents.parseLog(log);
        if(!p)continue;
        const title=p.name==='ProfitCredited'?'Profit credited in contract':p.name==='Deposited'?'Deposit confirmed':'Withdrawal confirmed';
        records.push({id:'tx-'+log.transactionHash+':'+log.index,title,detail:'Confirmed event at block '+log.blockNumber.toLocaleString()+'. Open the blockchain receipt for amounts and details.',when:'',kind:'chain',href:explorer+'/tx/'+log.transactionHash});
       }
      }
      next.push(...records.slice(0,8));
     }
    }catch{faults.push('chain events');}
   }
   if(id!==generation.current)return;
   setItems(next.slice(0,18));setMessage(faults.length?'Some sources could not be refreshed: '+faults.join(', ')+'.':'');setBusy(false);
  }
  void refresh();const timer=setInterval(()=>{void refresh();},120000);
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);
  return()=>{generation.current++;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[who,connected,data?.pendingWithdrawal]);
 const unseen=items.filter(x=>!seen.includes(x.id)).length;
 const markAll=()=>{const next=[...new Set([...seen,...items.map(x=>x.id)])].slice(-150);setSeen(next);try{localStorage.setItem(storageKey(who),JSON.stringify(next));}catch{setMessage('Could not save read status on this browser.');}};
 return <div className="v2-notifications" ref={root}>
  <button type="button" className="v2-bell" aria-label={'Notifications'+(unseen?' · '+unseen+' unread':'')} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(!open)}><Bell size={19}/>{unseen>0&&<span className="v2-unread">{unseen>9?'9+':unseen}</span>}</button>
  {open&&<div className="v2-notice-popover" role="dialog" aria-label="Verified notifications">
   <div className="v2-notice-head"><div><strong>Notification center</strong><small>Only recorded activity and public announcements</small></div><button type="button" onClick={markAll} disabled={!items.length} title="Mark listed notices as viewed"><CheckCheck size={18}/></button></div>
   {busy&&<p className="muted" role="status">Checking records…</p>}
   {message&&<p className="inline-error" role="status">{message}</p>}
   {items.length?<ul className="v2-notice-list">{items.map(item=><li key={item.id} className={seen.includes(item.id)?'viewed':'new'}>
    <span className="v2-notice-icon">{item.kind==='activity'?<Clock3 size={17}/>:item.kind==='chain'?<ShieldCheck size={17}/>:<Info size={17}/>}</span>
    <div><strong>{item.title}</strong><p>{item.detail}</p>{item.when&&<small>{new Date(item.when).toLocaleString()}</small>}{item.href&&<a href={item.href} target="_blank" rel="noopener noreferrer">View receipt <ExternalLink size={13}/></a>}</div>
   </li>)}</ul>:!busy?<p className="muted">No recent notifications available from connected sources.</p>:null}
   <p className="v2-notice-footer">Updates while this dashboard is open. Read markers stay in this browser; this is not a push-notification service.</p>
  </div>}
 </div>;
}
