import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {Bell,Inbox,LifeBuoy} from 'lucide-react';
import {formatUtcTime} from './utc-time';
import {SupportError,type Announcement,type SupportClient,type SupportPage,type Ticket,type TicketRow,type TicketStatus} from './v3-support';

type Work=(token:string,valid:()=>boolean)=>Promise<void>;
type Props={client:SupportClient;admin:boolean};

function useDesk<T>(client:SupportClient,route:string,privateList:boolean){
 const [page,setPage]=useState<SupportPage<T>|null>(null),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const generation=useRef(0),running=useRef(false);
 useLayoutEffect(()=>()=>{generation.current++;running.current=false;},[client,route,privateList]);

 async function run(work:Work,auth=privateList){
  if(running.current)return;
  const id=generation.current,valid=()=>generation.current===id;
  running.current=true;setBusy(true);setError('');setNotice('');
  try{
   const token=auth?await client.authenticate(valid):'';
   if(valid())await work(token,valid);
  }catch(e){
   if(valid()){
    if(e instanceof SupportError&&(e.status===401||e.status===403))setPage(null);
    setError(e instanceof Error?e.message:'Support is temporarily unavailable.');
   }
  }finally{if(valid()){running.current=false;setBusy(false);}}
 }
 async function load(token:string,valid:()=>boolean,index=0,filters:Record<string,string>={}){
  const params=new URLSearchParams({page:String(index),...filters});
  const result=await client.request<SupportPage<T>>(route+(route.includes('?')?'&':'?')+params,'GET',undefined,token);
  if(!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||result.pageSize<=0)throw Error('Invalid support page.');
  if(valid())setPage(result);
 }
 useEffect(()=>{
  if(!privateList||client.session.token)void run((token,valid)=>load(token,valid));
  // Each mounted desk has a single wallet, mode and access scope.
 },[client,route,privateList]);
 return {page,busy,error,notice,setNotice,run,load};
}
function Pager({page,busy,onPage}:{page:SupportPage<unknown>;busy:boolean;onPage:(n:number)=>void}){
 if(page.total<=page.pageSize)return null;
 return <nav className="gv3-support-actions" aria-label="Support pagination">
  <button disabled={busy||!page.page} onClick={()=>onPage(page.page-1)}>Previous page</button>
  <span>Page {page.page+1} of {Math.ceil(page.total/page.pageSize)}</span>
  <button disabled={busy||(page.page+1)*page.pageSize>=page.total} onClick={()=>onPage(page.page+1)}>Next page</button>
 </nav>;
}
function Feedback({error,notice}:{error:string;notice:string}){
 return <>{error&&<p className="gv2-error" role="alert">{error}</p>}{notice&&<p className="gv2-message" role="status">{notice}</p>}</>;
}
type Filters={status:TicketStatus|'';q:string};
export function V3SupportTickets({client,admin,wallet,onConnect}:{wallet:string;onConnect:()=>void}&Props){
 const desk=useDesk<TicketRow>(client,admin?'tickets?admin=1':'tickets',true);
 const {page,busy,run,load}=desk;
 const [ticket,setTicket]=useState<Ticket|null>(null),[title,setTitle]=useState(''),[message,setMessage]=useState(''),[reply,setReply]=useState('');
 const [filters,setFilters]=useState<Filters>({status:'',q:''}),[search,setSearch]=useState('');
 const titleRef=useRef<HTMLHeadingElement>(null);
 const reload=(index=0,next=filters)=>void run(async(token,valid)=>{
  await load(token,valid,index,next);if(valid()){setFilters(next);setTicket(null);setReply('');}
 });
 async function open(id:string){
  await run(async(token,valid)=>{
   const result=await client.request<Ticket>('tickets/'+id+(admin?'?admin=1':''),'GET',undefined,token);
   if(valid()){setTicket(result);setReply('');requestAnimationFrame(()=>titleRef.current?.focus());}
  });
 }
 function create(e:FormEvent){
  e.preventDefault();
  void run(async(token,valid)=>{
   const result=await client.request<Ticket>('tickets','POST',{title,message},token);
   if(valid()){
    setTicket(result);setTitle('');setMessage('');setReply('');setFilters({status:'',q:''});setSearch('');
    desk.setNotice('Your ticket was sent.');requestAnimationFrame(()=>titleRef.current?.focus());
    await load(token,valid);
   }
  });
 }
 function change(body:{message:string}|{status:TicketStatus}){
  if(!ticket)return;
  void run(async(token,valid)=>{
   const result=await client.request<Ticket>('tickets/'+ticket.id+(admin?'?admin=1':''),'POST',body,token);
   if(valid()){
    setTicket(result);setReply('');
    desk.setNotice('message' in body?'Reply sent.':body.status==='open'?'Ticket reopened.':'Ticket closed.');
    await load(token,valid,page?.page,filters);
   }
  });
 }
 return <section className="gv2-panel gv3-support" aria-label={admin?'Support inbox':'My support tickets'}>
  <header className="gv2-panel-head"><h2>{admin?'Support inbox':'My support tickets'}</h2>{admin?<Inbox size={20}/>:<LifeBuoy size={20}/>}</header>
  <Feedback error={desk.error} notice={desk.notice}/>
  {!page?<div className="gv3-support-access"><p>{admin?'Sign in to review member conversations.':'Connect and sign a support message to read your private conversations. No gas fee applies.'}</p>
   <button className="gv2-primary" disabled={busy} onClick={()=>wallet?reload():onConnect()}>{busy?'Opening inbox…':!wallet?'Connect wallet':admin?'Open support inbox':'Open my tickets'}</button></div>:<>
   <form className="gv3-support-tools" onSubmit={e=>{e.preventDefault();reload(0,{...filters,q:search.trim()});}}>
    <label>Ticket status<select value={filters.status} disabled={busy} onChange={e=>reload(0,{...filters,status:e.target.value as Filters['status']})}>
     <option value="">All statuses</option><option value="open">Open</option><option value="closed">Closed</option></select></label>
    <label>Find a ticket<input type="search" value={search} maxLength={120} onChange={e=>setSearch(e.target.value)} placeholder={admin?'Subject, wallet or ticket ID':'Subject or ticket ID'}/></label>
    <button disabled={busy}>Search</button><button type="button" disabled={busy} onClick={()=>reload(page.page)}>Refresh inbox</button>
   </form>
   <p>{page.total===0?'No tickets match this view.':page.total+' '+(page.total===1?'ticket':'tickets')}</p>
   <div className="gv3-support-list">{page.items.map(row=><button type="button" className="gv3-ticket-row" key={row.id} disabled={busy} onClick={()=>void open(row.id)} aria-pressed={ticket?.id===row.id}>
    <strong>{row.title}</strong><span className="gv3-status">{row.status}</span>
    <small>{admin&&<>{row.wallet} · </>}{formatUtcTime(row.updatedAt)} · {row.messages} {row.messages===1?'message':'messages'}</small>
   </button>)}</div>
   <Pager page={page} busy={busy} onPage={reload}/>
   {ticket&&<article className="gv3-support-thread"><h3 tabIndex={-1} ref={titleRef}>{ticket.title}</h3>
    <small>Ticket {ticket.id} · {ticket.status}</small>{admin&&<p>{ticket.wallet}</p>}
    <ol>{ticket.messages.map(entry=><li key={entry.id} className={entry.admin?'staff':''}>
     <strong>{entry.admin?'Support team':'Account holder'}</strong><time dateTime={entry.createdAt}>{formatUtcTime(entry.createdAt)}</time><p>{entry.message}</p>
    </li>)}</ol>
    {ticket.status==='open'&&<form onSubmit={e=>{e.preventDefault();change({message:reply});}}>
     <label>Reply<textarea required maxLength={4000} rows={3} value={reply} onChange={e=>setReply(e.target.value)}/></label>
     <button className="gv2-primary" disabled={busy||!reply.trim()}>Send reply</button>
    </form>}
    <button disabled={busy} onClick={()=>change({status:ticket.status==='open'?'closed':'open'})}>{ticket.status==='open'?'Close ticket':'Reopen ticket'}</button>
   </article>}
   {!admin&&<form className="gv3-support-compose" onSubmit={create}><h3>New support ticket</h3>
    <label>Subject<input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>Message<textarea required maxLength={4000} rows={4} value={message} onChange={e=>setMessage(e.target.value)}/></label>
    <button className="gv2-primary" disabled={busy||!title.trim()||!message.trim()}>Send ticket</button>
   </form>}
  </>}
 </section>;
}

export function V3Announcements({client,admin}:Props){
 const desk=useDesk<Announcement>(client,admin?'announcements?admin=1':'announcements',admin);
 const {page,busy,run,load}=desk;
 const [editing,setEditing]=useState<Announcement|null>(null),[title,setTitle]=useState(''),[message,setMessage]=useState('');
 const inputRef=useRef<HTMLInputElement>(null);
 const reload=(index=0)=>void run((token,valid)=>load(token,valid,index));
 function edit(item:Announcement|null){
  setEditing(item);setTitle(item?.title??'');setMessage(item?.message??'');
  if(item)inputRef.current?.focus();
 }
 function save(e:FormEvent){
  e.preventDefault();
  void run(async(token,valid)=>{
   if(editing)await client.request('announcements/'+editing.id,'PATCH',{title,message,ifRevision:editing.revision??1},token);
   else await client.request('announcements','POST',{title,message},token);
   if(valid()){
    desk.setNotice(editing?'Changes saved.':'Announcement published.');edit(null);await load(token,valid,editing?page?.page:0);
   }
  });
 }
 function publish(item:Announcement){
  void run(async(token,valid)=>{
   await client.request('announcements/'+item.id,'PATCH',{published:!item.published,ifRevision:item.revision??1},token);
   if(valid()){
    if(editing?.id===item.id)edit(null);
    desk.setNotice(item.published?'Announcement unpublished.':'Announcement published.');await load(token,valid,page?.page);
   }
  });
 }
 return <section className="gv2-panel gv3-support" aria-label={admin?'Announcement management':'Published announcements'}>
  <header className="gv2-panel-head"><h2>{admin?'Announcement management':'Published announcements'}</h2><Bell size={20}/></header>
  <Feedback error={desk.error} notice={desk.notice}/>
  {(!admin||page)&&<div className="gv3-support-actions"><button disabled={busy} onClick={()=>reload(page?.page)}>{busy?'Loading…':'Refresh announcements'}</button></div>}
  {admin&&!page&&<button className="gv2-primary" disabled={busy} onClick={()=>reload()}>{busy?'Opening…':'Manage announcements'}</button>}
  {admin&&page&&<form className="gv3-support-compose" onSubmit={save}><h3>{editing?'Edit announcement':'New announcement'}</h3>
   <label>Title<input ref={inputRef} required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label>
   <label>Announcement text<textarea required maxLength={6000} rows={4} value={message} onChange={e=>setMessage(e.target.value)}/></label>
   <div className="gv3-support-actions"><button className="gv2-primary" disabled={busy||!title.trim()||!message.trim()}>{editing?'Save changes':'Publish announcement'}</button>
    {editing&&<button type="button" disabled={busy} onClick={()=>edit(null)}>Cancel edit</button>}</div>
  </form>}
  {page&&!page.total&&<p>{admin?'There are no announcements yet.':'There are no published announcements yet.'}</p>}
  {page?.items.map(item=><article className="gv3-support-announcement" key={item.id}>
   <h3>{item.title}</h3><time dateTime={item.createdAt}>{formatUtcTime(item.createdAt)}</time>
   {admin&&<span className="gv3-status">{item.published?'Published':'Unpublished'}</span>}<p>{item.message}</p>
   {admin&&<div className="gv3-support-actions"><button disabled={busy} onClick={()=>edit(item)}>Edit</button><button disabled={busy} onClick={()=>publish(item)}>{item.published?'Unpublish':'Republish'}</button></div>}
  </article>)}
  {page&&<Pager page={page} busy={busy} onPage={reload}/>}
 </section>;
}
