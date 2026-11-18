import {useEffect,useState} from 'react';
import {ArrowRight,Clock3,RefreshCw,ShieldCheck} from 'lucide-react';
import type {V3Snapshot} from './v3-chain';
import {v3Countdown,v3CycleView,V3_PERIOD_SECONDS} from './v3-cycle';
import {V3_HOURLY_TEST} from './v3-site-config';
import {formatV3Amount as money} from './v3-format';
import DigitalValue from './DigitalValue';
import {formatUtcTime} from './utc-time';

export default function V3CycleCard({view,busy,onCheckIn,onPositions,unifiedEnabled=false}:{
 view:V3Snapshot;busy:boolean;unifiedEnabled?:boolean;onCheckIn:()=>void;onPositions:()=>void;
}){
 const [elapsed,setElapsed]=useState(0);
 useEffect(()=>{
  const anchor=performance.now();setElapsed(0);
  const timer=setInterval(()=>setElapsed(Math.max(0,Math.floor((performance.now()-anchor)/1000))),1000);
  return()=>clearInterval(timer);
 },[view.asOf]);
 if(view.unifiedPage!==undefined)return <section className="gv3-cycle" aria-label="Unified test cycle">
  <div className="gv3-cycle-head"><div><span className="gv3-kicker">ONE-HOUR TEST CYCLE</span>
   <h2>Each addition has its own cycle</h2><p>Review accrual times in the {view.singleCapital?'investment account':'reinvestment position'}.</p></div></div>
  <div className="gv3-cycle-copy"><p>{unifiedEnabled?'See the recorded daily and compound claims for each addition.':'Estimates are unavailable while the unified account is in read-only preview.'}</p>
   <button type="button" onClick={onPositions}>{view.singleCapital?'View investment account':'View positions'} <ArrowRight size={15}/></button></div>
 </section>;
 let cycle:ReturnType<typeof v3CycleView>;
 try{cycle=v3CycleView(view.positions,view.asOf,elapsed,view.lastCheckIn,view.dailyRateBps);}
 catch{return <section className="gv3-cycle-error" role="alert">Cycle timing could not be verified. Refresh the account before acting.</section>;}
 const remaining=cycle.secondsRemaining;
 const progress=remaining===null?0:Math.min(1,Math.max(0,1-remaining/V3_PERIOD_SECONDS));
 const due=remaining===0;
 // A recent check-in alone does not prove contract eligibility. A snapshot can
 // also expire locally before the next verified block refresh.
 const active=view.eligible&&cycle.activityRemaining>0&&!view.paused;
 const activityReason=view.paused?'The test contract is paused.':
  !view.registered?'Register this test wallet first.':
  view.suspended?'This test account is suspended.':
  view.capital<10n*10n**18n?'A minimum of 10 TEST principal is required.':
  view.capital>50_000n*10n**18n&&!view.vipKyc?'VIP verification is required for this principal amount.':
  cycle.activityRemaining===0?'Check in on chain to renew the 24-hour activity window.':
  !view.eligible?'Eligibility was not confirmed at the last verified block. Refresh your account.':
  'Check-in expires in '+v3Countdown(cycle.activityRemaining)+'.';
 const checkInWait=view.lastCheckIn>0?Math.max(0,view.lastCheckIn+3600-(view.asOf+elapsed)):0;
 return <section className="gv3-cycle" aria-label={V3_HOURLY_TEST?'One-hour test position cycle':'Twenty-four hour position cycle'}>
  <div className="gv3-cycle-head"><div><span className="gv3-kicker">{V3_HOURLY_TEST?'YOUR ONE-HOUR TEST CYCLE':'YOUR DAILY CYCLE'}</span>
   <h2>Track every eligible period</h2><p>Each position starts its own {V3_HOURLY_TEST?'one-hour test':'24-hour'} cycle.</p></div>
   <span className={'gv3-cycle-state '+(active?'active':'')}><span/> {active?'Eligible at last check':'Eligibility not confirmed'}</span></div>
  <div className="gv3-cycle-body">
   <div className="gv3-cycle-clock">
    <div className="gv3-clock-console" role="timer" aria-live="off">
     <div className="gv3-clock-console-head"><span>{V3_HOURLY_TEST?'ONE-HOUR TEST CYCLE':'DAILY CYCLE'}</span><Clock3/></div>
     <DigitalValue size="clock" value={remaining===null?'--:--:--':v3Countdown(remaining)}
      label={remaining===null?'No active position':`Estimated time remaining ${v3Countdown(remaining)}`}/>
     <div className="gv3-clock-console-foot"><span>{remaining===null?'NO POSITION':due?'DUE · VERIFY ON CHAIN':'HOURS : MIN : SEC'}</span><span>{V3_HOURLY_TEST?'1H TEST':'24H'}</span></div>
     <div className="gv3-clock-progress" aria-hidden="true"><span style={{width:`${progress*100}%`}}/></div>
    </div>
    <div className="gv3-cycle-copy"><span className="gv3-kicker">NEXT POSITION</span>
     <h3>{remaining===null?'No active position':due?'Ready for on-chain confirmation':'Next eligibility window'}</h3>
     <p>{cycle.nextAt===null?'Open a test position to start its timer.':formatUtcTime(cycle.nextAt)}</p>
     <small>The timer is an estimate based on the last verified block. Reaching zero does not itself credit or pay profit.</small>
     <button type="button" onClick={onPositions}>View positions <ArrowRight size={15}/></button>
    </div>
   </div>
   <div className="gv3-cycle-side">
    <div className="gv3-cycle-forecast"><span className="gv3-kicker gv3-forecast-kicker">LIVE ESTIMATED PROGRESS</span>
     <strong className="gv3-forecast-main"><DigitalValue value={active?money(cycle.progressDaily+cycle.progressCompound):'—'} unit="TEST USDT"/></strong>
     <p>{active?'A visual estimate through the current cycle. Claims are recorded only after an eligible, confirmed transaction.':'Progress is hidden while eligibility is not confirmed. Refresh or check in as needed.'}</p>
     <div className="gv3-forecast-row gv3-forecast-row--daily"><span>{V3_HOURLY_TEST?'Cycle base estimate so far':'Daily estimate so far'}</span><b><DigitalValue value={active?money(cycle.progressDaily):'—'}/></b></div>
     <div className="gv3-forecast-row gv3-forecast-row--compound"><span>Profit-on-profit estimate so far</span><b><DigitalValue value={active?money(cycle.progressCompound):'—'}/></b></div>
     <div className="gv3-forecast-row gv3-forecast-row--cycle"><span>CONDITIONAL CYCLE ESTIMATE</span><b><DigitalValue value={money(cycle.estimatedDaily+cycle.estimatedCompound)} unit="TEST USDT"/></b></div>
     <small>At the verified {view.dailyRateBps/100}% test rate, if each position becomes eligible. {V3_HOURLY_TEST&&'The full daily test rate is applied once per eligible one-hour test cycle; this is accelerated test accounting. '}Estimates are not recorded claims, cash or guaranteed profit.</small>
    </div>
    <div className="gv3-activity"><ShieldCheck size={19}/><div><strong>{active?'Account eligible':'Eligibility needs attention'}</strong>
     <small>{activityReason}
      {checkInWait>0&&' · Next check-in in '+v3Countdown(checkInWait)}</small></div>
     <button type="button" disabled={busy||!view.registered||view.suspended||view.paused||checkInWait>0} onClick={onCheckIn}>
      <RefreshCw size={14}/> Check in</button></div>
   </div>
  </div>
 </section>;
}
