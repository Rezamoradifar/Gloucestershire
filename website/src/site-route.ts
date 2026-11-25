export type SiteRoute='landing'|'v2'|'v3';

type RouteOptions={v3Only:boolean;hourlyTest:boolean;dailyTest?:boolean;landingAtRoot:boolean};

export function linkedMemberTab(hash:string) {
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
