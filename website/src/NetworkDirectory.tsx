import {useEffect,useRef,useState} from 'react';
import {Interface,zeroPadValue,getAddress,type Log} from 'ethers';
import {ChevronDown,ChevronRight,ExternalLink,GitBranch,RefreshCw,Users} from 'lucide-react';
import {session,errorText,type Snapshot} from './chain';
import {explorer,vaultAddress} from './config';
import {displayAmount} from './money';

const registry=new Interface(['event Registered(address indexed user,address indexed referrer)']);
const topic=registry.getEvent('Registered')!.topicHash;
type Member={address:string;block:number;tx:string};
type Profile={active:boolean;kyc:boolean;capitalUsd:bigint;salesUsd:bigint;activeDirect:bigint;registered:boolean};
const short=(a:string)=>a.slice(0,8)+'…'+a.slice(-5);

function MemberRow({root,member,depth,block}:{root:string;member:Member;depth:number;block:number}){
 const [open,setOpen]=useState(false),[profile,setProfile]=useState<Profile|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!open)return;
  let cancelled=false;setProfile(null);setError('');
  session(root).then(({vault})=>vault.users(member.address,{blockTag:block})).then(user=>{
   if(!cancelled)setProfile({registered:Boolean(user.registered),active:Boolean(user.active),kyc:Boolean(user.vipKyc),
    capitalUsd:BigInt(user.capitalUsd),salesUsd:BigInt(user.salesUsd),activeDirect:BigInt(user.activeDirect)});
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
    <span>VIP KYC: <strong>{profile.kyc?'Verified':'Not verified'}</strong></span></div>:!error?<p className="muted">Loading member details from the contract…</p>:null}
   {error&&<p className="inline-error" role="alert">{error}</p>}
   {depth<3&&<Level key={member.address} root={root} parent={member.address} block={block} depth={depth+1}/>}
  </div>}
 </li>;
}

function Level({root,parent,block,depth}:{root:string;parent:string;block:number;depth:number}){
 const [members,setMembers]=useState<Member[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[cursor,setCursor]=useState<number|null>(null),[show,setShow]=useState(12);
 const cursorRef=useRef<number|null>(null),request=useRef(0),running=useRef(false);
 const load=async()=>{
  const head=cursorRef.current;
  if(head===null||running.current)return;
  const id=request.current;running.current=true;setBusy(true);setError('');
  try{
   const {provider}=await session(root);
   if(id!==request.current)return;
   const target=Math.max(0,head-19999);
   const found:Member[]=[];let current=head,attempts=0;
   while(current>=target&&attempts<48){
    if(id!==request.current)return;
    let span=2500,records:Log[]|null=null,first=0;
    while(records===null){
     first=Math.max(target,current-span+1);
     try{records=await provider.getLogs({address:vaultAddress,fromBlock:first,toBlock:current,topics:[topic,null,zeroPadValue(parent,32)]});}
     catch(reason){if(span<=125)throw reason;span=Math.max(125,Math.floor(span/2));}
    }
    for(const record of records){
     const parsed=registry.parseLog(record);
     if(parsed&&parsed.name==='Registered')found.push({address:getAddress(String(parsed.args.user)),block:record.blockNumber,tx:record.transactionHash});
    }
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
  request.current++;running.current=false;cursorRef.current=Math.max(0,block-3);
  setMembers([]);setCursor(cursorRef.current);setError('');setShow(12);
  void load();
  return()=>{request.current++;};
  // Block changes from dashboard polling must not reset the historical scan.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[root,parent,depth]);
 return <div className="team-level">
  <div className="team-level-heading"><strong>Level {depth} · {members.length} discovered</strong>
   <span>{cursor===null?'Scanned to genesis':cursor!==null?'Older registrations may exist':'Not scanned'}</span></div>
  {members.length?<ul className="team-members">{members.slice(0,show).map(member=>
    <MemberRow key={member.address} root={root} member={member} depth={depth} block={block}/>)}</ul>:
   !busy?<p className="muted">No direct registrations found in the scanned range. Older records may exist.</p>:null}
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
