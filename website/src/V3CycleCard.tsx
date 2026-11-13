import {useEffect,useState} from 'react';
import {ArrowRight,Clock3,RefreshCw,ShieldCheck} from 'lucide-react';
import type {V3Snapshot} from './v3-chain';
import {v3Countdown,v3CycleView,V3_PERIOD_SECONDS} from './v3-cycle';
import {formatV3Amount as money} from './v3-format';

export default function V3CycleCard({view,busy,onCheckIn,onPositions}:{
 view:V3Snapshot;busy:boolean;onCheckIn:()=>void;onPositions:()=>void;
}){
 const [elapsed,setElapsed]=useState(0);
 useEffect(()=>{
  const anchor=performance.now();setElapsed(0);
  const timer=setInterval(()=>setElapsed(Math.max(0,Math.floor((performance.now()-anchor)/1000))),1000);
  return()=>clearInterval(timer);
 },[view.asOf]);
 let cycle:ReturnType<typeof v3CycleView>;
 try{cycle=v3CycleView(view.positions,view.asOf,elapsed,view.lastCheckIn,view.dailyRateBps);}
 catch{return <section className="gv3-cycle-error" role="alert">Cycle timing could not be verified. Refresh the account before acting.</section>;}
 const remaining=cycle.secondsRemaining;
 const progress=remaining===null?0:Math.min(1,Math.max(0,1-remaining/V3_PERIOD_SECONDS));
 const due=remaining===0;
 const active=cycle.activityRemaining>0&&view.registered&&!view.suspended&&!view.paused;
 return <section className="gv3-cycle" aria-label="Twenty-four hour position cycle">
  <div className="gv3-cycle-head"><div><span className="gv3-kicker">YOUR DAILY CYCLE</span>
   <h2>Track every eligible period</h2><p>Each position starts its own 24-hour cycle.</p></div>
   <span className={'gv3-cycle-state '+(active?'active':'')}><span/> {active?'Activity active':'Check-in required'}</span></div>
  <div className="gv3-cycle-body">
   <div className="gv3-cycle-clock">
    <div className="gv3-clock-ring" style={{background:`conic-gradient(#efcd8c ${progress*100}%, #34424a 0)`}}>
     <div><Clock3 size={19}/><strong aria-label="Estimated time remaining">{remaining===null?'--:--:--':v3Countdown(remaining)}</strong><small>{remaining===null?'No position':due?'Due · verify on chain':'Until next cycle'}</small></div>
    </div>
    <div className="gv3-cycle-copy"><span className="gv3-kicker">NEXT POSITION</span>
     <h3>{remaining===null?'No active position':due?'Ready for on-chain confirmation':'Next eligibility window'}</h3>
     <p>{cycle.nextAt===null?'Open a test position to start its timer.':new Date(cycle.nextAt*1000).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</p>
     <small>The timer is an estimate based on the last verified block. Reaching zero does not itself credit or pay profit.</small>
     <button type="button" onClick={onPositions}>View positions <ArrowRight size={15}/></button>
    </div>
   </div>
   <div className="gv3-cycle-side">
    <div className="gv3-cycle-forecast"><span className="gv3-kicker">CONDITIONAL CYCLE ESTIMATE</span>
     <strong>{money(cycle.estimatedDaily+cycle.estimatedCompound)} <small>TEST USDT</small></strong>
     <p>Across current positions at the verified {view.dailyRateBps/100}% test rate, if each becomes eligible.</p>
     <div><span>Personal estimate</span><b>{money(cycle.estimatedDaily)}</b></div>
     <div><span>Profit-on-profit estimate</span><b>{money(cycle.estimatedCompound)}</b></div>
     <small>Estimate only · not accrued, funded, or guaranteed.</small>
    </div>
    <div className="gv3-activity"><ShieldCheck size={19}/><div><strong>{active?'Check-in active':'Check in to qualify'}</strong>
     <small>{active?'Expires in '+v3Countdown(cycle.activityRemaining):'A signed check-in is required for an eligible cycle.'}</small></div>
     <button type="button" disabled={busy||!view.registered||view.suspended||view.paused} onClick={onCheckIn}>
      <RefreshCw size={14}/> Check in</button></div>
   </div>
  </div>
 </section>;
}
