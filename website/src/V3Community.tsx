import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {Bell,Inbox,LifeBuoy} from 'lucide-react';
import {formatUtcTime} from './utc-time';
import {SupportError,type Announcement,type SupportClient,type SupportPage,type Ticket,type TicketRow,type TicketStatus} from './v3-support';

import {channelPosts,channelProfile} from './v3-channel-content';

type Work=(token:string,valid:()=>boolean)=>Promise<void>;
type Props={client:SupportClient;admin:boolean};

function useDesk<T,P extends SupportPage<T>=SupportPage<T>>(client:SupportClient,route:string,privateList:boolean){
 const [page,setPage]=useState<P|null>(null),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const generation=useRef(0),running=useRef(false);
 useLayoutEffect(()=>()=>{generation.current++;running.current=false;},[client,route,privateList]);

 const lastQuery=useRef({index:0,filters:{} as Record<string,string>});
 const afterRefresh=useRef<Work|null>(null);
 async function run(work:Work,auth=privateList,background=false){
  if(running.current)return;
  const id=generation.current,valid=()=>generation.current===id;
  running.current=true;if(!background){setBusy(true);setError('');setNotice('');}
  try{
   const token=auth?await client.authenticate(valid,!background):'';
   if(valid()){await work(token,valid);if(valid())setError('');}
  }catch(e){
   if(valid()){
    if(e instanceof SupportError&&(e.status===401||e.status===403))setPage(null);
    setError(e instanceof Error?e.message:'Support is temporarily unavailable.');
   }
  }finally{if(valid()){running.current=false;setBusy(false);}}
 }
 async function load(token:string,valid:()=>boolean,index=0,filters:Record<string,string>={}){
  const params=new URLSearchParams({page:String(index),...filters});
  const result=await client.request<P>(route+(route.includes('?')?'&':'?')+params,'GET',undefined,token);
  if(!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||result.pageSize<=0)throw Error('Invalid support page.');
  if(valid()){lastQuery.current={index:result.page,filters};setPage(result);}
 }
 useEffect(()=>{
  function refresh(){
   if(document.visibilityState==='hidden'||(privateList&&!client.session.token))return;
   void run(async(token,valid)=>{
    const {index,filters}=lastQuery.current;
    await load(token,valid,index,filters);
    if(valid())await afterRefresh.current?.(token,valid);
   },privateList,true);
  }
  const expired=()=>{setPage(null);setNotice('');};
  refresh();
  const timer=window.setInterval(refresh,25000);
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  client.events.addEventListener('change',refresh);client.events.addEventListener('signed-in',refresh);
  client.events.addEventListener('expired',expired);
  return ()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);
   client.events.removeEventListener('change',refresh);client.events.removeEventListener('signed-in',refresh);client.events.removeEventListener('expired',expired);};
 },[client,route,privateList]);
 return {page,busy,error,notice,setNotice,run,load,afterRefresh};
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
export function V3SupportTickets({client,admin,wallet,onConnect,initialTicket}:{wallet:string;onConnect:()=>void;initialTicket?:string}&Props){
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
 const openOnLoad=useRef(initialTicket);
 useEffect(()=>{
  if(page&&openOnLoad.current&&!busy){const id=openOnLoad.current;openOnLoad.current=undefined;void open(id);}
 },[page,busy]);
 desk.afterRefresh.current=async(token,valid)=>{
  if(!ticket)return;
  const result=await client.request<Ticket>('tickets/'+ticket.id+(admin?'?admin=1':''),'GET',undefined,token);
  if(valid())setTicket(result);
 };
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

export function V3Announcements({client,admin,initialPost}:Props&{initialPost?:string}){
 const desk=useDesk<Announcement>(client,admin?'announcements?admin=1':'announcements',admin);
 const {page,busy,run,load}=desk;
 const [editing,setEditing]=useState<Announcement|null>(null),[title,setTitle]=useState(''),[message,setMessage]=useState('');
 const [starterKey,setStarterKey]=useState(''),[reviewPack,setReviewPack]=useState(false);
 const inputRef=useRef<HTMLInputElement>(null);
 const [selected,setSelected]=useState<Announcement|null>(null);
 useEffect(()=>{
  if(!initialPost)return;
  let active=true;
  const get=()=>client.request<Announcement>('announcements/'+initialPost).then(item=>{if(active)setSelected(item);},()=>{if(active)setSelected(null);});
  void get();const timer=window.setInterval(()=>{if(document.visibilityState!=='hidden')void get();},25000);
  return()=>{active=false;clearInterval(timer);};
 },[client,initialPost]);
 const reload=(index=0)=>void run((token,valid)=>load(token,valid,index));
 function edit(item:Announcement|null){
  setStarterKey('');setEditing(item);setTitle(item?.title??'');setMessage(item?.message??'');
  if(item)inputRef.current?.focus();
 }
 function save(e:FormEvent){
  e.preventDefault();
  void run(async(token,valid)=>{
   if(editing)await client.request('announcements/'+editing.id,'PATCH',{title,message,ifRevision:editing.revision??1},token);
   else await client.request('announcements','POST',{title,message,starterKey},token);
   if(valid()){
    desk.setNotice(editing?'Changes saved.':'Announcement published.');edit(null);await load(token,valid,editing?page?.page:0);
   }
  });
 }
 function publishPack(){
  void run(async(token,valid)=>{
   const result=await client.request<{published:number;synced:number}>('announcements/starter-pack','POST',{posts:channelPosts},token);
   if(valid()){setReviewPack(false);desk.setNotice(result.published?result.published+' starter posts published.':result.synced?result.synced+' existing starter posts queued for Telegram.':'All starter posts are up to date.');await load(token,valid);}
  });
 }
 function sync(item:Announcement){
  void run(async(token,valid)=>{
   const result=await client.request<{queued:boolean}>('announcements/'+item.id+'/channel','POST',{},token);
   if(valid())desk.setNotice(result.queued?'Channel delivery queued.':'This version is already queued or published to the channel.');
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
   {!editing&&<details><summary>Channel profile and starter posts</summary><p><strong>{channelProfile.name}</strong><br/>{channelProfile.bio}</p>
    <label>Start from a post<select defaultValue="" onChange={e=>{const post=channelPosts[Number(e.target.value)];if(post){setStarterKey(post.key);setTitle(post.title);setMessage(post.message);}e.target.value='';}}>
     <option value="" disabled>Choose a draft</option>{channelPosts.map((post,i)=><option key={post.title} value={i}>{post.title}</option>)}</select></label>
    <button type="button" disabled={busy} onClick={()=>setReviewPack(!reviewPack)}>{reviewPack?'Close preview':'Preview all six posts'}</button>
    {reviewPack&&<div>{channelPosts.map(post=><article key={post.key}><h4>{post.title}</h4><p>{post.message}</p></article>)}
     <p>Publish missing posts to the website. A configured channel receives the new posts as well.</p>
     <button className="gv2-primary" type="button" disabled={busy} onClick={publishPack}>Publish starter posts</button></div>}
   </details>}
   <label>Title<input ref={inputRef} required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label>
   <label>Announcement text<textarea required maxLength={6000} rows={4} value={message} onChange={e=>setMessage(e.target.value)}/></label>
   <div className="gv3-support-actions"><button className="gv2-primary" disabled={busy||!title.trim()||!message.trim()}>{editing?'Save changes':'Publish announcement'}</button>
    {editing&&<button type="button" disabled={busy} onClick={()=>edit(null)}>Cancel edit</button>}</div>
  </form>}
  {page&&!page.total&&<p>{admin?'There are no announcements yet.':'There are no published announcements yet.'}</p>}
  {selected&&<article className="gv3-support-announcement" aria-label="Selected announcement"><h3>{selected.title}</h3><p>{selected.message}</p></article>}
  {page?.items.filter(item=>item.id!==selected?.id).map(item=><article className="gv3-support-announcement" key={item.id}>
   <h3>{item.title}</h3><time dateTime={item.createdAt}>{formatUtcTime(item.createdAt)}</time>
   {admin&&<span className="gv3-status">{item.published?'Published':'Unpublished'}</span>}<p>{item.message}</p>
   {admin&&<div className="gv3-support-actions"><button disabled={busy} onClick={()=>edit(item)}>Edit</button><button disabled={busy} onClick={()=>publish(item)}>{item.published?'Unpublish':'Republish'}</button>{item.published&&<button disabled={busy} onClick={()=>sync(item)}>Sync to Telegram</button>}</div>}
  </article>)}
  {page&&<Pager page={page} busy={busy} onPage={reload}/>}
 </section>;
}

type AlertKind='announcement'|'ticket-opened'|'ticket-reply'|'ticket-closed'|'ticket-reopened';
type NotificationRow={seq:number;kind:AlertKind;ref:string;at:string;title:string;unread:boolean};
type DeliveryIssue={key:string;target:'admin'|'channel';status:'failed'|'review';reason:string};
type NotificationPage=SupportPage<NotificationRow>&{latest:number;unread:number;telegram?:{
 privateConfigured:boolean;channelConfigured:boolean;pending:number;issues:DeliveryIssue[]}};
const labels:Record<AlertKind,string>={'announcement':'Announcement','ticket-opened':'New support ticket',
 'ticket-reply':'Support ticket reply','ticket-closed':'Ticket closed','ticket-reopened':'Ticket reopened'};

export function NotificationBell({client,admin,onOpen}:Props&{onOpen:()=>void}){
 const desk=useDesk<NotificationRow,NotificationPage>(client,'notifications?summary=1'+(admin?'&admin=1':''),true);
 const count=desk.page?.unread??0;
 return <button type="button" className="gv3-notification-bell" onClick={onOpen}
  aria-label={(admin?'Admin notifications':'Notifications')+(count?', '+count+' unread':'')}><Bell size={18}/>
  {count>0&&<span aria-hidden="true">{count>99?'99+':count}</span>}</button>;
}

export function V3Notifications({client,admin,wallet,onConnect,onItem,onPublic,onSwitch,onManage}:Props&{
 wallet:string;onConnect:()=>void;onItem:(kind:AlertKind,id:string)=>void;onPublic:()=>void;onSwitch?:()=>void;onManage?:(area:'tickets'|'announcements')=>void}){
 const suffix=admin?'?admin=1':'';
 const desk=useDesk<NotificationRow,NotificationPage>(client,'notifications'+suffix,true);
 const {page,busy,run,load}=desk;
 const [selectedIssue,setIssue]=useState(''),[messageId,setMessageId]=useState('');
 const reload=(index=0)=>void run((token,valid)=>load(token,valid,index));
 function mark(){
  if(!page)return;
  void run(async(token,valid)=>{
   await client.request('notifications/read'+suffix,'POST',{through:page.latest},token);
   await load(token,valid,page.page);if(valid())desk.setNotice('Notifications marked as read.');
  });
 }
 function reconcile(key:string,action:'retry'|'confirm'){
  void run(async(token,valid)=>{
   await client.request('telegram/reconcile','POST',{key,action,messageId:Number(messageId)},token);
   if(valid()){setIssue('');setMessageId('');await load(token,valid);}
  });
 }
 const telegram=page?.telegram;
 return <section className="gv2-panel gv3-support" aria-label={admin?'Admin notifications':'Member notifications'}>
  <header className="gv2-panel-head"><h2>{admin?'Admin notifications':'My notifications'}</h2><Inbox size={20}/></header>
  <Feedback error={desk.error} notice={desk.notice}/>
  {!page?<div className="gv3-support-access"><p>{admin?'Sign with your manager wallet to read support alerts and check Telegram delivery.':'Sign with your wallet to see ticket replies and public announcements in one place.'}</p>
   <div className="gv3-support-actions"><button className="gv2-primary" disabled={busy} onClick={()=>wallet?reload():onConnect()}>{busy?'Opening…':wallet?'Open notifications':'Connect wallet'}</button>
   <button onClick={onPublic}>Read public announcements</button></div></div>:<>
   <div className="gv3-support-actions"><strong>{page.unread} unread</strong><button disabled={busy||!page.unread} onClick={mark}>Mark all as read</button>
    <button disabled={busy} onClick={()=>reload(page.page)}>Refresh</button></div>
   {page.total===0&&<p>Your inbox is up to date.</p>}
   <div className="gv3-support-list">{page.items.map(item=><button key={item.seq} className="gv3-ticket-row" onClick={()=>onItem(item.kind,item.ref)}>
    <strong>{item.title}</strong>{item.unread&&<span className="gv3-status">Unread</span>}
    <small>{labels[item.kind]} · {formatUtcTime(item.at)}</small></button>)}</div>
   <Pager page={page} busy={busy} onPage={reload}/>
   {admin&&onManage&&<nav className="gv3-support-actions" aria-label="Community management"><button onClick={()=>onManage('tickets')}>Support inbox</button><button onClick={()=>onManage('announcements')}>Manage announcements</button></nav>}
   {telegram&&<section className="gv3-support-thread"><h3>Telegram delivery</h3>
    <dl className="gv3-member-facts"><div><dt>Admin messages</dt><dd>{telegram.privateConfigured?'Configured':'Setup required'}</dd></div>
    <div><dt>Announcement channel</dt><dd>{telegram.channelConfigured?'Configured':'Setup required'}</dd></div>
    <div><dt>Pending messages</dt><dd>{telegram.pending}</dd></div></dl>
    {telegram.issues.map(issue=><article key={issue.key}><strong>{issue.target==='channel'?'Channel post':'Admin message'}</strong>
     <p>{issue.reason}</p><small>{issue.key}</small>
     {selectedIssue!==issue.key?<button onClick={()=>{setIssue(issue.key);setMessageId('');}}>Review delivery</button>:<div className="gv3-support-actions">
      <label>Delivered message ID<input inputMode="numeric" value={messageId} onChange={e=>setMessageId(e.target.value)}/></label>
      <button disabled={busy||!/^\d+$/.test(messageId)} onClick={()=>reconcile(issue.key,'confirm')}>Confirm existing message</button>
      <button disabled={busy} onClick={()=>reconcile(issue.key,'retry')}>I checked Telegram. Retry delivery</button></div>}
    </article>)}
   </section>}
  </>}
  {onSwitch&&<button onClick={onSwitch}>{admin?'My member notifications':'Admin notifications'}</button>}
 </section>;
}
