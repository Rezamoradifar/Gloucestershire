import {useEffect,useState} from 'react';
import {ArrowRight,Clock3,RefreshCw,ShieldCheck} from 'lucide-react';
import type {V3Snapshot} from './v3-chain';
import {v3Countdown,v3CycleView,V3_PERIOD_SECONDS} from './v3-cycle';
import {formatV3Amount as money} from './v3-format';
import DigitalValue from './DigitalValue';

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
 const checkInWait=view.lastCheckIn>0?Math.max(0,view.lastCheckIn+3600-(view.asOf+elapsed)):0;
 return <section className="gv3-cycle" aria-label="Twenty-four hour position cycle">
  <div className="gv3-cycle-head"><div><span className="gv3-kicker">YOUR DAILY CYCLE</span>
   <h2>Track every eligible period</h2><p>Each position starts its own 24-hour cycle.</p></div>
   <span className={'gv3-cycle-state '+(active?'active':'')}><span/> {active?'Activity active':'Check-in required'}</span></div>
  <div className="gv3-cycle-body">
   <div className="gv3-cycle-clock">
    <div className="gv3-clock-console" role="timer" aria-live="off">
     <div className="gv3-clock-console-head"><span>DAILY CYCLE</span><Clock3/></div>
     <DigitalValue size="clock" value={remaining===null?'--:--:--':v3Countdown(remaining)}
      label={remaining===null?'No active position':`Estimated time remaining ${v3Countdown(remaining)}`}/>
     <div className="gv3-clock-console-foot"><span>{remaining===null?'NO POSITION':due?'DUE · VERIFY ON CHAIN':'HOURS : MIN : SEC'}</span><span>24H</span></div>
     <div className="gv3-clock-progress" aria-hidden="true"><span style={{width:`${progress*100}%`}}/></div>
    </div>
    <div className="gv3-cycle-copy"><span className="gv3-kicker">NEXT POSITION</span>
     <h3>{remaining===null?'No active position':due?'Ready for on-chain confirmation':'Next eligibility window'}</h3>
     <p>{cycle.nextAt===null?'Open a test position to start its timer.':new Date(cycle.nextAt*1000).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</p>
     <small>The timer is an estimate based on the last verified block. Reaching zero does not itself credit or pay profit.</small>
     <button type="button" onClick={onPositions}>View positions <ArrowRight size={15}/></button>
    </div>
   </div>
   <div className="gv3-cycle-side">
    <div className="gv3-cycle-forecast"><span className="gv3-kicker">LIVE ESTIMATED PROGRESS</span>
     <strong><DigitalValue value={money(cycle.progressDaily+cycle.progressCompound)} unit="TEST USDT"/></strong>
     <p>A visual estimate through the current cycle. Claims are recorded only after an eligible, confirmed transaction.</p>
     <div><span>Daily estimate so far</span><b><DigitalValue value={money(cycle.progressDaily)}/></b></div>
     <div><span>Profit-on-profit estimate so far</span><b><DigitalValue value={money(cycle.progressCompound)}/></b></div>
     <div><span>CONDITIONAL CYCLE ESTIMATE</span><b><DigitalValue value={money(cycle.estimatedDaily+cycle.estimatedCompound)} unit="TEST USDT"/></b></div>
     <small>At the verified {view.dailyRateBps/100}% test rate, if each position becomes eligible. Estimates are not recorded claims, cash or guaranteed profit.</small>
    </div>
    <div className="gv3-activity"><ShieldCheck size={19}/><div><strong>{active?'Check-in active':'Check in to qualify'}</strong>
     <small>{active?'Expires in '+v3Countdown(cycle.activityRemaining):'A signed check-in is required for an eligible cycle.'}
      {checkInWait>0&&' · Next check-in in '+v3Countdown(checkInWait)}</small></div>
     <button type="button" disabled={busy||!view.registered||view.suspended||view.paused||checkInWait>0} onClick={onCheckIn}>
      <RefreshCw size={14}/> Check in</button></div>
   </div>
  </div>
 </section>;
}
