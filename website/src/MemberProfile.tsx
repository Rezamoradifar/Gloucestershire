import {useEffect,useRef,useState} from 'react';
import {Camera,Check,Copy,ExternalLink,ShieldCheck,UserRound,Wallet,Users} from 'lucide-react';
import {chainId,chainName,explorer} from './config';
import {displayAmount} from './money';
import type {Asset,Snapshot} from './chain';
const names=['Starter','Basic','Growth','Pro','VIP'];
const key=(who:string)=>'global-member-profile-v2:'+chainId+':'+who.toLowerCase();
type LocalProfile={nickname:string;avatar:string};
function read(who:string):LocalProfile{try{const data=JSON.parse(localStorage.getItem(key(who))||'{}');return {nickname:typeof data.nickname==='string'?data.nickname.slice(0,36):'',avatar:typeof data.avatar==='string'&&data.avatar.startsWith('data:image/webp;base64,')?data.avatar:''};}catch{return {nickname:'',avatar:''};}}
export default function MemberProfile({who,data,asset}:{who:string;data:Snapshot|null;asset:Asset}){
 const [profile,setProfile]=useState<LocalProfile>({nickname:'',avatar:''}),[feedback,setFeedback]=useState('');
 const fileRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{setProfile(who?read(who):{nickname:'',avatar:''});setFeedback('');},[who]);
 const save=(next:LocalProfile)=>{if(!who)return;try{localStorage.setItem(key(who),JSON.stringify(next));setProfile(next);setFeedback('Saved on this device only.');}catch{setFeedback('Could not save locally; browser storage may be disabled.');}};
 const loadAvatar=async(file?:File)=>{
  if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2_000_000){setFeedback('Choose a JPG, PNG or WebP image under 2 MB.');return;}
  const url=URL.createObjectURL(file);
  try{
   const img=new Image();img.src=url;await img.decode();
   const canvas=document.createElement('canvas');canvas.width=192;canvas.height=192;
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image preview is unavailable.');
   const side=Math.min(img.naturalWidth,img.naturalHeight);ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,192,192);
   const avatar=canvas.toDataURL('image/webp',0.72);
   if(avatar.length>120_000)throw Error('Compressed image is too large.');
   save({...profile,avatar});
  }catch{setFeedback('Could not process that photo. Try a different image.');}
  finally{URL.revokeObjectURL(url);if(fileRef.current)fileRef.current.value='';}
 };
 return <section className="panel v2-profile" aria-label="Member profile">
 <div className="v2-profile-hero">
  <div className="v2-avatar">{profile.avatar?<img src={profile.avatar} alt="Local profile avatar"/>:<UserRound size={42}/>}<button type="button" aria-label="Upload profile picture" disabled={!who} onClick={()=>fileRef.current?.click()}><Camera size={16}/></button><input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={e=>void loadAvatar(e.target.files?.[0])}/></div>
  <div><span className="detail-kicker">YOUR GLOBAL IDENTITY</span><h2>{profile.nickname||'Member profile'}</h2><p>Linked to your connected blockchain wallet · {chainName}</p><div className="v2-profile-label"><ShieldCheck size={16}/>{data?(names[data.tier]??'Member')+' tier':'Wallet not connected'}{data?.kyc?' · VIP KYC verified on chain':''}</div></div>
 </div>
 <div className="v2-profile-fields"><label>Display name (only on this browser)<input value={profile.nickname} maxLength={36} disabled={!who} placeholder="Choose a display name" onChange={e=>setProfile(p=>({...p,nickname:e.target.value}))}/></label><button type="button" className="small-button" disabled={!who} onClick={()=>save({...profile,nickname:profile.nickname.trim()})}><Check size={16}/> Save locally</button>{profile.avatar&&<button type="button" className="small-button" onClick={()=>save({...profile,avatar:''})}>Remove photo</button>}</div>
 {feedback&&<p className="muted" role="status">{feedback}</p>}
 <div className="v2-profile-grid">
  <div><small>Wallet address</small><bdi>{who||'Connect wallet'}</bdi>{who&&<button type="button" onClick={()=>navigator.clipboard.writeText(who).then(()=>setFeedback('Wallet address copied.')).catch(()=>setFeedback('Copy manually if clipboard is unavailable.'))}><Copy size={16}/> Copy</button>}</div>
  <div><small>Account registration</small><strong>{data?(data.registered?'Registered on chain':'Not registered'):'—'}</strong></div>
  <div><small>Reporter-verified active directs</small><strong>{data?.direct.toString()??'—'}</strong></div>
  <div><small>Recorded sales volume</small><strong>{displayAmount(data?.salesUsd,18,2)} USD</strong></div>
  <div><small>Recorded capital value</small><strong>{displayAmount(data?.capitalUsd,18,2)} USD</strong></div>
  <div><small>Selected asset</small><strong>{asset}</strong></div>
  <div><small>Account status</small><strong>{data?(data.active?'Reported active':'Not verified active'):'—'}</strong></div>
  <div><small>Referrer</small><bdi>{data?.referrer||'—'}</bdi></div>
 </div>
 {who&&<a className="v2-profile-explorer" href={explorer+'/address/'+who} target="_blank" rel="noopener noreferrer"><Wallet size={16}/> Review wallet on BscScan <ExternalLink size={16}/></a>}
 <p className="ledger-note"><Users size={15}/> A display name and photo are private to this browser and are not account verification or an on-chain identity. Only contract data is used for balances, roles and KYC status.</p>
 </section>;
}
