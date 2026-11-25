import {useEffect, useState} from 'react';
import {loadActivity, type Feed, type Pair, type Source} from './trading-activity';

export const activityStatuses = {live:'Live market', delayed:'Last market snapshot', connected:'Connected',
  partial:'Partial history', not_configured:'Not connected', unavailable:'Unavailable', rate_limited:'Rate limited'};

export function useTradingActivity(source:Source, attempt:number, pair:Pair='BTC/USD') {
  const [feed,setFeed]=useState<Feed|null>(null), [pending,setPending]=useState(true);
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
      } catch {
        if(!disposed && controller===current) setFeed(previous=>source==='market' && previous?.rows.length?
          {...previous,status:'delayed'}:{source,status:'unavailable',updatedAt:null,rows:[]});
      } finally {
        clearTimeout(timeout);
        if(!disposed && controller===current) {setPending(false);timer=setTimeout(refresh,delay);}
      }
    }
    function visibility() {
      stop();
      if(!document.hidden) {setFeed(null);void refresh();}
    }
    void refresh();document.addEventListener('visibilitychange',visibility);
    return ()=>{disposed=true;stop();document.removeEventListener('visibilitychange',visibility);};
  },[source,pair,attempt]);

  return {feed,pending};
}
