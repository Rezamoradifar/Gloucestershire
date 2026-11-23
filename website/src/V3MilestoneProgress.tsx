import {useId} from 'react';
import {formatV3Amount as money} from './v3-format';
import {stageBranchCapBps} from './v3-network-preview';
import type {V3NetworkGroup} from './v3-chain';

export default function V3MilestoneProgress({group}:{group:V3NetworkGroup}){
 const id=useId();
 const {target,reward,prepared,preview,branchAddresses}=group;
 const capBps=stageBranchCapBps(target);
 const cap=target*capBps/10_000n;
 const counted=preview?.volume??prepared;
 const complete=counted===target;
 const exact=Boolean(preview)||complete;
 const scale=Number(counted*10000n/target);
 const amounts=preview?.byBranch??[];
 function row(amount:bigint,index:number){
  const address=branchAddresses?.[index];
  return <li key={index}><span>Branch {index+1}
   {address&&<small title={address}>{address.slice(0,8)}…{address.slice(-6)}</small>}</span>
   <meter min={0} max={10000} value={Number(amount*10000n/cap)} aria-label={'Branch '+(index+1)+' share of branch cap'}
    aria-valuetext={money(amount)+' of '+money(cap)+' test USDT'}/><b>{money(amount)}</b></li>;
 }
 return <figure className="gv3-stage-progress" aria-labelledby={id+'-title'}>
  <figcaption id={id+'-title'}>{exact?'Eligible stage volume':'Confirmed prepared volume'}</figcaption>
  <div className="gv3-stage-total"><strong>{money(counted)}</strong><span>of {money(target)} test USDT</span></div>
  <progress value={scale} max={10000} aria-labelledby={id+'-title'} aria-valuetext={money(counted)+' of '+money(target)+' test USDT'}/>
  <div className="gv3-stage-outlook"><div><span>{complete?'Stage status':exact?'Still needed':'Volume preview'}</span>
   <b>{complete?'Target reached':exact?money(target-counted)+' test USDT':'Partial view'}</b></div>
   <div><span>Stage reward</span><b>{money(reward)} test USDT</b></div></div>
  {amounts.length>0&&<><h5>Counted from each branch</h5><ul className="gv3-stage-branches">{amounts.slice(0,4).map(row)}</ul>
   {amounts.length>4&&<details><summary>Show {amounts.length-4} more branches</summary>
    <ul className="gv3-stage-branches">{amounts.slice(4).map((amount,i)=>row(amount,i+4))}</ul></details>}</>}
  <p>Each branch can supply up to {money(cap)} test USDT ({Number(capBps)/100}%) for this stage.
   {prepared>0n&&' Includes '+money(prepared)+' already prepared.'}
   {!exact&&' Additional branch volume may qualify. The full eligible total has not been verified.'}</p>
 </figure>;
}
