import {lazy,Suspense,useEffect,useState} from 'react';
import Landing from './Landing';
import LoadingBoundary from './LoadingBoundary';
import {V3_DAILY_PLAN,V3_HOURLY_TEST} from './v3-site-config';
import {siteRoute,type SiteRoute} from './site-route';

// A verified V3 release excludes the retired dashboard from its bundle.
const v3Only=import.meta.env.VITE_V3_PRIMARY_DASHBOARD==='verified-testnet';
const DashboardV2=!v3Only?lazy(()=>import('./V2Dashboard')):null;
const DashboardV3=lazy(()=>import('./V3Dashboard'));
// If a V3 release has incomplete identity values it remains locked, rather
// than falling back to a retired contract. The release installer validates all
// three values before publishing the site.
function currentRoute(){
 const primarySingle=['single-capital-testnet','referral-profit-testnet','manual-reinvest-testnet','upline-rates-testnet','account-reinvest-testnet'].includes(import.meta.env.VITE_V3_UNIFIED_PRIMARY);
 return siteRoute(location.hash,{v3Only,hourlyTest:V3_HOURLY_TEST,dailyTest:V3_DAILY_PLAN,
  landingAtRoot:import.meta.env.VITE_V3_LANDING_AT_ROOT==='true'&&
   (!primarySingle||location.pathname==='/'||location.pathname==='/index.html')});
}
export default function Root(){
 const [route,setRoute]=useState<SiteRoute>(()=>currentRoute());
 useEffect(()=>{
  const change=()=>{
   const next=currentRoute();
   setRoute(next);
   if(next!=='landing'||location.hash===''||location.hash==='#')window.scrollTo(0,0);
  };
  window.addEventListener('hashchange',change);
  return()=>window.removeEventListener('hashchange',change);
 },[]);
 useEffect(()=>{
  document.title=route==='v3'?'Global Drop Trade | V3 BNB Testnet':
   route==='v2'?'Global Drop Trade | V2 Testnet Dashboard':
   'Global Drop Trade | AI-Powered Global Commerce';
  if(route==='landing'&&location.hash.length>1)
   requestAnimationFrame(()=>document.getElementById(location.hash.slice(1))?.scrollIntoView());
 },[route]);
 return <LoadingBoundary>{route==='v3'?
  <Suspense fallback={<div className="dashboard-loading">Checking pinned V3 BNB Testnet deployment…</div>}>
   <DashboardV3/>
  </Suspense>
  :route==='v2'&&DashboardV2?
  <Suspense fallback={<div className="dashboard-loading">Verifying existing V2 testnet wallet and contract…</div>}>
   <DashboardV2/>
  </Suspense>
  :<Landing/>}</LoadingBoundary>;
}
