import {useEffect,useMemo,useState} from 'react';
import type {V3Snapshot} from './v3-chain';

// Keep the block's timestamp as the time source. The device measures elapsed
// time only, including time the browser spent asleep or on a different tab.
export function useV3ChainClock(view:Pick<V3Snapshot,'asOf'|'hash'|'observedAtMs'>){
 const anchor=useMemo(()=>{
  const wall=Date.now(),observed=view.observedAtMs??wall;
  return {observed,monotonic:performance.now(),initialAge:Math.max(0,wall-observed)};
 },[view.hash,view.asOf,view.observedAtMs]);
 const [sample,setSample]=useState(()=>({wall:Date.now(),monotonic:performance.now()}));
 useEffect(()=>{
  const tick=()=>setSample({wall:Date.now(),monotonic:performance.now()});
  tick();
  const timer=window.setInterval(tick,1000);
  window.addEventListener('pageshow',tick);
  document.addEventListener('visibilitychange',tick);
  return ()=>{
   window.clearInterval(timer);
   window.removeEventListener('pageshow',tick);
   document.removeEventListener('visibilitychange',tick);
  };
 },[anchor]);
 const elapsedMs=Math.max(0,sample.wall-anchor.observed,anchor.initialAge+sample.monotonic-anchor.monotonic);
 return view.asOf+Math.floor(elapsedMs/1000);
}
