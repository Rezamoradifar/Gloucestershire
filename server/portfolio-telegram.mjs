// Telegram delivery is scoped to one verified portfolio. Only published announcement text goes to the channel.
const site = 'https://globaldroptrade.com/';
const tokenPattern = /^\d+:[A-Za-z0-9_-]{25,100}$/;
export function telegramSettings(env = process.env) {
 const token = env.GLOBAL_TELEGRAM_BOT_TOKEN || '';
 const vault = (env.GLOBAL_TELEGRAM_VAULT || '').toLowerCase();
 if (!tokenPattern.test(token) || !/^0x[0-9a-f]{40}$/.test(vault)) return null;
 const privateId = env.GLOBAL_TELEGRAM_ADMIN_CHAT_ID || '', channelId = env.GLOBAL_TELEGRAM_CHANNEL_ID || '';
 const admin = /^[1-9]\d{0,15}$/.test(privateId) ? privateId : '';
 const channel = /^-100\d{6,13}$/.test(channelId) ? channelId : '';
 return admin || channel ? {token, vault, admin, channel} : null;
}

function deliveryState(s) {
 return s.telegram ||= {jobs:{}, posts:{}};
}

export function telegramStatus(state, config) {
 const jobs = Object.values(state.telegram?.jobs || {});
 return {privateConfigured:Boolean(config?.admin), channelConfigured:Boolean(config?.channel),
  pending:jobs.filter(j => j.status === 'pending' || j.status === 'sending').length,
  issues:jobs.filter(j => j.status === 'review' || j.status === 'failed')
   .map(({key, target, status, reason}) => ({key, target, status, reason}))};
}

const ticketTitles = {'ticket-opened':'New support ticket','ticket-reply':'Member replied to a ticket',
 'ticket-closed':'Member closed a ticket','ticket-reopened':'Member reopened a ticket'};

export function createTelegramDelivery(config, {fetchImpl = fetch, now = Date.now} = {}) {
 if (!config) return null;
 function enqueue(state, {kind, item, audience, row, channelOnly=false}) {
  const {jobs, posts} = deliveryState(state);
  function insert(key, target, data) {
   const old = jobs[key];
   if (old) {old.data = data; old.version++; return;}
   jobs[key] = {key, target, data, version:1, status:'pending', destination:config[target], attempts:0, due:0};
  }
  if (kind === 'announcement') {
   if (config.channel && (item.published || posts[item.id] || jobs['post/'+item.id])) {
    insert('post/'+item.id, 'channel', {ref:item.id});
   }
   if (config.admin && !channelOnly) insert('notice/'+item.id+'/'+(item.revision || 1), 'admin', {
    text:(item.published ? 'Announcement published or updated' : 'Announcement withdrawn')+'\n'+item.title+'\n'+site+'#dashboard/announcements'});
  } else if (config.admin && audience === 'managers') {
   insert('event/'+row.seq, 'admin', {text:ticketTitles[kind]+'\nTicket '+item.id+'\n'+site+'#dashboard/admin-notifications'});
  }
 }
 function plan(state, job) {
  if (job.destination !== config[job.target]) return {issue:'Destination changed. Review this delivery in the original chat.'};
  if (job.target === 'admin') return {method:'sendMessage', body:{chat_id:config.admin, text:job.data.text}};
  const ref = job.data.ref, post = state.announcements.find(a => a.id === ref);
  const old = state.telegram.posts[ref];
  if (old && old.chat !== config.channel) return {issue:'Channel destination changed. Check the earlier publication.'};
  if (!post?.published && !old) return null;
  const link = '\n\n'+site+'#dashboard/announcements';
  const copy = post?.published ? post.title+'\n\n'+post.message : 'This announcement has been withdrawn.';
  let text = copy;
  if (copy.length + link.length > 4096) text = copy.slice(0, 4094 - link.length).replace(/[\uD800-\uDBFF]$/, '')+'…';
  const body = {chat_id:config.channel, text:text+link, link_preview_options:{is_disabled:true}};
  if (old) body.message_id = old.id;
  return {method:old ? 'editMessageText' : 'sendMessage', body};
 }
 async function deliver(mutate, current) {
  // Claim before sending. An interrupted, unacknowledged send needs an operator to reconcile it.
  if ((current().telegram?.retryAt || 0) > now()) return false;
  const next = Object.values(current().telegram?.jobs || {}).find(j =>
   j.status === 'pending' && j.due <= now() && config[j.target]);
  if (!next) return false;
  const task = await mutate(s => {
   const store = deliveryState(s), j = store.jobs[next.key];
   if (!j || j.status !== 'pending') return null;
   const p = plan(s,j);
   if (!p) {delete store.jobs[j.key]; return null;}
   if (p.issue) {j.status='failed';j.reason=p.issue;return null;}
   j.status='sending';j.attempts++;j.sentVersion=j.version;
   return {...p,key:j.key,version:j.version,postRevision:j.target==='channel'?(s.announcements.find(a=>a.id===j.data.ref)?.revision||1):undefined};
  });
  if (!task) return true;
  let status = 'done', reason = '', id = 0, wait = 0, limited = false;
  try {
   const response = await fetchImpl('https://api.telegram.org/bot'+config.token+'/'+task.method, {
    method:'POST', redirect:'error', signal:AbortSignal.timeout(10000),
    headers:{'Content-Type':'application/json'}, body:JSON.stringify(task.body)
   });
   const result = await response.json();
   if (response.ok && result.ok && Number.isSafeInteger(result.result?.message_id) &&
       String(result.result.chat?.id) === task.body.chat_id) id = result.result.message_id;
   else if (task.method === 'editMessageText' && result.error_code === 400 && /message is not modified/i.test(result.description || '')) id=task.body.message_id;
   else if (result.error_code === 429) {status='pending';limited=true;wait=Math.max(1,Number(result.parameters?.retry_after)||30)*1000;}
   else if ([400,401,403,404].includes(result.error_code)) {status='failed';reason='Telegram rejected the request ('+result.error_code+'). Check the bot and its posting permissions.';}
   else throw Error();
  } catch {
   if (task.method === 'editMessageText') {status='pending';wait=60000;}
   else {status='review';reason='Delivery was not confirmed. Check the destination before retrying.';}
  }
  await mutate(s => {
   const store=deliveryState(s), j=store.jobs[task.key];
   if (!j) return;
   if (limited) store.retryAt=now()+wait;
   if (status === 'done') {
    if (j.target === 'channel') store.posts[j.data.ref]={chat:task.body.chat_id,id,revision:task.postRevision};
    if (j.version === task.version) {delete store.jobs[j.key];return;}
    status='pending';
   }
   Object.assign(j,{status,reason,due:now()+wait});
  });
  return true;
 }
 return {enqueue,deliver,config};
}

export function recoverTelegram(state) {
 for (const j of Object.values(state.telegram?.jobs || {})) if (j.status === 'sending') {
  j.status='review';j.reason='Delivery was interrupted. Check the destination before retrying.';
 }
}

export function reconcileTelegram(state, key, action, messageId, config) {
 const store=deliveryState(state), j=store.jobs[key];
 if (!j || !['failed','review'].includes(j.status)) throw Object.assign(Error('Delivery is no longer awaiting review.'),{status:409});
 if (action === 'retry') {j.status='pending';j.due=0;return;}
 if (action !== 'confirm' || !Number.isSafeInteger(messageId) || messageId < 1 || !config?.[j.target] || j.destination !== config[j.target])
  throw Object.assign(Error('Enter the confirmed Telegram message ID or request a retry.'),{status:400});
 if (j.target === 'channel') {
  store.posts[j.data.ref]={chat:config.channel,id:messageId};
  // Editing the confirmed ID reconciles any change made during the interrupted send.
  j.status='pending';j.due=0;
 } else delete store.jobs[key];
}
