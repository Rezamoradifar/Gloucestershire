import {useEffect,useState} from 'react';
import {ArrowUpRight,Network,Users} from 'lucide-react';
import type {V3Snapshot} from './v3-chain';
import type {V3Action} from './v3-actions';
import {formatV3Amount as money} from './v3-format';

const short=(address:string)=>address.slice(0,9)+'…'+address.slice(-6);
const stages=[500,1000,3000,5000,10000,30000,50000,100000,300000,500000,1000000,3000000,5000000,10000000];

export default function V3NetworkPanel({view,busy,onAction,onWithdraw,onBranchPage,onGroupPage}:{
 view:V3Snapshot;busy:boolean;onAction:(action:V3Action,description:string)=>void;onWithdraw:()=>void;
 onBranchPage:(page:number)=>void;onGroupPage:(page:number)=>void;
}){
 const [selected,setSelected]=useState<string[]>([]);
 const [group,setGroup]=useState('0');
 useEffect(()=>{setSelected([]);setGroup('0');},[view.wallet]);
 const toggle=(address:string)=>setSelected(current=>current.includes(address)?current.filter(x=>x!==address):[...current,address]);
 const visibleGroup=view.networkGroups.find(g=>String(g.id)===group)?.id??view.networkGroups[0]?.id;
 return <div className="gv3-network">
  <section className="gv3-network-hero"><div><span className="gv3-kicker">NETWORK & REFERRALS</span>
   <h2>Progress with a clear view</h2><p>Qualification, referral claims and milestone rewards come from the verified V3 test contract.</p></div><Network size={27}/>
   <div className="gv3-network-stats">
    <div><small>Qualified directs</small><strong>{view.qualifiedDirects} <em>/ {view.requiredDirects}</em></strong><span>Each direct holds at least 100 TEST principal</span></div>
    <div><small>Balanced qualifying volume</small><strong>{money(view.qualifiedVolume)} <em>/ {money(view.requiredVolume)}</em></strong><span>Branch caps apply to the upgrade</span></div>
    <div><small>Current / maximum rate</small><strong>{view.dailyRateBps/100}% <em>/ {view.maximumRateBps/100}%</em></strong><span>Both conditions must be met for the maximum</span></div>
   </div>
  </section>
  <section className="gv2-panel"><div className="gv2-panel-head"><h3>Recorded team claims</h3><Users size={18}/></div>
   <div className="gv2-detail"><span>Referrer</span><b>{/^0x0{40}$/i.test(view.referrer)?'None':view.referrer}</b></div>
   <div className="gv2-detail"><span>Available referral claim</span><b>{money(view.referralAvailable)} TEST</b></div>
   <div className="gv2-detail"><span>Available network milestone claim</span><b>{money(view.networkAvailable)} TEST</b></div>
   <div className="gv2-detail"><span>Reserved milestone claim</span><b>{money(view.networkReserved)} TEST</b></div>
   <div className="gv2-detail"><span>Lifetime recorded milestone claims</span><b>{money(view.cumulativeNetwork)} TEST</b></div>
   <p>These are test claims. Manager approval, actual test-token funding and a confirmed payout remain separate steps.</p>
   <button onClick={onWithdraw} className="gv2-primary">Open withdrawal requests <ArrowUpRight size={15}/></button>
  </section>
  <section className="gv2-panel"><div className="gv2-panel-head"><h3>Direct branches</h3><span>Page {view.networkBranchPage+1} · {view.networkBranchCount} total</span></div>
   <p>Choose direct branches to form a group. A branch can belong to only one group. Volume is in test-token units.</p>
   <div className="gv3-branch-list">{view.networkBranches.map(branch=><label key={branch.address}>
    <input type="checkbox" checked={selected.includes(branch.address)} disabled={busy||(!selected.includes(branch.address)&&selected.length>=64)} onChange={()=>toggle(branch.address)}/>
    <span><strong>{short(branch.address)}</strong><small>{branch.address}</small></span><b>{money(branch.volume)} TEST</b>
   </label>)}</div>
   {!view.networkBranches.length&&<p>No verified direct branch volume is recorded yet.</p>}
   <div className="gv2-buttons"><button disabled={busy||view.networkBranchPage===0} onClick={()=>onBranchPage(view.networkBranchPage-1)}>Previous branches</button>
    <button disabled={busy||(view.networkBranchPage+1)*20>=view.networkBranchCount} onClick={()=>onBranchPage(view.networkBranchPage+1)}>Next branches</button></div>
   <p className="gv2-small">{selected.length} of 64 branches selected for this transaction.</p>
   <div className="gv2-buttons"><button disabled={busy||view.paused||!selected.length} onClick={()=>onAction({kind:'createRewardGroup',branches:selected},'Create a new network reward group with the selected direct branches?')}>Create reward group</button>
    {visibleGroup!==undefined&&<><select aria-label="Reward group to extend" value={String(visibleGroup)} onChange={e=>setGroup(e.target.value)}>{view.networkGroups.map(g=><option key={g.id} value={g.id}>Group #{g.id+1}</option>)}</select>
     <button disabled={busy||view.paused||!selected.length} onClick={()=>onAction({kind:'addRewardBranches',group:visibleGroup,branches:selected},'Add selected direct branches to this reward group?')}>Add to group</button></>}</div>
  </section>
  <section className="gv2-panel"><div className="gv2-panel-head"><h3>Milestone groups</h3><span>Page {view.networkGroupPage+1} · {view.networkGroupCount} total</span></div>
   {view.networkGroups.map(g=><article className="gv3-network-group" key={g.id}>
    <div><span className="gv3-kicker">GROUP #{g.id+1} · {g.branches} BRANCHES</span><h4>{g.stage>=14?'All 14 stages completed':'Stage '+(g.stage+1)+' of 14'}</h4></div>
    {g.stage<14&&<><div><small>Volume prepared</small><strong>{money(g.prepared)} / {money(g.target)} TEST</strong></div>
     <div><small>Stage claim if eligible</small><strong>{money(g.reward)} TEST</strong></div>
     <div className="gv3-queue-actions"><button disabled={busy||view.paused||g.prepared>=g.target} onClick={()=>onAction({kind:'prepareNetworkReward',group:g.id,stage:g.stage,steps:64},'Prepare eligible volume for group '+(g.id+1)+', stage '+(g.stage+1)+'?')}>Prepare volume</button>
      <button disabled={busy||view.paused||!view.eligible||g.prepared<g.target} onClick={()=>onAction({kind:'claimNetworkRewards',group:g.id,stage:g.stage,count:1},'Record the eligible stage '+(g.stage+1)+' test claim? This is not a cash payment.')}>Record stage claim</button></div></>}
   </article>)}
   {!view.networkGroups.length&&<p>No reward group has been created for this V3 wallet.</p>}
   <div className="gv2-buttons"><button disabled={busy||view.networkGroupPage===0} onClick={()=>onGroupPage(view.networkGroupPage-1)}>Previous groups</button>
    <button disabled={busy||(view.networkGroupPage+1)*20>=view.networkGroupCount} onClick={()=>onGroupPage(view.networkGroupPage+1)}>Next groups</button></div>
   <details><summary>Review the 14-stage test schedule</summary><div className="gv3-stage-grid">{stages.map((target,index)=>{
    const rate=index<5?7:index<8?6:index<11?5:3;
    return <div key={target}><span>Stage {index+1}</span><b>{target.toLocaleString('en-US')} TEST</b><small>{rate}% · {Math.floor(target*rate/100).toLocaleString('en-US')} TEST claim</small></div>;
   })}</div><p>Stages use fresh unused volume and branch caps; figures are test claims, not cash payouts.</p></details>
  </section>
 </div>;
}
