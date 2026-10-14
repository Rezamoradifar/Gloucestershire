import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {getAddress,isAddress,verifyMessage} from 'ethers';
const fail=(status,message)=>Object.assign(Error(message),{status});
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw fail(400,`Text must contain 1–${max} characters.`);return v.trim();};
export async function createCommunity({file,owner,chainId,contract,origin='https://globaldroptrade.com',now=Date.now}){
 let state;try{state=JSON.parse(await readFile(file,'utf8'));if(state.version!==1||!Array.isArray(state.tickets)||!Array.isArray(state.announcements))throw Error('Invalid community data');}catch(e){if(e.code!=='ENOENT')throw e;state={version:1,tickets:[],announcements:[]};}
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});
 let queue=Promise.resolve();const challenges=new Map(),sessions=new Map(),rates=new Map();
 function mutate(fn){const result=queue.then(async()=>{const next=structuredClone(state),value=fn(next),tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(next),{mode:0o600,flag:'wx'});await rename(tmp,file);}finally{await unlink(tmp).catch(()=>{});}state=next;return value;});queue=result.catch(()=>{});return result;}
 function prune(){for(const map of [challenges,sessions,rates])for(const [key,value] of map)if(value.expires<=now())map.delete(key);}
 async function body(req){let size=0,data='';for await(const chunk of req){size+=chunk.length;if(size>16384)throw fail(413,'Request too large.');data+=chunk;}try{return JSON.parse(data||'{}');}catch{throw fail(400,'Invalid JSON.');}}
 function user(req){prune();const token=(req.headers.authorization||'').replace(/^Bearer /,'');const session=sessions.get(token);if(!session)throw fail(401,'Sign in with your wallet again.');return session.wallet;}
 async function admin(wallet){let current;try{current=await owner();}catch{throw fail(503,'Could not verify support administrator.');}if(current.toLowerCase()!==wallet.toLowerCase())throw fail(403,'Administrator permission required.');}
 return async function handle(req,res){const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/community/'))return false;
 const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 try{prune();const route=url.pathname.slice('/api/community/'.length),method=req.method;
 if(route==='announcements'&&method==='GET'){send(200,{items:state.announcements.filter(a=>a.published).slice(-100).reverse()});return true;}
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
 if(route==='announcements'&&method==='POST'){await admin(wallet);const b=await body(req),title=text(b.title,120),message=text(b.message,6000);const item=await mutate(s=>{if(s.announcements.length>=5000)throw fail(409,'Announcement storage limit reached.');const item={id:randomUUID(),title,message,published:true,createdAt:new Date(now()).toISOString()};s.announcements.push(item);return item;});send(201,item);return true;}
 if(route.startsWith('announcements/')&&method==='DELETE'){await admin(wallet);const id=route.slice(14);await mutate(s=>{const item=s.announcements.find(a=>a.id===id);if(!item)throw fail(404,'Announcement not found.');item.published=false;});send(200,{ok:true});return true;}
 if(route==='tickets'&&method==='GET'){const all=url.searchParams.get('admin')==='1';if(all)await admin(wallet);const items=state.tickets.filter(t=>all||t.wallet.toLowerCase()===wallet.toLowerCase()).slice(-100).reverse().map(({messages,...t})=>({...t,messages:messages.length}));send(200,{items});return true;}
 if(route==='tickets'&&method==='POST'){const b=await body(req),title=text(b.title,120),message=text(b.message,4000);const item=await mutate(s=>{if(s.tickets.length>=10000||s.tickets.filter(t=>t.wallet===wallet&&t.status==='open').length>=20)throw fail(409,'Ticket limit reached.');const time=new Date(now()).toISOString(),item={id:randomUUID(),wallet,title,status:'open',createdAt:time,updatedAt:time,messages:[{id:randomUUID(),wallet,message,createdAt:time,admin:false}]};s.tickets.push(item);return item;});send(201,item);return true;}
 const match=route.match(/^tickets\/([a-zA-Z0-9-]+)$/);
 if(match){const ticket=state.tickets.find(t=>t.id===match[1]);if(!ticket)throw fail(404,'Ticket not found.');const own=ticket.wallet.toLowerCase()===wallet.toLowerCase();if(!own)await admin(wallet);
  if(method==='GET'){send(200,ticket);return true;}
  if(method==='POST'){const b=await body(req);if(b.status!==undefined&&!['open','closed'].includes(b.status))throw fail(400,'Invalid ticket status.');const message=b.message===undefined?null:text(b.message,4000);if(!message&&b.status===undefined)throw fail(400,'Message or status required.');const item=await mutate(s=>{const t=s.tickets.find(t=>t.id===match[1]);if(message){if(t.status==='closed'&&b.status!=='open')throw fail(409,'Reopen the ticket before replying.');if(t.messages.length>=200)throw fail(409,'Ticket message limit reached.');t.messages.push({id:randomUUID(),wallet,message,createdAt:new Date(now()).toISOString(),admin:!own});}if(b.status)t.status=b.status;t.updatedAt=new Date(now()).toISOString();return t;});send(200,item);return true;}
 }
 throw fail(404,'Route not found.');
 }catch(e){send(e.status||500,{error:e.status?e.message:'Support service unavailable.'});}return true;
 };
}
