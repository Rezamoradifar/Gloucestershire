import type {V3WalletPosition} from './v3-chain';
import {V3_PERIOD_SECONDS} from './v3-cycle';
import {formatV3Amount as show} from './v3-format';
import DigitalValue from './DigitalValue';
import {formatUtcTime} from './utc-time';

const PRINCIPAL_LOCK_SECONDS=90*24*60*60;

function PositionRow({position:p}:{position:V3WalletPosition}){
 return <article className="gv3-position-card">
  <div><strong>Position #{p.id+1}{p.fromReinvestment?' · from manual reinvestment':''}</strong>
   <small>Opened {formatUtcTime(p.openedAt)} · Principal unlock at {formatUtcTime(p.openedAt+PRINCIPAL_LOCK_SECONDS)} · Next eligible accrual at {formatUtcTime(p.lastAccruedAt+V3_PERIOD_SECONDS)}</small></div>
  <div><b><DigitalValue value={show(p.principal)} unit="USDT"/></b><small>Recorded principal</small></div>
  <div><b><DigitalValue value={show(p.availableDaily)} unit="USDT"/></b><small>Daily available claims</small>
   <b><DigitalValue value={show(p.availableCompound)} unit="USDT"/></b><small>Available personal compound earnings</small></div>
  <div><b><DigitalValue value={show(p.reservedProfit)} unit="USDT"/></b><small>Reserved for pending withdrawal</small></div>
 </article>;
}

export default function V3PositionsList({positions}:{positions:V3WalletPosition[]}){
 const deposits=positions.filter(position=>!position.fromReinvestment);
 const reinvestments=positions.filter(position=>position.fromReinvestment);
 const total=reinvestments.reduce((sum,p)=>({principal:sum.principal+p.principal,
  daily:sum.daily+p.availableDaily,compound:sum.compound+p.availableCompound,
  reserved:sum.reserved+p.reservedProfit}),{principal:0n,daily:0n,compound:0n,reserved:0n});
 return <section className="gv2-panel"><div className="gv2-panel-head"><h3>My verified V3 positions</h3><span>{positions.length} on-chain entries</span></div>
  {deposits.map(p=><PositionRow position={p} key={p.id}/>)}
  {reinvestments.length>0&&<div className="gv3-reinvest-group">
   <article className="gv3-position-card gv3-reinvest-summary">
    <div><strong>Combined reinvestments</strong><small>{reinvestments.length} separate on-chain {reinvestments.length===1?'position':'positions'} shown together</small></div>
    <div><b><DigitalValue value={show(total.principal)} unit="USDT"/></b><small>Combined reinvested principal</small></div>
    <div><b><DigitalValue value={show(total.daily)} unit="USDT"/></b><small>Daily available claims</small>
     <b><DigitalValue value={show(total.compound)} unit="USDT"/></b><small>Available personal compound earnings</small></div>
    <div><b><DigitalValue value={show(total.reserved)} unit="USDT"/></b><small>Reserved for pending withdrawal</small></div>
   </article>
   <p>These amounts are grouped for display. The existing contract still keeps a separate position, accrual time and principal lock for each reinvestment.</p>
   <details className="gv3-reinvest-details"><summary>View individual contract positions and unlock times</summary>
    {reinvestments.map(p=><PositionRow position={p} key={p.id}/>)}
   </details>
  </div>}
  {!positions.length&&<p>No independently verified V3 positions exist in this wallet.</p>}
 </section>;
}
