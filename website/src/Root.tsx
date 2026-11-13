import {lazy,Suspense,useEffect,useState} from 'react';
import Landing from './Landing';
import LoadingBoundary from './LoadingBoundary';
import {v3ParseReleaseConfig} from './v3-site-config';

// Never reuse V2 state in V3, or silently migrate existing accounts.
// V3 becomes the primary /#dashboard ONLY after a verified deployed code hash
// is pinned and an authorized operator opts in to this explicit testnet switch.
const DashboardV2=lazy(()=>import('./V2Dashboard'));
const DashboardV3=lazy(()=>import('./V3Dashboard'));
const v3Configured=Boolean(v3ParseReleaseConfig({
 address:import.meta.env.VITE_V3_CONTRACT_ADDRESS,
 runtimeHash:import.meta.env.VITE_V3_RUNTIME_HASH,
 deploymentTx:import.meta.env.VITE_V3_DEPLOYMENT_TX
}));
const v3Primary=v3Configured&&
 import.meta.env.VITE_V3_PRIMARY_DASHBOARD==='verified-testnet';
type Route='landing'|'v2'|'v3';
function currentRoute():Route{
 if(location.hash==='#v2-dashboard')return 'v2';
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
  :route==='v2'?
  <Suspense fallback={<div className="dashboard-loading">Verifying existing V2 testnet wallet and contract…</div>}>
   <DashboardV2/>
  </Suspense>
  :<Landing/>}</LoadingBoundary>;
}
