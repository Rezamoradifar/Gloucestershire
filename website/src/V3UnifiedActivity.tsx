import {RefreshCw,ShieldCheck} from 'lucide-react';
import type {V3Snapshot} from './v3-chain';

// A unified check-in records activity only. It does not accrue or pay profit.
export default function V3UnifiedActivity({view,busy,readOnly,onCheckIn}:{
 view:V3Snapshot;busy:boolean;readOnly:boolean;onCheckIn:()=>void
}){
 const cooldown=view.lastCheckIn>0&&view.asOf<view.lastCheckIn+3600;
 const disabled=busy||readOnly||!view.registered||view.suspended||view.paused||cooldown;
 return <section className="gv3-cycle" aria-label="Unified test account activity">
  <div className="gv3-activity"><ShieldCheck size={19}/><div><strong>Check in to qualify</strong>
   <small>Check-in records activity only. Eligible claims need a verified keeper.</small>
   {cooldown&&<small>Check-in is on cooldown at the verified block.</small>}
   {readOnly&&<small>This test preview is read-only.</small>}</div>
  <button type="button" disabled={disabled} onClick={onCheckIn}><RefreshCw size={14}/> Check in</button></div>
 </section>;
}
