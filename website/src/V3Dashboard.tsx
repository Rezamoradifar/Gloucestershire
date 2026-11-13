// Global V3 TESTNET workspace integrated into the original Global navy/gold
// shell and five-tab mobile navigation. Uses verified on-chain TEST claims only;
// it can never display fabricated deposits, profits or cash.
import {useCallback,useEffect,useRef,useState} from 'react';
import {ZeroAddress,getAddress,formatUnits,parseUnits} from 'ethers';
import {ArrowUpRight,CheckCircle2,Clock3,Coins,ExternalLink,History,Home,Info,
 Layers,LogOut,Menu,RefreshCw,Settings2,ShieldAlert,ShieldCheck,UserRound,Users,Wallet,X} from 'lucide-react';
import {wallets,getWalletProvider,walletConnectionError,switchWalletNetwork,type WalletKind} from './wallet';
import {V3_EXPLORER,readV3Snapshot,v3ReleaseConfig,type V3Snapshot,type V3Withdrawal} from './v3-chain';
import {V3_TEST_TOKEN} from './v3-site-config';
import {sendV3Action,sendV3FundWithdrawal,sendV3TestTokenDeposit,readV3ManagerQueue,
 type V3Action} from './v3-actions';
import {v3PrepareUserClaims} from './v3-claim-balance';
import V3ClaimsReadout from './V3ClaimsReadout';
import './v2-dashboard.css';
import './v2-classic-shell.css';
import './v2-classic-refinement.css';
import './v2-mobile-dock.css';
import './v2-responsive-complete.css';
import './v2-premium-experience.css';
import './v2-signature-dashboard.css';
import './v3-dashboard.css';

type Tab='overview'|'positions'|'team'|'history'|'profile'|'withdrawals'|'admin'|'contract';
const menus=[
 {id:'overview' as Tab,label:'Overview',Icon:Home},
 {id:'positions' as Tab,label:'Positions',Icon:Layers},
 {id:'team' as Tab,label:'Team & referrals',Icon:Users},
 {id:'history' as Tab,label:'History',Icon:History},
 {id:'profile' as Tab,label:'Profile',Icon:UserRound},
 {id:'withdrawals' as Tab,label:'Withdrawals',Icon:Coins},
 {id:'admin' as Tab,label:'Administration',Icon:Settings2},
 {id:'contract' as Tab,label:'Contract & safety',Icon:ShieldCheck}
];
const dock=menus.slice(0,5);
const short=(s:string)=>s.slice(0,9)+'…'+s.slice(-5);
const show=(v:bigint,p=4)=>formatUnits(v,18).replace(/(\.\d{0,8})\d+$/,'$1').replace(/\.?0+$/,'')||'0';
const date=(seconds:number)=>seconds?new Date(seconds*1000).toLocaleString('en-US'):'Not recorded';
const kinds=['Profit','Principal','Referral'] as const;
const statuses=['Requested','Manager approved','Cash escrowed','Paid','Rejected','Cancelled'] as const;
const amount=(s:string)=>{
 const v=s.trim();
 if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v))throw Error('Enter a positive decimal TEST USDT amount.');
 const n=parseUnits(v,18);if(n<=0n)throw Error('Amount must be positive.');
 return n;
};

export default function V3Dashboard(){
 const [tab,setTab]=useState<Tab>('overview'),[menuOpen,setMenuOpen]=useState(false);
 const [wallet,setWallet]=useState(''),[chain,setChain]=useState<number|null>(null);
 const [connecting,setConnecting]=useState(false),[loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [txHash,setTxHash]=useState(''),[view,setView]=useState<V3Snapshot|null>(null);
 const [value,setValue]=useState(''),[selectedPosition,setSelectedPosition]=useState('0');
 const [referrer,setReferrer]=useState(ZeroAddress);
 const [requestKind,setRequestKind]=useState<'profit'|'principal'|'referral'>('profit');
 const [adminQueue,setAdminQueue]=useState<{count:number;requests:V3Withdrawal[]}|null>(null);
 const revision=useRef(0);
 const config=v3ReleaseConfig;

 useEffect(()=>{
  let alive=true,version=0;
  const sync=async()=>{
   const current=++version,p=getWalletProvider();
   revision.current++;
   setView(null);setAdminQueue(null);
   if(!p){if(alive){setWallet('');setChain(null);}return;}
   try{
    const [accounts,chainId]=await Promise.all([
     p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})
    ]);
    if(alive&&current===version){
     setWallet(Array.isArray(accounts)&&typeof accounts[0]==='string'?getAddress(accounts[0]):'');
     setChain(Number(chainId));
    }
   }catch{if(alive&&current===version){setWallet('');setChain(null);}}
  };
  const stop=wallets.subscribe(()=>{void sync();});void sync();
  return()=>{alive=false;version++;stop();};
 },[]);
 const refresh=useCallback(async()=>{
  const id=++revision.current;
  const provider=getWalletProvider();
  if(!provider||!wallet||chain!==97||!config){setView(null);setLoading(false);return;}
  setLoading(true);setError('');
  try{
   const result=await readV3Snapshot(provider,wallet,config);
   if(id===revision.current&&getWalletProvider()===provider)setView(result);
  }catch(e){
   if(id===revision.current){setView(null);setError(e instanceof Error?e.message:'V3 verification failed.');}
  }finally{if(id===revision.current)setLoading(false);}
 },[wallet,chain,config]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{
  if(!config||!wallet||chain!==97)return;
  const tick=setInterval(()=>{
   if(document.visibilityState==='visible'&&!busy)void refresh();
  },45000);
  return()=>clearInterval(tick);
 },[wallet,chain,busy,refresh,config]);
 async function connect(kind:WalletKind){
  setConnecting(true);setError('');
  try{await wallets.connect(kind);}
  catch(e){setError(walletConnectionError(e));}
  finally{setConnecting(false);}
 }
 async function disconnect(){await wallets.disconnect();setView(null);setAdminQueue(null);}
 async function perform(action:V3Action,description:string){
  if(busy||!wallet||!config||chain!==97||!view)return;
  if(!window.confirm(description+'\n\nBNB TESTNET ONLY · Mock TUSDT has no monetary value.\nV3 contract: '+config.address+'\nThe wallet must sign this separate blockchain transaction. Continue?'))return;
  const p=getWalletProvider();if(!p){setError('Wallet disconnected.');return;}
  setBusy(true);setError('');setNotice('Confirm the V3 TESTNET transaction in your connected wallet…');setTxHash('');
  try{
   const hash=await sendV3Action(p,wallet,action,config);
   setTxHash(hash);setNotice('V3 TESTNET action confirmed on-chain.');
   await refresh();if(view.canManage)await readQueue();
  }catch(e){setNotice('');setError(e instanceof Error?e.message:'V3 action not confirmed.');}
  finally{setBusy(false);}
 }
 async function deposit(){
  if(!view||!config||busy)return;
  let n:bigint;
  try{n=amount(value);}catch(e){setError((e as Error).message);return;}
  if(n>view.walletTestTokenBalance){setError('Connected wallet lacks this amount of mock TUSDT.');return;}
  const parent=view.registered?view.referrer:referrer;
  if(!window.confirm('NEW V3 TESTNET ONLY\n\nDeposit '+show(n)+' MOCK TUSDT into new V3 contract '+config.address+
   '\n100% of TEST tokens stays in this V3 vault; there is NO 10/10/80 routing. The term differs from V2.'+
   '\nThis is not a real-money deposit and future yields/withdrawals are not guaranteed. Approve token (if needed) and confirm the deposit?'))return;
  const p=getWalletProvider();if(!p)return;
  setBusy(true);setError('');setNotice('Review TEST token approval and V3 deposit in wallet…');setTxHash('');
  try{
   const tx=await sendV3TestTokenDeposit(p,wallet,n,parent,config);
   setTxHash(tx);setNotice('Mock TEST token deposit confirmed in V3.');setValue('');
   await refresh();
  }catch(e){setNotice('');setError(e instanceof Error?e.message:'V3 deposit not confirmed.');}
  finally{setBusy(false);}
 }
 async function readQueue(){
  const p=getWalletProvider();if(!p||!config||!wallet)return;
  try{setAdminQueue(await readV3ManagerQueue(p,wallet,config));}
  catch(e){setError(e instanceof Error?e.message:'V3 manager queue unavailable.');}
 }
 async function fund(id:number,gross:bigint,beneficiary:string){
  if(!config||busy||!wallet||!view?.canFund)return;
  if(!window.confirm('ONLY BNB TESTNET\nFund already-approved request #'+(id+1)+
   '\nBeneficiary: '+beneficiary+'\nExact mock tokens to escrow: '+show(gross)+
   '\nThis transfers actual TEST tokens from your funder wallet into the V3 vault. Continue?'))return;
  const p=getWalletProvider();if(!p)return;
  setBusy(true);setError('');setTxHash('');setNotice('Confirm exact mock token allowance and cash funding…');
  try{
   const tx=await sendV3FundWithdrawal(p,wallet,id,config);
   setTxHash(tx);setNotice('Exact withdrawal escrow funded on TESTNET; payout is a separate transaction.');
   await refresh();await readQueue();
  }catch(e){setNotice('');setError(e instanceof Error?e.message:'Funding not confirmed. Inspect the chain before retrying.');}
  finally{setBusy(false);}
 }
 const claims=view?v3PrepareUserClaims(view.ledger):null;
 const due=view?.positions.filter(p=>p.principal>0n&&view.asOf>=p.lastAccruedAt+86400).slice(0,20).map(p=>p.id)??[];
 const requestValue=()=>{
  if(!view)throw Error('No verified V3 account.');
  const n=amount(value);
  if(!view.registered||view.suspended||view.pendingWithdrawal||view.asOf<view.nextRequestAt)
   throw Error('Withdrawal already pending, account suspended or 72-hour cooldown active.');
  const p=view.positions.find(x=>x.id===Number(selectedPosition));
  if(requestKind==='referral'){
   if(n>view.referralAvailable||n>view.ledger.requestCap)throw Error('Referral amount exceeds verified claim or cap.');
   return {kind:'requestReferral',amount:n} as const;
  }
  if(!p)throw Error('Select a verified V3 position.');
  if(requestKind==='profit'){
   if(n>p.availableProfit||n>view.ledger.requestCap)throw Error('Claim exceeds recorded position profit or 10% per-request limit.');
   return {kind:'requestProfit',positionId:p.id,amount:n} as const;
  }
  if(view.asOf<p.openedAt+90*86400||n>p.principal-p.reservedPrincipal)
   throw Error('This principal is not past its 90-day lock or is already reserved.');
  return {kind:'requestPrincipal',positionId:p.id,amount:n} as const;
 };
 const request=()=>{
  try{
   const a=requestValue();
   void perform(a,'Request '+value+' MOCK TUSDT '+requestKind+' withdrawal. 3% fee for profit, 30% principal penalty after lock. Manager approval and actual funding required.');
  }catch(e){setError((e as Error).message);}
 };
 const withdrawItem=(r:V3Withdrawal,admin=false)=>
  <article className="gv3-withdrawal-row" key={r.id}>
   <div><strong>Request #{r.id+1} · {kinds[r.kind]??'Unknown'}</strong>
    <small>{date(r.requestedAt)} · {short(r.beneficiary)}</small></div>
   <div><b>{show(r.gross)} TEST USDT</b><small>Net {show(r.gross-r.fee)} · Fee {show(r.fee)}</small></div>
   <div><span className="gv3-request-status">{statuses[r.status]??'Unverified'}</span>
    {admin&&<div className="gv3-queue-actions">
     {r.status===0&&<><button disabled={busy} onClick={()=>void perform({kind:'approveWithdrawal',id:r.id},'Approve request #'+(r.id+1)+' for '+r.beneficiary+'? No money is paid until escrowed.')}>Approve</button>
      <button disabled={busy} onClick={()=>void perform({kind:'rejectWithdrawal',id:r.id},'Reject unescrowed request #'+(r.id+1)+'?')}>Reject</button></>}
     {r.status===1&&<><button disabled={busy} onClick={()=>void perform({kind:'reserveExistingCash',id:r.id},'Reserve already-free V3 cash for request #'+(r.id+1)+'? Other principal must remain protected.')}>Use existing cash</button>
      {view?.canFund&&<button disabled={busy} onClick={()=>void fund(r.id,r.gross,r.beneficiary)}>Fund exact request</button>}</>}
     {r.status===2&&<button disabled={busy} onClick={()=>void perform({kind:'payWithdrawal',id:r.id},'Pay the immutable beneficiary '+r.beneficiary+' exactly '+show(r.gross-r.fee)+' TEST USDT?')}>Pay approved request</button>}
    </div>}
   </div>
  </article>;
 const navigate=(to:Tab)=>{setTab(to);setMenuOpen(false);setError('');setValue('');};
 return <div className="gv2 shell gv2-classic gv3-workspace" dir="ltr">
  <aside className={'sidebar gv2-sidebar '+(menuOpen?'open':'')} aria-label="Global V3 testnet navigation">
   <button className="gv2-sidebar-close" onClick={()=>setMenuOpen(false)} aria-label="Close navigation"><X size={18}/></button>
   <a className="brand" href="#" onClick={()=>setMenuOpen(false)}><span className="brand-icon">G</span>
    <div><strong>GLOBAL</strong><small>DROP TRADE · V3 TESTNET</small></div></a>
   <div className="sidebar-caption">V3 TEST WORKSPACE</div>
   <nav>{menus.filter(x=>x.id!=='admin'||Boolean(view?.canManage)).map(({id,label,Icon})=>
    <button key={id} onClick={()=>navigate(id)} className={tab===id?'active':''} aria-current={tab===id?'page':undefined}><Icon size={19}/><span>{label}</span></button>)}</nav>
   <div className="gv2-sidebar-bottom"><a href="#dashboard">Open existing V2 dashboard</a><a href="#">Global landing</a>
    <small>V3 BNB TESTNET · No real assets</small></div>
  </aside>
  {menuOpen&&<button className="gv2-scrim" onClick={()=>setMenuOpen(false)} aria-label="Close navigation"/>}
  <div className="workspace gv2-workspace">
   <header className="topbar gv2-classic-topbar">
    <div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={()=>setMenuOpen(v=>!v)}><Menu size={19}/></button><span>V3 Testnet</span><strong>{menus.find(x=>x.id===tab)?.label}</strong></div>
    <div className="top-actions"><span className="network-label">V3 · TESTNET</span>
     {wallet?<button className="wallet-button" onClick={()=>void disconnect()}><LogOut size={16}/>{short(wallet)}</button>
      :<button className="wallet-button" disabled={connecting} onClick={()=>void connect('injected')}><Wallet size={17}/>{connecting?'Connecting…':'Connect wallet'}</button>}</div>
   </header>
   <main className="gv2-wrap">
    <div className="gv2-heading"><div><span className="gv2-page-label">GLOBAL · V3 BNB TESTNET</span>
     <h1>{menus.find(x=>x.id===tab)?.label}</h1>
     <p>Verified on-chain claims, automatic profit-on-profit accounting and manager-approved payouts. TESTNET ONLY.</p>
    </div>{wallet&&config&&<button onClick={()=>void refresh()} disabled={loading||busy}><RefreshCw size={17}/> Refresh</button>}</div>
    <section className="gv2-release"><ShieldCheck size={19}/><div className="gv2-release-copy">
     <strong>Isolated Global V3 test environment</strong>
     <span>{config?short(config.address)+' · verified runtime required before any wallet action':'V3 not deployed or not operator-pinned. V2 remains available.'}</span>
    </div>{config&&<a target="_blank" rel="noreferrer" href={V3_EXPLORER+'/address/'+config.address}>Contract <ExternalLink size={14}/></a>}</section>
    {!config&&<section className="gv2-panel gv3-not-ready" role="status"><ShieldAlert size={26}/>
     <h2>V3 integration is prepared, but activation is locked</h2>
     <p>No V3 address or hash has been invented. An authorized operator must first deploy the separate V3 BNB Testnet contract, independently verify its bytecode and activate this test page. Existing V2 accounts and balances are unchanged.</p>
     <a href="#dashboard">Return to verified V2 dashboard <ArrowUpRight size={16}/></a>
    </section>}
    {config&&<><div className="gv3-notice"><Info size={16}/> V3 records <b>unfunded TESTNET contractual claims</b>. These are NOT real USDT, verified business earnings, guaranteed returns or available wallet cash. Manager approval is only for withdrawals; daily profit-on-profit needs an eligible check-in and a gas-paying keeper transaction.</div>
    {error&&<p className="gv2-error" role="alert">{error}</p>}
    {notice&&<p className="gv2-message" role="status">{notice} {txHash&&<a href={V3_EXPLORER+'/tx/'+txHash} target="_blank" rel="noreferrer">Verified TX <ExternalLink size={14}/></a>}</p>}
    {!wallet&&<section className="gv2-panel gv3-connect"><Wallet size={31}/><h2>Connect your BNB Testnet wallet</h2>
     <p>No balance is shown before the V3 code hash and selected wallet are independently verified.</p>
     <div className="gv2-buttons"><button className="gv2-primary" disabled={connecting} onClick={()=>void connect('injected')}>Browser wallet</button>
      <button disabled={connecting} onClick={()=>void connect('walletconnect')}>WalletConnect QR</button></div></section>}
    {wallet&&chain!==97&&<section className="gv2-panel"><h3>Switch to BNB Testnet (97)</h3>
     <p>Do not use BNB Mainnet or transfer real Tether to this prototype.</p>
     <button className="gv2-primary" onClick={()=>void switchWalletNetwork().catch(e=>setError(String(e)))}>Switch network</button></section>}
    {wallet&&chain===97&&loading&&!view&&<section className="gv2-panel">Verifying pinned V3 runtime and account balances…</section>}
    {wallet&&chain===97&&!loading&&!view&&<section className="gv2-panel"><h3>Verified V3 account unavailable</h3>
     <button onClick={()=>void refresh()}>Retry blockchain verification</button></section>}
    {view&&<div className="gv2-content">
     {tab==='overview'&&<>
      <section className="gv2-premium-board">
       <div className="gv2-premium-board-top"><span className="gv2-premium-eyebrow">GLOBAL PRIVATE TESTNET WORKSPACE</span><span className="gv2-premium-wallet"><Wallet size={14}/>{short(wallet)}</span></div>
       <div className="gv2-premium-board-main"><div className="gv2-premium-hero-balance">
        <span className="gv2-premium-caption">Recorded V3 principal · not redeemable cash</span>
        <strong>{show(view.capital)} <em>TEST USDT</em></strong>
        <p>Only blockchain-confirmed records are shown. V2 accounts are not migrated.</p>
       </div><div className="gv2-premium-hero-side">
        <small>Claim status · {view.registered?'Registered':'Unregistered'} · {view.eligible?'Eligible':'Check-in required'}</small>
        <h2>{claims?show(claims.outstandingPersonal+claims.outstandingReferral):'—'} TEST USDT</h2>
        <p>Accrued test claims, not funded wallet balances</p>
       </div></div>
      </section>
      <V3ClaimsReadout verifiedLedger={view.ledger}/>
      <div className="gv2-summary">
       <div className="gv2-metric"><small>Daily test-rate tier</small><strong>{view.dailyRateBps/100}%</strong><span>Conditional accounting rule</span></div>
       <div className="gv2-metric"><small>Personal accrued claims</small><strong>{claims?show(claims.outstandingPersonal):'—'}</strong><span>Including profit-on-profit</span></div>
       <div className="gv2-metric"><small>Principal cash backing</small><strong>{show(view.ledger.cash)} TEST</strong><span>Vault cash, not personal wallet cash</span></div>
       <div className="gv2-metric"><small>Unfunded total obligations</small><strong>{claims?show(claims.overallUnfundedLiability):'—'}</strong><span>Not guaranteed to be paid</span></div>
      </div>
      <div className="gv2-panel"><div className="gv2-panel-head"><h3>Daily activity & automatic compounding</h3></div>
       <p>The testnet keeper can accrue eligible positions automatically without manager permission. Your own signed check-in is still needed at least once each active day. Each eligible position can accrue once per 24 hours, with no missed-day backfill.</p>
       <div className="gv2-buttons"><button className="gv2-primary" disabled={busy||!view.registered||view.suspended||view.paused} onClick={()=>
        void perform(due.length?{kind:'checkInAndAccrue',positionIds:due}:{kind:'checkIn'},
         due.length?'Sign daily check-in and record '+due.length+' due reward position(s)?':'Sign daily eligibility check-in?')}>
        <CheckCircle2 size={16}/> Check in {due.length?'& accrue due positions':''}</button>
        <button onClick={()=>navigate('withdrawals')}>Withdrawal requests</button></div>
       <p className="gv2-small">Last signed check-in: {date(view.lastCheckIn)} · Currently due positions: {due.length}.</p>
      </div>
     </>}
     {tab==='positions'&&<>
      <section className="gv2-panel"><div className="gv2-panel-head"><h3>My verified V3 positions</h3><span>{view.positions.length} entries</span></div>
       {view.positions.map(p=><article className="gv3-position-card" key={p.id}>
        <div><strong>Position #{p.id+1}{p.fromReinvestment?' · from manual reinvestment':''}</strong>
         <small>Opened {date(p.openedAt)} · Next eligible accrual after {date(p.lastAccruedAt+86400)}</small></div>
        <div><b>{show(p.principal)} TEST</b><small>Original principal entry</small></div>
        <div><b>{show(p.availableDaily)} + {show(p.availableCompound)}</b><small>Daily + compound available claims</small></div>
        <div><b>{show(p.reservedProfit)} TEST</b><small>Reserved for pending withdrawal</small></div>
       </article>)}
       {!view.positions.length&&<p>No independently verified V3 positions exist in this wallet.</p>}
      </section>
      <section className="gv2-panel"><div className="gv2-panel-head"><h3>Mock test-token deposit</h3><span>NOT real money</span></div>
       <p>100% of test tokens remains in V3 vault. The deployed V2 used different 10/10/80 routing; no old account is migrated.</p>
       <div className="gv3-input-row"><label htmlFor="v3-deposit">Amount (TEST USDT)</label><input id="v3-deposit" value={value} onChange={e=>setValue(e.target.value)} inputMode="decimal" placeholder="1000"/>
        {!view.registered&&<><label htmlFor="v3-parent">Referrer (optional)</label>
         <input id="v3-parent" value={referrer} onChange={e=>setReferrer(e.target.value)} /></>}
        <small>Wallet balance: {show(view.walletTestTokenBalance)} MOCK TEST USDT</small>
        <button className="gv2-primary" disabled={busy||view.paused} onClick={()=>void deposit()}>Review & sign test deposit</button></div>
      </section>
      <section className="gv2-panel"><h3>Optional manual reinvestment</h3><p>Automatic profit-on-profit does not require this action. Manual reinvestment moves already accrued claims to a new locked principal position, without creating new cash.</p>
       <div className="gv3-input-row"><label htmlFor="v3-reinvest-id">Position</label><select id="v3-reinvest-id" value={selectedPosition} onChange={e=>setSelectedPosition(e.target.value)}>
        {view.positions.map(p=><option key={p.id} value={p.id}>Position #{p.id+1}</option>)}</select>
        <label htmlFor="v3-reinvest-value">Recorded profit to reinvest</label><input id="v3-reinvest-value" value={value} onChange={e=>setValue(e.target.value)} inputMode="decimal"/>
        <button disabled={busy||!view.positions.length} onClick={()=>{
         try{void perform({kind:'reinvest',positionId:Number(selectedPosition),amount:amount(value)},'Manually convert accrued test profit to 90-day locked principal?');}
         catch(e){setError((e as Error).message);}
        }}>Reinvest recorded TEST claim</button></div></section>
     </>}
     {tab==='team'&&<section className="gv2-panel"><div className="gv2-panel-head"><h3>Team and referral credits</h3><Users size={18}/></div>
      <div className="gv2-detail"><span>Your referrer</span><b>{view.referrer===ZeroAddress?'None':view.referrer}</b></div>
      <div className="gv2-detail"><span>Total registered V3 members</span><b>{view.memberCount}</b></div>
      <div className="gv2-detail"><span>Available referral TEST claim</span><b>{show(view.referralAvailable)}</b></div>
      <div className="gv2-detail"><span>Already reserved referral claims</span><b>{show(view.referralReserved)}</b></div>
      <p className="gv2-small">Only on-chain accrued V3 referrals appear here. An on-chain member count is not a verified marketing team tree; no V2 referral data is imported.</p>
      <button onClick={()=>navigate('withdrawals')} className="gv2-primary">Request eligible referral claim</button>
     </section>}
     {tab==='history'&&<section className="gv2-panel"><div className="gv2-panel-head"><h3>Recent confirmed withdrawals</h3><span>Last {view.withdrawals.length} of {view.withdrawCount}</span></div>
      {view.withdrawals.map(r=>withdrawItem(r))}
      {!view.withdrawals.length&&<p>No V3 withdrawals have been confirmed or requested for this wallet.</p>}
      <p className="gv2-small">This page shows the on-chain recent-request index only; it does not invent historical deposits or import old contract data. For full V3 event history, a verified event indexer is required.</p>
     </section>}
     {tab==='profile'&&<section className="gv2-panel"><h3>Verified V3 profile</h3>
      <div className="gv2-detail"><span>Wallet</span><b>{wallet}</b></div>
      <div className="gv2-detail"><span>Registration</span><b>{view.registered?'Registered on V3':'Not registered'}</b></div>
      <div className="gv2-detail"><span>KYC</span><b>{view.vipKyc?'Manager verified':'Not verified'}</b></div>
      <div className="gv2-detail"><span>Suspension</span><b>{view.suspended?'Suspended':'No suspension'}</b></div>
      <div className="gv2-detail"><span>Last check-in</span><b>{date(view.lastCheckIn)}</b></div>
      <div className="gv2-detail"><span>Next new withdrawal allowed after</span><b>{date(view.nextRequestAt)}</b></div>
      <div className="gv2-detail"><span>Cumulative V3 test deposits</span><b>{show(view.originalDeposits)}</b></div>
      <div className="gv2-detail"><span>Cumulative manual reinvestments</span><b>{show(view.reinvestments)}</b></div>
      {!view.registered&&<button className="gv2-primary" disabled={busy} onClick={()=>void perform({kind:'register',referrer:referrer||ZeroAddress},'Register this new V3 testnet account?')}>Register V3 wallet</button>}
      <p>No customer or balance migration from V2 has occurred. Your V2 profile remains at <a href="#dashboard">the existing dashboard</a>.</p>
     </section>}
     {tab==='withdrawals'&&<section className="gv2-panel"><div className="gv2-panel-head"><h3>Request a V3 testnet withdrawal</h3><Clock3 size={18}/></div>
      <p>Claimed profit is a recorded obligation, not escrowed cash. Manager approval and actual TEST token funding are required before payment.</p>
      <div className="gv2-detail"><span>Maximum single profit/referral request now</span><b>{claims?show(claims.maxSingleRequest):'0'} TEST</b></div>
      <div className="gv3-input-row">
       <label htmlFor="v3-request-kind">Withdrawal type</label>
       <select id="v3-request-kind" value={requestKind} onChange={e=>setRequestKind(e.target.value as 'profit'|'principal'|'referral')}><option value="profit">Accrued profit</option><option value="referral">Referral claim</option><option value="principal">Matured principal</option></select>
       {requestKind!=='referral'&&<><label htmlFor="v3-request-position">Position</label><select id="v3-request-position" value={selectedPosition} onChange={e=>setSelectedPosition(e.target.value)}>
        {view.positions.map(p=><option key={p.id} value={p.id}>Position #{p.id+1}</option>)}</select></>}
       <label htmlFor="v3-request-amount">TEST USDT amount</label><input id="v3-request-amount" value={value} inputMode="decimal" onChange={e=>setValue(e.target.value)} placeholder="0.00"/>
       <button className="gv2-primary" disabled={busy||!view.registered||view.pendingWithdrawal||view.paused} onClick={request}>Review & sign withdrawal request</button>
      </div>
      <h3>Your recent V3 requests</h3>{view.withdrawals.map(r=>withdrawItem(r))}
      {!view.withdrawals.length&&<p>No V3 requests yet.</p>}
     </section>}
     {tab==='admin'&&view.canManage&&<section className="gv2-panel">
      <div className="gv2-panel-head"><h3>V3 manager approval and payout</h3><button disabled={busy} onClick={()=>void readQueue()}>Load latest 20 requests</button></div>
      <p>Daily accrual and automatic profit-on-profit require NO manager approval. Only here can management approve withdrawals, reserve available cash, or authorize exact TEST-token funding. Funding does NOT automatically pay.</p>
      <div className="gv2-detail"><span>Total recorded V3 principal claims</span><b>{show(view.ledger.principalLiability)} TEST</b></div>
      <div className="gv2-detail"><span>Accrued test-profit liabilities</span><b>{show(view.ledger.profitLiability)} TEST</b></div>
      <div className="gv2-detail"><span>V3 test-token cash</span><b>{show(view.ledger.cash)} TEST</b></div>
      <div className="gv2-detail"><span>Cash reserved for approved requests</span><b>{show(view.ledger.escrow)} TEST</b></div>
      <div className="gv2-detail"><span>Unfunded total liability</span><b>{claims?show(claims.overallUnfundedLiability):'—'} TEST</b></div>
      {adminQueue&&<><h3>Latest {adminQueue.requests.length} of {adminQueue.count} requests</h3>
       {adminQueue.requests.map(r=>withdrawItem(r,true))}
       {!adminQueue.requests.length&&<p>No manager requests are currently indexed.</p>}</>}
     </section>}
     {tab==='contract'&&<section className="gv2-panel"><div className="gv2-panel-head"><h3>V3 source and verification</h3><ShieldCheck size={18}/></div>
      <div className="gv2-detail"><span>Network</span><b>BNB Testnet (97)</b></div>
      <div className="gv2-detail"><span>Contract</span><b>{config.address}</b></div>
      <div className="gv2-detail"><span>Pinned bytecode hash</span><b>{config.runtimeHash}</b></div>
      <div className="gv2-detail"><span>Deployment TX</span><b>{config.deploymentTx}</b></div>
      <div className="gv2-detail"><span>Asset</span><b>{V3_TEST_TOKEN} · MOCK TUSDT</b></div>
      <div className="gv2-detail"><span>Withdrawals</span><b>Manager-approved; separate funding & payout</b></div>
      <div className="gv2-detail"><span>Principal lock</span><b>90 days, then 30% withdrawal penalty</b></div>
      <a className="gv2-explorer" href={V3_EXPLORER+'/address/'+config.address} target="_blank" rel="noreferrer">Review on BscScan <ExternalLink size={16}/></a>
      <p>Unaudited isolated testnet prototype. This interface never creates real USDT or a backed investment guarantee. V2 uses different fund routing and cannot be migrated silently.</p>
     </section>}
    </div>}
    </>}
    <footer className="gv2-foot">GLOBAL DROP TRADE · V3 ISOLATED TESTNET · No real deposits or guaranteed yield · <a href="#dashboard">Existing V2 dashboard</a></footer>
   </main>
  </div>
  <nav className="gv2-mobile-bottom" aria-label="V3 five-tab mobile navigation">
   {dock.map(({id,label,Icon})=><button key={id} type="button" onClick={()=>navigate(id)}
    aria-current={tab===id?'page':undefined}><Icon size={19}/><span>{label==='Overview'?'Home':label==='Team & referrals'?'Team':label}</span></button>)}
  </nav>
 </div>;
}
