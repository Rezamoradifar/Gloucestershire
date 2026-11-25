import {formatShare,formatV3Amount as money} from './v3-format';
import type {V3Snapshot} from './v3-chain';

export default function V3PortfolioOverview({view}:{view:V3Snapshot}){
 const personal=view.positions.reduce((sum,p)=>sum+p.cumulativeDaily+p.cumulativeCompound,0n);
 const total=personal+view.cumulativeReferral+view.cumulativeNetwork;
 const sources=[['personal','Personal profit',personal],['referral','Referral commissions',view.cumulativeReferral],['network','Network rewards',view.cumulativeNetwork]] as const;
 return <section className="gv2-panel gdp-overview" aria-label="Account performance">
  <header className="gdp-title"><h2>Account performance</h2><span>Lifetime</span></header>
  <div className="gdp-performance-body"><div><small>Total recorded earnings</small><strong className="gdp-large">{money(total)} <span>test USDT</span></strong>
   <div className="gdp-bar" aria-hidden="true">{sources.map(([key,,v])=><i data-source={key} key={key} style={{flexGrow:total?Number(v*100000n/total):0}}/>)}</div>
   <div className="gdp-sources">{sources.map(([key,label,v])=><div data-source={key} key={key}><i/><span>{label}</span><b>{money(v)}</b><small>{formatShare(v,total)}</small></div>)}</div>
  </div><div className="gdp-volume"><small>Qualifying team volume</small><strong>{formatShare(view.qualifiedVolume,view.requiredVolume)}</strong>
   <progress max={10000} value={view.requiredVolume?Math.min(10000,Number(view.qualifiedVolume*10000n/view.requiredVolume)):0} aria-label="Volume qualification"/>
   <span>{money(view.qualifiedVolume)} of {money(view.requiredVolume)} test USDT</span><small>Qualified directs · {view.qualifiedDirects} / {view.requiredDirects}</small></div></div>
 </section>;
}
