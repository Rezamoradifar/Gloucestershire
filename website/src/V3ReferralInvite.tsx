import {useMemo,useState} from 'react';
import {Copy,Link2,Users} from 'lucide-react';
import {referralLink} from './referral-invite';
import type {V3Snapshot} from './v3-chain';

export default function V3ReferralInvite({view}:{view:V3Snapshot}){
 const [message,setMessage]=useState('');
 const address=view.registered?view.wallet:'';
 const link=useMemo(()=>{
  if(!address||typeof window==='undefined')return '';
  try{return referralLink(address,window.location.origin,window.location.pathname);}
  catch{return '';}
 },[address]);
 async function copy(value:string){
  if(!value)return;
  try{
   if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
   await navigator.clipboard.writeText(value);setMessage('Copied.');
  }catch{setMessage('Select the value and copy it manually.');}
 }
 return <section className="gv2-panel gv1-referral" aria-labelledby="gv1-referral-title">
  <div className="gv2-panel-head"><div><h3 id="gv1-referral-title">Your referral address</h3>
   <p>New members can use your public wallet address when they register on this contract.</p></div><Users size={20}/></div>
  {!view.registered&&<p className="gv1-inline-warning">Register this wallet before sharing an invitation.</p>}
  {view.registered&&!view.eligible&&<p className="gv1-inline-warning">Your link is available; referral eligibility also requires a current check-in and the contract conditions.</p>}
  <label htmlFor="gv1-referral-address">Your wallet address</label>
  <div className="gv1-copy-field"><input id="gv1-referral-address" value={address} readOnly placeholder="Register your wallet first" onFocus={event=>event.currentTarget.select()}/>
   <button type="button" disabled={!address} onClick={()=>void copy(address)} aria-label="Copy referral address"><Copy size={16}/></button></div>
  <label htmlFor="gv1-referral-link">Invitation link</label>
  <div className="gv1-copy-field"><input id="gv1-referral-link" value={link} readOnly placeholder="Invitation link will appear here" onFocus={event=>event.currentTarget.select()}/>
   <button type="button" disabled={!link} onClick={()=>void copy(link)} aria-label="Copy invitation link"><Link2 size={16}/></button></div>
  {message&&<p role="status">{message}</p>}
 </section>;
}
