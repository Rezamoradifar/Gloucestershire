import {randomBytes,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {access,mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {getAddress,isAddress,verifyMessage} from 'ethers';
import {initializeNotifications,communityEvent,notificationFeed} from './portfolio-notifications.mjs';
import {telegramSettings,createTelegramDelivery,telegramStatus,reconcileTelegram,recoverTelegram} from './portfolio-telegram.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw fail(400,`Text must contain 1–${max} characters.`);return v.trim();};
export async function createCommunity({file,owner,isAdmin,chainId,contract,origin='https://globaldroptrade.com',now=Date.now,prefix='/api/community/',telegram=null}){
 const portfolio=chainId===97 && isAddress(contract) && prefix==='/api/v3/community/'+contract.toLowerCase()+'/';
 if((portfolio&&typeof isAdmin!=='function')||(!portfolio&&!['/api/community/','/api/v2/community/'].includes(prefix)))throw Error('Community API prefix is not approved.');
 let state;try{state=JSON.parse(await readFile(file,'utf8'));if(state.version!==1||!Array.isArray(state.tickets)||!Array.isArray(state.announcements))throw Error('Invalid community data');}catch(e){if(e.code!=='ENOENT')throw e;state={version:1,tickets:[],announcements:[]};}
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});
 if(portfolio)await access(path.dirname(file),constants.W_OK);
 let queue=Promise.resolve();const challenges=new Map(),sessions=new Map(),rates=new Map();
 function mutate(fn){const result=queue.then(async()=>{const next=structuredClone(state),value=fn(next),tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(next),{mode:0o600,flag:'wx'});await rename(tmp,file);}finally{await unlink(tmp).catch(()=>{});}state=next;return value;});queue=result.catch(()=>{});return result;}
 if(portfolio){initializeNotifications(state);recoverTelegram(state);}
 const delivery=portfolio ? telegram : null;
 const event=(s,kind,item,audience,at)=>{if(portfolio)communityEvent(s,kind,item,audience,at,delivery);};
 let delivering=false,closed=false;
 async function flush(){
  if(!delivery||delivering||closed)return;
  delivering=true;
  try{for(let n=0;n<20&&!closed&&await delivery.deliver(mutate,()=>state);n++){}}
  catch{console.error('Could not update the Telegram delivery queue.');}
  finally{delivering=false;}
 }
 const timer=delivery?setInterval(flush,3000):null;
 timer?.unref();if(delivery)void flush();
 function syncPost(s,item){
  if(!delivery?.config.channel||!item.published||s.telegram?.jobs['post/'+item.id])return false;
  const existing=s.telegram?.posts[item.id];
  if(existing?.chat===delivery.config.channel&&existing.revision===(item.revision||1))return false;
  delivery.enqueue(s,{kind:'announcement',item,channelOnly:true});return true;
 }
 function publishNew(s,entry){
  const item={id:randomUUID(),...entry,published:true,createdAt:new Date(now()).toISOString()};
  s.announcements.push(item);event(s,'announcement',item,'all',item.createdAt);return item;
 }
 function prune(){for(const map of [challenges,sessions,rates])for(const [key,value] of map)if(value.expires<=now())map.delete(key);}
 async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>32768)throw fail(413,'Request too large.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw fail(400,'Invalid JSON.');}}
 function user(req){prune();const token=(req.headers.authorization||'').replace(/^Bearer /,'');const session=sessions.get(token);if(!session)throw fail(401,'Sign in with your wallet again.');return session.wallet;}
 async function admin(wallet){
  let allowed;
  try{allowed=isAdmin?await isAdmin(wallet):(await owner()).toLowerCase()===wallet.toLowerCase();}
  catch{throw fail(503,'Could not verify support administrator.');}
  if(allowed!==true)throw fail(403,'Administrator permission required.');
 }
 function list(items,params){
  const raw=params.get('page'),size=portfolio?20:100;
  if(raw!==null&&!/^(0|[1-9][0-9]{0,4})$/.test(raw))throw fail(400,'Invalid page.');
  const total=items.length,page=Math.min(Number(raw??0),Math.max(0,Math.ceil(total/size)-1));
  return {items:items.slice(page*size,(page+1)*size),page,total,pageSize:size};
 }
 async function handle(req,res){const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(prefix))return false;
 const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(portfolio?{...value,chainId,vault:contract}:value));};
 try{prune();const route=url.pathname.slice(prefix.length),method=req.method;
 if(route==='announcements'&&method==='GET'){
  const all=url.searchParams.get('admin')==='1';
  if(all)await admin(user(req));
  const items=state.announcements.filter(item=>all||item.published).reverse();
  if(portfolio)items.sort((a,b)=>(b.updatedAt||b.createdAt).localeCompare(a.updatedAt||a.createdAt));
  send(200,list(items,url.searchParams));return true;
 }
 const publicPost=portfolio && method==='GET' && route.match(/^announcements\/([a-zA-Z0-9-]+)$/);
 if(publicPost){
  const item=state.announcements.find(a=>a.id===publicPost[1]&&a.published);
  if(!item)throw fail(404,'Announcement is no longer published.');
  send(200,item);return true;
 }
 if(route==='challenge'&&method==='POST'){
  const peer=req.socket.remoteAddress||'unknown',rate=rates.get(peer)||{count:0,expires:now()+60000};if(++rate.count>60)throw fail(429,'Too many sign-in attempts. Try later.');rates.set(peer,rate);
  const b=await body(req);if(!isAddress(b.wallet))throw fail(400,'Invalid wallet.');if(challenges.size>=1000)throw fail(429,'Try again later.');
  const wallet=getAddress(b.wallet),nonce=randomBytes(24).toString('hex'),expires=now()+300000;
  const message=`GlobalDropTrade support sign-in\nOrigin: ${origin}\nChain: ${chainId}\nContract: ${contract}\nWallet: ${wallet}\nNonce: ${nonce}\nExpires: ${new Date(expires).toISOString()}\nThis signature authenticates support access only. It does not authorize a transaction.`;
  challenges.set(nonce,{wallet,message,expires});send(200,{nonce,message});return true;
 }
 if(route==='session'&&method==='POST'){
  const b=await body(req),challenge=challenges.get(b.nonce);challenges.delete(b.nonce);if(!challenge)throw fail(401,'Sign-in challenge expired or already used.');
  let signer;try{signer=verifyMessage(challenge.message,b.signature);}catch{throw fail(401,'Invalid signature.');}if(signer.toLowerCase()!==challenge.wallet.toLowerCase())throw fail(401,'Signature does not match the wallet.');
  if(sessions.size>=5000)throw fail(429,'Try later.');const token=randomBytes(32).toString('hex');sessions.set(token,{wallet:challenge.wallet,expires:now()+3600000});send(200,{token,wallet:challenge.wallet});return true;
 }
 const wallet=user(req);
 if(portfolio && (route==='notifications'||route==='notifications/read')){
  const asAdmin=url.searchParams.get('admin')==='1';
  if(asAdmin)await admin(wallet);
  if(route==='notifications' && method==='GET'){
   const feed=notificationFeed(state,wallet,asAdmin);
   if(url.searchParams.get('summary')==='1'){send(200,{items:[],total:feed.items.length,page:0,pageSize:20,unread:feed.unread,latest:feed.latest});return true;}
   send(200,{...list(feed.items,url.searchParams),unread:feed.unread,latest:feed.latest,
    ...(asAdmin?{telegram:telegramStatus(state,delivery?.config)}:{})});return true;
  }
  if(route==='notifications/read' && method==='POST'){
   const {through}=await body(req);
   await mutate(s=>{
    const feed=notificationFeed(s,wallet,asAdmin);
    if(!Number.isSafeInteger(through)||through<0||through>s.notifications.latest)throw fail(400,'Invalid notification cursor.');
    // Only a high-water mark actually visible to this inbox can be acknowledged.
    if(through && !feed.items.some(r=>r.seq===through))throw fail(409,'The notification list changed. Refresh and try again.');
    if(through)s.notifications.read[feed.key]=Math.max(s.notifications.read[feed.key]||0,through);
   });send(200,{ok:true});return true;
  }
 }
 if(portfolio && route==='telegram/reconcile' && method==='POST'){
  await admin(wallet);
  const {key,action,messageId}=await body(req);
  if(typeof key!=='string'||key.length>120||!Object.hasOwn(state.telegram?.jobs || {},key))throw fail(404,'Delivery not found.');
  await mutate(s=>reconcileTelegram(s,key,action,messageId,delivery?.config));send(200,{ok:true});return true;
 }
 if(portfolio&&route==='announcements/starter-pack'&&method==='POST'){
  await admin(wallet);
  const {posts}=await body(req);
  if(!Array.isArray(posts)||posts.length!==6)throw fail(400,'Six channel posts are required.');
  const required=new Set(['welcome','notifications','private-support','history','network','service-updates']);
  const entries=posts.map(post=>{
   if(!required.delete(post?.key))throw fail(400,'Invalid starter post.');
   return {title:text(post.title,120),message:text(post.message,6000),starterKey:post.key};
  });
  const result=await mutate(s=>{
   const missing=entries.filter(post=>!s.announcements.some(a=>a.starterKey===post.starterKey));
   if(s.announcements.length+missing.length>5000)throw fail(409,'Announcement storage limit reached.');
   for(const entry of missing)publishNew(s,entry);
   let synced=0;
   for(const item of s.announcements)if(item.starterKey&&syncPost(s,item))synced++;
   return {published:missing.length,synced};
  });
  send(200,result);return true;
 }
 if(route==='announcements'&&method==='POST'){
  await admin(wallet);const b=await body(req),title=text(b.title,120),message=text(b.message,6000);
  const starterKey=portfolio&&b.starterKey;
  if(starterKey&&!['welcome','notifications','private-support','history','network','service-updates'].includes(starterKey))throw fail(400,'Unknown starter post.');
  const item=await mutate(s=>{
   if(s.announcements.length>=5000)throw fail(409,'Announcement storage limit reached.');
   if(starterKey&&s.announcements.some(a=>a.starterKey===starterKey))throw fail(409,'This starter post already exists. Edit the existing announcement.');
   return publishNew(s,{title,message,...(starterKey?{starterKey}:{})});
  });send(201,item);return true;
 }
 const channelPost=portfolio && route.match(/^announcements\/([a-zA-Z0-9-]+)\/channel$/);
 if(channelPost&&method==='POST'){
  await admin(wallet);
  if(!delivery?.config.channel)throw fail(409,'Set up the Telegram announcement channel first.');
  const queued=await mutate(s=>{
   const item=s.announcements.find(a=>a.id===channelPost[1]&&a.published);
   if(!item)throw fail(404,'Published announcement not found.');
   return syncPost(s,item);
  });
  send(200,{queued});return true;
 }
 const announcement=route.match(/^announcements\/([a-zA-Z0-9-]+)$/);
 if(announcement&&(method==='DELETE'||(method==='PATCH'&&portfolio))){
  await admin(wallet);
  const changes=method==='DELETE'?{published:false}:await body(req);
  const expected=changes?.ifRevision;
  if(expected!==undefined){
   if(!Number.isSafeInteger(expected)||expected<1)throw fail(400,'Invalid revision.');
   delete changes.ifRevision;
  }
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||
   Object.keys(changes).some(key=>!['title','message','published'].includes(key))||
   ('published' in changes&&typeof changes.published!=='boolean'))throw fail(400,'Invalid announcement update.');
  if('title' in changes)changes.title=text(changes.title,120);
  if('message' in changes)changes.message=text(changes.message,6000);
  const item=await mutate(s=>{
   const item=s.announcements.find(a=>a.id===announcement[1]);if(!item)throw fail(404,'Announcement not found.');
   const revision=item.revision??1;
   if(expected!==undefined&&revision!==expected)throw fail(409,'This announcement changed. Refresh before editing it again.');
   const wasPublished=item.published;
   Object.assign(item,changes,{updatedAt:new Date(now()).toISOString(),revision:revision+1});
   if(wasPublished||item.published)event(s,'announcement',item,'all',item.updatedAt);return item;
  });
  send(200,method==='DELETE'?{ok:true}:item);return true;
 }
 if(route==='tickets'&&method==='GET'){
  const all=url.searchParams.get('admin')==='1',status=url.searchParams.get('status');
  if(all)await admin(wallet);
  if(status&&!['open','closed'].includes(status))throw fail(400,'Invalid ticket status.');
  const query=(url.searchParams.get('q')??'').trim().toLowerCase();
  if(query.length>120)throw fail(400,'Ticket search is too long.');
  const items=state.tickets.filter(t=>(all||t.wallet.toLowerCase()===wallet.toLowerCase())&&(!status||t.status===status)&&
   (!query||[t.title,t.id,t.wallet].some(value=>value.toLowerCase().includes(query)))).reverse();
  if(portfolio)items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const page=list(items,url.searchParams);
  send(200,{...page,items:page.items.map(({messages,...t})=>({...t,messages:messages.length}))});return true;
 }
 if(route==='tickets'&&method==='POST'){const b=await body(req),title=text(b.title,120),message=text(b.message,4000);const item=await mutate(s=>{if(s.tickets.length>=10000||s.tickets.filter(t=>t.wallet===wallet&&t.status==='open').length>=20)throw fail(409,'Ticket limit reached.');const time=new Date(now()).toISOString(),item={id:randomUUID(),wallet,title,status:'open',createdAt:time,updatedAt:time,messages:[{id:randomUUID(),wallet,message,createdAt:time,admin:false}]};s.tickets.push(item);event(s,'ticket-opened',item,'managers',time);return item;});send(201,item);return true;}
 const match=route.match(/^tickets\/([a-zA-Z0-9-]+)$/);
 if(match){const ticket=state.tickets.find(t=>t.id===match[1]);if(!ticket)throw fail(404,'Ticket not found.');const own=ticket.wallet.toLowerCase()===wallet.toLowerCase(),staff=portfolio&&url.searchParams.get('admin')==='1';if(staff||!own)await admin(wallet);
  if(method==='GET'){send(200,ticket);return true;}
  if(method==='POST'){const b=await body(req);if(b.status!==undefined&&!['open','closed'].includes(b.status))throw fail(400,'Invalid ticket status.');const message=b.message===undefined?null:text(b.message,4000);if(!message&&b.status===undefined)throw fail(400,'Message or status required.');const item=await mutate(s=>{const t=s.tickets.find(t=>t.id===match[1]);const prior=t.status;if(message){if(t.status==='closed'&&b.status!=='open')throw fail(409,'Reopen the ticket before replying.');if(t.messages.length>=200)throw fail(409,'Ticket message limit reached.');t.messages.push({id:randomUUID(),wallet,message,createdAt:new Date(now()).toISOString(),admin:staff||!own});}if(b.status)t.status=b.status;t.updatedAt=new Date(now()).toISOString();
   const audience=staff||!own?t.wallet.toLowerCase():'managers';
   if(message)event(s,'ticket-reply',t,audience,t.updatedAt);
   if(prior!==t.status)event(s,t.status==='open'?'ticket-reopened':'ticket-closed',t,audience,t.updatedAt);
   return t;});send(200,item);return true;}
 }
 throw fail(404,'Route not found.');
 }catch(e){send(e.status||500,{error:e.status?e.message:'Support service unavailable.'});}return true;
 }
 handle.close=()=>{closed=true;if(timer)clearInterval(timer);};
 return handle;
}

// Keep each portfolio's tickets, one-use challenges and sessions in its own namespace.
export function createPortfolioCommunity(reader,{directory='/var/lib/globaldroptrade-api/v3',origin,
 telegram=telegramSettings(),deliveryOptions}={}){
 const stores=new Map();
 function open(vault,authority){
  if(!stores.has(vault)){
   const key=vault.toLowerCase();
   const delivery=key===telegram?.vault?createTelegramDelivery(telegram,deliveryOptions):null;
   const job=createCommunity({file:path.join(directory,key,'community.json'),prefix:'/api/v3/community/'+key+'/',
    chainId:97,contract:vault,origin,isAdmin:authority,telegram:delivery}).catch(error=>{stores.delete(vault);throw error;});
   stores.set(vault,job);
  }
  return stores.get(vault);
 }
 // Resume outstanding deliveries even when the website has no visitors after a restart.
 if(telegram){
  const vault=getAddress(telegram.vault),authority=reader?.supportAuthority(vault);
  if(authority)void open(vault,authority).catch(()=>console.error('Telegram support storage unavailable.'));
 }
 async function handle(req,res){
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(!pathname.startsWith('/api/v3/community/'))return false;
  const match=pathname.match(/^\/api\/v3\/community\/(0x[0-9a-f]{40})\//);
  const vault=match?getAddress(match[1]):null;
  const authority=vault&&reader?.supportAuthority(vault);
  if(!authority){res.writeHead(404);res.end(JSON.stringify({error:'Unknown support workspace.'}));return true;}
  try{return await (await open(vault,authority))(req,res);}
  catch{res.writeHead(503);res.end(JSON.stringify({error:'Support storage is temporarily unavailable.'}));return true;}
 }
 handle.close=()=>{for(const job of stores.values())void job.then(store=>store.close(),()=>{});};
 return handle;
}
