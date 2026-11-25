// Notification rows contain references. Ticket text is read only after checking the audience.
function append(state, kind, ref, audience, at) {
 const feed = state.notifications;
 const row = {seq: ++feed.latest, kind, ref, audience, at};
 feed.events.push(row);
 return row;
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
