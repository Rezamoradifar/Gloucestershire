import {useEffect, useState} from 'react';
import {interruptedFeed,loadActivity,StoreTransportError,storeSnapshotLifetime,type Feed,type Pair,type Source} from './trading-activity';

export const activityStatuses = {live:'Live market', delayed:'Last market snapshot', connected:'Connected',
  partial:'Partial history', not_configured:'Not connected', unavailable:'Unavailable', rate_limited:'Rate limited'};

export function useTradingActivity(source:Source, attempt:number, pair:Pair='BTC/USD') {
  const [feed,setFeed]=useState<Feed|null>(null), [pending,setPending]=useState(true);
  useEffect(()=>{
    if(!feed?.snapshotStatus || !feed.updatedAt) return;
    const expires=Date.parse(feed.updatedAt)+storeSnapshotLifetime;
    const timer=setTimeout(()=>setFeed(current=>current===feed?
      {source:feed.source,status:feed.status,updatedAt:null,rows:[]}:current),Math.max(0,expires-Date.now()));
    return ()=>clearTimeout(timer);
  },[feed]);
  useEffect(()=>{
    let disposed=false, timer:ReturnType<typeof setTimeout>|undefined, current:AbortController|undefined;
    function stop() { clearTimeout(timer); current?.abort(); current=undefined; }
    async function refresh() {
      if(disposed || document.hidden) return;
      const controller=new AbortController();
      current=controller; setPending(true);
      const timeout=setTimeout(()=>controller.abort(),12000);
      let delay=source==='market'?10000:30000;
      try {
        const next=await loadActivity(source,pair,controller.signal);
        if(next.status==='rate_limited') delay=90000;
        if(!disposed && controller===current) setFeed(next);
      } catch (error) {
        if(error instanceof StoreTransportError && error.status==='rate_limited')delay=90000;
        if(!disposed && controller===current) setFeed(previous=>interruptedFeed(source,previous,error));
      } finally {
        clearTimeout(timeout);
        if(!disposed && controller===current) {setPending(false);timer=setTimeout(refresh,delay);}
      }
    }
    function visibility() {
      stop();
      if(!document.hidden) {
        setFeed(previous=>{
          if(source!=='amazon' && source!=='ebay')return null;
          if(previous?.updatedAt && Date.parse(previous.updatedAt)<=Date.now()-storeSnapshotLifetime)return null;
          return previous;
        });
        void refresh();
      }
    }
    void refresh();document.addEventListener('visibilitychange',visibility);
    return ()=>{disposed=true;stop();document.removeEventListener('visibilitychange',visibility);};
  },[source,pair,attempt]);

  return {feed,pending};
}
