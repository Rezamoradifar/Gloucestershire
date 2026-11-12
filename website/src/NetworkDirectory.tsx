import {useEffect,useRef,useState} from 'react';
import {Interface,ZeroAddress,getAddress,type Log} from 'ethers';
import {ChevronDown,ChevronRight,ExternalLink,GitBranch,RefreshCw,Users} from 'lucide-react';
import {errorText,type Snapshot} from './chain';
import {readOnlySession} from './read-only-session';
import {requestVerifiedHistory} from './server-event-history';
import {requestVerifiedTeamMember,type VerifiedTeamMember} from './team-data';
import {explorer} from './config';
import {displayAmount} from './money';
import NetworkConstellation from './NetworkConstellation';

const registry=new Interface(['event Registered(address indexed user,address indexed referrer)']);
type Member={address:string;block:number;tx:string};
type Profile=VerifiedTeamMember;
const short=(a:string)=>a.slice(0,8)+'…'+a.slice(-5);

function MemberRow({root,member,depth,block,selected=false}:{root:string;member:Member;depth:number;block:number;selected?:boolean}){
 const [open,setOpen]=useState(false),[profile,setProfile]=useState<Profile|null>(null),[error,setError]=useState('');
 useEffect(()=>{if(selected)setOpen(true);},[selected]);
 useEffect(()=>{
  if(!open)return;
  let cancelled=false;setProfile(null);setError('');
  requestVerifiedTeamMember(member.address).then(user=>{
   if(!cancelled)setProfile(user);
  }).catch(reason=>{if(!cancelled)setError(errorText(reason));});
  return()=>{cancelled=true;};
 },[root,member.address,block,open]);
 return <li className="team-row">
  <div className="team-person">
   <button type="button" className="team-expand" aria-expanded={open} onClick={()=>setOpen(x=>!x)}>
    {open?<ChevronDown size={18}/>:<ChevronRight size={18}/>}
    <span><bdi>{short(member.address)}</bdi><small>Level {depth} · joined at block {member.block.toLocaleString('en-US')}</small></span>
   </button>
   <a href={explorer+'/address/'+member.address} target="_blank" rel="noopener noreferrer" aria-label={'View '+short(member.address)+' on chain'}><ExternalLink size={16}/></a>
  </div>
  {open&&<div className="team-expanded">
   {profile?<div className="team-profile"><span>Status: <strong>{profile.active?'Verified active':'Not verified active'}</strong></span>
    <span>Registered: <strong>{profile.registered?'Yes':'No'}</strong></span>
    <span>Reported active directs: <strong>{profile.activeDirect.toString()}</strong></span>
    <span>Recorded capital: <strong>{displayAmount(profile.capitalUsd,18,2)} USD</strong></span>
    <span>Recorded sales: <strong>{displayAmount(profile.salesUsd,18,2)} USD</strong></span>
    <span>VIP KYC: <strong>{profile.kyc?'Verified':'Not verified'}</strong></span><span>Confirmed snapshot: <strong>{profile.blockNumber.toLocaleString('en-US')}</strong></span></div>:!error?<p className="muted">Reading confirmed member details from server RPC…</p>:null}
   {error&&<p className="inline-error" role="alert">{error}</p>}
   {depth<3&&<Level key={member.address} root={root} parent={member.address} block={block} depth={depth+1}/>}
  </div>}
 </li>;
}

function Level({root,parent,block,depth}:{root:string;parent:string;block:number;depth:number}){
 const [members,setMembers]=useState<Member[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[cursor,setCursor]=useState<number|null>(null),[show,setShow]=useState(12),[focused,setFocused]=useState<string|null>(null),[source,setSource]=useState('');
 const cursorRef=useRef<number|null>(null),request=useRef(0),running=useRef(false);
 const load=async()=>{
  const head=cursorRef.current;
  if(head===null||running.current)return;
  const id=request.current;running.current=true;setBusy(true);setError('');
  try{
   // Read registration logs from the verified server RPC, never the
   // mobile wallet's often unsupported eth_getLogs method.
   const target=Math.max(0,head-1151);
   const found:Member[]=[];let current=head,attempts=0;
   while(current>=target&&attempts<12){
    if(id!==request.current)return;
    const first=Math.max(target,current-95);
    const page=await requestVerifiedHistory({wallet:parent,asset:ZeroAddress,scope:'wallet',kind:'team',from:first,to:current});
    for(const record of page.logs){
     const parsed=registry.parseLog(record as unknown as Log);
     if(parsed?.name==='Registered'&&getAddress(String(parsed.args.referrer))===getAddress(parent))
      found.push({address:getAddress(String(parsed.args.user)),block:record.blockNumber,tx:record.transactionHash});
    }
    setSource(page.source==='database+rpc'?'Cached + RPC verified':'RPC verified');
    current=first-1;attempts++;
   }
   if(id!==request.current)return;
   setMembers(old=>{const map=new Map(old.map(row=>[row.address.toLowerCase(),row]));
    for(const item of found)map.set(item.address.toLowerCase(),item);
    return [...map.values()].sort((a,b)=>b.block-a.block);});
   cursorRef.current=current>=0?current:null;setCursor(cursorRef.current);
  }catch(reason){if(id===request.current)setError(errorText(reason));}
  finally{if(id===request.current){running.current=false;setBusy(false);}}
 };
 useEffect(()=>{
  request.current++;const id=request.current;running.current=false;cursorRef.current=null;
  setMembers([]);setCursor(null);setError('');setShow(12);setFocused(null);setSource('');
  void (async()=>{
   try{
    await readOnlySession(root); // verify connected wallet and chain, not its history RPC
    const head=await requestVerifiedHistory({wallet:parent,asset:ZeroAddress,scope:'wallet',kind:'team'});
    if(id!==request.current)return;
    cursorRef.current=Math.max(0,Math.min(block-3,head.confirmedHead));
    setCursor(cursorRef.current);
    void load();
   }catch(reason){if(id===request.current)setError(errorText(reason));}
  })();
  return()=>{request.current++;};
  // Dashboard polling does not discard already loaded historical pages.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[root,parent,depth]);
 return <div className="team-level">
  <div className="team-level-heading"><strong>Level {depth} · {members.length} discovered</strong>
   <span>{cursor===null?'No older pages remaining':'Older registrations may exist'}{source?' · '+source:''}</span></div>
  {depth===1&&<NetworkConstellation parent={parent} members={members} selected={focused} onSelect={address=>{setFocused(address);setShow(Math.max(show,members.findIndex(m=>m.address===address)+1));}}/>}
  {members.length?<ul className="team-members">{members.slice(0,show).map(member=>
    <MemberRow key={member.address} root={root} member={member} depth={depth} block={block} selected={focused===member.address}/>)}</ul>:
   !busy?<p className="muted">{error?'Registration data unavailable. Do not treat this as zero members.':cursor===null?'No direct registrations found in all scanned blocks.':'No registrations in loaded pages; older records may exist.'}</p>:null}
  {error&&<p className="inline-error" role="alert">{error}</p>}
  <div className="team-footer">
   {members.length>show&&<button type="button" className="small-button" onClick={()=>setShow(v=>v+12)}>Show more members</button>}
   {cursor!==null&&<button type="button" className="small-button" disabled={busy} onClick={()=>void load()}><RefreshCw size={15} className={busy?'spin':''}/>{busy?'Reading registrations…':'Load older registrations'}</button>}
  </div>
 </div>;
}

export default function NetworkDirectory({who,connected,data}:{who:string;connected:boolean;data:Snapshot|null}){
 return <section className="panel global-team" aria-labelledby="global-team-title">
  <div className="panel-title"><div><span className="detail-kicker">ON-CHAIN NETWORK DIRECTORY</span>
   <h2 id="global-team-title"><GitBranch size={22}/> Your referral team</h2>
   <p>Explore real registrations and expand members through three referral levels.</p></div><span className="round-icon"><Users size={22}/></span></div>
  <div className="team-summary"><div><small>Verified active direct members</small><strong>{data?data.direct.toString():'—'}</strong></div>
   <div><small>Your referring wallet</small><strong>{data&&data.referrer&&!/^0x0{40}$/i.test(data.referrer)?short(data.referrer):'None recorded'}</strong></div>
   <div><small>Account status</small><strong>{data?(data.active?'Active':'Not verified active'):'Connect wallet'}</strong></div></div>
  <p className="ledger-note">Registration records are public on-chain. Each scan is bounded; counts shown here are discovered registrations, not certified full-network totals. Reported active directs are a separate contract metric. Expand a wallet to read its recorded capital, sales, status and deeper team.</p>
  {connected&&data&&data.blockNumber>0?<Level key={who.toLowerCase()} root={who} parent={who} block={data.blockNumber} depth={1}/>:
   <p className="muted">Connect your wallet on the configured chain to load your referral tree.</p>}
 </section>;
}
