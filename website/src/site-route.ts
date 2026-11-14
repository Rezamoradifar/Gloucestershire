export type SiteRoute='landing'|'v2'|'v3';

type RouteOptions={v3Only:boolean;hourlyTest:boolean;landingAtRoot:boolean};

export function siteRoute(hash:string,{v3Only,hourlyTest,landingAtRoot}:RouteOptions):SiteRoute{
 if(hourlyTest&&!landingAtRoot&&(!hash||hash==='#'))return 'v3';
 if(hash==='#v2-dashboard')return v3Only?'v3':'v2';
 if(hash==='#v3-dashboard')return 'v3';
 if(hash==='#dashboard')return v3Only?'v3':'v2';
 return 'landing';
}
