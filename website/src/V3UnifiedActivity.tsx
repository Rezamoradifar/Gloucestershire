import {RefreshCw,ShieldCheck} from 'lucide-react';
import {formatEther} from 'ethers';
import type {V3Snapshot} from './v3-chain';
import {formatUtcTime} from './utc-time';

// A unified check-in records activity only. It does not accrue or pay profit.
export default function V3UnifiedActivity({view,busy,readOnly,onCheckIn}:{
 view:V3Snapshot;busy:boolean;readOnly:boolean;onCheckIn:()=>void
}){
 const cooldown=view.lastCheckIn>0&&view.asOf<view.lastCheckIn+3600;
 const needsCapital=view.dailyPlan&&(view.capital<10n*10n**18n||(view.capital>50000n*10n**18n&&!view.vipKyc));
 const disabled=needsCapital||busy||readOnly||!view.registered||view.suspended||view.paused||cooldown;
 return <section className="gv3-cycle" aria-label="Unified test account activity">
  <div className="gv3-activity"><ShieldCheck size={19}/><div><strong>Check in to qualify</strong>
   <small>Check-in records activity only. Eligible claims need a verified keeper.</small>
   {needsCapital&&<small>Check-in requires at least 10 test USDT of principal and VIP verification above 50,000.</small>}
   {cooldown&&<small>Check-in cooldown ends at {formatUtcTime(view.lastCheckIn+3600)}.</small>}
   {readOnly&&<small>This test preview is read-only.</small>}</div>
  <button type="button" disabled={disabled} onClick={onCheckIn}><RefreshCw size={14}/> Check in</button></div>
  {view.keeper&&<div className="gv3-cycle-copy" role="status">
   <strong>{view.keeper.gasWei===null?'Keeper gas status unavailable':
    view.keeper.gasWei<1000000000000000n?'Automatic profit waiting for tBNB':'Keeper gas available'}</strong>
   <p>Keeper wallet: <span className="network-address">{view.keeper.operator}</span></p>
   <p>{view.keeper.gasWei!==null&&'Verified balance: '+formatEther(view.keeper.gasWei)+' tBNB. '}
    Automatic recording requires at least 0.001 tBNB on BNB Testnet (97).
    {!readOnly&&' Deposits and account registration are enabled.'}</p>
  </div>}
 </section>;
}
