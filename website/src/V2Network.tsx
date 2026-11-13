import {useEffect,useState} from 'react';
import {ExternalLink,RefreshCw,Users,Copy,ShieldCheck} from 'lucide-react';
import {ZeroAddress} from 'ethers';
import {getWalletProvider} from './wallet';
import {V2_EXPLORER,v2Short,v2Money,type V2Snapshot} from './v2-chain';
import {readV2RegistrySlice,type V2RegistryPage} from './v2-network';
import {referralLink} from './referral-invite';

export default function V2Network({snapshot,wallet}:{snapshot:V2Snapshot;wallet:string}){
 const [page,setPage]=useState<V2RegistryPage|null>(null);
 const [offset,setOffset]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [copied,setCopied]=useState(false);
 useEffect(()=>{setPage(null);setOffset(0);setError('');},[wallet]);
 async function load(next=offset){
  const provider=getWalletProvider();
  if(!provider)return setError('Connect your BNB Testnet wallet.');
  setLoading(true);setError('');
  try{
   const result=await readV2RegistrySlice(provider,wallet,next,20);
   if(getWalletProvider()===provider){setPage(result);setOffset(next);}
  }catch(e){setError(e instanceof Error?e.message:'Could not verify V2 team from chain.');}
  finally{setLoading(false);}
 }
 const counts=Array.from({length:4},(_,i)=>page?.members.filter(x=>x.level===i+1).length??0);
 let invite='';
 try{invite=referralLink(wallet,window.location.origin);}catch{}
 return <section className="gv2-panel" aria-label="Verified V2 network">
  <div className="gv2-panel-head"><h2><Users size={19}/> Team & referrals</h2>
   <button disabled={loading} onClick={()=>void load(offset)}><RefreshCw size={16}/>{loading?'Reading…':'Read V2 team'}</button></div>
  <p>All referral links, parents and eligibility statuses are read from the NEW V2 contract on BNB Testnet. No old member records are imported.</p>
  <div className="gv2-detail"><span>Your wallet</span><b className="gv2-break">{wallet}</b></div>
  <div className="gv2-detail"><span>On-chain referrer</span><b className="gv2-break">{snapshot.referrer===ZeroAddress?'No referrer':snapshot.referrer}</b></div>
  <div className="gv2-detail"><span>Current activity status</span><b>{snapshot.eligible?'Qualified now':'Not qualified now'}</b></div>
  <div className="gv2-detail"><span>Active check-in expires</span><b>{snapshot.lastCheckIn?new Date((snapshot.lastCheckIn+86400)*1000).toLocaleString():'No check-in'}</b></div>
  {invite&&<div className="gv2-field"><label>Official V2 invitation link</label><input value={invite} readOnly/>
   <button onClick={()=>{void navigator.clipboard.writeText(invite).then(()=>setCopied(true)).catch(()=>setError('Copy unavailable. Select the link manually.'));}}>
    <Copy size={16}/>{copied?'Copied':'Copy invitation link'}</button></div>}
  {error&&<p className="gv2-error" role="alert">{error}</p>}
  {page&&<>
   <div className="gv2-detail"><span>NEW V2 registration records scanned</span><b>{page.from} – {page.to} of {page.total}</b></div>
   <div className="gv2-detail"><span>Confirmed block</span><b>{page.block.toLocaleString()}</b></div>
   <div className="gv2-plan-grid">
    {counts.map((count,i)=><div key={i} className="gv2-plan-card">
     <span>Level {i+1}</span><strong>{count}</strong><small>Found in this scanned page only</small>
    </div>)}
   </div>
   {page.members.filter(x=>x.level!==null).map(row=><div className="gv2-position" key={row.wallet}>
    <div><a href={V2_EXPLORER+'/address/'+row.wallet} target="_blank" rel="noopener noreferrer">
     {v2Short(row.wallet)} <ExternalLink size={13}/></a><small>Line {row.level} · parent {v2Short(row.referrer)}</small></div>
    <div><strong>Recorded USD {v2Money(row.capitalUsd,18,2)}</strong><small>{row.eligible?'Activity qualified':'Not currently qualified'}</small></div>
    <div><small>{row.kyc?'KYC approved':'KYC not approved'} · {row.suspended?'Suspended':'Not suspended'}</small></div>
   </div>)}
   {!page.members.some(x=>x.level!==null)&&<p>No referrals found in the inspected registry slice. Older or newer slices may still contain matches.</p>}
   <div className="gv2-buttons">
    <button disabled={loading||offset===0} onClick={()=>void load(Math.max(0,offset-20))}>Previous 20 registrations</button>
    <span>{page.to} / {page.total} processed for this view</span>
    <button disabled={loading||page.to>=page.total} onClick={()=>void load(page.to)}>Next 20 registrations</button>
   </div>
   <p className="gv2-small">These are verified, bounded registry results. The four-level totals above are NOT lifetime team counts until all registry pages have been inspected.</p>
  </>}
  {!page&&<p className="gv2-small"><ShieldCheck size={16}/> Click “Read V2 team” for real blockchain data. No fabricated network sizes, positions or referral rewards.</p>}
 </section>;
}
