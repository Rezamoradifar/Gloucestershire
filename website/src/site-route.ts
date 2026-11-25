export type SiteRoute='landing'|'v2'|'v3';

type RouteOptions={v3Only:boolean;hourlyTest:boolean;dailyTest?:boolean;landingAtRoot:boolean};

export function linkedMemberTab(hash:string) {
 if(hash==='#dashboard/admin-tickets')return 'admin-tickets';
 if(hash==='#dashboard/admin-announcements')return 'admin-announcements';
 if(hash==='#dashboard/notifications')return 'notifications';
 if(hash==='#dashboard/admin-notifications')return 'admin-notifications';
 if(hash==='#dashboard/tickets')return 'tickets';
 if(hash==='#dashboard/announcements')return 'announcements';
 if(hash==='#dashboard/history')return 'history';
 if(hash==='#dashboard/admin')return 'admin';
 return null;
}

export function siteRoute(hash:string,{v3Only,hourlyTest,dailyTest,landingAtRoot}:RouteOptions):SiteRoute{
 if(v3Only&&linkedMemberTab(hash))return 'v3';
 if((hourlyTest||dailyTest)&&!landingAtRoot&&(!hash||hash==='#'))return 'v3';
 if(hash==='#v2-dashboard')return v3Only?'v3':'v2';
 if(hash==='#v3-dashboard')return 'v3';
 if(hash==='#dashboard')return v3Only?'v3':'v2';
 return 'landing';
}
