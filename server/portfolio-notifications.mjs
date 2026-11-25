// Notification rows contain references. Ticket text is read only after checking the audience.
function append(state, kind, ref, audience, at) {
 const feed = state.notifications;
 const row = {seq: ++feed.latest, kind, ref, audience, at};
 feed.events.push(row);
 return row;
}

// Upgrade only the original, unedited V7 launch-test record. Retain its ID and original copy.
const launchTestVault='0x156a308187b1aa5897b82d617e583ad4687c8c09';
const launchTestId='880ada50-2d73-460c-ad05-76f16efa5381';
export function initialTestNotice(state,vault){
 if(vault.toLowerCase()!==launchTestVault || state.launchNoticeBackup || state.telegram?.jobs?.['post/'+launchTestId] || state.telegram?.posts?.[launchTestId])return null;
 return state.announcements.find(item=>item.id===launchTestId && item.createdAt==='2026-11-25T14:40:08.523Z' &&
  item.published===true && !item.updatedAt && (item.revision??1)===1 && item.title==='Hi' && item.message==='Hi users test 1')??null;
}
export function replaceInitialTestNotice(state,vault,at){
 const item=initialTestNotice(state,vault);if(!item)return;
 state.launchNoticeBackup={id:item.id,title:item.title,message:item.message,createdAt:item.createdAt};
 Object.assign(item,{title:'Welcome to the Global Drop Trade testnet',
  message:'The dashboard runs on BNB Testnet. Use test USDT for deposits and withdrawals. Open History to check confirmed transactions. For account help, open Support tickets. Replies appear in Notifications.',
  updatedAt:at,revision:2});
 communityEvent(state,'announcement',item,'all',at,null);
}

export function initializeNotifications(state) {
 if (state.notifications) return;
 state.notifications = {latest: 0, events: [], read: {}};
 const history = [];
 for (const post of state.announcements) {
  if (post.published) history.push(['announcement', post.id, 'all', post.updatedAt || post.createdAt]);
 }
 for (const ticket of state.tickets) {
  ticket.messages.forEach((m, index) => history.push([
   index === 0 ? 'ticket-opened' : 'ticket-reply', ticket.id,
   m.admin ? ticket.wallet.toLowerCase() : 'managers', m.createdAt
  ]));
  if (ticket.status === 'closed') history.push(['ticket-closed', ticket.id, ticket.wallet.toLowerCase(), ticket.updatedAt]);
 }
 history.sort((a,b) => a[3].localeCompare(b[3]));
 for (const args of history) append(state, ...args);
}

export function communityEvent(state, kind, item, audience, at, telegram) {
 const publicChange = kind === 'announcement';
 if (publicChange) {
  // A member should see just the current public version of each announcement.
  state.notifications.events = state.notifications.events.filter(r => r.kind !== kind || r.ref !== item.id);
 }
 const row = !publicChange || item.published ? append(state, kind, item.id, audience, at) : null;
 telegram?.enqueue(state, {kind, item, audience, row});
}

export function notificationFeed(state, wallet, admin) {
 const feed = state.notifications;
 const key = (admin ? 'admin/' : 'member/') + wallet.toLowerCase();
 const seen = feed.read[key] || 0;
 const tickets = new Map(state.tickets.map(t => [t.id, t]));
 const posts = new Map(state.announcements.filter(a => a.published).map(a => [a.id, a]));
 const items = [];
 const audience = admin ? 'managers' : wallet.toLowerCase();
 for (let i = feed.events.length - 1; i >= 0; i--) {
  const r = feed.events[i];
  if (r.audience !== 'all' && r.audience !== audience) continue;
  const item = r.kind === 'announcement' ? posts.get(r.ref) : tickets.get(r.ref);
  if (item) items.push({seq:r.seq, kind:r.kind, ref:r.ref, at:r.at, title:item.title, unread:r.seq > seen});
 }
 return {key, items, latest:items[0]?.seq || 0, unread:items.filter(item => item.unread).length};
}
