import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {ExternalLink,FileClock,FileDown,KeyRound,RefreshCw,Search,ShieldCheck,Users} from 'lucide-react';
import {formatUnits,isAddress,getAddress,ZeroAddress,type Log} from 'ethers';
import {adminSignIn,adminHead,adminRegistrations,adminUser,adminWithdrawals,AdminUserApiError,
 type AdminHead,type AdminUser,type AdminWithdrawals,type RegistryEvent} from './admin-users-client';
import {requestDirectBranches,type DirectBranchPage} from './server-team';
import {readDailyActivityStatus,type DailyActivityStatus} from './daily-activity-client';
import {requestVerifiedHistory} from './server-event-history';
import {parseFinancialLog,historyLabels,type LedgerEvent} from './history-ledger';
import {explorer} from './config';
import {displayAmount} from './money';
import './admin-users.css';

const short=(wallet:string)=>wallet.slice(0,8)+'…'+wallet.slice(-6);
const viewTime=(value:string)=>{try{return new Date(Number(BigInt(value))*1000).toLocaleString();}catch{return 'Not reported';}};
const amount=(units:string,decimals:number,precision=4)=>displayAmount(BigInt(units),decimals,precision);
const safeCsv=(value:unknown)=>{const v=String(value??'');return '"'+(/^[\s]*[=+@-]/.test(v)?"'"+v:v).replace(/"/g,'""')+'"';};

function AccountAssets({user}:{user:AdminUser}){
 return <div className="admin-users-assets">{user.assets.map(a=>
  <article key={a.symbol} className="admin-users-asset">
   <h4>{a.symbol} · on-chain account</h4>
   <div className="admin-users-detail-grid">
    <span>Recorded principal <strong>{amount(a.principal,a.decimals)} {a.symbol}</strong></span>
    <span>Profit credit <strong>{amount(a.profit,a.decimals)} {a.symbol}</strong></span>
    <span>External deposits <strong>{amount(a.externalDeposited,a.decimals)} {a.symbol}</strong></span>
    <span>Cumulative reinvested <strong>{amount(a.reinvested,a.decimals)} {a.symbol}</strong></span>
    <span>Reported profit withdrawal cap <strong>{amount(a.withdrawalCap,a.decimals)} {a.symbol}</strong></span>
    <span>Next withdrawal after <strong>{a.nextWithdrawal==='0'?'No cooldown recorded':viewTime(a.nextWithdrawal)}</strong></span>
   </div>
  </article>)}</div>;
}

function RegistrationDirectory({rows,selected,onPick}:{rows:RegistryEvent[];selected:string;onPick:(wallet:string)=>void}){
 const [filter,setFilter]=useState('');
 const results=useMemo(()=>rows.filter(row=>[row.wallet,row.referrer,row.transactionHash].some(value=>
  value.toLowerCase().includes(filter.trim().toLowerCase()))).slice(0,100),[rows,filter]);
 return <div className="admin-users-registry">
  <label htmlFor="admin-user-filter">Filter loaded registrations by wallet, referrer or transaction</label>
  <input id="admin-user-filter" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Search loaded rows…" type="search" />
  <div className="admin-users-table-scroll"><table>
   <thead><tr><th>Registered wallet</th><th>Referrer</th><th>Block</th><th>Record</th></tr></thead>
   <tbody>{results.map(row=><tr key={row.transactionHash+':'+row.logIndex}>
    <td><button type="button" aria-pressed={selected.toLowerCase()===row.wallet.toLowerCase()}
      className="admin-users-link" onClick={()=>onPick(row.wallet)}>{short(row.wallet)}</button></td>
    <td><button type="button" className="admin-users-link" onClick={()=>onPick(row.referrer)}
      disabled={row.referrer===ZeroAddress}>{row.referrer===ZeroAddress?'No recorded referrer':short(row.referrer)}</button></td>
    <td>{row.blockNumber.toLocaleString('en-US')}</td>
    <td><a href={explorer+'/tx/'+row.transactionHash} target="_blank" rel="noopener noreferrer" title="Verified registration transaction"><ExternalLink size={15}/> Explorer</a></td>
   </tr>)}</tbody>
  </table></div>
  {!results.length&&<p className="muted">No matches in the blocks already scanned. Older registrations may still exist.</p>}
  {rows.length>100&&<p className="muted">Showing up to 100 filtered rows; use search to locate older loaded records.</p>}
 </div>;
}

export default function AdminUserDirectory({who,owner,onReviewStatus}:{
 who:string;owner:boolean;onReviewStatus:(wallet:string)=>void
}){
 const [token,setToken]=useState(''),[head,setHead]=useState<AdminHead|null>(null);
 const [rows,setRows]=useState<RegistryEvent[]>([]),[cursor,setCursor]=useState<number|null>(null);
 const [selected,setSelected]=useState(''),[search,setSearch]=useState('');
 const [profile,setProfile]=useState<AdminUser|null>(null),[withdrawals,setWithdrawals]=useState<AdminWithdrawals|null>(null);
 const [branches,setBranches]=useState<DirectBranchPage|null>(null);
 const [activity,setActivity]=useState<DailyActivityStatus|null>(null),[activityError,setActivityError]=useState('');
 const [history,setHistory]=useState<LedgerEvent[]>([]),[historyCursor,setHistoryCursor]=useState<number|null>(null);
 const [historyAsset,setHistoryAsset]=useState<'BNB'|'USDT'>('USDT');
 const [historyError,setHistoryError]=useState(''),[historyBusy,setHistoryBusy]=useState(false);
 const [positionOffset,setPositionOffset]=useState(0),[withdrawPage,setWithdrawPage]=useState(0);
 const [authBusy,setAuthBusy]=useState(false),[scanBusy,setScanBusy]=useState(false),[detailBusy,setDetailBusy]=useState(false);
 const [error,setError]=useState(''),[detailError,setDetailError]=useState('');
 const revision=useRef(0),scanning=useRef(false),sessionRef=useRef(''),scannerRef=useRef<AbortController|null>(null);
 const selectedRef=useRef(0),historyGeneration=useRef(0),historyAbort=useRef<AbortController|null>(null);
 useEffect(()=>{
  revision.current++;sessionRef.current='';scannerRef.current?.abort();historyGeneration.current++;historyAbort.current?.abort();scanning.current=false;
  setToken('');setHead(null);setRows([]);setCursor(null);setSelected('');setSearch('');
  setProfile(null);setWithdrawals(null);setBranches(null);setActivity(null);setHistory([]);setHistoryAsset('USDT');
  setError('');setDetailError('');setHistoryError('');setPositionOffset(0);setWithdrawPage(0);
  setAuthBusy(false);setScanBusy(false);setDetailBusy(false);
  return()=>{revision.current++;scannerRef.current?.abort();historyGeneration.current++;historyAbort.current?.abort();};
 },[who,owner]);
 const needSign=()=>{sessionRef.current='';setToken('');setError('Owner audit session expired. Verify your owner wallet again.');};
 const handleError=(e:unknown,set:(value:string)=>void)=>{
  if(e instanceof AdminUserApiError&&[401,403].includes(e.status)){needSign();return;}
  if((e as Error)?.name!=='AbortError')set((e as Error)?.message||'Verified contract request unavailable.');
 };
 const login=async()=>{
  if(!owner||!who||authBusy)return;
  const id=revision.current;
  setAuthBusy(true);setError('');
  try{
   const signed=await adminSignIn(who,()=>revision.current===id&&owner);
   if(revision.current!==id)return;
   const snapshot=await adminHead(signed);
   if(revision.current!==id)return;
   sessionRef.current=signed;setToken(signed);setHead(snapshot);setCursor(snapshot.confirmedHead);
   setRows([]);setSelected('');setProfile(null);
  }catch(e){if(revision.current===id)handleError(e,setError);}
  finally{if(revision.current===id)setAuthBusy(false);}
 };
 const loadRegistry=async()=>{
  if(scanning.current||cursor===null||!head||!token)return;
  const id=revision.current,controller=new AbortController();scannerRef.current=controller;
  scanning.current=true;setScanBusy(true);setError('');
  let current:number|null=cursor,buffer:RegistryEvent[]=[];
  try{
   // Four bounded canonical windows per click, rather than unbounded archive
   // scans or silently claiming an unknown global user total.
   for(let batch=0;batch<4&&current!==null;batch++){
    if(controller.signal.aborted||revision.current!==id)return;
    const from=Math.max(head.deploymentBlock,current-1023);
    const data=await adminRegistrations(token,head,from,current,controller.signal);
    buffer.push(...data.events);
    current=from===head.deploymentBlock?null:from-1;
    setRows(previous=>{
     const stored=new Map(previous.map(row=>[row.transactionHash.toLowerCase()+':'+row.logIndex,row]));
     for(const row of data.events)stored.set(row.transactionHash.toLowerCase()+':'+row.logIndex,row);
     return [...stored.values()].sort((a,b)=>b.blockNumber-a.blockNumber||b.logIndex-a.logIndex);
    });
    setCursor(current);
   }
  }catch(e){if(revision.current===id&&!controller.signal.aborted)handleError(e,setError);}
  finally{if(revision.current===id){scannerRef.current=null;scanning.current=false;setScanBusy(false);}}
 };
 const choose=(wallet:string)=>{
  if(!isAddress(wallet))return;
  const address=getAddress(wallet);
  setSelected(address);setSearch(address);setPositionOffset(0);setWithdrawPage(0);
  setProfile(null);setWithdrawals(null);setBranches(null);setActivity(null);setActivityError('');
  historyGeneration.current++;historyAbort.current?.abort();setHistoryBusy(false);
  setHistory([]);setHistoryCursor(head?.confirmedHead??null);setHistoryError('');setHistoryAsset('USDT');
 };
 const find=(event:FormEvent)=>{event.preventDefault();if(!isAddress(search))setDetailError('Enter a valid wallet address.');else{setDetailError('');choose(search);}};
 useEffect(()=>{
  if(!selected||!head||!token)return;
  const id=++selectedRef.current,abort=new AbortController();
  setDetailBusy(true);setDetailError('');setProfile(null);setWithdrawals(null);setBranches(null);setActivity(null);
  const load=async()=>{
   const result=await Promise.allSettled([
    adminUser(token,head,selected,positionOffset,abort.signal),
    adminWithdrawals(token,head,selected,withdrawPage,abort.signal),
    requestDirectBranches(selected,0,12,head.confirmedHead,abort.signal),
    readDailyActivityStatus(selected)
   ]);
   if(id!==selectedRef.current||abort.signal.aborted)return;
   if(result[0].status==='fulfilled')setProfile(result[0].value);
   else handleError(result[0].reason,setDetailError);
   if(result[1].status==='fulfilled')setWithdrawals(result[1].value);
   else handleError(result[1].reason,setDetailError);
   if(result[2].status==='fulfilled')setBranches(result[2].value);
   // Direct members are optional: a fallback RPC may not support the pinned block.
   if(result[3].status==='fulfilled')setActivity(result[3].value);
   else setActivityError('Check-in service was unavailable; eligibility cannot be inferred.');
  };
  void load().finally(()=>{if(id===selectedRef.current)setDetailBusy(false);});
  return()=>{selectedRef.current++;abort.abort();};
 },[selected,token,head,positionOffset,withdrawPage]);
 const scanHistory=async()=>{
  if(!selected||!head||!token||historyCursor===null||historyBusy||!profile)return;
  const generation=++historyGeneration.current,controller=new AbortController();historyAbort.current=controller;
  setHistoryBusy(true);setHistoryError('');
  const current=historyCursor,first=Math.max(head.deploymentBlock,current-95);
  try{
   const asset=historyAsset==='BNB'?ZeroAddress:(profile.assets.find(a=>a.symbol==='USDT')?.address??ZeroAddress);
   const data=await requestVerifiedHistory({wallet:selected,asset,scope:'wallet',kind:'finance',from:first,to:current,signal:controller.signal});
   if(controller.signal.aborted||generation!==historyGeneration.current)return;
   const seen=new Map(history.map(row=>[row.key,row]));
   for(const log of data.logs){
    const record=parseFinancialLog(log as unknown as Log);
    if(record)seen.set(record.key,{...record,timestamp:log.timestamp});
   }
   setHistory([...seen.values()].sort((a,b)=>b.block-a.block||b.index-a.index));
   setHistoryCursor(first===head.deploymentBlock?null:first-1);
  }catch(e){if(!controller.signal.aborted&&generation===historyGeneration.current)handleError(e,setHistoryError);}
  finally{if(generation===historyGeneration.current){setHistoryBusy(false);historyAbort.current=null;}}
 };
 const exportLoaded=()=>{
  if(!head||!rows.length)return;
  const header=['wallet','referrer','registration_block','transaction_hash','log_index','chain_id','vault','snapshot_block','scanned_down_to','full_registry_scanned'];
  const body=rows.map(row=>[row.wallet,row.referrer,row.blockNumber,row.transactionHash,row.logIndex,head.chainId,
   head.vaultAddress,head.confirmedHead,cursor===null?head.deploymentBlock:cursor+1,cursor===null?'yes':'no']);
  const csv='\ufeff'+[header,...body].map(row=>row.map(safeCsv).join(',')).join('\r\n')+'\r\n';
  const blob=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=blob;a.download='global-verified-loaded-registrations.csv';
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(blob),500);
 };
 const assetDecimals=(symbol:string)=>profile?.assets.find(a=>a.symbol===symbol)?.decimals??18;
 const scannedFrom=cursor===null?head?.deploymentBlock:cursor===undefined?null:cursor===null?null:cursor+1;
 return <section className="panel admin-users" aria-labelledby="admin-users-heading">
  <div className="panel-title">
   <div><span className="detail-kicker">OWNER-VERIFIED · READ ONLY</span>
    <h2 id="admin-users-heading"><Users size={22}/> User directory & account audit</h2>
    <p>Review registered wallets, referral links, account balances, profits, positions, withdrawals and activity evidence at confirmed blockchain checkpoints.</p>
   </div>
   <ShieldCheck size={22}/>
  </div>
  <p className="ledger-note">Available to the current contract owner after a dedicated wallet-message sign-in. Neither a support ticket session nor an ordinary connected wallet grants directory access. No administrator signing key, account password or private KYC document is exposed.</p>
  {!owner?<p className="notice neutral" role="status">The verified contract owner wallet must be connected to access the administrator user directory. Reporters can still use the existing customer-status tools with their separately granted permissions.</p>:
   !token||!head?<div className="admin-users-auth"><p>Authorize this browser for a 10-minute, read-only owner audit session. A message signature is required; no transaction or gas is requested.</p>
    <button type="button" className="primary-button" disabled={authBusy} onClick={()=>void login()}><KeyRound size={17}/>{authBusy?'Verifying owner wallet…':'Unlock user directory'}</button></div>:
   <>
    <div className="admin-users-summary">
     <div><small>Loaded registration records</small><strong>{rows.length.toLocaleString('en-US')}</strong></div>
     <div><small>Scan coverage</small><strong>{cursor===null?'Complete to deployment':scannedFrom?.toLocaleString('en-US')+' → '+head.confirmedHead.toLocaleString('en-US')}</strong></div>
     <div><small>Confirmed snapshot block</small><strong>{head.confirmedHead.toLocaleString('en-US')}</strong></div>
     <div><small>Chain</small><strong>{head.chainId===97?'BNB Testnet':'BNB Mainnet'}</strong></div>
    </div>
    <p className="muted" role="status">{cursor===null?'All registration event ranges back to the configured deployment block have been scanned.':'Partial registry: more historical registration events may exist. Loaded rows are not the platform’s complete user total.'}</p>
    <div className="admin-users-toolbar">
     <button type="button" className="small-button" onClick={()=>void loadRegistry()} disabled={scanBusy||cursor===null}>
      <RefreshCw size={15} className={scanBusy?'spin':''}/>{scanBusy?'Reading confirmed blocks…':cursor===null?'Full scan reached':'Scan up to 4,096 older blocks'}
     </button>
     <button type="button" className="small-button" onClick={exportLoaded} disabled={!rows.length}><FileDown size={15}/> Export loaded CSV</button>
     <button type="button" className="small-button" onClick={()=>{revision.current++;scannerRef.current?.abort();historyGeneration.current++;historyAbort.current?.abort();sessionRef.current='';setToken('');setHead(null);setSelected('');setRows([]);setCursor(null);}}>
      Lock owner directory
     </button>
    </div>
    <RegistrationDirectory rows={rows} selected={selected} onPick={choose}/>
    <form className="admin-users-search" onSubmit={find}>
     <label htmlFor="admin-users-address"><Search size={15}/> Inspect any registered or unregistered wallet</label>
     <div><input id="admin-users-address" value={search} onChange={e=>setSearch(e.target.value)} dir="ltr" spellCheck={false} placeholder="0x…"/>
      <button type="submit" className="primary-button" disabled={!search.trim()}><Search size={16}/> Open account</button>
     </div>
    </form>
    {detailError&&<p className="inline-error" role="alert">{detailError}</p>}
    {selected&&<div className="admin-users-report" aria-live="polite">
     <div className="admin-users-report-head"><h3>On-chain member details</h3>
      <a href={explorer+'/address/'+selected} target="_blank" rel="noopener noreferrer">{short(selected)} <ExternalLink size={15}/></a>
     </div>
     {detailBusy&&!profile&&<p className="muted">Verifying member state and queue at the selected checkpoint…</p>}
     {profile&&<>
      <div className="admin-users-detail-grid">
       <span>Registration <strong>{profile.profile.registered?'Registered':'Not registered'}</strong></span>
       <span>Reporter activity status <strong>{profile.profile.active?'Verified active':'Not verified active'}</strong></span>
       <span>VIP KYC flag <strong>{profile.profile.kycVerified?'Verified on chain':'Not verified'}</strong></span>
       <span>Account tier <strong>{profile.profile.tier}</strong></span>
       <span>Referrer <strong>{profile.profile.referrer===ZeroAddress?'No referrer':short(profile.profile.referrer)}</strong></span>
       <span>Registered direct referrals <strong>{profile.profile.registeredDirect}</strong></span>
       <span>Reporter-verified active directs <strong>{profile.profile.activeDirect}</strong></span>
       <span>Qualified directs <strong>{profile.profile.qualifiedDirect}</strong></span>
       <span>Recorded capital USD <strong>{amount(profile.profile.capitalUsd,18,2)}</strong></span>
       <span>Recorded sales USD <strong>{amount(profile.profile.salesUsd,18,2)}</strong></span>
       <span>Daily target rate <strong>{(profile.profile.dailyTargetBps/100).toFixed(2)}% · not a guaranteed payout</strong></span>
       <span>Positions in contract <strong>{profile.positionCount.toLocaleString('en-US')}</strong></span>
      </div>
      <p className="muted">Activity is a reporter-set contract flag. Check-in evidence is separate; recorded credits do not confirm wallet transfers. Snapshot at block {profile.confirmedHead.toLocaleString('en-US')}.</p>
      <section className="admin-users-subsection" aria-label="Current referral-earning eligibility checks">
       <h4>Referral earning checks · current status only</h4>
       <p className="muted">These are current prerequisites from the contract and check-in service, not proof of entitlement for previous periods or a new payment instruction.</p>
       {!profile.profile.active&&<p className="inline-error">Contract reporter activity: inactive. Current referrals fail the verified-active condition until legitimately attested.</p>}
       {profile.profile.tier===4&&!profile.profile.kycVerified&&<p className="inline-error">VIP KYC flag is not verified; VIP referral credit requires independent KYC approval.</p>}
       {activity?.requirementActive&&!activity.activityCurrent&&<p className="inline-error">Current 24-hour activity evidence is missing or expired.</p>}
       {profile.profile.active&&!(profile.profile.tier===4&&!profile.profile.kycVerified)&&
         (!activity?.requirementActive||activity.activityCurrent)&&<p className="muted">No current reporter/KYC/check-in blocker was detected, but reward entitlement, capital coverage and historical credits remain unverified.</p>}
       {!activity&&<p className="muted">Check-in eligibility could not be verified; do not presume it is satisfied.</p>}
      </section>
      <AccountAssets user={profile}/>
      <div className="admin-users-actions">
       <button className="small-button" type="button" onClick={()=>{onReviewStatus(selected);document.getElementById('global-customer-status')?.scrollIntoView({behavior:'smooth',block:'start'});}}>Prefill reviewed customer status</button>
       <button className="small-button" type="button" disabled={!profile.profile.registered||historyBusy||historyCursor===null}
        onClick={()=>void scanHistory()}><FileClock size={15}/> {historyBusy?'Scanning events…':'Scan older finance events'}</button>
      </div>
      <section className="admin-users-subsection"><h4>Investment positions · {profile.positions.length} of {profile.positionCount} shown</h4>
       {profile.positions.length?<div className="admin-users-table-scroll"><table><thead><tr><th>Position</th><th>Asset</th><th>Capital</th><th>Capital USD</th><th>Unlock</th></tr></thead><tbody>
        {profile.positions.map(p=><tr key={p.id}><td>#{p.id+1}</td><td>{p.symbol}</td>
         <td>{amount(p.principal,assetDecimals(p.symbol),5)}</td><td>{amount(p.capitalUsd,18,2)}</td>
         <td>{viewTime(p.unlockAt)}</td></tr>)}
       </tbody></table></div>:<p className="muted">No position entries in this page.</p>}
       {profile.positionCount>8&&<div className="admin-users-toolbar">
        <button className="small-button" type="button" disabled={positionOffset===0} onClick={()=>setPositionOffset(v=>Math.max(0,v-8))}>Previous positions</button>
        <button className="small-button" type="button" disabled={positionOffset+8>=profile.positionCount} onClick={()=>setPositionOffset(v=>v+8)}>Next positions</button></div>}
      </section>
      <section className="admin-users-subsection"><h4>Direct referral wallets</h4>
       {branches?<><p className="muted">{branches.total} registered directs in contract. Showing first {branches.members.length}; no active status inferred.</p>
        <div className="admin-users-branch-list">{branches.members.map(m=><button type="button" key={m.address} className="small-button" onClick={()=>choose(m.address)}>{short(m.address)}</button>)}</div></>:
        <p className="muted">Direct-member view unavailable at this checkpoint. On-chain counts above remain authoritative.</p>}
      </section>
     </>}
     <section className="admin-users-subsection"><h4>24-hour check-in evidence</h4>
      {activity?<p>{activity.activityCurrent?'Activity evidence currently valid':'No current activity evidence confirmed'} · Last check-in: {activity.lastCheckInAt?viewTime(String(activity.lastCheckInAt)):'Not recorded'} · Rule enforced: {activity.requirementActive?'Yes':'No'}</p>:
       <p className="muted">{activityError||'Checking activity service…'}</p>}
      <p className="muted">This check-in is distinct from the contract reporter-active flag and does not itself create a reward.</p>
     </section>
     <section className="admin-users-subsection"><h4>Withdrawal requests</h4>
      {withdrawals?.supported?<><p className="muted">Contract queue: {withdrawals.total} total for this wallet · page {(withdrawals.page??0)+1}. Paid queue status does not prove a transfer receipt.</p>
       {withdrawals.requests?.length?<div className="admin-users-table-scroll"><table><thead><tr><th>ID</th><th>Requested net</th><th>Status</th><th>Deadline</th></tr></thead><tbody>
        {withdrawals.requests.map(w=><tr key={w.id}><td>#{(BigInt(w.id)+1n).toString()}</td>
         <td>{amount(w.net,w.asset===ZeroAddress?18:assetDecimals('USDT'),4)} {w.asset===ZeroAddress?'BNB':'USDT'}</td>
         <td>{['Pending','Recorded paid','Cancelled','Approved · pending payment'][w.status]}</td>
         <td>{viewTime(w.dueAt)}</td></tr>)}</tbody></table></div>:<p className="muted">No requests on this queue page.</p>}
       {(withdrawals.total??0)>8&&<div className="admin-users-toolbar">
        <button className="small-button" disabled={!withdrawPage} onClick={()=>setWithdrawPage(v=>Math.max(0,v-1))}>Newer</button>
        <button className="small-button" disabled={(withdrawPage+1)*8>=(withdrawals.total??0)} onClick={()=>setWithdrawPage(v=>v+1)}>Older</button></div>}
      </>:withdrawals?<p className="muted">The deployed contract does not expose a compatible withdrawal queue. Check verified withdrawal events instead.</p>:
       <p className="muted">Withdrawal queue details unavailable or still loading.</p>}
     </section>
     <section className="admin-users-subsection"><h4>Verified financial events · {historyAsset}</h4>
      <div className="admin-users-toolbar" role="group" aria-label="Financial history asset">
       {(['USDT','BNB'] as const).map(symbol=><button type="button" key={symbol} className="small-button" aria-pressed={historyAsset===symbol} disabled={historyBusy} onClick={()=>{historyGeneration.current++;historyAbort.current?.abort();setHistoryAsset(symbol);setHistory([]);setHistoryCursor(head.confirmedHead);setHistoryError('');}}>{symbol}</button>)}
      </div>
      <p className="muted">{historyCursor===null?'History scanned to the configured deployment block.':'Loaded '+history.length+' events in scanned windows only. Click “Scan older finance events” to expand coverage.'}</p>
      {historyError&&<p className="inline-error" role="alert">{historyError}</p>}
      {history.length>0?<div className="admin-users-table-scroll"><table><thead><tr><th>Event</th><th>Amount</th><th>Block</th><th>Receipt</th></tr></thead><tbody>
       {history.slice(0,30).map(row=><tr key={row.key}><td>{historyLabels[row.kind]}</td>
        <td>{displayAmount(row.amount,assetDecimals(historyAsset),5)} {historyAsset}</td><td>{row.block.toLocaleString('en-US')}</td>
        <td><a href={explorer+'/tx/'+row.tx} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> Tx</a></td></tr>)}
      </tbody></table></div>:<p className="muted">No USDT events found in the ranges scanned so far; this does not establish zero lifetime activity.</p>}
      <p className="muted">ProfitCredited is an on-chain credit, not a paid bank or wallet transfer. Personal versus referral allocation requires verified batch attribution, not guesswork.</p>
     </section>
    </div>}
   </>}
  {error&&<p className="inline-error" role="alert">{error}</p>}
 </section>;
}
