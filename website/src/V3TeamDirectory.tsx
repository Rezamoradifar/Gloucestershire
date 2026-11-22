import {useEffect,useRef,useState} from 'react';
import type {Eip1193Provider} from 'ethers';
import {V3_EXPLORER,type V3Snapshot} from './v3-chain';
import {formatV3Amount} from './v3-format';
import type {V3SiteReleaseConfig} from './v3-site-config';
import {readV3TeamDirectory,type TeamMember} from './v3-team-directory';

type Directory={members:TeamMember[];scanned:number;total:number;block:number;status:'reading'|'complete'|'error'};
const pageSize=10;
export default function V3TeamDirectory({view,provider,config}:{view:V3Snapshot;provider:Eip1193Provider;config:V3SiteReleaseConfig}){
 const latest=useRef(view);latest.current=view;
 const [attempt,setAttempt]=useState(0),[page,setPage]=useState(0),[level,setLevel]=useState(0);
 const [state,setState]=useState<Directory>({members:[],scanned:0,total:view.memberCount,block:view.block,status:'reading'});
 useEffect(()=>{
  const anchor=latest.current,controller=new AbortController();
  setPage(0);setLevel(0);
  setState({members:[],scanned:0,total:anchor.memberCount,block:anchor.block,status:'reading'});
  readV3TeamDirectory(provider,config,anchor.wallet,controller.signal,chunk=>{
   if(!controller.signal.aborted)setState(v=>({...v,block:chunk.block,total:chunk.total,scanned:chunk.scanned,members:v.members.concat(chunk.members)}));
  }).then(()=>{
   if(!controller.signal.aborted)setState(v=>({...v,status:'complete'}));
  }).catch(()=>{
   if(!controller.signal.aborted)setState(v=>({...v,status:'error'}));
  });
  return ()=>controller.abort();
 },[provider,config,view.wallet,view.memberCount,attempt]);
 const {members,scanned,total,block,status}=state;
 const direct=members.filter(m=>m.level===1).length,active=members.filter(m=>m.eligible).length;
 const levels=Array.from(new Set(members.map(m=>m.level))).sort((a,b)=>a-b);
 const filtered=level===0?members:members.filter(m=>m.level===level);
 const pages=Math.max(1,Math.ceil(filtered.length/pageSize));
 return <section className="gv2-panel gv3-team-directory" aria-label="Team directory">
  <div className="gv2-panel-head"><h2>Team members</h2><button type="button" disabled={status==='reading'} onClick={()=>setAttempt(n=>n+1)}>{status==='error'?'Retry team lookup':'Refresh team'}</button></div>
  <p role="status">{status==='complete'?`All ${total} registry entries checked`:status==='error'?`Incomplete team lookup · ${scanned} of ${total} entries checked`:`Checking registry · ${scanned} of ${total}`} · Block {block.toLocaleString('en-US')}</p>
  <dl aria-label={status==='complete'?'Team totals':'Team members verified so far'} className="gv3-team-totals"><div><dt>Direct</dt><dd>{!scanned&&status!=='complete'?'—':direct}</dd></div><div><dt>Indirect</dt><dd>{!scanned&&status!=='complete'?'—':members.length-direct}</dd></div><div><dt>Active</dt><dd>{!scanned&&status!=='complete'?'—':active}</dd></div></dl>
  {members.length>0&&<><p>Rates below use each member’s current capital. Recorded commissions appear in History.</p><label>Referral level <select value={level} onChange={e=>{setLevel(Number(e.target.value));setPage(0);}}><option value={0}>All levels</option>{levels.map(n=><option value={n} key={n}>Level {n}</option>)}</select></label>
   <ul>{filtered.slice(page*pageSize,(page+1)*pageSize).map(m=><li key={m.wallet}>
    <div><strong>Level {m.level}{m.level===1?' · Direct':''}</strong><span className={m.eligible?'gv3-team-active':''}>{m.suspended?'Suspended':m.eligible?'Active':m.capital===0n?'Awaiting deposit':'Inactive'}</span></div>
    <a href={V3_EXPLORER+'/address/'+m.wallet} target="_blank" rel="noreferrer">{m.wallet}</a>
    <small>Referred by {m.level===1?'you':m.referrer}</small><b>{formatV3Amount(m.capital)} test USDT principal</b>
    <small>{m.level>4?'Outside the four commission levels':m.rateBps===null?'Current level rate unavailable':`Current level rate: ${m.rateBps/100}% of qualifying profit`}</small>
    {m.level===4&&Boolean(m.rateBps)&&(!view.eligible||view.tier!==4||!view.vipKyc)&&<small>Your account currently needs active, KYC-verified VIP status for this level.</small>}
   </li>)}</ul>
   {pages>1&&<div className="gv2-buttons"><button disabled={page===0} onClick={()=>setPage(n=>n-1)}>Previous members</button><span>{page+1} / {pages}</span><button disabled={page+1>=pages} onClick={()=>setPage(n=>n+1)}>Next members</button></div>}
  </>}
  {status==='complete'&&!members.length&&<p>No registered referrals under this wallet on this contract.</p>}
 </section>;
}
