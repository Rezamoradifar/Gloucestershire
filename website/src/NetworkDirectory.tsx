import {useEffect,useRef,useState} from 'react';
import {ChevronDown,ChevronRight,ExternalLink,GitBranch,RefreshCw,Users} from 'lucide-react';
import type {Snapshot} from './chain';
import {explorer} from './config';
import {displayAmount} from './money';
import {requestTeamPage,requestTeamProfile,type TeamMember,type TeamProfile} from './server-team';
import NetworkConstellation from './NetworkConstellation';

const short=(a:string)=>a.slice(0,8)+'…'+a.slice(-5);
const PAGE_WINDOW=96;
const WINDOWS_PER_CLICK=12;
type Member=TeamMember;

function MemberRow({member,depth,block,selected=false}:{member:Member;depth:number;block:number;selected?:boolean}){
 const [open,setOpen]=useState(false),[profile,setProfile]=useState<TeamProfile|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{if(selected)setOpen(true);},[selected]);
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();
  setProfile(null);setError('');
  void requestTeamProfile(member.address,block,controller.signal).then(setProfile).catch(reason=>{
   if(!controller.signal.aborted)setError((reason as Error)?.message||'Verified profile unavailable.');
  });
  return()=>controller.abort();
 },[member.address,block,open]);
 return <li className="team-row">
  <div className="team-person">
   <button type="button" className="team-expand" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
    {open?<ChevronDown size={18}/>:<ChevronRight size={18}/>}
    <span><bdi>{short(member.address)}</bdi><small>Level {depth} · registered at block {member.block.toLocaleString('en-US')}</small></span>
   </button>
   <a href={explorer+'/tx/'+member.tx} target="_blank" rel="noopener noreferrer"
    aria-label={'View '+short(member.address)+' registration transaction'}><ExternalLink size={16}/></a>
  </div>
  {open&&<div className="team-expanded">
   {profile?<div className="team-profile">
    <span>Status: <strong>{profile.active?'Verified active':'Not verified active'}</strong></span>
    <span>Registered: <strong>{profile.registered?'Yes':'No'}</strong></span>
    <span>Reported active directs: <strong>{profile.activeDirect.toString()}</strong></span>
    <span>Recorded capital: <strong>{displayAmount(profile.capitalUsd,18,2)} USD</strong></span>
    <span>Recorded sales: <strong>{displayAmount(profile.salesUsd,18,2)} USD</strong></span>
    <span>VIP KYC: <strong>{profile.kyc?'Verified':'Not verified'}</strong></span>
   </div>:!error?<p className="muted">Reading confirmed member state through the server RPC…</p>:null}
   {error&&<p className="inline-error" role="alert">{error}</p>}
   {depth<3&&<Level key={member.address} parent={member.address} block={block} depth={depth+1}/>}
  </div>}
 </li>;
}

function Level({parent,block,depth}:{parent:string;block:number;depth:number}){
 const [members,setMembers]=useState<Member[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [cursor,setCursor]=useState<number|null>(null),[show,setShow]=useState(12),[focused,setFocused]=useState<string|null>(null);
 const cursorRef=useRef<number|null>(null),request=useRef(0),running=useRef(false);
 const confirmedRef=useRef<number>(0);
 const load=async()=>{
  if(cursorRef.current===null||running.current)return;
  const id=request.current;
  running.current=true;setBusy(true);setError('');
  let current=cursorRef.current;
  const found:Member[]=[];
  try{
   for(let n=0;n<WINDOWS_PER_CLICK&&current!==null;n++){
    if(id!==request.current)return;
    const first=Math.max(0,current-PAGE_WINDOW+1);
    const result=await requestTeamPage(parent,first,current);
    if(result.confirmedHead<confirmedRef.current)throw Error('Team snapshot is behind its original checkpoint. Retry this level.');
    found.push(...result.members);
    current=first===0?null:first-1;
   }
   if(id!==request.current)return;
   setMembers(old=>{
    const map=new Map(old.map(row=>[row.address.toLowerCase(),row]));
    for(const row of found)map.set(row.address.toLowerCase(),row);
    return [...map.values()].sort((a,b)=>b.block-a.block||b.index-a.index);
   });
   cursorRef.current=current;setCursor(current);
  }catch(reason){if(id===request.current)setError((reason as Error)?.message||'Team scan unavailable.');}
  finally{if(id===request.current){running.current=false;setBusy(false);}}
 };
 useEffect(()=>{
  request.current++;running.current=false;
  cursorRef.current=null;confirmedRef.current=0;
  setMembers([]);setCursor(null);setError('');setShow(12);setFocused(null);
  const id=request.current;
  void requestTeamPage(parent).then(info=>{
   if(request.current!==id)return;
   confirmedRef.current=Math.min(block,info.confirmedHead);
   cursorRef.current=confirmedRef.current;setCursor(confirmedRef.current);
   void load();
  }).catch(reason=>{if(id===request.current)setError((reason as Error)?.message||'Verified team RPC is unavailable.');});
  return()=>{request.current++;};
  // Changes to dashboard poll block must not reset pages already verified.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[parent,depth]);
 return <div className="team-level">
  <div className="team-level-heading"><strong>Level {depth} · {members.length} discovered</strong>
   <span>{busy?'Scanning verified registrations…':cursor===null&&confirmedRef.current>0?'Scanned to genesis':confirmedRef.current>0?'Older registrations may exist':'Awaiting RPC snapshot'}</span></div>
  {depth===1&&<NetworkConstellation parent={parent} members={members} selected={focused} onSelect={address=>{
   setFocused(address);setShow(Math.max(show,members.findIndex(row=>row.address===address)+1));
  }}/>}
  {members.length?<ul className="team-members">{members.slice(0,show).map(member=>
   <MemberRow key={member.address} member={member} depth={depth} block={confirmedRef.current} selected={focused===member.address}/>)}</ul>:
   !busy&&confirmedRef.current>0&&!error?<p className="muted">No registrations in the scanned blocks. Older blocks may still contain members.</p>:null}
  {error&&<p className="inline-error" role="alert">{error}</p>}
  <div className="team-footer">
   {members.length>show&&<button type="button" className="small-button" onClick={()=>setShow(v=>v+12)}>Show more members</button>}
   {cursor!==null&&<button type="button" className="small-button" disabled={busy} onClick={()=>void load()}>
    <RefreshCw size={15} className={busy?'spin':''}/>{busy?'Reading registrations…':error?'Retry registration scan':'Load older registrations'}
   </button>}
  </div>
 </div>;
}

export default function NetworkDirectory({who,connected,data}:{who:string;connected:boolean;data:Snapshot|null}){
 return <section className="panel global-team" aria-labelledby="global-team-title">
  <div className="panel-title"><div><span className="detail-kicker">SERVER-VERIFIED CONTRACT REGISTRATIONS</span>
   <h2 id="global-team-title"><GitBranch size={22}/> Your referral team</h2>
   <p>Explore confirmed on-chain registrations through three referral levels, even when a mobile wallet cannot read historical logs.</p></div>
   <span className="round-icon"><Users size={22}/></span></div>
  <div className="team-summary"><div><small>Reporter-verified active directs</small><strong>{data?data.direct.toString():'—'}</strong></div>
   <div><small>Your referring wallet</small><strong>{data&&data.referrer&&!/^0x0{40}$/i.test(data.referrer)?short(data.referrer):'None recorded'}</strong></div>
   <div><small>Account status</small><strong>{data?(data.active?'Active':'Not verified active'):'Connect wallet'}</strong></div></div>
  <p className="ledger-note">Team registrations and expanded profiles come from verified BNB contract RPC reads on the Global server. Loaded counts are partial until every historical range has been scanned. Active-direct counts and earnings are separate on-chain metrics, not invitation counts.</p>
  {connected&&data&&data.blockNumber>0?<Level key={who.toLowerCase()} parent={who} block={data.blockNumber} depth={1}/>:
   <p className="muted">Connect your wallet on the configured chain to view your referral tree.</p>}
 </section>;
}
