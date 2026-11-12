import {useMemo,useState} from 'react';
import {Copy,Link2,Share2,ShieldCheck,Users} from 'lucide-react';
import {getAddress,isAddress} from 'ethers';
import {referralLink} from './referral-invite';
import './referral-invite.css';

async function copyPublicText(value:string){
 if(navigator.clipboard?.writeText){
  try{await navigator.clipboard.writeText(value);return;}catch{ /* Embedded wallet browsers may refuse clipboard access. */ }
 }
 const field=document.createElement('textarea');
 field.value=value;field.readOnly=true;
 field.style.position='fixed';field.style.opacity='0';field.style.left='-9999px';
 document.body.appendChild(field);
 try{field.focus();field.select();if(!document.execCommand('copy'))throw Error('Clipboard permission is unavailable.');}
 finally{field.remove();}
}
export default function ReferralInvite({
 wallet,registered,connected,onNotice,onError
}:{
 wallet:string;registered:boolean;connected:boolean;
 onNotice:(value:string)=>void;onError:(value:string)=>void
}){
 const [copied,setCopied]=useState<'code'|'link'|null>(null);
 const code=connected&&isAddress(wallet)?getAddress(wallet):'';
 const link=useMemo(()=>{
  if(!code)return '';
  try{return referralLink(code,window.location.origin,window.location.pathname);}
  catch{return '';}
 },[code]);
 const enabled=Boolean(code&&registered&&link);
 const copy=async(kind:'code'|'link')=>{
  if(!enabled)return;
  try{
   await copyPublicText(kind==='code'?code:link);
   setCopied(kind);onNotice(kind==='code'?'Referral address copied.':'Invitation link copied.');
  }catch{onError('Clipboard is unavailable in this wallet browser. Select the displayed text and copy it manually.');}
 };
 const share=async()=>{
  if(!enabled)return;
  if(navigator.share){
   try{await navigator.share({title:'Global Drop Trade invitation',text:'Join using my referral address.',url:link});return;}
   catch(error){if((error as Error)?.name==='AbortError')return;}
  }
  await copy('link');
 };
 return <section className="panel referral-invite" aria-labelledby="referral-invite-title">
  <div className="panel-title"><div><h2 id="referral-invite-title"><Users size={20}/> Your referral code</h2>
   <p>The referral code is your public wallet address, recorded on-chain when a new member first deposits.</p></div>
   <ShieldCheck size={21}/></div>
  {!connected?<p className="inline-error" role="status">Connect your wallet to the correct network to view your invitation.</p>:
   !registered?<p className="notice neutral" role="status">Register on this contract with your first valid deposit before sharing a referral link. Unregistered referrers cannot be accepted.</p>:null}
  <div className="referral-invite-fields">
   <label htmlFor="referral-code-value">Referral code (wallet address)</label>
   <div className="referral-invite-copy">
    <input id="referral-code-value" readOnly dir="ltr" value={code} placeholder="Connect wallet to generate your code"
     onFocus={event=>event.currentTarget.select()} aria-label="Your referral wallet address"/>
    <button type="button" className="small-button" disabled={!enabled} onClick={()=>void copy('code')}><Copy size={16}/>{copied==='code'?'Copied':'Copy code'}</button>
   </div>
   <label htmlFor="referral-invite-url">Invitation link</label>
   <div className="referral-invite-copy">
    <input id="referral-invite-url" readOnly dir="ltr" value={link}
     placeholder="Your invitation link will appear here"
     onFocus={event=>event.currentTarget.select()} aria-label="Your referral invitation link"/>
    <button type="button" className="small-button" disabled={!enabled} onClick={()=>void copy('link')}><Link2 size={16}/>{copied==='link'?'Copied':'Copy link'}</button>
   </div>
  </div>
  <button type="button" className="small-button referral-invite-share" disabled={!enabled} onClick={()=>void share()}>
   <Share2 size={17}/> Share invitation
  </button>
  <p className="muted referral-invite-note">An invite pre-fills the referrer for a new wallet's first deposit. The member can review or change it before confirming. Existing registered wallets keep their original on-chain referrer. Sending an invitation is not an earnings event or a commission guarantee.</p>
 </section>;
}
