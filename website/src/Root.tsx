import {lazy,Suspense,useEffect,useState} from 'react';
import Landing from './Landing';
import LoadingBoundary from './LoadingBoundary';

// A verified V3 release excludes the retired dashboard from its bundle.
const v3Only=import.meta.env.VITE_V3_PRIMARY_DASHBOARD==='verified-testnet';
const DashboardV2=!v3Only?lazy(()=>import('./V2Dashboard')):null;
const DashboardV3=lazy(()=>import('./V3Dashboard'));
// If a V3 release has incomplete identity values it remains locked, rather
// than falling back to a retired contract. The release installer validates all
// three values before publishing the site.
const v3Primary=v3Only;
type Route='landing'|'v2'|'v3';
function currentRoute():Route{
 if(location.hash==='#v2-dashboard')return v3Only?'v3':'v2';
 if(location.hash==='#v3-dashboard')return 'v3';
 if(location.hash==='#dashboard')return v3Primary?'v3':'v2';
 return 'landing';
}
export default function Root(){
 const [route,setRoute]=useState<Route>(()=>currentRoute());
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
