import {lazy,Suspense,useEffect,useState} from 'react';
import Landing from './Landing';
import LoadingBoundary from './LoadingBoundary';
// V2 dashboard reads only the newly deployed 97 testnet vault. Do not inject
// the legacy /api/config contract or import the old account dashboard.
const Dashboard=lazy(()=>import('./V2Dashboard'));

export default function Root(){
 const [dashboard,setDashboard]=useState(location.hash==='#dashboard');
 useEffect(()=>{
  const change=()=>{
   const next=location.hash==='#dashboard';
   setDashboard(next);
   if(next||location.hash===''||location.hash==='#')window.scrollTo(0,0);
  };
  window.addEventListener('hashchange',change);
  return()=>window.removeEventListener('hashchange',change);
 },[]);
 useEffect(()=>{
  document.title=dashboard?'Global Drop Trade | V2 Testnet Dashboard':'Global Drop Trade | AI-Powered Global Commerce';
  if(!dashboard&&location.hash.length>1)
   requestAnimationFrame(()=>document.getElementById(location.hash.slice(1))?.scrollIntoView());
 },[dashboard]);
 return <LoadingBoundary>{dashboard?
  <Suspense fallback={<div className="dashboard-loading">Verifying V2 Testnet wallet and contract…</div>}><Dashboard/></Suspense>
  :<Landing/>}</LoadingBoundary>;
}
