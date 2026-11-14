// Global V3 TESTNET workspace integrated into the original Global navy/gold
// shell and five-tab mobile navigation. Uses verified on-chain TEST claims only;
// it can never display fabricated deposits, profits or cash.
import {useCallback,useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {ZeroAddress,getAddress,formatUnits} from 'ethers';
import {ArrowUpRight,CheckCircle2,ChevronRight,Clock3,Coins,ExternalLink,History,Home,Info,
 Layers,Menu,RefreshCw,Settings2,ShieldAlert,ShieldCheck,UserRound,Users,Wallet,X} from 'lucide-react';
import {wallets,getWalletProvider,walletConnectionError,switchWalletNetwork,type WalletKind} from './wallet';
import {V3_EXPLORER,readV3Snapshot,v3ReleaseConfig,type V3Snapshot,type V3Withdrawal} from './v3-chain';
import {sendV3Action,sendV3FundWithdrawal,sendV3TestTokenDeposit,readV3ManagerQueue,
 type V3Action,type V3TransactionProgress} from './v3-actions';
import {V3TransactionProgressTracker,v3TransactionProgressText} from './v3-transaction-progress';
import {diagnoseV3Wallet,type V3WalletDiagnostic} from './v3-wallet-diagnostic';
import {v3PrepareUserClaims} from './v3-claim-balance';
import {V3_PERIOD_SECONDS} from './v3-cycle';
import {V3_HOURLY_TEST} from './v3-site-config';
import V3ClaimsReadout from './V3ClaimsReadout';
import V3CycleCard from './V3CycleCard';
import V3NetworkPanel from './V3NetworkPanel';
import V3ClassicOverview from './V3ClassicOverview';
import V3HistoryPanel from './V3HistoryPanel';
import V3WithdrawalHistory from './V3WithdrawalHistory';
import V3CommercePanel from './V3CommercePanel';
import V3WalletControl from './V3WalletControl';
import WalletPicker from './WalletPicker';
import DigitalValue from './DigitalValue';
import {formatV3Amount as show} from './v3-format';
import {readReferralInvite,reviewReferralForDeposit} from './referral-invite';
import {parseV3Amount as amount,prepareV3WithdrawalRequest,type V3WithdrawalKind} from './v3-withdrawal-form';
import './v2-dashboard.css';
import './v2-classic-shell.css';
import './v2-classic-refinement.css';
import './v2-mobile-dock.css';
import './v2-responsive-complete.css';
import './v2-premium-experience.css';
import './v2-signature-dashboard.css';
import './v3-dashboard.css';
import './v1-v3-dashboard.css';

type Tab='overview'|'positions'|'team'|'history'|'profile'|'withdrawals'|'admin';
const menus=[
 {id:'overview' as Tab,label:'Overview',Icon:Home},
 {id:'positions' as Tab,label:'My positions',Icon:Layers},
 {id:'team' as Tab,label:'Referral network',Icon:Users},
 {id:'withdrawals' as Tab,label:'Withdrawal requests',Icon:Coins},
 {id:'history' as Tab,label:'History',Icon:History},
 {id:'profile' as Tab,label:'Profile',Icon:UserRound},
 {id:'admin' as Tab,label:'Funding & settlement',Icon:Settings2}
];
const dock=[{id:'overview' as Tab,label:'Home',Icon:Home},{id:'positions' as Tab,label:'Positions',Icon:Layers},
 {id:'team' as Tab,label:'Team',Icon:Users},{id:'history' as Tab,label:'History',Icon:History},
 {id:'profile' as Tab,label:'Profile',Icon:UserRound}];
const short=(s:string)=>s.slice(0,9)+'…'+s.slice(-5);
const date=(seconds:number)=>seconds?new Date(seconds*1000).toLocaleString('en-US'):'Not recorded';
const kinds=['Profit','Principal','Referral','Network milestone'] as const;
const statuses=['Requested','Manager approved','Cash escrowed','Paid','Rejected','Cancelled'] as const;
export default function V3Dashboard(){
 const [tab,setTab]=useState<Tab>('overview'),[menuOpen,setMenuOpen]=useState(false),[walletOpen,setWalletOpen]=useState(false);
 const [wallet,setWallet]=useState(''),[chain,setChain]=useState<number|null>(null);
 const [connecting,setConnecting]=useState(false),[loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[readError,setReadError]=useState(''),[notice,setNotice]=useState('');
 const [txHash,setTxHash]=useState(''),[view,setView]=useState<V3Snapshot|null>(null);
 const [transactionProgress,setTransactionProgress]=useState<V3TransactionProgress|null>(null);
 const [reviewRequired,setReviewRequired]=useState(false);
 const [reviewDetail,setReviewDetail]=useState<{message:string;hash?:string}|null>(null);
 const reviewRequiredRef=useRef(false),inFlight=useRef(false);
 const [walletDiagnostic,setWalletDiagnostic]=useState<V3WalletDiagnostic|null>(null),[diagnosing,setDiagnosing]=useState(false);
 const diagnosticVersion=useRef(0);
 const [value,setValue]=useState(''),[selectedPosition,setSelectedPosition]=useState('0');
 const [referrer,setReferrer]=useState(()=>{
  const invite=readReferralInvite(typeof window==='undefined'?'':window.location.search);
  return invite.status==='valid'?invite.address:'';
 });
 const [requestKind,setRequestKind]=useState<V3WithdrawalKind>('profit');
 const [adminQueue,setAdminQueue]=useState<{count:number;page:number;requests:V3Withdrawal[]}|null>(null);
 const [branchPage,setBranchPage]=useState(0),[groupPage,setGroupPage]=useState(0);
 const revision=useRef(0);
 const polling=useRef(false);
 const menuTrigger=useRef<HTMLButtonElement>(null);
 const [smallScreen,setSmallScreen]=useState(()=>typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(max-width: 960px)').matches);
 const config=v3ReleaseConfig;
 const invalidInvite=typeof window!=='undefined'&&readReferralInvite(window.location.search).status==='invalid';

 useEffect(()=>{
  if(typeof window.matchMedia!=='function')return;
  const media=window.matchMedia('(max-width: 960px)');
  const update=()=>{setSmallScreen(media.matches);if(!media.matches)setMenuOpen(false);};
  media.addEventListener('change',update);
  return()=>media.removeEventListener('change',update);
 },[]);
 useEffect(()=>{
  if(!menuOpen)return;
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenuOpen(false);menuTrigger.current?.focus();}};
  window.addEventListener('keydown',close);
  return()=>window.removeEventListener('keydown',close);
 },[menuOpen]);
 useEffect(()=>{
  let alive=true,version=0;
  const sync=async()=>{
   const current=++version,p=getWalletProvider();
   diagnosticVersion.current++;setWalletDiagnostic(null);setDiagnosing(false);
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
  return()=>{alive=false;version++;diagnosticVersion.current++;stop();};
 },[]);
 const refresh=useCallback(async()=>{
  const id=++revision.current;
  const provider=getWalletProvider();
  if(!provider||!wallet||chain!==97||!config){setView(null);setReadError('');setLoading(false);return;}
  setLoading(true);
  try{
   const result=await readV3Snapshot(provider,wallet,config,tab==='team'?{branches:branchPage,groups:groupPage}:null);
   if(id===revision.current&&getWalletProvider()===provider){setView(result);setReadError('');}
  }catch(e){
   if(id===revision.current){setView(null);setReadError('Unable to load verified account data. Retry or use the wallet connection check.');}
  }finally{if(id===revision.current)setLoading(false);}
 },[wallet,chain,config,tab,branchPage,groupPage]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{
  if(!config||!wallet||chain!==97)return;
  const tick=()=>{
   if(document.visibilityState!=='visible'||busy||polling.current)return;
   polling.current=true;
   void refresh().finally(()=>{polling.current=false;});
  };
  const timer=setInterval(tick,20000);
  document.addEventListener('visibilitychange',tick);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);};
 },[wallet,chain,busy,refresh,config]);
 async function connect(kind:WalletKind){
  setConnecting(true);setError('');
  try{await wallets.connect(kind);}
  catch(e){setError(walletConnectionError(e));}
  finally{setConnecting(false);}
 }
 function openWalletPicker(){
  if(busy||connecting)return;
  setError('');setNotice('');setWalletOpen(true);
 }
 function chooseWallet(kind:WalletKind){
  // Close the native dialog before WalletConnect opens its own modal.
  flushSync(()=>setWalletOpen(false));
  void connect(kind);
 }
 async function disconnect(){
  if(busy||connecting)return;
  setConnecting(true);setError('');setNotice('');setTxHash('');
  try{await wallets.disconnect();setNotice('Wallet disconnected from this site.');}
  catch{setError('Disconnected from this site. If your wallet still shows an active session, disconnect it in your wallet app.');}
  finally{setView(null);setAdminQueue(null);setConnecting(false);}
 }
 async function checkWallet(){
  const p=getWalletProvider();if(!p||!wallet||diagnosing)return;
  const version=++diagnosticVersion.current;setDiagnosing(true);setWalletDiagnostic(null);
  try{
   const result=await diagnoseV3Wallet(p,wallet,config);
   if(version===diagnosticVersion.current&&p===getWalletProvider())setWalletDiagnostic(result);
  }catch{if(version===diagnosticVersion.current)setError('Wallet diagnostics could not be completed.');}
  finally{if(version===diagnosticVersion.current)setDiagnosing(false);}
 }
 function acknowledgeReview(){reviewRequiredRef.current=false;setReviewRequired(false);setReviewDetail(null);setTransactionProgress(null);setError('');}
 function chosenReferrer(){
  const input=referrer.trim();
  if(!input||input.toLowerCase()===ZeroAddress.toLowerCase())return ZeroAddress;
  return reviewReferralForDeposit(input,window.location.origin,wallet)||ZeroAddress;
 }
 async function perform(action:V3Action,description:string){
  if(busy||inFlight.current)return;
  if(!wallet){setError('Connect your wallet before continuing.');return;}
  if(!config){setError('The verified V3 testnet contract is unavailable.');return;}
  if(chain!==97){setError('Switch your wallet to BNB Testnet before continuing.');return;}
  if(!view){setError('The verified account is unavailable. Refresh or use the wallet connection check.');return;}
  const trackedAction=action.kind==='register'||action.kind==='createRewardGroup'||action.kind==='addRewardBranches';
  if(trackedAction&&reviewRequiredRef.current){setError('Check your wallet transaction history before trying again.');return;}
  if(!window.confirm(description+'\n\nBNB TESTNET ONLY · Mock TUSDT has no monetary value.\nV3 contract: '+config.address+'\nThe wallet must sign this separate blockchain transaction. Continue?'))return;
  const p=getWalletProvider();if(!p){setError('Wallet disconnected.');return;}
  inFlight.current=true;setBusy(true);setError('');setTransactionProgress(null);setNotice(action.kind==='register'?'Checking registration…':'Confirm the V3 TESTNET transaction in your connected wallet…');setTxHash('');
  const tracker=new V3TransactionProgressTracker();
  let progressHash:string|undefined;
  const report=(detail:V3TransactionProgress)=>{tracker.record(detail);if(detail.step==='wallet_request')progressHash=undefined;if(detail.hash)progressHash=detail.hash;setTransactionProgress(detail);};
  try{
   const hash=await sendV3Action(p,wallet,action,config,trackedAction?report:undefined);
   setTxHash(hash);setNotice('V3 TESTNET action confirmed on-chain.');
   await refresh();if(view.canManage)await readQueue(adminQueue?.page??0);
  }catch(e){const message=e instanceof Error?e.message:'V3 action not confirmed.';setNotice('');setError(message);
   if(trackedAction&&tracker.needsReview(message)){reviewRequiredRef.current=true;setReviewDetail({message,hash:progressHash});setReviewRequired(true);}}
  finally{inFlight.current=false;setBusy(false);}
 }
 async function deposit(){
  if(busy||inFlight.current)return;
  if(!wallet){setError('Connect your wallet before continuing.');return;}
  if(!config){setError('The verified V3 testnet contract is unavailable.');return;}
  if(chain!==97){setError('Switch your wallet to BNB Testnet before continuing.');return;}
  if(!view){setError('The verified account is unavailable. Refresh or use the wallet connection check.');return;}
  if(reviewRequiredRef.current){setError('Check your wallet transaction history before trying again.');return;}
  let n:bigint;
  try{n=amount(value);}catch(e){setError((e as Error).message);return;}
  if(n>view.walletTestTokenBalance){setError('Connected wallet lacks this amount of mock TUSDT.');return;}
  let parent:string;
  try{parent=view.registered?view.referrer:chosenReferrer();}
  catch(e){setError(e instanceof Error?e.message:'Invalid referral address.');return;}
  if(!window.confirm('NEW V3 TESTNET ONLY\n\nDeposit exactly '+formatUnits(n,18)+' MOCK TUSDT into new V3 contract '+config.address+
   '\nReferrer: '+(parent===ZeroAddress?'None':parent)+' (permanent after first registration).'+
   '\nYour test deposit routes 10% to each original fee wallet and 80% to the original operations wallet. Gross principal is recorded but is not held as vault cash.'+
   '\nThis is not a real-money deposit and future yields/withdrawals are not guaranteed. Approve token (if needed) and confirm the deposit?'))return;
  const p=getWalletProvider();if(!p){setError('Wallet disconnected. Reconnect before continuing.');return;}
  inFlight.current=true;setBusy(true);setError('');setTransactionProgress(null);setNotice('Checking the test deposit…');setTxHash('');
  const tracker=new V3TransactionProgressTracker();
  let progressHash:string|undefined;
  const report=(detail:V3TransactionProgress)=>{tracker.record(detail);if(detail.step==='wallet_request')progressHash=undefined;if(detail.hash)progressHash=detail.hash;setTransactionProgress(detail);};
  try{
   const tx=await sendV3TestTokenDeposit(p,wallet,n,parent,config,report);
   setTxHash(tx);setNotice('Mock TEST token deposit confirmed in V3.');setValue('');
   await refresh();
  }catch(e){const message=e instanceof Error?e.message:'V3 deposit not confirmed.';setNotice('');setError(message);
   if(tracker.needsReview(message)){reviewRequiredRef.current=true;setReviewDetail({message,hash:progressHash});setReviewRequired(true);}}
  finally{inFlight.current=false;setBusy(false);}
 }
 async function readQueue(page=0){
  const p=getWalletProvider();if(!p||!config||!wallet)return;
  try{setAdminQueue(await readV3ManagerQueue(p,wallet,config,page));}
  catch(e){setError(e instanceof Error?e.message:'V3 manager queue unavailable.');}
 }
 async function fund(id:number,gross:bigint,beneficiary:string){
  if(!config||busy||!wallet||!view?.canFund)return;
  if(!window.confirm('ONLY BNB TESTNET\nFund already-approved request #'+(id+1)+
   '\nBeneficiary: '+beneficiary+'\nExact mock tokens to escrow: '+formatUnits(gross,18)+
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
 const due=view?.positions.filter(p=>p.principal>0n&&view.asOf>=p.lastAccruedAt+V3_PERIOD_SECONDS).slice(0,20).map(p=>p.id)??[];
 const checkIn=()=>void perform(due.length?{kind:'checkInAndAccrue',positionIds:due}:{kind:'checkIn'},
  due.length?'Sign daily check-in and record '+due.length+' due reward position(s)?':'Sign daily eligibility check-in?');
 const request=(kind=requestKind)=>{
  try{
   const a=prepareV3WithdrawalRequest(view,value,selectedPosition,kind);
   const fee=a.amount*(kind==='principal'?3000n:300n)/10000n;
   void perform(a,'Request '+kind+' withdrawal. Gross: '+formatUnits(a.amount,18)+
    ' TEST; fee: '+formatUnits(fee,18)+' TEST; net: '+formatUnits(a.amount-fee,18)+
    ' TEST. Manager approval and actual funding required.');
  }catch(e){setError((e as Error).message);}
 };
 const reinvest=()=>{
  try{
   const position=view?.positions.find(item=>item.id===Number(selectedPosition));
   if(!position)throw Error('Select a verified V3 position.');
   void perform({kind:'reinvest',positionId:position.id,amount:amount(value)},'Manually convert accrued test profit to 90-day locked principal?');
  }catch(e){setError(e instanceof Error?e.message:'Invalid reinvestment.');}
 };
 const register=()=>{
  try{const parent=chosenReferrer();void perform({kind:'register',referrer:parent},
   'Register this new V3 testnet account with referrer '+(parent===ZeroAddress?'none':parent)+'? The referrer is permanent.');}
  catch(e){setError(e instanceof Error?e.message:'Invalid referral address.');}
 };
 const withdrawItem=(r:V3Withdrawal,admin=false)=>
  <article className="gv3-withdrawal-row" key={r.id}>
   <div><strong>Request #{r.id+1} · {kinds[r.kind]??'Unknown'}</strong>
    <small>{date(r.requestedAt)} · {short(r.beneficiary)}</small></div>
   <div><b><DigitalValue value={show(r.gross)} unit="TEST USDT"/></b><small>Net {show(r.gross-r.fee)} · Fee {show(r.fee)}</small></div>
   <div><span className="gv3-request-status">{statuses[r.status]??'Unverified'}</span>
    {admin&&<div className="gv3-queue-actions">
     {r.status===0&&<><button disabled={busy} onClick={()=>void perform({kind:'approveWithdrawal',id:r.id},'Approve request #'+(r.id+1)+' for '+r.beneficiary+'? Gross '+formatUnits(r.gross,18)+' TEST, fee '+formatUnits(r.fee,18)+' TEST. No money is paid until escrowed.')}>Approve</button>
      <button disabled={busy} onClick={()=>void perform({kind:'rejectWithdrawal',id:r.id},'Reject unescrowed request #'+(r.id+1)+'?')}>Reject</button></>}
     {r.status===1&&<><button disabled={busy} onClick={()=>void perform({kind:'reserveExistingCash',id:r.id},'Reserve '+formatUnits(r.gross,18)+' TEST from already-free V3 cash for request #'+(r.id+1)+'? '+(r.kind===1?'This may reduce cash available for other principal claims.':'The contract checks outstanding principal before reserving profit.'))}>Use existing cash</button>
      {view?.canFund&&<button disabled={busy} onClick={()=>void fund(r.id,r.gross,r.beneficiary)}>Fund exact request</button>}</>}
     {r.status===2&&<button disabled={busy} onClick={()=>void perform({kind:'payWithdrawal',id:r.id},'Pay the immutable beneficiary '+r.beneficiary+' exactly '+formatUnits(r.gross-r.fee,18)+' TEST USDT?')}>Pay approved request</button>}
    </div>}
   </div>
  </article>;
 const navigate=(to:Tab)=>{setTab(to);setMenuOpen(false);setError('');setValue('');};
 return <div className="gv2 shell gv2-classic gv3-workspace" dir="ltr">
  <aside id="v3-dashboard-menu" className={'sidebar gv2-sidebar '+(menuOpen?'open':'')} aria-label="Global V3 testnet navigation" inert={smallScreen&&!menuOpen}>
   <button className="gv2-sidebar-close" onClick={()=>{setMenuOpen(false);menuTrigger.current?.focus();}} aria-label="Close navigation"><X size={18}/></button>
   <a className="brand" href="#" onClick={()=>setMenuOpen(false)}><span className="brand-icon">G</span>
    <div><strong>GLOBAL</strong><small>ARBITRAGE &amp; DROPSHIPPING</small></div></a>
   <div className="sidebar-caption">YOUR WORKSPACE</div>
   <nav>{menus.filter(x=>x.id!=='admin'||Boolean(view?.canManage)).map(({id,label,Icon})=>
    <button key={id} onClick={()=>navigate(id)} className={tab===id?'active':''} aria-current={tab===id?'page':undefined}><Icon size={19}/><span>{label}</span>{tab===id&&<ChevronRight size={15}/>}</button>)}
    <button type="button" onClick={()=>{window.location.hash='#marketplace';}}><Coins size={19}/><span>Products &amp; sales</span></button></nav>
   <div className="gv2-sidebar-bottom"><div className="gv1-sidebar-network"><span>◆</span><div><strong>BNB Testnet</strong><small>Test environment</small></div></div>
    <div className="gv1-sidebar-note"><ShieldCheck size={17}/><span>Account activity<br/><small>Available in your history</small></span></div>
    <a href="#">Back to website</a></div>
  </aside>
  {menuOpen&&<button className="gv2-scrim" onClick={()=>{setMenuOpen(false);menuTrigger.current?.focus();}} aria-label="Close navigation"/>}
  <div className="workspace gv2-workspace">
   <header className="topbar gv2-classic-topbar">
    <div className="breadcrumb"><button ref={menuTrigger} className="icon-button mobile-menu" aria-label="Open menu" aria-controls="v3-dashboard-menu" aria-expanded={menuOpen} onClick={()=>setMenuOpen(v=>!v)}><Menu size={19}/></button><span>Dashboard</span><ChevronRight size={14}/><strong>{menus.find(x=>x.id===tab)?.label}</strong></div>
    <div className="top-actions"><span className="network-label">V3 · TESTNET</span>
     <V3WalletControl address={wallet} busy={connecting||busy} onConnect={openWalletPicker} onDisconnect={()=>void disconnect()}/></div>
   </header>
   <main className="gv2-wrap">
    {V3_HOURLY_TEST&&<div className="gv3-notice" role="status"><Info size={16}/>
     ONE-HOUR BNB TESTNET CONTRACT. Accounts and claims shown here belong to this test deployment. Test tokens only.</div>}
    <div className="gv2-heading"><div><span className="gv2-page-label">GLOBAL FINANCE</span>
     <h1>{tab==='overview'?'Account overview':menus.find(x=>x.id===tab)?.label}</h1>
     <p>{tab==='overview'?'Your capital, recorded profit and withdrawal availability.':'Your verified testnet account and current contract information.'}</p>
    </div>{wallet&&config&&<button onClick={()=>void refresh()} disabled={loading||busy}><RefreshCw size={17}/> Refresh</button>}</div>
    <section className="gv2-release"><ShieldCheck size={19}/><div className="gv2-release-copy">
     <strong>Isolated Global V3 test environment</strong>
     <span>{config?'Account data is checked before wallet actions.':'The current testnet account connection has not yet been verified.'}</span>
    </div></section>
    {!config&&<section className="gv2-panel gv3-not-ready" role="status"><ShieldAlert size={26}/>
     <h2>V3 integration is prepared, but activation is locked</h2>
     <p>The testnet contract must be deployed and independently verified before this dashboard can show account data.</p>
     <a href="#">Return to Global landing <ArrowUpRight size={16}/></a>
    </section>}
    {config&&<><div className="gv3-notice"><Info size={16}/> BNB Testnet uses test USDT with no monetary value. Profit and rewards are recorded claims, not verified business earnings or wallet cash. Withdrawals are manager-approved and require funding; automatic profit-on-profit needs an eligible check-in and a gas-paying keeper.</div>
    {error&&<p className="gv2-error" role="alert">{error}</p>}
    {readError&&<p className="gv2-error" role="alert">{readError}</p>}
    {notice&&<p className="gv2-message" role="status">{notice} {txHash&&<a href={V3_EXPLORER+'/tx/'+txHash} target="_blank" rel="noreferrer">Verified TX <ExternalLink size={14}/></a>}</p>}
    {transactionProgress&&<p className="gv2-message" role="status">{busy?'Current step: ':'Last step: '}{v3TransactionProgressText(transactionProgress)}{' '}
     {transactionProgress.hash&&<a href={V3_EXPLORER+'/tx/'+transactionProgress.hash} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14}/></a>}</p>}
    {reviewRequired&&<section className="gv3-notice" role="alert"><ShieldAlert size={18}/><div>
     <strong>Check wallet activity before retrying.</strong><p>A request may have been sent. This reminder lasts only while this page remains open; check the transaction before reloading or trying again.</p>
     {reviewDetail&&<p>{reviewDetail.message} {reviewDetail.hash&&<a href={V3_EXPLORER+'/tx/'+reviewDetail.hash} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14}/></a>}</p>}
     <button type="button" disabled={busy} onClick={acknowledgeReview}>I checked wallet history</button></div></section>}
    {!wallet&&tab!=='overview'&&<section className="gv2-panel gv3-connect"><Wallet size={31}/><h2>Connect your BNB Testnet wallet</h2>
     <p>No balance is shown before the V3 code hash and selected wallet are independently verified.</p>
     <div className="gv2-buttons"><button className="gv2-primary" disabled={connecting} onClick={()=>void connect('injected')}>Browser wallet</button>
      <button disabled={connecting} onClick={()=>void connect('walletconnect')}>WalletConnect QR</button></div></section>}
    {wallet&&chain!==97&&<section className="gv2-panel"><h3>Switch to BNB Testnet (97)</h3>
     <p>Do not use BNB Mainnet or transfer real Tether to this prototype.</p>
     <button className="gv2-primary" onClick={()=>void switchWalletNetwork().catch(e=>setError(String(e)))}>Switch network</button></section>}
    {wallet&&chain===97&&loading&&!view&&<section className="gv2-panel">Verifying pinned V3 runtime and account balances…</section>}
    {wallet&&chain===97&&!loading&&!view&&<section className="gv2-panel"><h3>Verified V3 account unavailable</h3>
     <button onClick={()=>void refresh()}>Retry blockchain verification</button></section>}
    {tab==='profile'&&wallet&&<section className="gv2-panel"><h3>Wallet connection check</h3>
     <p>Compare the selected wallet and its BNB Testnet balance with an independent network read. No transaction or signature is requested.</p>
     <button type="button" disabled={diagnosing||busy} onClick={()=>void checkWallet()}>{diagnosing?'Checking wallet…':'Check wallet connection'}</button>
     {walletDiagnostic&&<div role="status"><p>Wallet: {walletDiagnostic.wallet.status} · Network: {walletDiagnostic.wallet.chainId??'unavailable'} · Selected account: {walletDiagnostic.wallet.accountMatches===null?'unavailable':walletDiagnostic.wallet.accountMatches?'matches':'does not match'}</p>
      <p>Wallet RPC balance: {walletDiagnostic.wallet.testBNB===null?'unavailable':walletDiagnostic.wallet.testBNB+' tBNB'}</p>
      <p>Independent RPC: {walletDiagnostic.independent.status} · Block: {walletDiagnostic.independent.block??'unavailable'} · Balance: {walletDiagnostic.independent.testBNB===null?'unavailable':walletDiagnostic.independent.testBNB+' tBNB'}</p>
      <p>Balances can differ across blocks or RPCs; this check does not prove a wallet transaction will succeed.</p></div>}
    </section>}
    {tab==='overview'&&view&&<div className="gv3-sync-line" aria-live="off"><span className="gv3-live-status">{loading?'CHECKING BLOCKCHAIN':'AUTO REFRESH · 20 SEC'}</span>
     <span>Verified block {view.block.toLocaleString('en-US')} · {date(view.asOf)}</span></div>}
    {tab==='overview'&&<V3ClassicOverview view={view} busy={busy} loading={loading} connecting={connecting}
     value={value} onValue={setValue} referrer={referrer} onReferrer={setReferrer} invalidInvite={invalidInvite}
     selectedPosition={selectedPosition} onPosition={setSelectedPosition}
     onDeposit={()=>void deposit()} onWithdraw={()=>request('profit')} onReinvest={reinvest}
     onNetwork={()=>navigate('team')} onConnect={openWalletPicker} onWalletConnect={()=>void connect('walletconnect')}/>}
    {tab==='overview'&&<V3CommercePanel/>}
    {view&&<div className="gv2-content">
     {tab==='overview'&&<>
      <V3CycleCard view={view} busy={busy} onCheckIn={checkIn} onPositions={()=>navigate('positions')}/>
      {view.wallet.toLowerCase()===wallet.toLowerCase()&&<V3ClaimsReadout key={(config?.address??'').toLowerCase()+':'+view.wallet.toLowerCase()} verifiedLedger={view.ledger}/>}
      <div className="gv2-summary">
       <div className="gv2-metric"><small>Daily test-rate tier</small><strong><DigitalValue value={String(view.dailyRateBps/100)} unit="%"/></strong><span>Conditional accounting rule</span></div>
       <div className="gv2-metric"><small>Personal accrued claims</small><strong><DigitalValue value={claims?show(claims.outstandingPersonal):'—'} unit="TEST"/></strong><span>Including profit-on-profit</span></div>
       <div className="gv2-metric"><small>Vault test-token cash</small><strong><DigitalValue value={show(view.ledger.cash)} unit="TEST"/></strong><span>Includes cash reserved for requests</span></div>
       <div className="gv2-metric"><small>Unfunded total obligations</small><strong><DigitalValue value={claims?show(claims.overallUnfundedLiability):'—'} unit="TEST"/></strong><span>Not guaranteed to be paid</span></div>
      </div>
      <div className="gv3-cycle-note"><CheckCircle2 size={16}/> Last confirmed check-in: {date(view.lastCheckIn)} · {due.length} positions due at the last verified block. Automatic posting needs an eligible check-in and a funded testnet keeper.</div>
     </>}
     {tab==='positions'&&<>
      <section className="gv2-panel"><div className="gv2-panel-head"><h3>My verified V3 positions</h3><span>{view.positions.length} entries</span></div>
       {view.positions.map(p=><article className="gv3-position-card" key={p.id}>
        <div><strong>Position #{p.id+1}{p.fromReinvestment?' · from manual reinvestment':''}</strong>
         <small>Opened {date(p.openedAt)} · Next eligible accrual after {date(p.lastAccruedAt+V3_PERIOD_SECONDS)}</small></div>
        <div><b><DigitalValue value={show(p.principal)} unit="TEST"/></b><small>Original principal entry</small></div>
        <div><b><DigitalValue value={show(p.availableDaily)} unit="TEST"/></b><small>Daily available claims</small>
         <b><DigitalValue value={show(p.availableCompound)} unit="TEST"/></b><small>Profit-on-profit available claims</small></div>
        <div><b><DigitalValue value={show(p.reservedProfit)} unit="TEST"/></b><small>Reserved for pending withdrawal</small></div>
       </article>)}
       {!view.positions.length&&<p>No independently verified V3 positions exist in this wallet.</p>}
      </section>
      <section className="gv2-panel"><div className="gv2-panel-head"><h3>Mock test-token deposit</h3><span>NOT real money</span></div>
       <p>100% of each test deposit is routed to designated wallets, including fee wallets. It does not remain as cash in the vault or establish product spending.</p>
       <div className="gv3-input-row"><label htmlFor="v3-deposit">Amount (TEST USDT)</label><input id="v3-deposit" value={value} onChange={e=>setValue(e.target.value)} inputMode="decimal" placeholder="1000"/>
        {!view.registered&&<><label htmlFor="v3-parent">Referrer (optional)</label>
         <input id="v3-parent" value={referrer} onChange={e=>setReferrer(e.target.value)} /></>}
        <small>Wallet balance: {show(view.walletTestTokenBalance)} MOCK TEST USDT</small>
        <button className="gv2-primary" disabled={busy||view.paused||reviewRequired} onClick={()=>void deposit()}>Review & sign test deposit</button></div>
      </section>
      <section className="gv2-panel"><h3>Optional manual reinvestment</h3><p>Automatic profit-on-profit does not require this action. Manual reinvestment moves already accrued claims to a new locked principal position, without creating new cash.</p>
       <div className="gv3-input-row"><label htmlFor="v3-reinvest-id">Position</label><select id="v3-reinvest-id" value={selectedPosition} onChange={e=>setSelectedPosition(e.target.value)}>
        {view.positions.map(p=><option key={p.id} value={p.id}>Position #{p.id+1}</option>)}</select>
        <label htmlFor="v3-reinvest-value">Recorded profit to reinvest</label><input id="v3-reinvest-value" value={value} onChange={e=>setValue(e.target.value)} inputMode="decimal"/>
        <button disabled={busy||!view.positions.length} onClick={reinvest}>Reinvest recorded TEST claim</button></div></section>
     </>}
     {tab==='team'&&(view.networkLoaded?
      <V3NetworkPanel view={view} busy={busy||loading} onAction={(action,description)=>void perform(action,description)} onWithdraw={()=>navigate('withdrawals')}
       onBranchPage={setBranchPage} onGroupPage={setGroupPage}/>:
      <section className="gv2-panel" role="status">Loading verified network branches and groups…</section>)}
     {tab==='history'&&<><V3HistoryPanel key={view.wallet} wallet={view.wallet} config={config}/><V3WithdrawalHistory key={'withdraw-'+view.wallet} wallet={view.wallet} config={config}/></>}
     {tab==='profile'&&<section className="gv2-panel"><h3>Verified V3 profile</h3>
      <div className="gv2-detail"><span>Wallet</span><b>{wallet}</b></div>
      <div className="gv2-detail"><span>Registration</span><b>{view.registered?'Registered on V3':'Not registered'}</b></div>
      <div className="gv2-detail"><span>KYC</span><b>{view.vipKyc?'Manager verified':'Not verified'}</b></div>
      <div className="gv2-detail"><span>Suspension</span><b>{view.suspended?'Suspended':'No suspension'}</b></div>
      <div className="gv2-detail"><span>Last check-in</span><b>{date(view.lastCheckIn)}</b></div>
      <div className="gv2-detail"><span>Next new withdrawal allowed after</span><b>{date(view.nextRequestAt)}</b></div>
      <div className="gv2-detail"><span>Cumulative V3 test deposits</span><b>{show(view.originalDeposits)}</b></div>
      <div className="gv2-detail"><span>Cumulative manual reinvestments</span><b>{show(view.reinvestments)}</b></div>
      {!view.registered&&<div className="gv3-input-row">
       <label htmlFor="v3-profile-referrer">Referrer wallet or invitation link (optional)</label>
       <input id="v3-profile-referrer" value={referrer} onChange={e=>setReferrer(e.target.value)} autoComplete="off"/>
       <small>Leave empty to register without a referrer. A selected referrer must already be registered in this test contract and cannot be changed after registration.</small>
       <button className="gv2-primary" disabled={busy||view.paused||reviewRequired} onClick={register}>Register V3 wallet</button>
      </div>}
      <p>This profile shows only the current contract's confirmed account records.</p>
     </section>}
     {tab==='withdrawals'&&<section className="gv2-panel"><div className="gv2-panel-head"><h3>Request a V3 testnet withdrawal</h3><Clock3 size={18}/></div>
      <p>Claimed profit is a recorded obligation, not escrowed cash. Manager approval and actual TEST token funding are required before payment.</p>
      <div className="gv2-detail"><span>Maximum single profit/referral request now</span><b><DigitalValue value={claims?show(claims.maxSingleRequest):'0'} unit="TEST"/></b></div>
      <div className="gv3-input-row">
       <label htmlFor="v3-request-kind">Withdrawal type</label>
       <select id="v3-request-kind" value={requestKind} onChange={e=>setRequestKind(e.target.value as 'profit'|'principal'|'referral'|'network')}><option value="profit">Accrued profit</option><option value="referral">Referral claim</option><option value="network">Network milestone claim</option><option value="principal">Matured principal</option></select>
       {(requestKind==='profit'||requestKind==='principal')&&<><label htmlFor="v3-request-position">Position</label><select id="v3-request-position" value={selectedPosition} onChange={e=>setSelectedPosition(e.target.value)}>
        {view.positions.map(p=><option key={p.id} value={p.id}>Position #{p.id+1}</option>)}</select></>}
       <label htmlFor="v3-request-amount">TEST USDT amount</label><input id="v3-request-amount" value={value} inputMode="decimal" onChange={e=>setValue(e.target.value)} placeholder="0.00"/>
       <button className="gv2-primary" disabled={busy||!view.registered||view.pendingWithdrawal||view.paused} onClick={()=>request()}>Review & sign withdrawal request</button>
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
      {adminQueue&&<><h3>Page {adminQueue.page+1} · {adminQueue.requests.length} of {adminQueue.count} requests</h3>
       {adminQueue.requests.map(r=>withdrawItem(r,true))}
       {!adminQueue.requests.length&&<p>No manager requests are currently indexed on this page.</p>}
       <div className="gv2-buttons"><button disabled={busy||adminQueue.page===0} onClick={()=>void readQueue(adminQueue.page-1)}>Newer requests</button>
        <button disabled={busy||(adminQueue.page+1)*20>=adminQueue.count} onClick={()=>void readQueue(adminQueue.page+1)}>Older requests</button></div></>}
     </section>}
    </div>}
    </>}
    <footer className="gv2-foot">GLOBAL DROP TRADE · V3 ISOLATED TESTNET · No real deposits or guaranteed yield</footer>
   </main>
  </div>
  <nav className="gv2-mobile-bottom" aria-label="V3 five-tab mobile navigation">
   {dock.map(({id,label,Icon})=><button key={id} type="button" onClick={()=>navigate(id)}
    aria-current={tab===id?'page':undefined}><Icon size={19}/><span>{label==='Overview'?'Home':label==='Team & referrals'?'Team':label}</span></button>)}
  </nav>
  <WalletPicker open={walletOpen} address={wallet} busy={connecting||busy}
   onClose={()=>setWalletOpen(false)} onConnect={chooseWallet} onDisconnect={()=>void disconnect()}/>
 </div>;
}
