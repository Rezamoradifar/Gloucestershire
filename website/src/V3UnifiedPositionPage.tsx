import DigitalValue from './DigitalValue';
import {formatV3Amount as show} from './v3-format';
import type {UnifiedPositionPage} from './v3-unified-position';
import {formatUtcTime} from './utc-time';

export default function V3UnifiedPositionPage({page,onPrevious,onNext,singleCapital=false}:{
 page:UnifiedPositionPage;onPrevious:()=>void;onNext:()=>void;singleCapital?:boolean
}){
 const first=page.start+1,last=page.start+page.lots.length;
 return <section className="gv2-panel" aria-label={singleCapital?'Investment account':'Unified reinvestment position'}>
  <div className="gv2-panel-head"><h3>{singleCapital?'Investment account':`Reinvestment position #${page.positionId+1}`}</h3>
   <span>Verified block {page.block.toLocaleString('en-US')}</span></div>
  <article className="gv3-position-card gv3-reinvest-summary">
   <div><strong>{singleCapital?'All capital additions':'One reinvestment position'}</strong><small>{page.totalLots} additions</small></div>
   <div><b><DigitalValue value={show(page.principal)} unit="USDT"/></b><small>Recorded principal</small></div>
   <div><b><DigitalValue value={show(page.daily)} unit="USDT"/></b><small>Daily available claims</small>
    <b><DigitalValue value={show(page.compound)} unit="USDT"/></b><small>Profit-on-profit available claims</small></div>
   <div><b><DigitalValue value={show(page.reservedProfit)} unit="USDT"/></b><small>Reserved profit</small></div>
  </article>
  <p>Each addition keeps its own 90-day principal lock and accrual time.</p>
  <p>Showing additions {first}–{last} of {page.totalLots} · Available on this page: {show(page.availableProfitOnPage)} USDT profit, {show(page.maturedPrincipalOnPage)} USDT unlocked principal.</p>
  <div className="gv3-reinvest-details">{page.lots.map(lot=><article className="gv3-position-card" key={lot.id}>
   <div><strong>Addition #{lot.id+1}</strong><small>Opened {formatUtcTime(lot.openedAt)} · Principal unlock at {formatUtcTime(lot.unlockAt)} · Next eligible accrual at {formatUtcTime(lot.nextAccrualAt)}</small></div>
   <div><b><DigitalValue value={show(lot.principal)} unit="USDT"/></b><small>Recorded principal</small></div>
   <div><b><DigitalValue value={show(lot.daily+lot.compound)} unit="USDT"/></b><small>Recorded profit</small></div>
  </article>)}</div>
  <div className="gv2-buttons"><button type="button" disabled={page.start===0} onClick={onPrevious}>Previous additions</button>
   <button type="button" disabled={last>=page.totalLots} onClick={onNext}>Next additions</button></div>
 </section>;
}
