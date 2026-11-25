import {useEffect,useRef,useState} from 'react';
import {ZeroAddress,type Eip1193Provider} from 'ethers';
import type {V3SiteReleaseConfig} from './v3-site-config';
import {readMemberDetails,readMemberDirectory,type MemberChange,type MemberDetails} from './v3-manager-vip';
import {formatV3Amount,v3TierName} from './v3-format';
import {formatUtcTime} from './utc-time';

type Props={provider:Eip1193Provider;manager:string;config:V3SiteReleaseConfig;busy:boolean;readOnly:boolean;
  onChange:(change:MemberChange,description:string)=>Promise<void>};
type Registry=Awaited<ReturnType<typeof readMemberDirectory>>;

export default function V3ManagerVipPanel({provider,manager,config,busy,readOnly,onChange}:Props) {
 const [input,setInput]=useState(''),[record,setRecord]=useState<MemberDetails|null>(null);
 const [checking,setChecking]=useState(false),[error,setError]=useState('');
 const [page,setPage]=useState(0),[refresh,setRefresh]=useState(0),[registry,setRegistry]=useState<Registry|null>(null),[registryError,setRegistryError]=useState('');
 const request=useRef(0),detailsRef=useRef<HTMLElement>(null);
 useEffect(()=>()=>{request.current++;},[provider,manager,config.address]);
 useEffect(()=>{
  let active=true;setRegistry(null);setRegistryError('');
  readMemberDirectory(provider,manager,config,page).then(data=>{if(active)setRegistry(data);})
   .catch(e=>{if(active)setRegistryError(e instanceof Error?e.message:'Member registry unavailable.');});
  return ()=>{active=false;};
 },[provider,manager,config,page,refresh]);

 async function lookup(target:string){
  const id=++request.current;setInput(target);setChecking(true);setRecord(null);setError('');
  try{
   const next=await readMemberDetails(provider,manager,target,config);
   if(request.current===id){setRecord(next);requestAnimationFrame(()=>detailsRef.current?.focus());}
  }catch(e){if(request.current===id)setError(e instanceof Error?e.message:'Member lookup unavailable.');}
  finally{if(request.current===id)setChecking(false);}
 }
 async function review(current:MemberDetails,kind:MemberChange['kind']){
  const id=request.current;
  if(kind==='setVipKyc'){
   await onChange({kind,member:current.member,previous:current.approved,approved:!current.approved},
    'Member wallet: '+current.member+'. Change VIP verification from '+(current.approved?'approved to not approved':'not approved to approved')+' on this vault.');
  }else{
   await onChange({kind,member:current.member,previous:current.suspended,suspended:!current.suspended},
    (current.suspended?'Restore access for member ':'Suspend member ')+current.member+' on this vault.');
  }
  if(id===request.current)await lookup(current.member);
 }
 const money=(value:bigint)=>formatV3Amount(value)+' test USDT';
 return <section className="gv2-panel gv3-support" aria-label="Member directory and VIP verification">
  <h2>Member directory</h2>
  <form className="gv3-support-tools" onSubmit={e=>{e.preventDefault();void lookup(input);}}>
   <label>Member wallet address<input value={input} onChange={e=>{request.current++;setInput(e.target.value);setRecord(null);setError('');setChecking(false);}}
    disabled={busy} spellCheck={false} autoComplete="off" placeholder="0x…"/></label>
   <button disabled={busy||checking||!input.trim()}>{checking?'Checking member…':'Look up member'}</button>
  </form>
  {registryError&&<p role="alert">{registryError}</p>}
  <div className="gv3-support-actions"><button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Refresh directory</button>
   {registry&&<span>{registry.total} registered · Page {page+1}</span>}</div>
  {!registry&&!registryError&&<p role="status">Loading the member registry…</p>}
  {registry&&<><div className="gv3-support-list">{registry.members.map((address,i)=><button className="gv3-member-row" key={address} disabled={busy||checking}
   onClick={()=>void lookup(address)}><strong>Member {page*10+i+1}</strong><small>{address}</small></button>)}</div>
   {registry.total>10&&<div className="gv3-support-actions"><button disabled={busy||page===0} onClick={()=>setPage(n=>n-1)}>Previous members</button>
    <button disabled={busy||(page+1)*10>=registry.total} onClick={()=>setPage(n=>n+1)}>Next members</button></div>}
  </>}
  {error&&<p role="alert">{error}</p>}
  {record&&<article className="gv3-support-thread" tabIndex={-1} ref={detailsRef}><h3>Member details</h3><p>{record.member}</p>
   {!record.registered?<p>Unregistered in this vault.</p>:<>
    <dl className="gv3-member-facts">{[
     ['Account status',record.suspended?'Suspended':'Registered'],['Plan',v3TierName(record.tier)],
     ['VIP verification',record.approved?'Approved':'Not approved'],['Referrer',record.referrer===ZeroAddress?'No referrer':record.referrer],
     ['Principal',money(record.capital)],['External deposits',money(record.deposits)],['Reinvested',money(record.reinvestments)],
     ['Available referrals',money(record.referral)],['Available network rewards',money(record.network)],
     ['Positions',record.positions],['Withdrawal requests',record.requests],['Last check-in',formatUtcTime(record.lastCheckIn)]
    ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="gv3-support-actions"><button disabled={busy||readOnly||checking} onClick={()=>void review(record,'setVipKyc')}>
     {record.approved?'Review revocation':'Review VIP approval'}</button>
     {record.canGuard&&<button disabled={busy||readOnly||checking} onClick={()=>void review(record,'setSuspended')}>
      {record.suspended?'Review reactivation':'Review suspension'}</button>}</div>
   </>}
   <small>Confirmed at block {record.block.toLocaleString('en-US')} · {formatUtcTime(record.timestamp)}</small>
  </article>}
 </section>;
}
