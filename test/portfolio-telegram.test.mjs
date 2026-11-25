import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegramDelivery,telegramSettings,telegramStatus,recoverTelegram,reconcileTelegram} from '../server/portfolio-telegram.mjs';
import {initializeNotifications,notificationFeed,communityEvent} from '../server/portfolio-notifications.mjs';

const vault='0x'+'1'.repeat(40),wallet='0x'+'3'.repeat(40),other='0x'+'4'.repeat(40);
const config={vault,token:'900:'+ 'x'.repeat(32),admin:'123456789',channel:'-1001234567890'};
const at='2026-11-25T15:00:00.000Z';
function fixture(){
 const s={tickets:[],announcements:[]},calls=[];
 initializeNotifications(s);
 let clock=1,respond;
 const telegram=createTelegramDelivery(config,{now:()=>clock,fetchImpl:async(url,init)=>{
  assert.ok(url.startsWith('https://api.telegram.org/bot'+config.token+'/'));assert.equal(init.redirect,'error');
  const data=JSON.parse(init.body);calls.push({method:url.split('/').at(-1),...data});
  if(respond)return respond(data);
  return {ok:true,json:async()=>({ok:true,result:{chat:{id:Number(data.chat_id)},message_id:data.message_id||calls.length}})};
 }});
 const step=()=>telegram.deliver(async fn=>fn(s),()=>s);
 const drain=async()=>{for(let n=0;n<20&&await step();n++){}};
 const post={id:'N-1',title:'Hours',message:'Public news',revision:1,published:true,createdAt:at};
 s.announcements.push(post);
 const change=()=>communityEvent(s,'announcement',post,'all',at,telegram);
 return {s,calls,telegram,post,change,step,drain,setReply(fn){respond=fn;},advance(ms){clock+=ms;}};
}
test('only the configured portfolio and valid private/channel destinations enable Telegram',()=>{
 assert.equal(telegramSettings({}),null);
 assert.deepEqual(telegramSettings({GLOBAL_TELEGRAM_VAULT:vault,GLOBAL_TELEGRAM_BOT_TOKEN:config.token,
  GLOBAL_TELEGRAM_ADMIN_CHAT_ID:config.admin,GLOBAL_TELEGRAM_CHANNEL_ID:config.channel}),config);
 assert.equal(telegramSettings({GLOBAL_TELEGRAM_VAULT:vault,GLOBAL_TELEGRAM_BOT_TOKEN:config.token,
  GLOBAL_TELEGRAM_ADMIN_CHAT_ID:config.channel,GLOBAL_TELEGRAM_CHANNEL_ID:'@other'}),null);
});
test('private activity goes only to the administrator and never includes ticket contents or wallet addresses',async()=>{
 const f=fixture(),t={id:'T-17',title:'Sensitive account details',wallet,messages:[]};f.s.tickets.push(t);
 communityEvent(f.s,'ticket-opened',t,'managers',at,f.telegram);
 communityEvent(f.s,'ticket-reply',t,wallet,at,f.telegram);
 await f.drain();assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].chat_id,config.admin);assert.match(f.calls[0].text,/T-17/);
 assert.doesNotMatch(f.calls[0].text,/Sensitive|0x333/);
 assert.equal(notificationFeed(f.s,wallet,false).items[0].kind,'ticket-reply');
 assert.equal(notificationFeed(f.s,other,false).items.length,0);assert.equal(notificationFeed(f.s,other,true).items[0].kind,'ticket-opened');
});
test('publication edits, timed-out updates and withdrawal reconcile the same message without a second channel post',async()=>{
 const f=fixture();f.change();await f.drain();const first=f.calls.find(c=>c.chat_id===config.channel);
 assert.equal(first.method,'sendMessage');assert.match(first.text,/Public news/);
 f.post.message='Updated report '.repeat(440);f.post.revision++;f.change();
 await f.drain();let edit=f.calls.filter(c=>c.chat_id===config.channel).at(-1);
 assert.equal(edit.method,'editMessageText');assert.equal(edit.message_id,1);assert.ok(edit.text.length<=4096);
 f.post.published=false;f.post.revision++;f.change();await f.drain();
 edit=f.calls.filter(c=>c.chat_id===config.channel).at(-1);assert.match(edit.text,/withdrawn/);assert.doesNotMatch(edit.text,/Updated report/);
 assert.equal(notificationFeed(f.s,wallet,false).items.length,0);
 f.post.published=true;f.post.revision++;f.change();await f.drain();
 assert.equal(f.calls.filter(c=>c.chat_id===config.channel&&c.method==='sendMessage').length,1);
 assert.equal(telegramStatus(f.s,config).pending,0);
});
test('queued sends honor Telegram rate limits and require explicit reconciliation after an ambiguous send or process restart',async()=>{
 const f=fixture();f.change();f.setReply(()=>({ok:false,json:async()=>({error_code:429,parameters:{retry_after:30}})}));
 await f.step();await f.drain();assert.equal(f.calls.length,1);f.advance(30001);
 f.setReply(()=>{throw Error('socket closed');});await f.step();
 const job=f.s.telegram.jobs['post/N-1'];assert.equal(job.status,'review');
 f.setReply(null);await f.drain();assert.equal(f.calls.filter(c=>c.chat_id===config.channel).length,2);
 reconcileTelegram(f.s,job.key,'confirm',1201,config);await f.drain();
 assert.equal(f.calls.at(-1).method,'editMessageText');assert.equal(f.calls.at(-1).message_id,1201);
 f.post.revision++;f.change();f.s.telegram.jobs['post/N-1'].status='sending';recoverTelegram(f.s);
 assert.equal(f.s.telegram.jobs['post/N-1'].status,'review');
});
test('an edit made during an in-flight publication updates the confirmed message',async()=>{
 const f=fixture();f.change();let release,started;
 const ready=new Promise(done=>started=done);
 f.setReply(data=>new Promise(done=>{started();release=()=>done({ok:true,json:async()=>({ok:true,result:{chat:{id:Number(data.chat_id)},message_id:98}})});}));
 const sending=f.step();await ready;f.post.revision++;f.post.message='Latest';f.change();release();await sending;
 f.setReply(null);await f.drain();
 const channel=f.calls.filter(c=>c.chat_id===config.channel);
 assert.deepEqual(channel.map(c=>c.method),['sendMessage','editMessageText']);assert.equal(channel[1].message_id,98);assert.match(channel[1].text,/Latest/);
});
test('existing content is available in notification history after upgrading without outbound messages',()=>{
 const state={announcements:[{id:'a',title:'Live',published:true,createdAt:at},{id:'b',title:'Hidden',published:false,createdAt:at}],
 tickets:[{id:'t',title:'Parcel',wallet,status:'open',createdAt:at,updatedAt:at,messages:[{createdAt:at,admin:false},{createdAt:at,admin:true}]}]};
 initializeNotifications(state);initializeNotifications(state);
 assert.equal(notificationFeed(state,wallet,false).unread,2);assert.equal(notificationFeed(state,other,false).unread,1);
 assert.equal(notificationFeed(state,other,true).unread,2);assert.equal(state.telegram,undefined);
});
