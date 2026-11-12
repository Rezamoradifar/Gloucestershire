import {useEffect,useRef,useState} from 'react';
import {ChevronDown,ChevronRight,ExternalLink,GitBranch,RefreshCw,Users} from 'lucide-react';
import type {Snapshot} from './chain';
import {explorer} from './config';
import {displayAmount} from './money';
import {requestDirectBranches,requestTeamProfile,type DirectBranch,type TeamProfile} from './server-team';
import NetworkConstellation from './NetworkConstellation';

const short=(value:string)=>value.slice(0,8)+'…'+value.slice(-5);
const PAGE_SIZE=12;

function MemberRow({member,depth,block,selected=false}:{
 member:DirectBranch;depth:number;block:number;selected?:boolean
}){
 const [open,setOpen]=useState(false);
 const [profile,setProfile]=useState<TeamProfile|null>(null),[error,setError]=useState('');
 useEffect(()=>{if(selected)setOpen(true);},[selected]);
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();
  setProfile(null);setError('');
  void requestTeamProfile(member.address,block,controller.signal).then(value=>{
   if(!controller.signal.aborted)setProfile(value);
  }).catch(reason=>{
   if(!controller.signal.aborted)setError((reason as Error)?.message||'Verified member state unavailable.');
  });
  return()=>controller.abort();
 },[open,member.address,block]);
 return <li className="team-row">
  <div className="team-person">
   <button type="button" className="team-expand" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
    {open?<ChevronDown size={18}/>:<ChevronRight size={18}/>}
    <span><bdi>{short(member.address)}</bdi><small>Level {depth} · on-chain branch #{member.branchIndex+1}</small></span>
   </button>
   <a href={explorer+'/address/'+member.address} target="_blank" rel="noopener noreferrer"
    aria-label={'View '+short(member.address)+' contract account'}><ExternalLink size={16}/></a>
  </div>
  {open&&<div className="team-expanded">
   {profile?<div className="team-profile">
    <span>Registration: <strong>{profile.registered?'Confirmed on chain':'Not confirmed'}</strong></span>
    <span>Reporter status: <strong>{profile.active?'Verified active':'Not verified active'}</strong></span>
    <span>Reported active directs: <strong>{profile.activeDirect.toString()}</strong></span>
    <span>Recorded capital: <strong>{displayAmount(profile.capitalUsd,18,2)} USD</strong></span>
    <span>Recorded sales: <strong>{displayAmount(profile.salesUsd,18,2)} USD</strong></span>
    <span>VIP KYC: <strong>{profile.kyc?'Verified':'Not verified'}</strong></span>
   </div>:!error?<p className="muted">Reading confirmed contract member state…</p>:null}
   {error&&<p className="inline-error" role="alert">{error}</p>}
   {depth<3&&<Level key={member.address} parent={member.address} depth={depth+1} initialBlock={block}/>}
  </div>}
 </li>;
}

function Level({parent,depth,initialBlock,onDirectCount}:{
 parent:string;depth:number;initialBlock?:number;onDirectCount?:(count:number|null)=>void
}){
 const [members,setMembers]=useState<DirectBranch[]>([]);
 const [total,setTotal]=useState<number|null>(null),[loaded,setLoaded]=useState(0);
 const [snapshot,setSnapshot]=useState<number|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<string|null>(null);
 const generation=useRef(0),running=useRef(false),nextOffset=useRef(0),blockRef=useRef<number|null>(null);
 const blockHashRef=useRef<string|null>(null),pending=useRef<AbortController|null>(null);
 const load=async()=>{
  if(running.current)return;
  const id=generation.current;
  running.current=true;setBusy(true);setError('');
  const controller=new AbortController();pending.current=controller;
  const offset=nextOffset.current,requestedBlock=blockRef.current??initialBlock;
  try{
   const page=await requestDirectBranches(parent,offset,PAGE_SIZE,requestedBlock,controller.signal);
   if(generation.current!==id||controller.signal.aborted)return;
   if((blockRef.current!==null&&page.block!==blockRef.current)||
      (blockHashRef.current!==null&&page.blockHash.toLowerCase()!==blockHashRef.current.toLowerCase()))
    throw Error('A confirmed team checkpoint changed. Reopen this team to scan from a new block.');
   blockRef.current=page.block;blockHashRef.current=page.blockHash;
   nextOffset.current=offset+page.members.length;
   setLoaded(nextOffset.current);setSnapshot(page.block);setTotal(page.total);
   setMembers(previous=>[...previous,...page.members]);
   if(depth===1)onDirectCount?.(page.total);
  }catch(reason){
   if(generation.current===id&&!controller.signal.aborted)
    setError((reason as Error)?.message||'The verified on-chain team list is unavailable.');
  }finally{
   if(generation.current===id){running.current=false;setBusy(false);}
  }
 };
 useEffect(()=>{
  generation.current++;running.current=false;pending.current?.abort();pending.current=null;
  nextOffset.current=0;blockRef.current=null;blockHashRef.current=null;
  setMembers([]);setTotal(null);setLoaded(0);setSnapshot(null);setBusy(false);setError('');setSelected(null);
  if(depth===1)onDirectCount?.(null);
  void load();
  return()=>{generation.current++;pending.current?.abort();};
  // New block heights from dashboard polling do not reset an in-progress team.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[parent,depth,initialBlock]);
 const more=total!==null&&loaded<total;
 return <div className="team-level">
  <div className="team-level-heading">
   <strong>Level {depth} · {total===null?'Count pending':total.toLocaleString('en-US')+' registered'}</strong>
   <span>{total===null?'Checking contract…':loaded.toLocaleString('en-US')+' of '+total.toLocaleString('en-US')+' loaded'}</span>
  </div>
  {depth===1&&<NetworkConstellation parent={parent} members={members} selected={selected} onSelect={address=>setSelected(address)}/>}
  {members.length?<ul className="team-members">{members.map(member=>
   <MemberRow key={member.address} member={member} depth={depth} block={snapshot??0}
    selected={selected?.toLowerCase()===member.address.toLowerCase()}/>)}</ul>:
   !busy&&total===0?<p className="muted">No registered direct referrals were recorded in this contract.</p>:null}
  {error&&<p className="inline-error" role="alert">{error}</p>}
  <div className="team-footer">
   {more&&<button type="button" className="small-button" disabled={busy} onClick={()=>void load()}>
    <RefreshCw size={15} className={busy?'spin':''}/>{busy?'Reading verified members…':'Load next '+Math.min(PAGE_SIZE,total-loaded)+' members'}
   </button>}
   {error&&<button type="button" className="small-button" disabled={busy} onClick={()=>void load()}>Retry verified page</button>}
   {snapshot!==null&&<small className="muted">Contract snapshot block {snapshot.toLocaleString('en-US')}</small>}
  </div>
 </div>;
}

export default function NetworkDirectory({who,connected,data}:{
 who:string;connected:boolean;data:Snapshot|null
}){
 const [registeredDirect,setRegisteredDirect]=useState<number|null>(null);
 useEffect(()=>{setRegisteredDirect(null);},[who,connected]);
 return <section className="panel global-team" aria-labelledby="global-team-title">
  <div className="panel-title"><div><span className="detail-kicker">CONFIRMED CONTRACT TEAM</span>
   <h2 id="global-team-title"><GitBranch size={22}/> Your referral team</h2>
   <p>Direct and indirect registered wallets from the contract itself, with three levels of verified membership.</p></div>
   <span className="round-icon"><Users size={22}/></span>
  </div>
  <div className="team-summary">
   <div><small>Registered direct members · on-chain</small><strong>{registeredDirect===null?'—':registeredDirect.toLocaleString('en-US')}</strong></div>
   <div><small>Reporter-verified active directs</small><strong>{data?data.direct.toString():'—'}</strong></div>
   <div><small>Your referring wallet</small><strong>{data?.referrer&&!/^0x0{40}$/i.test(data.referrer)?short(data.referrer):'None recorded'}</strong></div>
   <div><small>Account status</small><strong>{data?(data.active?'Reporter-verified active':'Not verified active'):'Connect wallet'}</strong></div>
  </div>
  <p className="ledger-note">Registered members and reporter-verified active members are different counts. The latter is set through authorized contract activity verification and is not automatically equal to registered referrals. Contract volume does not prove credited or paid profit. No invitation or activity status is fabricated.</p>
  {connected&&data&&data.blockNumber>0?
   <Level key={who.toLowerCase()} parent={who} depth={1} onDirectCount={setRegisteredDirect}/>:
   <p className="muted">Connect your wallet on the configured chain to load verified referral members.</p>}
 </section>;
}
