import {useEffect,useState} from 'react';
import {getAddress,isAddress,ZeroAddress} from 'ethers';
import {AlertTriangle,CheckCircle2,Clock3,FileCheck2,Search,ShieldCheck,Users,Wallet,ExternalLink} from 'lucide-react';
import {getWalletProvider} from './wallet';
import {readV2AdminMembers,readV2AdminRequests,V2_EXPLORER,v2Money,v2Date,v2Short,v2WithdrawalStatus,type V2Snapshot,type V2Withdrawal,type V2AdminMember} from './v2-chain';
import {readV2AdminCustomer,sendV2ManagerAction,V2_APPROVAL_REASONS,type V2AdminCustomer,type V2RejectCode} from './v2-admin';
import V2HistoryPanel from './V2HistoryPanel';
import V2OnDemandFunding from './V2OnDemandFunding';
import './v2-admin.css';

type ListState={total:number;page:number;members:V2AdminMember[]};
type QueueState={total:number;page:number;rows:V2Withdrawal[]};
export default function V2AdminConsole({wallet,snapshot,onChanged}:{
 wallet:string;snapshot:V2Snapshot;onChanged:()=>void
}){
 const [members,setMembers]=useState<ListState|null>(null),[requests,setRequests]=useState<QueueState|null>(null);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [target,setTarget]=useState(''),[detail,setDetail]=useState<V2AdminCustomer|null>(null);
 const [detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
 const [identityReviewed,setIdentityReviewed]=useState(false),[reviewConfirm,setReviewConfirm]=useState('');
 const [reason,setReason]=useState<V2RejectCode>('TERMS_NOT_MET');
 const [busy,setBusy]=useState(false);
 const asset=(address:string)=>address.toLowerCase()===ZeroAddress.toLowerCase()?'BNB':'USDT';
 const precision=(address:string)=>address.toLowerCase()===ZeroAddress.toLowerCase()?18:snapshot.accounts[1].decimals;
 const explorer=(address:string)=>V2_EXPLORER+'/address/'+address;
 const approvalTotal=requests?.rows.filter(x=>x.status===0).length??0;

 async function listMembers(page=0){
  const provider=getWalletProvider();
  if(!provider)return setError('Connect your authorized manager wallet.');
  setLoading(true);setError('');
  try{
   const data=await readV2AdminMembers(provider,wallet,page);
   if(provider===getWalletProvider())setMembers(data);
  }catch(e){setError(e instanceof Error?e.message:'User registry could not be loaded.');}
  finally{setLoading(false);}
 }
 async function listRequests(page=0){
  const provider=getWalletProvider();
  if(!provider)return setError('Connect your authorized manager wallet.');
  setLoading(true);setError('');
  try{
   const data=await readV2AdminRequests(provider,wallet,page);
   if(provider===getWalletProvider())setRequests(data);
  }catch(e){setError(e instanceof Error?e.message:'Withdrawal queue could not be loaded.');}
  finally{setLoading(false);}
 }
 async function openCustomer(address:string){
  const provider=getWalletProvider();
  if(!provider||!isAddress(address)){setDetailError('Enter a valid customer wallet address.');return;}
  setDetailLoading(true);setDetailError('');setDetail(null);
  setIdentityReviewed(false);setReviewConfirm('');
  try{
   const data=await readV2AdminCustomer(provider,wallet,address);
   if(provider===getWalletProvider()){setDetail(data);setTarget(data.wallet);}
  }catch(e){setDetailError(e instanceof Error?e.message:'Customer file not available.');}
  finally{setDetailLoading(false);}
 }
 useEffect(()=>{
  setMembers(null);setRequests(null);setDetail(null);setTarget('');setNotice('');
  void listMembers(0);
  if(snapshot.canApprove)void listRequests(0);
  // Depend on the connected manager, not the polling block number.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[wallet]);

 async function execute(action:Parameters<typeof sendV2ManagerAction>[2],text:string){
  const provider=getWalletProvider();
  if(!provider||busy)return;
  if(!window.confirm(text+'\n\nBNB TESTNET · This sends a real on-chain transaction.'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const hash=await sendV2ManagerAction(provider,wallet,action);
   setNotice('Confirmed on chain: '+hash.slice(0,12)+'…');
   onChanged();
   if(members)await listMembers(members.page);
   if(snapshot.canApprove&&requests)await listRequests(requests.page);
   if(detail)await openCustomer(detail.wallet);
  }catch(e){setError(e instanceof Error?e.message:'The administrator transaction was not confirmed.');}
  finally{setBusy(false);}
 }
 const matchingTarget=Boolean(detail)&&reviewConfirm.trim().toLowerCase()===detail?.wallet.toLowerCase();
 const allowedKyc=Boolean(snapshot.canKyc&&detail?.registered&&matchingTarget&&!busy);
 return <div className="gv2-admin">
  <section className="gv2-panel">
   <div className="gv2-panel-head"><h2><ShieldCheck size={19}/> V2 manager control center</h2><span>Verified block {snapshot.block.toLocaleString()}</span></div>
   <p>On-chain permissions are checked for every administrative action. No production data or old-contract wallets are imported.</p>
   <div className="gv2-detail"><span>Withdrawal approver role</span><b>{snapshot.canApprove?'Verified manager':'Not authorized'}</b></div>
   <div className="gv2-detail"><span>VIP/KYC reviewer role</span><b>{snapshot.canKyc?'Verified manager':'Not authorized'}</b></div>
   {error&&<p role="alert" className="gv2-error">{error}</p>}
   {notice&&<p role="status" className="gv2-message">{notice}</p>}
  </section>

  <section className="gv2-panel">
   <div className="gv2-panel-head"><h3><Wallet size={18}/> Treasury coverage · BNB and USDT separately</h3><span>On-chain, not an assurance of solvency</span></div>
   {snapshot.accounts.map(a=><div key={a.symbol} className="gv2-coverage">
    <h4>{a.symbol}</h4>
    <div className="gv2-detail"><span>Recorded principal claims</span><b>{v2Money(a.contractPrincipal,a.decimals,6)} {a.symbol}</b></div>
    <div className="gv2-detail"><span>Credited profit liabilities</span><b>{v2Money(a.contractProfit,a.decimals,6)} {a.symbol}</b></div>
    <div className="gv2-detail"><span>Liquid assets in vault</span><b>{v2Money(a.cash,a.decimals,6)} {a.symbol}</b></div>
    <div className="gv2-detail"><span>Unfunded principal</span><b>{v2Money(a.unfunded,a.decimals,6)} {a.symbol}</b></div>
    {a.unfunded>0n&&<p className="gv2-audit-warning"><AlertTriangle size={15}/> Principal cash shortfall. Recorded balances are not fully liquid backing.</p>}
    {a.cash<a.contractProfit&&<p className="gv2-audit-warning"><AlertTriangle size={15}/> Contract cash below credited profit liabilities.</p>}
   </div>)}
   <p className="gv2-small">These are on-chain contract balances and liabilities, not an independent audit of operations wallet holdings or real external business revenue.</p>
  </section>

  <section className="gv2-panel"><div className="gv2-panel-head"><h3>Just-in-time TESTNET payout funding</h3><span>No advance treasury top-up</span></div><p>Fund the exact on-chain cash shortfall only after a withdrawal has been requested and manager-approved. This immutable V2 contract may require coverage of all credited-profit liabilities before paying one individual profit request. See each approved TEST USDT request below.</p></section>

  <section className="gv2-panel">
   <div className="gv2-panel-head"><h3><Users size={18}/> Registered V2 customers</h3>
    <button disabled={loading} onClick={()=>void listMembers(members?.page??0)}>Refresh list</button></div>
   <p className="gv2-small">Paginated V2 on-chain registry. Select a wallet for both-asset accounting, current conditions, positions, requests and bounded event history.</p>
   <form className="gv2-admin-search" onSubmit={e=>{e.preventDefault();void openCustomer(target);}}>
    <label htmlFor="gv2-admin-lookup">Search exact wallet address</label>
    <div><input id="gv2-admin-lookup" value={target} onChange={e=>setTarget(e.target.value)} placeholder="0x…" spellCheck={false}/>
     <button disabled={detailLoading||!isAddress(target)} type="submit"><Search size={16}/> Open customer</button></div>
   </form>
   {detailError&&<p className="gv2-error" role="alert">{detailError}</p>}
   {members?.members.map(m=><div className="gv2-position" key={m.wallet}>
    <div><button className="gv2-link-button" onClick={()=>void openCustomer(m.wallet)}>{v2Short(m.wallet)}</button>
     <small>Referrer: {m.referrer===ZeroAddress?'None':v2Short(m.referrer)}</small></div>
    <div><b>USD {v2Money(m.capitalUsd,18,2)}</b>
     <small>USDT profit {v2Money(m.profitUsdt,snapshot.accounts[1].decimals)}</small></div>
    <div><span>{m.eligible?'Active now':'Not eligible now'} · {m.kyc?'KYC yes':'KYC pending'} · {m.suspended?'Suspended':'Not suspended'}</span></div>
   </div>)}
   {!members?.members.length&&<p>{loading?'Loading registry…':'No registered V2 users found on this page.'}</p>}
   <div className="gv2-buttons">
    <button disabled={loading||!members||members.page===0} onClick={()=>void listMembers((members?.page??0)-1)}>Previous users</button>
    <span>{members?.total??0} total · page {(members?.page??0)+1}</span>
    <button disabled={loading||!members||(members.page+1)*10>=members.total} onClick={()=>void listMembers((members?.page??0)+1)}>Next users</button>
   </div>
  </section>

  {detail&&<section className="gv2-panel">
   <div className="gv2-panel-head"><h3><FileCheck2 size={18}/> Customer dossier</h3><span>Block {detail.block.toLocaleString()}</span></div>
   <div className="gv2-detail"><span>Wallet</span><b className="gv2-break">{detail.wallet}</b>
    <a href={explorer(detail.wallet)} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/></a></div>
   <div className="gv2-detail"><span>Referrer</span><b className="gv2-break">{detail.referrer}</b></div>
   <div className="gv2-detail"><span>Recorded capital USD</span><b>{v2Money(detail.capitalUsd,18,2)}</b></div>
   <div className="gv2-detail"><span>Activity right now</span><b>{detail.eligible?'Eligible':'Not eligible'} · last check-in {v2Date(detail.lastCheckIn)}</b></div>
   <div className="gv2-detail"><span>KYC / account security</span><b>{detail.kyc?'Verified KYC':'KYC unverified'} / {detail.suspended?'Suspended':'Not suspended'}</b></div>
   {detail.accounts.map(a=><div key={a.symbol} className="gv2-coverage">
    <h4>{a.symbol} · Customer accounting</h4>
    <div className="gv2-detail"><span>Principal</span><b>{v2Money(a.principal,a.decimals)}</b></div>
    <div className="gv2-detail"><span>Credited profit (personal + referral)</span><b>{v2Money(a.profit,a.decimals)}</b></div>
    <div className="gv2-detail"><span>External deposits</span><b>{v2Money(a.deposited,a.decimals)}</b></div>
    <div className="gv2-detail"><span>Manual reinvest</span><b>{v2Money(a.reinvested,a.decimals)}</b></div>
    <div className="gv2-detail"><span>Withdrawal cap / pending</span><b>{v2Money(a.cap,a.decimals)} / {a.requestPending?'Yes':'No'}</b></div>
   </div>)}
   <h4>Recorded positions — first {detail.positions.length} of {detail.positionsTotal}</h4>
   {detail.positions.map(p=><div className="gv2-position" key={p.id}>
    <div><strong>Position #{p.id+1}</strong><small>Opened {v2Date(p.openedAt)}</small></div>
    <div><b>{v2Money(p.principal,p.asset===ZeroAddress?18:snapshot.accounts[1].decimals)} {asset(p.asset)}</b><small>USD {v2Money(p.capitalUsd,18,2)}</small></div>
    <div><small>Reserved: {v2Money(p.reserved,p.asset===ZeroAddress?18:snapshot.accounts[1].decimals)}</small></div>
   </div>)}
   <h4>Recent recorded requests — first {detail.withdrawals.length} of {detail.withdrawalsTotal}</h4>
   {detail.withdrawals.map(r=><div key={r.id} className="gv2-position">
    <div><b>Request #{r.id+1}</b><small>{r.principal?'Principal':'Profit'}</small></div>
    <div><b>{v2Money(r.gross,precision(r.asset))} {asset(r.asset)}</b><small>Fee {v2Money(r.fee,precision(r.asset))}</small></div>
    <div>{v2WithdrawalStatus(r.status)}</div></div>)}
   <p className="gv2-small">This is a bounded customer file, not a full lifetime history. Financial source and individual referrals are separately confirmed through contract logs below.</p>
   {snapshot.canKyc&&detail.registered&&<div className="gv2-review">
    <h4>Manual VIP/KYC decision</h4>
    <p>This interface does not inspect or store identity documents. Approve KYC only after an independently documented identity review in the organization’s secure case-management process.</p>
    <label className="gv2-check"><input type="checkbox" checked={identityReviewed} onChange={e=>setIdentityReviewed(e.target.checked)}/> I have personally reviewed sufficient authentic identity evidence in our secure process.</label>
    <label htmlFor="gv2-review-wallet">Enter the complete customer wallet address to confirm the correct person</label>
    <input id="gv2-review-wallet" value={reviewConfirm} onChange={e=>setReviewConfirm(e.target.value)} placeholder={detail.wallet} spellCheck={false}/>
    <div className="gv2-buttons">
     <button className="gv2-primary" disabled={!allowedKyc||!identityReviewed||detail.kyc} onClick={()=>void execute({kind:'kyc',user:detail.wallet,verified:true},'Confirm verified KYC for '+detail.wallet+' after human document review?')}>
      <CheckCircle2 size={15}/> Approve KYC in wallet</button>
     <button disabled={!allowedKyc||!detail.kyc} onClick={()=>void execute({kind:'kyc',user:detail.wallet,verified:false},'Revoke previously approved KYC for '+detail.wallet+'?')}>Revoke KYC</button>
    </div>
    <p className="gv2-small">KYC decision is written on-chain; supporting documents and off-chain reviewer evidence are not stored by this prototype.</p>
   </div>}
   <V2HistoryPanel requester={wallet} subject={detail.wallet} token={snapshot.token} decimals={snapshot.accounts[1].decimals}/>
  </section>}

  {snapshot.canApprove&&<section className="gv2-panel">
   <div className="gv2-panel-head"><h3><Clock3 size={19}/> All manager-approved withdrawal requests</h3>
    <button disabled={loading} onClick={()=>void listRequests(requests?.page??0)}>Refresh queue</button></div>
   <p className="gv2-small">Approval is never automatic. Fund only when an approved withdrawal is ready for payment. An exact on-chain shortfall is checked for each request; separate wallet signatures are required for actual test-token funding and payout.</p>
   <div className="gv2-detail"><span>Visible pending this page / total all statuses</span><b>{approvalTotal} / {requests?.total??0}</b></div>
   {requests?.rows.map(r=><div className="gv2-position" key={r.id}>
    <div><strong>#{r.id+1} · {r.principal?'Principal':'Profit'}</strong>
     <button className="gv2-link-button" onClick={()=>void openCustomer(r.user)}>{v2Short(r.user)}</button>
     <small>{v2Date(r.requestedAt)}</small></div>
    <div><b>{v2Money(r.gross,precision(r.asset))} {asset(r.asset)}</b>
     <small>Fee {v2Money(r.fee,precision(r.asset))}; net {v2Money(r.gross-r.fee,precision(r.asset))}</small>
     <small>{v2WithdrawalStatus(r.status)}</small></div>
    <div>{r.status===0&&<div className="gv2-manager-actions">
     <button className="gv2-primary" disabled={busy} onClick={()=>void execute({kind:'approve',requestId:r.id},
      'Approve exact V2 request #'+(r.id+1)+' for '+r.user+'? Payout only follows when funded.')}>Approve</button>
     <select aria-label="Rejection reason code" value={reason} onChange={e=>setReason(e.target.value as V2RejectCode)}>
      {V2_APPROVAL_REASONS.map(x=><option key={x.code} value={x.code}>{x.label}</option>)}
     </select>
     <button disabled={busy} onClick={()=>void execute({kind:'reject',requestId:r.id,reason},
      'Reject V2 request #'+(r.id+1)+' with reason '+reason+'? This will restore the recorded pending claim.')}>Reject</button>
    </div>}{r.status===1&&r.asset.toLowerCase()===snapshot.token.toLowerCase()&&<V2OnDemandFunding wallet={wallet} requestId={r.id} onChanged={()=>{onChanged();void listRequests(requests?.page??0);}}/>}</div>
   </div>)}
   {!requests?.rows.length&&<p>{loading?'Loading queue…':'No V2 requests recorded on this page.'}</p>}
   <div className="gv2-buttons">
    <button disabled={loading||!requests||requests.page===0} onClick={()=>void listRequests((requests?.page??0)-1)}>Newer requests</button>
    <span>{requests?.total??0} requests · page {(requests?.page??0)+1}</span>
    <button disabled={loading||!requests||(requests.page+1)*10>=requests.total} onClick={()=>void listRequests((requests?.page??0)+1)}>Older requests</button>
   </div>
  </section>}
 </div>;
}
