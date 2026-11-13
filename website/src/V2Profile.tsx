import {useEffect,useRef,useState} from 'react';
import {Camera,Check,Copy,ExternalLink,ShieldCheck,UserRound,Wallet} from 'lucide-react';
import {V2_ADDRESS,V2_CHAIN_ID,V2_EXPLORER,v2Date,v2Money,v2Short,type V2Snapshot} from './v2-chain';
const KEY_PREFIX='global-v2-only-profile:97:';
type LocalProfile={nickname:string;avatar:string};
function safeRead(wallet:string):LocalProfile{
 try{
  const j=JSON.parse(localStorage.getItem(KEY_PREFIX+wallet.toLowerCase())||'{}');
  return {
   nickname:typeof j.nickname==='string'?j.nickname.slice(0,36):'',
   avatar:typeof j.avatar==='string'&&j.avatar.startsWith('data:image/webp;base64,')?j.avatar:''
  };
 }catch{return {nickname:'',avatar:''};}
}
export default function V2Profile({snapshot}:{snapshot:V2Snapshot}){
 const [display,setDisplay]=useState<LocalProfile>({nickname:'',avatar:''});
 const [message,setMessage]=useState('');
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{setDisplay(safeRead(snapshot.wallet));setMessage('');},[snapshot.wallet]);
 function save(profile:LocalProfile){
  try{
   localStorage.setItem(KEY_PREFIX+snapshot.wallet.toLowerCase(),JSON.stringify(profile));
   setDisplay(profile);setMessage('Preferences saved only in this browser for the NEW V2 account.');
  }catch{setMessage('Browser storage unavailable; profile preferences not saved.');}
 }
 async function photo(file?:File){
  if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2_000_000){
   setMessage('Use PNG/JPG/WebP under 2 MB.');return;
  }
  const url=URL.createObjectURL(file);
  try{
   const img=new Image();img.src=url;await img.decode();
   const canvas=document.createElement('canvas');canvas.width=192;canvas.height=192;
   const ctx=canvas.getContext('2d');
   if(!ctx)throw Error('Image resize unavailable.');
   const side=Math.min(img.naturalWidth,img.naturalHeight);
   ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,192,192);
   const avatar=canvas.toDataURL('image/webp',0.72);
   if(avatar.length>120_000)throw Error('Avatar too large after compression.');
   save({...display,avatar});
  }catch{setMessage('Photo could not be processed.');}
  finally{URL.revokeObjectURL(url);if(input.current)input.current.value='';}
 }
 return <div className="gv2-admin">
  <section className="gv2-panel">
   <div className="gv2-panel-head"><h2><UserRound size={20}/> NEW V2 member profile</h2><span>Chain {V2_CHAIN_ID}</span></div>
   <div className="gv2-profile-header">
    {display.avatar?<img src={display.avatar} alt="Avatar stored only on this device" width={96} height={96}/>:
     <div className="gv2-profile-empty"><UserRound size={42}/></div>}
    <div><h3>{display.nickname||'Your V2 account'}</h3>
     <p>Verified wallet identity: {v2Short(snapshot.wallet)}</p>
     <label className="gv2-field"><Camera size={16}/> Local avatar
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp"
       onChange={e=>void photo(e.target.files?.[0])}/></label></div>
   </div>
   <div className="gv2-field">
    <label htmlFor="gv2-local-name">Display name (this browser only)</label>
    <input id="gv2-local-name" value={display.nickname} maxLength={36}
     onChange={e=>setDisplay(p=>({...p,nickname:e.target.value}))}/>
    <button onClick={()=>save({...display,nickname:display.nickname.trim()})}><Check size={16}/> Save V2 profile</button>
   </div>
   {message&&<p role="status" className="gv2-message">{message}</p>}
  </section>
  <section className="gv2-panel">
   <h3><ShieldCheck size={19}/> On-chain membership</h3>
   <div className="gv2-detail"><span>Wallet</span><b className="gv2-break">{snapshot.wallet}</b></div>
   <div className="gv2-detail"><span>Network</span><b>BNB Testnet · 97</b></div>
   <div className="gv2-detail"><span>Contract</span><b className="gv2-break">{V2_ADDRESS}</b></div>
   <div className="gv2-detail"><span>Registered</span><b>{snapshot.registered?'Yes':'No'}</b></div>
   <div className="gv2-detail"><span>Referrer</span><b className="gv2-break">{snapshot.referrer}</b></div>
   <div className="gv2-detail"><span>Recorded capital (not liquid cash)</span><b>USD {v2Money(snapshot.capitalUsd,18,2)}</b></div>
   <div className="gv2-detail"><span>On-chain activity</span><b>{snapshot.eligible?'Currently eligible':'Not currently eligible'}</b></div>
   <div className="gv2-detail"><span>Last on-chain check-in</span><b>{v2Date(snapshot.lastCheckIn)}</b></div>
   <div className="gv2-detail"><span>VIP KYC admin flag</span><b>{snapshot.kyc?'Administrator verified':'Not verified'}</b></div>
   <div className="gv2-detail"><span>Open positions</span><b>{snapshot.positionsTotal}</b></div>
   <a className="gv2-explorer" href={V2_EXPLORER+'/address/'+snapshot.wallet} target="_blank" rel="noopener noreferrer">
    Inspect your on-chain account <ExternalLink size={16}/></a>
   <p className="gv2-small">This profile does not import any old-contract balance, personal data or support ticket. A local nickname/avatar is not a KYC record.</p>
  </section>
 </div>;
}
