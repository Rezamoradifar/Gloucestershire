import {useEffect,useState} from 'react';
import {ArrowUpRight,Network,Users} from 'lucide-react';
import type {V3Snapshot} from './v3-chain';
import type {V3Action} from './v3-actions';
import {formatShare,formatV3Amount as money} from './v3-format';
import DigitalValue from './DigitalValue';
import V3ReferralInvite from './V3ReferralInvite';
import V3ReferralSchedule from './V3ReferralSchedule';
import V3MilestoneProgress from './V3MilestoneProgress';

const short=(address:string)=>address.slice(0,9)+'…'+address.slice(-6);
const stages=[500,1000,3000,5000,10000,30000,50000,100000,300000,500000,1000000,3000000,5000000,10000000];

export default function V3NetworkPanel({view,busy,readOnly=false,onAction,onWithdraw,onBranchPage,onGroupPage,groupsStatus='ready',onRetry}:{
 view:V3Snapshot;busy:boolean;readOnly?:boolean;onAction:(action:V3Action,description:string)=>void;onWithdraw:()=>void;
 groupsStatus?:'loading'|'ready'|'error';onRetry?:()=>void;
 onBranchPage:(page:number)=>void;onGroupPage:(page:number)=>void;
}){
 const [selected,setSelected]=useState<string[]>([]);
 const [group,setGroup]=useState('0');
 useEffect(()=>{setSelected([]);setGroup('0');},[view.wallet]);
 // Keep off-page selections, but remove any visible branch assigned since the
 // previous verified snapshot, including after a successful group action.
 useEffect(()=>{
  const assigned=new Set(view.networkBranches.filter(branch=>branch.grouped).map(branch=>branch.address.toLowerCase()));
  setSelected(current=>{
   const next=current.filter(address=>!assigned.has(address.toLowerCase()));
   return next.length===current.length?current:next;
  });
 },[view.networkBranches]);
 const toggle=(address:string)=>setSelected(current=>current.includes(address)?current.filter(x=>x!==address):[...current,address]);
 const BranchRow=view.manualReinvest?'div':'label';
 const visibleGroup=view.networkGroups.find(g=>String(g.id)===group)?.id??view.networkGroups[0]?.id;
 const milestones=(
  <section className="gv2-panel"><div className="gv2-panel-head"><h3>Milestone groups</h3><span>Page {view.networkGroupPage+1} · {view.networkGroupCount} total</span></div>
   {view.manualReinvest&&<p>Groups form automatically as branches record volume. A new branch opens the next group after stage 14.</p>}
   {view.networkGroups.map(g=>{const directClaim=g.prepared>=g.target||(g.branches<=64&&Boolean(g.preview?.eligible));
   return <article className={view.manualReinvest?'gv3-network-group gv3-auto-group':'gv3-network-group'} key={g.id}>
    <div><span className="gv3-kicker">GROUP #{g.id+1} · {g.branches} BRANCHES</span><h4>{view.dailyPlan?'Cycle '+(g.stage+1):g.stage>=14?'All 14 stages completed':'Stage '+(g.stage+1)+' of 14'}</h4></div>
    {(view.dailyPlan||g.stage<14)&&<>{view.manualReinvest?<V3MilestoneProgress group={g}/>:<><div><small>Volume prepared</small><strong>{money(g.prepared)} / {money(g.target)} USDT</strong></div>
     <div><small>{view.dailyPlan?'Cycle reward':'Stage claim if eligible'}</small><strong>{money(g.reward)} USDT</strong></div>
     {g.preview&&<div><small>Eligible volume including prepared</small><strong>{money(g.preview.volume)} / {money(g.target)} USDT</strong></div>}
     </>}{g.preview?.eligible&&g.prepared<g.target&&<p>One wallet transaction can prepare this volume and record the stage claim.</p>}
     {view.manualReinvest&&directClaim&&!view.eligible&&<p>Check in to qualify before recording the reward.</p>}
     <div className="gv3-queue-actions"><button disabled={busy||readOnly||view.paused||g.prepared>=g.target||g.preview?.volume===g.prepared} onClick={()=>onAction({kind:'prepareNetworkReward',group:g.id,stage:g.stage,steps:64},'Prepare eligible volume for group '+(g.id+1)+', stage '+(g.stage+1)+'?')}>Prepare volume</button>
      <button disabled={busy||readOnly||view.paused||!view.eligible||!directClaim} onClick={()=>onAction({kind:'claimNetworkRewards',group:g.id,stage:g.stage,count:1},'Prepare any remaining eligible volume and record '+(view.dailyPlan?'cycle ':'stage ')+(g.stage+1)+' test claim? This is not a cash payment.')}>{view.dailyPlan?'Record cycle claim':'Record stage claim'}</button></div></>}
   </article>})}
   {!view.networkGroups.length&&<p>{view.manualReinvest?'Your first group appears when a direct branch records volume.':'No reward group has been created for this V3 wallet.'}</p>}
   {view.networkGroupCount>20&&<div className="gv2-buttons"><button disabled={busy||view.networkGroupPage===0} onClick={()=>onGroupPage(view.networkGroupPage-1)}>Previous groups</button>
    <button disabled={busy||(view.networkGroupPage+1)*20>=view.networkGroupCount} onClick={()=>onGroupPage(view.networkGroupPage+1)}>Next groups</button></div>}
   {view.dailyPlan?<p>Each 500 USDT of new eligible deposit volume earns 35 test USDT. One branch can contribute up to 300 USDT per cycle. Used volume is deducted and the cycle repeats. Reinvestments do not add branch volume.</p>:<details><summary>Review the 14-stage test schedule</summary><div className="gv3-stage-grid">{stages.map((target,index)=>{
    const rate=index<5?7:index<8?6:index<11?5:3;
    return <div key={target}><span>Stage {index+1}</span><b>{target.toLocaleString('en-US')} USDT</b><small>{rate}% · {Math.floor(target*rate/100).toLocaleString('en-US')} USDT claim</small></div>;
   })}</div><p>Each stage uses fresh unused group volume. At stage 1, no more than 300 of the 500 USDT target can come from one branch; the remaining 200 must come from other grouped branches. Stage 2 requires 1,000 new USDT of eligible volume. Figures are test claims, not cash payouts.</p></details>}
  </section>
 );
 return <div className="gv3-network">
  <section className="gv3-network-hero"><div><span className="gv3-kicker">NETWORK & REFERRALS</span>
   <h2>Network qualification</h2><p>Qualification, referral claims and milestone rewards come from the verified V3 test contract.</p></div><Network size={27}/>
   <div className="gv3-network-stats">
    <div><small>Qualified directs</small><strong><DigitalValue value={String(view.qualifiedDirects)}/><em>/ {view.requiredDirects}</em></strong><span>{formatShare(BigInt(view.qualifiedDirects),BigInt(view.requiredDirects))} of required directs</span></div>
    <div><small>Balanced qualifying volume</small><strong><DigitalValue value={money(view.qualifiedVolume)}/><em>/ {money(view.requiredVolume)}</em></strong><span>{formatShare(view.qualifiedVolume,view.requiredVolume)} of the volume target</span></div>
    <div><small>Current / maximum rate</small><strong><DigitalValue value={String(view.dailyRateBps/100)} unit="%"/><em>/ {view.maximumRateBps/100}%</em></strong><span>Both conditions must be met for the maximum</span></div>
   </div>
  </section>
  {view.manualReinvest&&groupsStatus==='ready'&&milestones}
  {view.singleCapital&&<V3ReferralSchedule view={view}/>}
  <V3ReferralInvite view={view}/>
  <section className="gv2-panel"><div className="gv2-panel-head"><h3>Recorded team claims</h3><Users size={18}/></div>
   <div className="gv2-detail"><span>Referrer</span><b>{/^0x0{40}$/i.test(view.referrer)?'None':view.referrer}</b></div>
   <div className="gv2-detail"><span>Available referral claim</span><b><DigitalValue value={money(view.referralAvailable)} unit="USDT"/></b></div>
   {view.referralReserved!==undefined&&<div className="gv2-detail"><span>Referral claims reserved for withdrawals</span><b>{money(view.referralReserved)} USDT</b></div>}
   {view.cumulativeReferral!==undefined&&<div className="gv2-detail"><span>Lifetime referral commissions</span><b>{money(view.cumulativeReferral)} USDT</b></div>}
   <div className="gv2-detail"><span>Available network milestone claim</span><b><DigitalValue value={money(view.networkAvailable)} unit="USDT"/></b></div>
   <div className="gv2-detail"><span>Reserved milestone claim</span><b>{money(view.networkReserved)} USDT</b></div>
   <div className="gv2-detail"><span>Lifetime recorded milestone claims</span><b>{money(view.cumulativeNetwork)} USDT</b></div>
   <p>These are test claims. Manager approval, actual test-token funding and a confirmed payout remain separate steps.</p>
   <button onClick={onWithdraw} className="gv2-primary">{view.singleCapital?'Withdraw earnings in Account':'Open withdrawal requests'} <ArrowUpRight size={15}/></button>
  </section>
  {groupsStatus!=='ready'?<section className="gv2-panel" role="status">{groupsStatus==='error'?<>Branch and milestone data could not be read. <button type="button" onClick={onRetry}>Retry network data</button></>:'Loading verified network branches and groups…'}</section>:<>
  <section className="gv2-panel"><div className="gv2-panel-head"><h3>Direct branches</h3><span>Page {view.networkBranchPage+1} · {view.networkBranchCount} total</span></div>
   <p>{view.manualReinvest?'Lifetime volume for each direct branch. The stage chart shows how much counts toward the current reward.':'Select available direct branches to create a group or add them to an existing group. Each branch can belong to only one group. Volume is in test-token units.'}</p>
   <div className="gv3-branch-list">{view.networkBranches.map(branch=><BranchRow className={branch.grouped?'gv3-branch-assigned':undefined} key={branch.address}>
    {!view.manualReinvest&&<input type="checkbox" checked={!branch.grouped&&selected.includes(branch.address)} disabled={busy||readOnly||branch.grouped||(!selected.includes(branch.address)&&selected.length>=64)} onChange={()=>toggle(branch.address)}/>}
    <span><strong>{short(branch.address)}</strong><small>{branch.address}</small>
     <small className="gv3-branch-status">{view.manualReinvest?(branch.grouped?'Assigned automatically':'Assignment not verified'):(branch.grouped?'Already in a reward group':'Available to add')}</small></span><b>{money(branch.volume)} USDT</b>
   </BranchRow>)}</div>
   {!view.networkBranches.length&&<p>No verified direct branch volume is recorded yet.</p>}
   {view.networkBranchCount>20&&<div className="gv2-buttons"><button disabled={busy||view.networkBranchPage===0} onClick={()=>onBranchPage(view.networkBranchPage-1)}>Previous branches</button>
    <button disabled={busy||(view.networkBranchPage+1)*20>=view.networkBranchCount} onClick={()=>onBranchPage(view.networkBranchPage+1)}>Next branches</button></div>}
   {!view.manualReinvest&&<><p className="gv2-small">{selected.length} of 64 branches selected for this transaction.</p>
   <div className="gv2-buttons"><button disabled={busy||readOnly||view.paused||!selected.length} onClick={()=>onAction({kind:'createRewardGroup',branches:selected},'Create a new network reward group with the selected direct branches?')}>Create reward group</button>
    {visibleGroup!==undefined&&<><select aria-label="Reward group to extend" value={String(visibleGroup)} onChange={e=>setGroup(e.target.value)}>{view.networkGroups.map(g=><option key={g.id} value={g.id}>Group #{g.id+1}</option>)}</select>
     <button disabled={busy||readOnly||view.paused||!selected.length} onClick={()=>onAction({kind:'addRewardBranches',group:visibleGroup,branches:selected},'Add selected direct branches to this reward group?')}>Add to group</button></>}</div></>}
  </section>
  {!view.manualReinvest&&milestones}
  </>}
 </div>;
}
