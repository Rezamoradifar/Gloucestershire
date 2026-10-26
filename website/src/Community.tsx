import {useEffect,useRef,useState} from 'react';
import {errorText} from './chain';
import {communityApi as api,signInSupport,withSupportSession} from './community-client';
type Entry={id:string;title:string;message?:string;status?:string;wallet?:string;createdAt:string;messages?:{id:string;message:string;admin:boolean;createdAt:string}[]};
export default function Community({mode,who,admin}:{mode:'tickets'|'announcements';who:string;admin:boolean}){
 const [token,setToken]=useState(''),[items,setItems]=useState<Entry[]>([]),[ticket,setTicket]=useState<Entry|null>(null),[title,setTitle]=useState(''),[message,setMessage]=useState(''),[reply,setReply]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const generation=useRef(0),running=useRef(false);
 useEffect(()=>{generation.current++;setToken('');setItems([]);setTicket(null);setTitle('');setMessage('');setReply('');setError('');setBusy(false);running.current=false;return()=>{generation.current++;};},[who,mode,admin]);
 useEffect(()=>{if(mode!=='announcements')return;let stopped=false;api<{items:Entry[]}>('announcements').then(d=>{if(!stopped)setItems(d.items);}).catch(e=>{if(!stopped)setError(errorText(e));});return()=>{stopped=true;};},[mode,who]);
 async function run(fn:(auth:string,valid:()=>boolean)=>Promise<void>,authRequired=true){
  if(running.current)return;
  const id=generation.current,valid=()=>generation.current===id;
  running.current=true;setBusy(true);setError('');
  try{
   if(authRequired){
    if(!who)throw Error('Connect your wallet first.');
    await withSupportSession(token,()=>signInSupport(who,valid),value=>{if(valid())setToken(value);},async auth=>{if(valid())await fn(auth,valid);});
   }else if(valid())await fn('',valid);
  }catch(e){if(valid())setError(errorText(e));}
  finally{if(valid()){running.current=false;setBusy(false);}}
 }
 async function refresh(auth:string,valid:()=>boolean){const d=await api<{items:Entry[]}>(mode==='tickets'?'tickets'+(admin?'?admin=1':''):'announcements','GET',undefined,auth);if(valid())setItems(d.items);}
 return <section className="panel community-panel"><div className="panel-title"><h2>{mode==='tickets'?'Support tickets':'Announcements'}</h2><button className="small-button" disabled={busy} onClick={()=>void run(refresh,mode==='tickets')}>{busy?'Please wait…':'Refresh'}</button></div>{error&&<p className="inline-error" role="alert">{error}</p>}
 {mode==='tickets'&&<><p>Sign in with a wallet signature to access private tickets. This is not a blockchain transaction.</p><button className="small-button" disabled={!who||busy} onClick={()=>void run(refresh)}>{token?'Load tickets':admin?'Sign in & load support inbox':'Sign in & load my tickets'}</button></>}
 {(mode==='tickets'||admin)&&<form onSubmit={e=>{e.preventDefault();void run(async(auth,valid)=>{const entry=await api<Entry>(mode,'POST',{title,message},auth);if(valid()){setTitle('');setMessage('');if(mode==='tickets')setTicket(entry);}await refresh(auth,valid);});}}><h3>{mode==='tickets'?'Create ticket':'Publish announcement'}</h3><label className="field">Title<input required maxLength={120} value={title} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label><label className="field">Message<textarea required maxLength={mode==='tickets'?4000:6000} rows={4} value={message} disabled={busy} onChange={e=>setMessage(e.target.value)}/></label><button className="primary-button" disabled={!who||busy}>{mode==='tickets'?'Create ticket':'Publish announcement'}</button></form>}
 {items.map(item=><article className="community-message" key={item.id}><h3>{item.title}</h3><small>{new Date(item.createdAt).toLocaleString()}{item.status?' · '+item.status:''}</small>{mode==='announcements'?<><p>{item.message}</p>{admin&&<button className="small-button" disabled={busy} onClick={()=>void run(async(auth,valid)=>{await api('announcements/'+item.id,'DELETE',undefined,auth);await refresh(auth,valid);})}>Unpublish</button>}</>:<><p>{admin?item.wallet:''}</p><button className="small-button" disabled={busy} onClick={()=>void run(async(auth,valid)=>{const t=await api<Entry>('tickets/'+item.id,'GET',undefined,auth);if(valid()){setTicket(t);setReply('');}})}>Open ticket</button></>}</article>)}
 {mode==='tickets'&&ticket&&<article><h3>{ticket.title}</h3><p>Status: {ticket.status}</p>{ticket.messages?.map(m=><div className="community-message" key={m.id}><small>{m.admin?'Support':'Account holder'} · {new Date(m.createdAt).toLocaleString()}</small><p>{m.message}</p></div>)}<form onSubmit={e=>{e.preventDefault();const id=ticket.id;void run(async(auth,valid)=>{const t=await api<Entry>('tickets/'+id,'POST',{message:reply},auth);if(valid()){setTicket(t);setReply('');}await refresh(auth,valid);});}}><label className="field">Reply<textarea required maxLength={4000} rows={3} value={reply} disabled={busy||ticket.status==='closed'} onChange={e=>setReply(e.target.value)}/></label><button className="primary-button" disabled={busy||ticket.status==='closed'}>Send reply</button></form><button className="small-button" disabled={busy} onClick={()=>void run(async(auth,valid)=>{const t=await api<Entry>('tickets/'+ticket.id,'POST',{status:ticket.status==='open'?'closed':'open'},auth);if(valid())setTicket(t);await refresh(auth,valid);})}>{ticket.status==='open'?'Close ticket':'Reopen ticket'}</button></article>}
 </section>;
}
