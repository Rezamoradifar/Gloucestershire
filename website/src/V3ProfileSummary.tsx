import {useState} from 'react';
import {Copy,ExternalLink,UserRound} from 'lucide-react';
import {formatEther,ZeroAddress} from 'ethers';
import {V3_EXPLORER,type V3Snapshot} from './v3-chain';
import {formatV3Amount as money,v3TierName} from './v3-format';
import {formatUtcTime} from './utc-time';
import {availableAccountEarnings,totalAccountEarnings} from './v3-account-earnings';

type Props={view:V3Snapshot;contract:string};
export default function V3ProfileSummary({view,contract}:Props){
 const storageKey='gdt-profile-label:'+contract.toLowerCase()+':'+view.wallet.toLowerCase();
 const [name,setName]=useState(()=>{try{return window.localStorage.getItem(storageKey)?.slice(0,40)??'';}catch{return '';}});
 const [draft,setDraft]=useState(name),[editing,setEditing]=useState(false),[notice,setNotice]=useState('');
 const tier=v3TierName(view.tier);
 const status=view.suspended?'Suspended':!view.registered?'Not registered':view.eligible?'Active':'Check-in required';
 const rows=(values:[string,string][])=>values.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>);
 return <section className="gv2-panel gdp-profile" aria-labelledby="gdp-profile-heading">
  <header className="gdp-title"><div><small>Account profile</small><h2 id="gdp-profile-heading">{name||'My profile'}</h2>
   <p>{view.registered?tier+' plan':'Unregistered wallet'} · BNB Testnet (97)</p></div><span className="gdp-avatar"><UserRound/></span></header>
  <div className="gdp-identity"><small>Connected wallet</small><code>{view.wallet}</code>
   <div><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(view.wallet);setNotice('Wallet address copied.');}
    catch{setNotice('Select the wallet address above to copy it.');}}}><Copy size={14}/> Copy address</button>
    <a href={V3_EXPLORER+'/address/'+view.wallet} target="_blank" rel="noreferrer">Explorer <ExternalLink size={13}/></a>
    <button type="button" onClick={()=>{setEditing(!editing);setDraft(name);setNotice('');}}>{editing?'Cancel':'Edit nickname'}</button></div>
  </div>
  {editing&&<form className="gdp-nickname" onSubmit={e=>{e.preventDefault();const next=draft.trim();try{
   if(next)localStorage.setItem(storageKey,next);else localStorage.removeItem(storageKey);
   setName(next);setEditing(false);setNotice('Nickname saved on this device.');}catch{setNotice('This device could not save the nickname.');}}}>
   <label>Nickname on this device<input maxLength={40} value={draft} onChange={e=>setDraft(e.target.value)} autoComplete="off"/></label><button>Save</button></form>}
  {notice&&<p role="status">{notice}</p>}
  <div className="gdp-profile-grid"><div><h3>Membership</h3><dl>{rows([
   ['Account status',status],['Registration',view.registered?'Registered':'Not registered'],['VIP verification',view.vipKyc?'Manager verified':'Unverified'],
   ['Current plan rate',view.dailyRateBps/100+'% per eligible cycle'],['Last check-in',formatUtcTime(view.lastCheckIn)],
   ['Activity expires',view.lastCheckIn?formatUtcTime(view.lastCheckIn+86400):'Awaiting check-in'],
   ['Referrer',view.referrer===ZeroAddress?'No referrer':view.referrer]])}</dl></div>
   <div><h3>Capital and withdrawals</h3><dl>{rows([
    ['Capital balance',money(view.capital)+' test USDT'],['External deposits',money(view.originalDeposits)+' test USDT'],
    ['Manual reinvestments',money(view.reinvestments)+' test USDT'],['Available earnings',money(totalAccountEarnings(availableAccountEarnings(view)))+' test USDT'],
    ['Test-token wallet balance',money(view.walletTestTokenBalance)+' test USDT'],['Wallet gas',formatEther(view.gasWei)+' tBNB'],
    ['Withdrawal requests',String(view.withdrawCount)],['Next request',view.paused?'Contract paused':view.suspended?'Account suspended':!view.registered?'Registration required':view.pendingWithdrawal?'Open request pending':view.nextRequestAt>view.asOf?formatUtcTime(view.nextRequestAt):'Available now']])}</dl></div></div>
  <p className="gdp-caption">Verified block {view.block.toLocaleString('en-US')} · {formatUtcTime(view.asOf)}</p>
 </section>;
}
