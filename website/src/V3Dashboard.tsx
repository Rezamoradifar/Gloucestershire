// Global V3 TESTNET workspace integrated into the original Global navy/gold
// shell and five-tab mobile navigation. Uses verified testnet USDT claims only;
// it can never display fabricated deposits, profits or cash.
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {ZeroAddress,getAddress,formatUnits} from 'ethers';
import {ArrowUpRight,Bell,LifeBuoy,CheckCircle2,ChevronRight,Clock3,Coins,ExternalLink,Globe2,History,Home,
 Layers,Menu,RefreshCw,Settings2,ShieldAlert,ShieldCheck,UserRound,Users,Wallet,X} from 'lucide-react';
import {wallets,getWalletProvider,walletConnectionError,switchWalletNetwork,type WalletKind} from './wallet';
import {readWalletSelection} from './wallet-read';
import {V3_EXPLORER,readV3Snapshot,v3ReleaseConfig,type V3Snapshot,type V3Withdrawal} from './v3-chain';
import V3SettlementQueue,{V3SettlementBreakdown} from './V3SettlementQueue';
import {ApprovedDepositStopped,sendV3Action,sendV3FundWithdrawal,sendV3UnifiedPageWithdrawal,
 type V3Action,type V3TransactionProgress} from './v3-actions';
import {v3TransactionProgressText} from './v3-transaction-progress';
import {V3PersistentTransactionTracker,readV3PendingReview,clearV3PendingReview,v3ReviewKey,
 V3_PENDING_REVIEW_MESSAGE,type V3ReviewScope} from './v3-pending-review';
import {runUnifiedReinvestment} from './v3-unified-reinvestment-flow';
import {runV3Deposit,runV3Registration} from './v3-account-flow';
import {diagnoseV3Wallet,type V3WalletDiagnostic} from './v3-wallet-diagnostic';
import {v3PrepareUserClaims} from './v3-claim-balance';
import {V3_PERIOD_SECONDS} from './v3-cycle';
import {V3_HOURLY_TEST,unifiedWalletEnabled} from './v3-site-config';
import {isUnifiedWithdrawal,sendUnifiedWithdrawal,type UnifiedWithdrawal} from './v3-unified-settlement';
import V3ClaimsReadout from './V3ClaimsReadout';
import V3CycleCard from './V3CycleCard';
import V3UnifiedActivity from './V3UnifiedActivity';
import V3SeparateTestAccounts from './V3SeparateTestAccounts';
import {sendV3UnifiedCheckIn} from './v3-unified-checkin';
import V3NetworkPanel from './V3NetworkPanel';
import V3TeamDirectory from './V3TeamDirectory';
import {isUnifiedNetworkAction,sendUnifiedNetworkAction,networkActionTarget} from './v3-unified-network';
import V3PositionsList from './V3PositionsList';
import V3UnifiedPositionPage from './V3UnifiedPositionPage';
import V3AccountReinvestment from './V3AccountReinvestment';
import {allocateAccountEarnings,availableAccountEarnings,type AccountEarnings} from './v3-account-earnings';
import V3UnifiedReinvestSummary from './V3UnifiedReinvestSummary';
import V3AccountWithdrawalForm from './V3AccountWithdrawalForm';
import V3ProfileSummary from './V3ProfileSummary';
import V3PortfolioWithdrawal from './V3PortfolioWithdrawal';
import V3EarningsWithdrawal from './V3EarningsWithdrawal';
import {planV3AccountWithdrawal} from './v3-account-withdrawal';
import {prepareUnifiedPageAction,unifiedWithdrawalWindow,type UnifiedPositionPage} from './v3-unified-position';
import V3ClassicOverview from './V3ClassicOverview';
import {V3TransactionReview,useV3TransactionReview} from './V3TransactionReview';
import V3HistoryPanel from './V3HistoryPanel';
import V3WithdrawalHistory from './V3WithdrawalHistory';
import {linkedMemberTab} from './site-route';
import ThemeSwitch from './ThemeSwitch';
import V3TradingDesk from './V3TradingDesk';
import V3WalletControl from './V3WalletControl';
import WalletPicker from './WalletPicker';
import DigitalValue from './DigitalValue';
import {formatV3Amount as show} from './v3-format';
import {formatUtcTime} from './utc-time';
import V3ManagerVipPanel from './V3ManagerVipPanel';
import {sendManagerChange,type MemberChange} from './v3-manager-vip';
import {V3SupportTickets,V3Announcements} from './V3Community';
import {portfolioSupport} from './v3-support';
import {readReferralInvite,reviewReferralForDeposit} from './referral-invite';
import {parseV3Amount as amount,v3WithdrawalFee,type V3WithdrawalKind} from './v3-withdrawal-form';
import './v2-dashboard.css';
import './v2-classic-shell.css';
import './v2-classic-refinement.css';
import './v2-mobile-dock.css';
import './v2-responsive-complete.css';
import './v2-premium-experience.css';
import './v2-signature-dashboard.css';
import './v3-dashboard.css';
import './v1-v3-dashboard.css';
import './v3-account-and-team.css';
import './v3-glass.css';
import './v3-support.css';

type Tab='overview'|'positions'|'team'|'history'|'profile'|'withdrawals'|'tickets'|'announcements'|'admin';
type AdminSection='settlements'|'members'|'tickets'|'announcements';
const menus=[
 {id:'overview' as Tab,label:'Overview',Icon:Home},
 {id:'positions' as Tab,label:'My positions',Icon:Layers},
 {id:'team' as Tab,label:'Referral network',Icon:Users},
 {id:'withdrawals' as Tab,label:'Withdrawal requests',Icon:Coins},
 {id:'history' as Tab,label:'History',Icon:History},
 {id:'profile' as Tab,label:'Profile',Icon:UserRound},
 {id:'tickets' as Tab,label:'Support tickets',Icon:LifeBuoy},
 {id:'announcements' as Tab,label:'Announcements',Icon:Bell},
 {id:'admin' as Tab,label:'Admin panel',Icon:Settings2}
];
const dock=[{id:'overview' as Tab,label:'Home',Icon:Home},{id:'positions' as Tab,label:'Positions',Icon:Layers},
 {id:'team' as Tab,label:'Team',Icon:Users},{id:'history' as Tab,label:'History',Icon:History},
 {id:'profile' as Tab,label:'Profile',Icon:UserRound}];
const short=(s:string)=>s.slice(0,9)+'…'+s.slice(-5);
const kinds=['Profit','Principal','Referral','Network milestone','Combined withdrawal'] as const;
const statuses=['Requested','Manager approved','Cash escrowed','Paid','Rejected','Cancelled'] as const;
export default function V3Dashboard(){
 const [tab,setTab]=useState<Tab>(()=>typeof window==='undefined'?'overview':linkedMemberTab(window.location.hash)??'overview');
 const [menuOpen,setMenuOpen]=useState(false),[walletOpen,setWalletOpen]=useState(false);
 useEffect(()=>{
  const followLink=()=>{setTab(linkedMemberTab(window.location.hash)??'overview');setMenuOpen(false);};
  window.addEventListener('hashchange',followLink);
  return()=>window.removeEventListener('hashchange',followLink);
 },[]);
 const [walletSession,setWalletSession]=useState<{
  wallet:string;chain:number|null;provider:ReturnType<typeof getWalletProvider>;version:number;error?:string
 }>({wallet:'',chain:null,provider:null,version:0});
 const {wallet,chain}=walletSession;
 const [connecting,setConnecting]=useState(false),[loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[readError,setReadError]=useState(''),[notice,setNotice]=useState('');
 const [txHash,setTxHash]=useState(''),[view,setView]=useState<V3Snapshot|null>(null);
 const [transactionProgress,setTransactionProgress]=useState<V3TransactionProgress|null>(null);
 const [reviewRequired,setReviewRequired]=useState(false);
 const [reviewDetail,setReviewDetail]=useState<{message:string;hash?:string}|null>(null);
 const reviewRequiredRef=useRef(false),inFlight=useRef(false);
 const {review,request:openReview,finish:finishReview}=useV3TransactionReview();
 const walletVersion=useRef(0);
 const [walletDiagnostic,setWalletDiagnostic]=useState<V3WalletDiagnostic|null>(null),[diagnosing,setDiagnosing]=useState(false);
 const diagnosticVersion=useRef(0);
 const [value,setValue]=useState(''),[selectedPosition,setSelectedPosition]=useState('0');
 const [withdrawalAmount,setWithdrawalAmount]=useState('');
 const [accountTarget,setAccountTarget]=useState<'withdraw'|'reinvest'|null>(null);
 const [referrer,setReferrer]=useState(()=>{
  const invite=readReferralInvite(typeof window==='undefined'?'':window.location.search);
  return invite.status==='valid'?invite.address:'';
 });
 const [requestKind,setRequestKind]=useState<V3WithdrawalKind>('profit');
 const [queueVersion,setQueueVersion]=useState(0);
 const [branchPage,setBranchPage]=useState(0),[groupPage,setGroupPage]=useState(0);
 const [unifiedPageStart,setUnifiedPageStart]=useState(0);
 const revision=useRef(0);
 const polling=useRef(false),confirmedBlock=useRef(0);
 const menuTrigger=useRef<HTMLButtonElement>(null);
 const [smallScreen,setSmallScreen]=useState(()=>typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(max-width: 960px)').matches);
 const config=v3ReleaseConfig;
 const [adminSection,setAdminSection]=useState<AdminSection>('settlements');
 const support=useMemo(()=>config?.unified?.portfolio?portfolioSupport(config.address,wallet,{token:''}):null,
  [config,wallet,walletSession.version]);
 const communityTab=tab==='tickets'||tab==='announcements';
 const independentTab=Boolean(config?.unified?.portfolio&&(communityTab||tab==='history'));
 const supportKey=[walletSession.version,config?.address,tab].join('/');
 useEffect(()=>{setAdminSection('settlements');},[walletSession.version,config?.address]);
 const reviewScope:V3ReviewScope|null=wallet&&chain===97&&config?{chainId:97,contract:config.address,wallet}:null;
 const reviewKey=reviewScope?v3ReviewKey(reviewScope):null;
 const currentReviewKey=useRef<string|null>(null);currentReviewKey.current=reviewKey;
 const singleCapital=config?.unified?.singleCapital===true;
 const tabLabel=(id:Tab,label:string)=>singleCapital&&id==='positions'?'Investment account':label;
 const activeTabLabel=tabLabel(tab,menus.find(item=>item.id===tab)?.label??'');
 const unifiedEnabled=unifiedWalletEnabled(config,typeof window==='undefined'?'':window.location.pathname);
 const unifiedReadOnly=Boolean(config?.unified)&&!unifiedEnabled;
 const operatorAccess=Boolean(view?.canManage||(config?.unified&&view?.canFund));
 useEffect(()=>{setUnifiedPageStart(0);setWithdrawalAmount('');setRequestKind('profit');},[wallet,chain,config?.address]);
 const actionError=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(error)actionError.current?.scrollIntoView({block:'center'});},[error]);
 const invalidInvite=typeof window!=='undefined'&&readReferralInvite(window.location.search).status==='invalid';

 useEffect(()=>{
  const restore=()=>{
   const pending=reviewScope?readV3PendingReview(reviewScope):null;
   reviewRequiredRef.current=Boolean(pending);setReviewRequired(Boolean(pending));
   setReviewDetail(pending?{message:V3_PENDING_REVIEW_MESSAGE,hash:pending.hash}:null);
  };
  restore();setTransactionProgress(null);
  const changed=(event:StorageEvent)=>{if(event.key===reviewKey||event.key===null)restore();};
  window.addEventListener('storage',changed);
  return()=>window.removeEventListener('storage',changed);
 },[reviewKey]);

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
  let alive=true,sequence=0;
  let selection:{wallet:string;chain:number|null;provider:ReturnType<typeof getWalletProvider>;error?:string}|null=null;
  const applySelection=(next:NonNullable<typeof selection>)=>{
   if(selection&&selection.provider===next.provider&&selection.chain===next.chain&&selection.wallet===next.wallet&&selection.error===next.error)return;
   selection=next;confirmedBlock.current=0;
   const version=++walletVersion.current;
   finishReview(false);
   diagnosticVersion.current++;setWalletDiagnostic(null);setDiagnosing(false);
   revision.current++;setView(null);setReadError('');setError('');setNotice('');setTxHash('');
   setBranchPage(0);setGroupPage(0);setLoading(Boolean(next.wallet));
   setWalletSession({...next,version});
  };
  const sync=async()=>{
   const id=++sequence,p=getWalletProvider();
   const disconnected={wallet:'',chain:null,provider:p};
   if(!p||selection?.provider!==p)applySelection(disconnected);
   if(!p)return;
   try{
    const {accounts,chainId}=await readWalletSelection(p);
    if(alive&&id===sequence){
     const account=Array.isArray(accounts)&&typeof accounts[0]==='string'?getAddress(accounts[0]):'';
     applySelection({wallet:account,chain:Number(chainId),provider:p});
    }
   }catch{
    if(alive&&id===sequence)applySelection({...disconnected,
     error:'Unable to read the wallet account or network. Reconnect your wallet and try again.'});
   }
  };
  const resume=()=>{if(document.visibilityState==='visible')void wallets.restore();};
  const stop=wallets.subscribe(()=>{void sync();});void sync();
  resume();
  // Mobile in-app browsers may inject their provider after the first render.
  const delayed=window.setTimeout(resume,1000);
  window.addEventListener('ethereum#initialized',resume);
  document.addEventListener('visibilitychange',resume);
  return()=>{
   alive=false;walletVersion.current++;diagnosticVersion.current++;stop();
   window.clearTimeout(delayed);window.removeEventListener('ethereum#initialized',resume);
   document.removeEventListener('visibilitychange',resume);
  };
 },[finishReview]);
 const withdrawalCoverage=tab==='withdrawals'||(tab==='positions'&&singleCapital&&(requestKind==='profit'||requestKind==='principal'));
 useEffect(()=>{
  if(tab!=='positions'||!accountTarget||view?.wallet.toLowerCase()!==wallet.toLowerCase())return;
  const heading=document.getElementById(accountTarget==='withdraw'?'account-withdraw-heading':'account-earnings-title');
  if(heading){heading.focus();heading.scrollIntoView({block:'start'});setAccountTarget(null);}
 },[tab,accountTarget,view,wallet]);
 const refresh=useCallback(async(background=false)=>{
  const provider=walletSession.provider;
  if(walletSession.version!==walletVersion.current||provider!==getWalletProvider())return;
  const id=++revision.current;
  if(!provider||!wallet||chain!==97||!config){setView(null);setReadError(walletSession.error??'');setLoading(false);return;}
  if(tab==='history'&&config.unified?.portfolio){setLoading(false);setReadError('');return;}
  if(!background)setLoading(true);
  try{
   const result=await readV3Snapshot(provider,wallet,config,tab==='team'?{branches:branchPage,groups:groupPage}:null,unifiedPageStart,withdrawalCoverage,confirmedBlock.current);
   if(id===revision.current&&getWalletProvider()===provider){setView(result);setReadError('');}
  }catch(e){
   if(id===revision.current){
    if(!background)setView(null);
    setReadError(background?'Refresh unavailable. Values shown are from the last verified block.':'Unable to load verified account data. Retry or use the wallet connection check.');
   }
  }finally{if(id===revision.current)setLoading(false);}
 },[walletSession,wallet,chain,config,tab,branchPage,groupPage,unifiedPageStart,withdrawalCoverage]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{
  if(loading||!config||!wallet||chain!==97||independentTab)return;
  const tick=()=>{
   if(document.visibilityState!=='visible'||busy||polling.current)return;
   polling.current=true;
   void refresh(true).finally(()=>{polling.current=false;});
  };
  const timer=setInterval(tick,20000);
  document.addEventListener('visibilitychange',tick);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);};
 },[wallet,chain,busy,loading,refresh,config,tab,independentTab]);
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
  finally{setView(null);setConnecting(false);}
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
 function showPendingReview(scope:V3ReviewScope|null,detail:{message:string;hash?:string}){
  if(!scope||v3ReviewKey(scope)!==currentReviewKey.current)return;
  reviewRequiredRef.current=true;setReviewRequired(true);setReviewDetail(detail);
 }
 function pendingReviewGate(){
  const pending=reviewScope?readV3PendingReview(reviewScope):null;
  if(pending)showPendingReview(reviewScope,{message:V3_PENDING_REVIEW_MESSAGE,hash:pending.hash});
  return Boolean(pending)||reviewRequiredRef.current;
 }
 function acknowledgeReview(){
  if(reviewScope)clearV3PendingReview(reviewScope);
  reviewRequiredRef.current=false;setReviewRequired(false);setReviewDetail(null);setTransactionProgress(null);setError('');
 }
 function chosenReferrer(){
  const input=referrer.trim();
  if(!input||input.toLowerCase()===ZeroAddress.toLowerCase())return ZeroAddress;
  return reviewReferralForDeposit(input,window.location.origin,wallet)||ZeroAddress;
 }
 async function confirmAction(title:string,description:string,target?:string){
  if(!config)return false;
  if(pendingReviewGate()){setError('Check your wallet transaction history before trying again.');return false;}
  if(!config.unified)return window.confirm('BNB TESTNET ONLY\n\n'+description+'\nV3 contract: '+config.address);
  const provider=getWalletProvider(),version=walletVersion.current;
  if(!provider||provider!==walletSession.provider||version!==walletSession.version||chain!==97||!wallet||unifiedReadOnly)return false;
  if(!await openReview({title,description,wallet,contract:target??config.address}))return false;
  if(walletVersion.current!==version||provider!==getWalletProvider()){
   setError('The wallet connection changed. Review the transaction again.');
   return false;
  }
  return !inFlight.current&&!pendingReviewGate();
 }
 async function perform(action:V3Action|UnifiedWithdrawal|MemberChange,description:string,reviewedRequest?:V3Withdrawal){
  if(busy||inFlight.current)return;
  if(!wallet){setError('Connect your wallet before continuing.');return;}
  if(!config){setError('The verified V3 testnet contract is unavailable.');return;}
  if(unifiedReadOnly){setError('The unified testnet preview is read-only.');return;}
  if(chain!==97){setError('Switch your wallet to BNB Testnet before continuing.');return;}
  if(!view){setError('The verified account is unavailable. Refresh or use the wallet connection check.');return;}
  const memberChange=action.kind==='setVipKyc'||action.kind==='setSuspended';
  if(memberChange&&(!view.canManage||!config.unified?.portfolio)){setError('This action requires a verified portfolio manager.');return;}
  if(config.unified&&action.kind!=='register'&&!memberChange&&!isUnifiedWithdrawal(action)&&!isUnifiedNetworkAction(action)){setError('This action is unavailable on the unified test network.');return;}
  if(!config.unified&&(action.kind==='fundWithdrawal'||action.kind==='cancelWithdrawal'||action.kind==='fundPlanReserve'))return;
  const trackedAction=Boolean(config.unified)||action.kind==='register'||action.kind==='createRewardGroup'||action.kind==='addRewardBranches';
  if(trackedAction&&pendingReviewGate()){setError('Check your wallet transaction history before trying again.');return;}
  const target=config.unified&&!memberChange&&isUnifiedNetworkAction(action)?networkActionTarget(config,action):config.address;
  const parts=reviewedRequest?.allocation;
  const settleDetails=reviewedRequest?'\nBeneficiary '+reviewedRequest.beneficiary+
   (parts?'\nPersonal '+formatUnits(parts.personal,18)+' · Referral '+formatUnits(parts.referral,18)+' · Network '+formatUnits(parts.network,18)+' · Principal '+formatUnits(parts.principal,18):'')+
   '\nGross '+formatUnits(reviewedRequest.gross,18)+' · Deductions '+formatUnits(reviewedRequest.fee,18)+' · Net '+formatUnits(reviewedRequest.gross-reviewedRequest.fee,18)+' test USDT.':'';
  if(!await confirmAction('Review testnet transaction',description+settleDetails+'\nUSDT on BNB Testnet is a test token with no monetary value. Confirm the separate blockchain transaction in your wallet.',target))return;
  const p=getWalletProvider();if(!p){setError('Wallet disconnected.');return;}
  inFlight.current=true;setBusy(true);setError('');setTransactionProgress(null);setNotice(action.kind==='register'?'Checking registration…':'Confirm the V3 TESTNET transaction in your connected wallet…');setTxHash('');
  const tracker=new V3PersistentTransactionTracker(reviewScope!);
  let progressHash:string|undefined;
  const report=(detail:V3TransactionProgress)=>{tracker.record(detail);if(detail.step==='wallet_request')progressHash=undefined;if(detail.hash)progressHash=detail.hash;setTransactionProgress(detail);};
  try{
   let hash:string;
   if(memberChange){
    hash=await sendManagerChange(p,wallet,action,config,unifiedEnabled,report);
   }else if(action.kind==='register'){
    hash=await runV3Registration({provider:p,wallet,referrer:action.referrer,config,unifiedEnabled,onProgress:report});
   }else if(config.unified&&isUnifiedNetworkAction(action)){
    hash=await sendUnifiedNetworkAction(p,wallet,action,config,{enabled:unifiedEnabled,onProgress:report});
   }else if(config.unified&&isUnifiedWithdrawal(action)){
    hash=await sendUnifiedWithdrawal(p,wallet,action,config,{enabled:unifiedEnabled,onProgress:report,reviewedRequest});
   }else if(action.kind!=='fundWithdrawal'&&action.kind!=='cancelWithdrawal'&&action.kind!=='fundPlanReserve'&&action.kind!=='requestAccountWithdrawal'){
    hash=await sendV3Action(p,wallet,action,config,trackedAction?report:undefined);
   }else throw Error('Select the verified unified withdrawal profile.');
   tracker.complete();setTxHash(hash);
   if(['requestProfit','requestReferral','requestNetworkReward','requestPrincipal','requestAccountWithdrawal'].includes(action.kind)){
    setWithdrawalAmount('');setValue('');setNotice('Withdrawal requested. Manager approval and funding are pending.');
   }else setNotice('V3 TESTNET action confirmed on-chain.');
   if(operatorAccess)setQueueVersion(n=>n+1);await refresh();
  }catch(e){const message=e instanceof Error?e.message:'V3 action not confirmed.';setNotice('');setError(message);
   if(trackedAction&&tracker.needsReview(message)){showPendingReview(reviewScope,{message,hash:progressHash});}}
  finally{inFlight.current=false;setBusy(false);}
 }
 async function deposit(){
  if(busy||inFlight.current)return;
  if(!wallet){setError('Connect your wallet before continuing.');return;}
  if(!config){setError('The verified V3 testnet contract is unavailable.');return;}
  if(unifiedReadOnly){setError('The unified testnet preview is read-only.');return;}
  if(chain!==97){setError('Switch your wallet to BNB Testnet before continuing.');return;}
  if(!view){setError('The verified account is unavailable. Refresh or use the wallet connection check.');return;}
  if(pendingReviewGate()){setError('Check your wallet transaction history before trying again.');return;}
  let n:bigint;
  try{n=amount(value);}catch(e){setError((e as Error).message);return;}
  if(n<10n*10n**18n){setError('The minimum deposit is 10 test USDT.');return;}
  if(view.suspended||view.paused){setError(view.paused?'Deposits are paused on this contract.':'This account is suspended.');return;}
  if(view.gasWei===0n){setError('This wallet needs tBNB on BNB Testnet (97) for transaction fees.');return;}
  if(n>view.walletTestTokenBalance){setError('Connected wallet lacks this amount of mock TUSDT.');return;}
  if(view.dailyPlan&&view.ledger.cash<view.ledger.principalLiability+view.ledger.profitLiability+n){
   setError('The plan reserve cannot cover this deposit. Ask the operator to fund the reserve.');return;
  }
  let parent:string;
  try{parent=view.registered?view.referrer:chosenReferrer();}
  catch(e){setError(e instanceof Error?e.message:'Invalid referral address.');return;}
  const needsApproval=view.allowance<n;
  if(!await confirmAction('Review test deposit','Deposit exactly '+formatUnits(n,18)+' test USDT.'+
   (needsApproval?'\nFirst authorize the exact test-token amount. Return here after approval to submit the separate deposit.':'\nThe verified allowance covers this amount. Continue to confirm the deposit.')+
   (needsApproval&&view.allowance>0n?'\nThe wallet will first reset the existing partial allowance to zero.':'')+
   '\nReferrer: '+(parent===ZeroAddress?'None':parent)+' (permanent after first registration).'+
   '\nYour test deposit routes 10% to each original fee wallet and 80% to the original operations wallet. Gross principal is recorded but is not held as vault cash.'+
   '\nThis test deposit locks principal for 90 days. Future payouts depend on approval and funding. Approve the token if needed and confirm the deposit?'))return;
  const p=getWalletProvider();if(!p){setError('Wallet disconnected. Reconnect before continuing.');return;}
  inFlight.current=true;setBusy(true);setError('');setTransactionProgress(null);setNotice('Checking the test deposit…');setTxHash('');
  const tracker=new V3PersistentTransactionTracker(reviewScope!);
  let progressHash:string|undefined;
  const report=(detail:V3TransactionProgress)=>{
   tracker.record(detail);
   if(currentReviewKey.current!==reviewKey)return;
   if(detail.step==='confirmed'&&detail.blockNumber)
    confirmedBlock.current=Math.max(confirmedBlock.current,detail.blockNumber);
   if(detail.step==='wallet_request')progressHash=undefined;if(detail.hash)progressHash=detail.hash;setTransactionProgress(detail);};
  try{
   const version=walletVersion.current;
   const reviewApprovedDeposit=async(hash:string)=>{
    if(getWalletProvider()!==p||walletVersion.current!==version)return false;
    setNotice('Token approval confirmed. Continue to the deposit.');
    const accepted=await openReview({title:'Confirm your deposit',confirmLabel:'Continue to deposit',wallet,contract:config.address,
     description:'Your wallet approved '+formatUnits(n,18)+' test USDT. Confirm the separate deposit of this amount on BNB Testnet. Cancelling here leaves the allowance available for later.'});
    return accepted&&getWalletProvider()===p&&walletVersion.current===version&&
     readV3PendingReview(reviewScope!)?.hash===hash;
   };
   const tx=await runV3Deposit({provider:p,wallet,amount:n,referrer:parent,config,
    unifiedEnabled,onProgress:report,reviewApprovedDeposit});
   tracker.complete();
   if(currentReviewKey.current!==reviewKey)return;
   setTxHash(tx);setNotice('USDT test-token deposit confirmed in V3.');setValue('');
   await refresh();
  }catch(e){
   if(e instanceof ApprovedDepositStopped){
    tracker.complete();
    if(currentReviewKey.current===reviewKey){setTxHash(e.approvalHash);setNotice(e.message);await refresh();}
   }else{
    const message=e instanceof Error?e.message:'V3 deposit not confirmed.';
    const needsReview=tracker.needsReview(message);
    if(currentReviewKey.current===reviewKey){
     setNotice('');setError(message);
     if(needsReview)showPendingReview(reviewScope,{message,hash:progressHash});
    }
   }
  }
  finally{inFlight.current=false;setBusy(false);}
 }
 function fundReserve(){
  if(!config?.unified?.dailyPlan||!view?.canFund)return;
  try{
   const gross=amount(value);
   void perform({kind:'fundPlanReserve',gross},'Provide '+formatUnits(gross,18)+' test USDT from this wallet as backing for the plan. This funding does not credit an investment account.');
  }catch(e){setError(e instanceof Error?e.message:'Enter a positive reserve amount.');}
 }
 async function fund(request:V3Withdrawal){
  const {id,gross,beneficiary}=request;
  if(!config||busy||!wallet||!view?.canFund)return;
  if(config.unified){
   await perform({kind:'fundWithdrawal',id,gross,beneficiary},'Fund approved request #'+(id+1)+' for '+beneficiary+' with exactly '+formatUnits(gross,18)+' USDT from this wallet? The tokens are escrowed until payout.',request);
   return;
  }
  if(!window.confirm('ONLY BNB TESTNET\nFund already-approved request #'+(id+1)+
   '\nBeneficiary: '+beneficiary+'\nExact mock tokens to escrow: '+formatUnits(gross,18)+
   '\nThis transfers actual USDT tokens from your funder wallet into the V3 vault. Continue?'))return;
  const p=getWalletProvider();if(!p)return;
  setBusy(true);setError('');setTxHash('');setNotice('Confirm exact mock token allowance and cash funding…');
  try{
   const tx=await sendV3FundWithdrawal(p,wallet,id,config);
   setTxHash(tx);setNotice('Exact withdrawal escrow funded on TESTNET; payout is a separate transaction.');
   setQueueVersion(n=>n+1);await refresh();
  }catch(e){setNotice('');setError(e instanceof Error?e.message:'Funding not confirmed. Inspect the chain before retrying.');}
  finally{setBusy(false);}
 }
 const claims=view?v3PrepareUserClaims(view.ledger):null;
 const due=view?.positions.filter(p=>(!config?.unified||!p.fromReinvestment)&&p.principal>0n&&view.asOf>=p.lastAccruedAt+V3_PERIOD_SECONDS).slice(0,20).map(p=>p.id)??[];
 async function checkInUnified(){
  if(busy||inFlight.current)return;
  if(unifiedReadOnly){setError('The unified testnet preview is read-only.');return;}
  if(!wallet||!config?.unified||chain!==97||!view){setError('Connect and verify your BNB Testnet account.');return;}
  if(pendingReviewGate()){setError('Check your wallet transaction history before trying again.');return;}
  if(!view.registered||view.suspended||view.paused){setError('This test account cannot check in.');return;}
  if(view.gasWei===0n){setError('This wallet needs tBNB on BNB Testnet (97) to sign its check-in.');return;}
  if(!await confirmAction('Review check-in','Record your account activity? This requires a wallet transaction and testnet gas. It does not credit or transfer profit.'))return;
  const p=getWalletProvider();if(!p){setError('Wallet disconnected.');return;}
  inFlight.current=true;setBusy(true);setError('');setNotice('Checking test account activity…');setTxHash('');setTransactionProgress(null);
  const tracker=new V3PersistentTransactionTracker(reviewScope!);let progressHash:string|undefined;
  const report=(detail:V3TransactionProgress)=>{
   tracker.record(detail);
   if(currentReviewKey.current===reviewKey&&detail.step==='confirmed'&&detail.blockNumber)
    confirmedBlock.current=Math.max(confirmedBlock.current,detail.blockNumber);
   if(detail.step==='wallet_request')progressHash=undefined;if(detail.hash)progressHash=detail.hash;setTransactionProgress(detail);};
  try{
   const result=await sendV3UnifiedCheckIn(p,wallet,config,{enabled:unifiedEnabled,onProgress:report});
   tracker.complete();setTxHash(result.hash);setNotice('Test check-in confirmed. Eligible claims require separate accrual.');await refresh();
  }catch(e){const message=e instanceof Error?e.message:'V3 check-in not confirmed.';setNotice('');setError(message);
   if(tracker.needsReview(message)){showPendingReview(reviewScope,{message,hash:progressHash});}}
  finally{inFlight.current=false;setBusy(false);}
 }
 const checkIn=()=>{
  if(config?.unified){void checkInUnified();return;}
  void perform(due.length?{kind:'checkInAndAccrue',positionIds:due}:{kind:'checkIn'},
   due.length?'Sign daily check-in and record '+due.length+' due reward position(s)?':'Sign daily eligibility check-in?');
 };
 const request=(kind:V3WithdrawalKind,input:string)=>{
  try{
   if(!view||view.wallet.toLowerCase()!==wallet.toLowerCase())throw Error('The connected wallet changed. Refresh the account before requesting a withdrawal.');
   const plan=planV3AccountWithdrawal(view,input,kind,Boolean(config?.unified));
   if(plan.source==='book'){
    void requestUnifiedPage(plan.kind,plan.page,plan.amount);return;
   }
   const a=plan.action;
   const fee=v3WithdrawalFee(a.amount,kind==='principal',view.manualReinvest);
   void perform(a,'Request '+kind+' withdrawal from your account. Gross: '+formatUnits(a.amount,18)+
    ' USDT; fee: '+formatUnits(fee,18)+' USDT; net: '+formatUnits(a.amount-fee,18)+
    ' USDT. Manager approval and actual funding required.');
  }catch(e){setError((e as Error).message);}
 };
 async function requestUnifiedPage(kind:'profit'|'principal',page:UnifiedPositionPage,n:bigint){
  if(busy||loading||inFlight.current)return;
  if(unifiedReadOnly){setError('The unified testnet preview is read-only.');return;}
  if(!wallet||!config?.unified||chain!==97||!view){setError('Connect and verify your unified BNB Testnet account.');return;}
  if(pendingReviewGate()){setError('Check your wallet transaction history before trying again.');return;}
  if(page.wallet.toLowerCase()!==wallet.toLowerCase()||page.block!==view.block||page.asOf!==view.asOf||
     page.limit!==unifiedWithdrawalWindow(singleCapital)){
   setError('The verified withdrawal records changed. Refresh before continuing.');return;
  }
  try{
   prepareUnifiedPageAction(page,{registered:view.registered,suspended:view.suspended,paused:view.paused,
    pendingWithdrawal:view.pendingWithdrawal,nextRequestAt:view.nextRequestAt,requestCap:view.ledger.requestCap},kind,n);
  }catch(e){setError(e instanceof Error?e.message:'Invalid withdrawal request.');return;}
  const fee=v3WithdrawalFee(n,kind==='principal',view.manualReinvest);
  if(!await confirmAction('Review withdrawal request','Request '+kind+' withdrawal from your account?'+
   '\nGross: '+formatUnits(n,18)+' USDT; fee: '+formatUnits(fee,18)+' USDT; net: '+formatUnits(n-fee,18)+
   ' USDT. Manager approval and actual test-token funding are required. The wallet must sign one transaction.'))return;
  const p=getWalletProvider();if(!p){setError('Wallet disconnected.');return;}
  inFlight.current=true;setBusy(true);setError('');setNotice('Checking the test withdrawal request…');setTxHash('');setTransactionProgress(null);
  const tracker=new V3PersistentTransactionTracker(reviewScope!);let progressHash:string|undefined;
  const report=(detail:V3TransactionProgress)=>{tracker.record(detail);if(detail.step==='wallet_request')progressHash=undefined;if(detail.hash)progressHash=detail.hash;setTransactionProgress(detail);};
  try{
   const result=await sendV3UnifiedPageWithdrawal(p,wallet,kind,page.positionId,page.start,n,config,
    {enabled:unifiedEnabled,onProgress:report});
   tracker.complete();setTxHash(result.hash);setNotice('Test withdrawal requested. Approval and funding are separate.');setValue('');setWithdrawalAmount('');await refresh();
  }catch(e){const message=e instanceof Error?e.message:'V3 withdrawal request not confirmed.';setNotice('');setError(message);
   if(tracker.needsReview(message)){showPendingReview(reviewScope,{message,hash:progressHash});}}
  finally{inFlight.current=false;setBusy(false);}
 }
 async function reinvestUnified(n:bigint){
  if(busy||loading||inFlight.current)return;
  if(unifiedReadOnly){setError('The unified testnet preview is read-only.');return;}
  if(!wallet||!config?.unified||chain!==97||!view||view.wallet.toLowerCase()!==wallet.toLowerCase()){setError('Connect and verify your BNB Testnet account.');return;}
  if(pendingReviewGate()){setError('Check your wallet transaction history before trying again.');return;}
  if(!view.registered||view.suspended||view.paused){setError('This test account cannot reinvest.');return;}
  let split:AccountEarnings|undefined;
  let description='Reinvest '+formatUnits(n,18)+' USDT of recorded position profit into the unified position?';
  if(config.unified.accountReinvest){
   try{split=allocateAccountEarnings(availableAccountEarnings(view),n);}
   catch(e){setError((e as Error).message);return;}
   description='Add '+formatUnits(n,18)+' test USDT to this account.\nPersonal profit: '+formatUnits(split.personal,18)+
    ' · Referral commission: '+formatUnits(split.referral,18)+' · Network rewards: '+formatUnits(split.network,18)+'.';
  }else if(n>view.positions.reduce((sum,position)=>sum+position.availableProfit,0n)){
   setError('The amount exceeds recorded position profit.');return;
  }
  if(!await confirmAction('Review reinvestment',description+'\nThe addition has a separate 90-day principal lock. Sign one testnet transaction in your wallet.'))return;
  const p=getWalletProvider();if(!p){setError('Wallet disconnected.');return;}
  inFlight.current=true;setBusy(true);setError('');setNotice('Checking the test reinvestment…');setTxHash('');setTransactionProgress(null);
  const tracker=new V3PersistentTransactionTracker(reviewScope!);let progressHash:string|undefined;
  const report=(detail:V3TransactionProgress)=>{
   tracker.record(detail);
   if(currentReviewKey.current!==reviewKey)return;
   if(detail.step==='confirmed'&&detail.blockNumber)confirmedBlock.current=Math.max(confirmedBlock.current,detail.blockNumber);
   if(detail.step==='wallet_request')progressHash=undefined;
   if(detail.hash)progressHash=detail.hash;
   setTransactionProgress(detail);
  };
  try{
   const result=await runUnifiedReinvestment({enabled:unifiedEnabled,provider:p,wallet,amount:n,config,onProgress:report,reviewed:split});
   tracker.complete();
   if(currentReviewKey.current===reviewKey){setTxHash(result.hash);setNotice('Test reinvestment confirmed on-chain.');setValue('');await refresh();}
   return true;
  }catch(e){
   const message=e instanceof Error?e.message:'V3 reinvestment not confirmed.';
   const needsReview=tracker.needsReview(message);
   if(currentReviewKey.current===reviewKey){
    setNotice('');setError(message);
    if(needsReview)showPendingReview(reviewScope,{message,hash:progressHash});
   }
  }
  finally{inFlight.current=false;setBusy(false);}
 }
 const reinvest=()=>{
  try{
   if(config?.unified){void reinvestUnified(amount(value));return;}
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
    <small>{formatUtcTime(r.requestedAt)} · {admin?<a className="gv3-queue-address" href={V3_EXPLORER+'/address/'+r.beneficiary} target="_blank" rel="noreferrer">{r.beneficiary}</a>:short(r.beneficiary)}</small>
    {admin&&<V3SettlementBreakdown request={r}/>}</div>
   <div><b><DigitalValue value={show(r.gross)} unit="USDT"/></b><small>Net {show(r.gross-r.fee)} · Fee {show(r.fee)}</small></div>
   <div><span className="gv3-request-status">{statuses[r.status]??'Unverified'}</span>
    {config?.unified&&!admin&&r.beneficiary.toLowerCase()===wallet.toLowerCase()&&<>
     {r.status===0&&<small>Waiting for manager approval.</small>}
     {r.status===1&&<small>Waiting for {formatUnits(r.gross,18)} test USDT to be reserved for this request.</small>}
     {(r.status===0||r.status===1)&&<button disabled={busy||reviewRequired||unifiedReadOnly||!view||view.asOf<r.requestedAt+72*3600}
      onClick={()=>void perform({kind:'cancelWithdrawal',id:r.id},'Cancel this unescrowed request and release the reserved test claim?')}>Cancel after 72 hours</button>}
     {r.status===2&&<button disabled={busy||reviewRequired||unifiedReadOnly} onClick={()=>void perform({kind:'payWithdrawal',id:r.id},'Pay the funded test withdrawal to your wallet?')}>Collect funded USDT</button>}
    </>}
    {admin&&<div className="gv3-queue-actions">
     {view?.canManage&&r.status===0&&<><button disabled={busy||reviewRequired||unifiedReadOnly} onClick={()=>void perform({kind:'approveWithdrawal',id:r.id},'Approve request #'+(r.id+1)+'? Funding and payment follow approval.',r)}>Approve</button>
      <button disabled={busy||reviewRequired||unifiedReadOnly} onClick={()=>void perform({kind:'rejectWithdrawal',id:r.id},'Reject unescrowed request #'+(r.id+1)+'?',r)}>Reject</button></>}
     {r.status===1&&<>{view?.canManage&&<button disabled={busy||reviewRequired||unifiedReadOnly} onClick={()=>void perform({kind:'reserveExistingCash',id:r.id},'Reserve '+formatUnits(r.gross,18)+' USDT from already-free V3 cash for request #'+(r.id+1)+'? '+(r.kind===1?'This may reduce cash available for other principal claims.':'The contract checks outstanding principal before reserving profit.'),r)}>Use existing cash</button>}
      {config?.unified&&view?.canManage&&<button disabled={busy||reviewRequired||unifiedReadOnly} onClick={()=>void perform({kind:'rejectWithdrawal',id:r.id},'Reject this approved request and release its reserved test claim?',r)}>Reject before funding</button>}
      {view?.canFund&&<button disabled={busy||reviewRequired||unifiedReadOnly} onClick={()=>void fund(r)}>Fund exact request</button>}</>}
     {r.status===2&&<button disabled={busy||reviewRequired||unifiedReadOnly} onClick={()=>void perform({kind:'payWithdrawal',id:r.id},'Pay the immutable beneficiary '+r.beneficiary+' exactly '+formatUnits(r.gross-r.fee,18)+' USDT?',r)}>Pay funded request</button>}
    </div>}
   </div>
  </article>;
 const navigate=(to:Tab,nextValue='',target:'withdraw'|'reinvest'|null=null)=>{
  const accountWithdrawal=singleCapital&&to==='withdrawals';
  const deepLink=linkedMemberTab('#dashboard/'+to);
  if(deepLink||linkedMemberTab(window.location.hash)){
   const hash=deepLink?'#dashboard/'+deepLink:'#dashboard';
   window.history.replaceState(window.history.state,'',hash);
  }
  setTab(accountWithdrawal?'positions':to);
  setAccountTarget(accountWithdrawal?'withdraw':target);
  setMenuOpen(false);setError('');setValue(accountWithdrawal?'':nextValue);
  if(accountWithdrawal)setWithdrawalAmount(nextValue);
 };
 return <div className="gv2 shell gv2-classic gv3-workspace" dir="ltr">
  <aside id="v3-dashboard-menu" className={'sidebar gv2-sidebar '+(menuOpen?'open':'')} aria-label="Global V3 testnet navigation" inert={smallScreen&&!menuOpen}>
   <button className="gv2-sidebar-close" onClick={()=>{setMenuOpen(false);menuTrigger.current?.focus();}} aria-label="Close navigation"><X size={18}/></button>
   <a className="brand" href="#" onClick={()=>setMenuOpen(false)}><span className="brand-icon" aria-hidden="true"><Globe2 size={25}/></span>
    <div><strong>GLOBAL</strong><small>ARBITRAGE &amp; DROPSHIPPING</small></div></a>
   <div className="sidebar-caption">YOUR WORKSPACE</div>
   <nav>{menus.filter(x=>(x.id!=='admin'||operatorAccess)&&(!['tickets','announcements'].includes(x.id)||support)).map(({id,label,Icon})=>
    <button key={id} onClick={()=>navigate(id)} className={tab===id?'active':''} aria-current={tab===id?'page':undefined}><Icon size={19}/><span>{tabLabel(id,label)}</span>{tab===id&&<ChevronRight size={15}/>}</button>)}
    <button type="button" onClick={()=>{window.location.hash='#marketplace';}}><Coins size={19}/><span>Products &amp; sales</span></button></nav>
   <div className="gv2-sidebar-bottom"><div className="gv1-sidebar-network"><span>◆</span><div><strong>BNB Testnet</strong><small>Test environment</small></div></div>
    <div className="gv1-sidebar-note"><ShieldCheck size={17}/><span>Account activity<br/><small>Available in your history</small></span></div>
    <a href="#">Back to website</a></div>
  </aside>
  {menuOpen&&<button className="gv2-scrim" onClick={()=>{setMenuOpen(false);menuTrigger.current?.focus();}} aria-label="Close navigation"/>}
  <div className="workspace gv2-workspace">
   <header className="topbar gv2-classic-topbar">
     <div className="breadcrumb"><button ref={menuTrigger} className="icon-button mobile-menu" aria-label="Open menu" aria-controls="v3-dashboard-menu" aria-expanded={menuOpen} onClick={()=>setMenuOpen(v=>!v)}><Menu size={19}/></button><span>Dashboard</span><ChevronRight size={14}/><strong>{activeTabLabel}</strong></div>
    <div className="top-actions"><span className="network-label">V3 · TESTNET</span>
     <ThemeSwitch inline/>
     <V3WalletControl address={wallet} busy={connecting||busy} onConnect={openWalletPicker} onDisconnect={()=>void disconnect()}/></div>
   </header>
   <main className="gv2-wrap">
    <div className="gv2-heading"><div><span className="gv2-page-label">{V3_HOURLY_TEST?'ONE-HOUR BNB TESTNET CONTRACT':'BNB TESTNET'}</span>
     <h1>{tab==='overview'?'Account overview':activeTabLabel}</h1>
     <p>Test tokens only. No monetary value.</p>
     {unifiedReadOnly&&<p role="status"><strong>Read-only preview.</strong> Wallet transactions are disabled.</p>}
    </div>{wallet&&config&&!communityTab&&<button onClick={()=>void refresh()} disabled={loading||busy}><RefreshCw size={17}/> Refresh</button>}</div>
    {!config&&<section className="gv2-panel gv3-not-ready" role="status"><ShieldAlert size={26}/>
     <h2>V3 integration is prepared, but activation is locked</h2>
     <p>The testnet contract must be deployed and independently verified before this dashboard can show account data.</p>
     <a href="#">Return to Global landing <ArrowUpRight size={16}/></a>
    </section>}
    {!config&&tab==='overview'&&<V3TradingDesk/>}
    {config&&<>
    {tab==='admin'&&view&&!operatorAccess&&<p className="gv3-notice" role="status">This wallet has no manager or funding role for this contract.</p>}
    {error&&<p ref={actionError} className="gv2-error" role="alert">{error}</p>}
    {readError&&!independentTab&&<p className="gv2-error" role="alert">{readError}</p>}
    {notice&&<p className="gv2-message" role="status">{notice} {txHash&&<a href={V3_EXPLORER+'/tx/'+txHash} target="_blank" rel="noreferrer">Verified TX <ExternalLink size={14}/></a>}</p>}
    {config.unified&&notice&&txHash&&view?.registered&&!view.eligible&&!view.suspended&&!view.paused&&transactionProgress?.action==='test_deposit'&&transactionProgress.step==='confirmed'&&
     <button type="button" className="gv2-primary" disabled={busy||reviewRequired||unifiedReadOnly||view.asOf<view.lastCheckIn+3600} onClick={checkIn}>Activate account</button>}
    {transactionProgress&&<p className="gv2-message" role="status">{busy?'Current step: ':'Last step: '}{v3TransactionProgressText(transactionProgress)}{' '}
     {transactionProgress.hash&&<a href={V3_EXPLORER+'/tx/'+transactionProgress.hash} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14}/></a>}</p>}
    {reviewRequired&&<section className="gv3-notice" role="alert"><ShieldAlert size={18}/><div>
     <strong>Check wallet activity before retrying.</strong><p>A request may have been sent. The reminder is saved for this wallet and contract when browser storage is available. Check the transaction before trying again.</p>
     {reviewDetail&&<p>{reviewDetail.message} {reviewDetail.hash&&<a href={V3_EXPLORER+'/tx/'+reviewDetail.hash} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14}/></a>}</p>}
     <button type="button" disabled={busy} onClick={acknowledgeReview}>I checked wallet history</button></div></section>}
    {!wallet&&tab!=='overview'&&!communityTab&&<section className="gv2-panel gv3-connect"><Wallet size={31}/><h2>Connect your BNB Testnet wallet</h2>
     <p>No balance is shown before the V3 code hash and selected wallet are independently verified.</p>
     <div className="gv2-buttons"><button className="gv2-primary" disabled={connecting} onClick={()=>void connect('injected')}>Browser wallet</button>
      <button disabled={connecting} onClick={()=>void connect('walletconnect')}>WalletConnect QR</button></div></section>}
    {wallet&&chain!==97&&(!independentTab||tab==='tickets')&&<section className="gv2-panel"><h3>Switch to BNB Testnet (97)</h3>
     <p>Do not use BNB Mainnet or transfer real Tether to this prototype.</p>
     <button className="gv2-primary" onClick={()=>void switchWalletNetwork().catch(e=>setError(String(e)))}>Switch network</button></section>}
    {wallet&&chain===97&&loading&&!view&&!independentTab&&<section className="gv2-panel">Verifying pinned V3 runtime and account balances…</section>}
    {wallet&&chain===97&&!loading&&!view&&!independentTab&&<section className="gv2-panel"><h3>Verified V3 account unavailable</h3>
     <button onClick={()=>void refresh()}>Retry blockchain verification</button></section>}
    {tab==='profile'&&wallet&&<section className="gv2-panel"><h3>Wallet connection check</h3>
     <p>Compare the selected wallet and its BNB Testnet balance with an independent network read. No transaction or signature is requested.</p>
     <button type="button" disabled={diagnosing||busy} onClick={()=>void checkWallet()}>{diagnosing?'Checking wallet…':'Check wallet connection'}</button>
     {walletDiagnostic&&<div role="status"><p>Wallet: {walletDiagnostic.wallet.status} · Network: {walletDiagnostic.wallet.chainId??'unavailable'} · Selected account: {walletDiagnostic.wallet.accountMatches===null?'unavailable':walletDiagnostic.wallet.accountMatches?'matches':'does not match'}</p>
      <p>Wallet RPC balance: {walletDiagnostic.wallet.testBNB===null?'unavailable':walletDiagnostic.wallet.testBNB+' tBNB'}</p>
      <p>Independent RPC: {walletDiagnostic.independent.status} · Block: {walletDiagnostic.independent.block??'unavailable'} · Balance: {walletDiagnostic.independent.testBNB===null?'unavailable':walletDiagnostic.independent.testBNB+' tBNB'}</p>
      <p>Balances can differ across blocks or RPCs; this check does not prove a wallet transaction will succeed.</p></div>}
    </section>}
    {tab==='overview'&&support&&<nav className="gv3-community-links" aria-label="Member services">
     <button onClick={()=>navigate('tickets')}><LifeBuoy size={19}/> Support tickets <ChevronRight size={16}/></button>
     <button onClick={()=>navigate('announcements')}><Bell size={19}/> Announcements <ChevronRight size={16}/></button>
    </nav>}
    {tab==='overview'&&view&&<div className="gv3-sync-line" aria-live="off"><span className="gv3-live-status">{loading?'CHECKING BLOCKCHAIN':'AUTO REFRESH · 20 SEC'}</span>
     <span>Verified block {view.block.toLocaleString('en-US')} · {formatUtcTime(view.asOf)}</span></div>}
    {tab==='overview'&&<V3ClassicOverview view={view} connected={Boolean(wallet)} busy={busy||reviewRequired} readOnly={unifiedReadOnly} unifiedRelease={Boolean(config.unified)} loading={loading} connecting={connecting}
     value={value} onValue={setValue} referrer={referrer} onReferrer={setReferrer} invalidInvite={invalidInvite}
     selectedPosition={selectedPosition} onPosition={setSelectedPosition}
     onDeposit={()=>void deposit()} onWithdraw={()=>{setRequestKind('profit');navigate('withdrawals',value);}} onReinvest={reinvest} onAccountWithdraw={singleCapital?()=>{setRequestKind('profit');navigate('withdrawals');}:undefined} onAccountReinvest={config?.unified?.accountReinvest?()=>navigate('positions','','reinvest'):undefined}
     onNetwork={()=>navigate('team')} onConnect={openWalletPicker} onWalletConnect={()=>void connect('walletconnect')}>
     <V3TradingDesk view={view}/>
    </V3ClassicOverview>}
    {wallet&&tab==='history'&&(config.unified?.portfolio||view)&&<div className="gv2-content">
     <V3HistoryPanel key={config.address+':'+wallet} wallet={wallet} config={config}/>
     <V3WithdrawalHistory key={'withdraw-'+config.address+':'+wallet} wallet={wallet} config={config}/>
    </div>}
    {communityTab&&!support&&<p role="status">Support is available on the portfolio dashboard.</p>}
    {tab==='announcements'&&support&&<V3Announcements key={supportKey} client={support} admin={false}/>}
    {tab==='tickets'&&support&&(!wallet||chain===97)&&<V3SupportTickets key={supportKey} client={support} wallet={wallet} admin={false} onConnect={openWalletPicker}/>}
    {view&&tab!=='history'&&!communityTab&&<div className="gv2-content">
     {tab==='overview'&&<>
      <V3CycleCard view={view} busy={busy||reviewRequired||unifiedReadOnly} onCheckIn={checkIn} onPositions={()=>navigate('positions')} unifiedEnabled={unifiedEnabled}/>
      {config.unified&&<V3UnifiedActivity view={view} busy={busy||reviewRequired} readOnly={unifiedReadOnly} onCheckIn={checkIn}/>}
      {view.wallet.toLowerCase()===wallet.toLowerCase()&&<V3ClaimsReadout key={(config?.address??'').toLowerCase()+':'+view.wallet.toLowerCase()} showRequestLimit={!view.portfolio} verifiedLedger={view.ledger} manualReinvest={view.manualReinvest}/>}
      <div className="gv2-summary">
       <div className="gv2-metric"><small>Daily test-rate tier</small><strong><DigitalValue value={String(view.dailyRateBps/100)} unit="%"/></strong><span>Conditional accounting rule</span></div>
       <div className="gv2-metric"><small>Personal accrued claims</small><strong><DigitalValue value={claims?show(claims.outstandingPersonal):'—'} unit="USDT"/></strong><span>{view.manualReinvest?'Based on recorded principal':'Includes personal compound earnings'}</span></div>
       <div className="gv2-metric"><small>Vault test-token cash</small><strong><DigitalValue value={show(view.ledger.cash)} unit="USDT"/></strong><span>Includes cash reserved for requests</span></div>
       <div className="gv2-metric"><small>Unfunded total obligations</small><strong><DigitalValue value={claims?show(claims.overallUnfundedLiability):'—'} unit="USDT"/></strong><span>Not guaranteed to be paid</span></div>
      </div>
      <div className="gv3-cycle-note"><CheckCircle2 size={16}/> Last confirmed check-in: {formatUtcTime(view.lastCheckIn)}.
       {!config.unified&&` ${due.length} positions due at the last verified block.`} Automatic posting needs an eligible check-in and a funded testnet keeper.</div>
     </>}
     {tab==='positions'&&<>
      {singleCapital&&view.wallet.toLowerCase()===wallet.toLowerCase()&&<>
       {view.portfolio?<V3PortfolioWithdrawal key={config.address+':'+wallet} view={view} value={withdrawalAmount}
        onValue={setWithdrawalAmount} onPage={setUnifiedPageStart} busy={busy||loading||reviewRequired} readOnly={unifiedReadOnly}
        onSubmit={(action,description)=>void perform(action,description)}/>:<V3EarningsWithdrawal view={view} unified={true} kind={requestKind} onKind={setRequestKind}
        value={withdrawalAmount} onValue={setWithdrawalAmount} onPage={setUnifiedPageStart}
        busy={busy||loading||reviewRequired} readOnly={unifiedReadOnly} onSubmit={()=>request(requestKind,withdrawalAmount)}/>}
       {view.withdrawals.length>0&&<section className="gv2-panel gv3-account-requests" aria-label="Withdrawal requests">
        <h3>Latest withdrawal</h3>{withdrawItem(view.withdrawals[0])}
        {view.withdrawals.length>1&&<details><summary>Earlier requests</summary>{view.withdrawals.slice(1).map(r=>withdrawItem(r))}</details>}
       </section>}
      </>}
      {config.unified?.accountReinvest&&view.wallet.toLowerCase()===wallet.toLowerCase()&&
       <V3AccountReinvestment key={config.address+':'+wallet} view={view} busy={busy||loading||reviewRequired}
        readOnly={unifiedReadOnly} onSubmit={reinvestUnified}/>}
      {config.unified&&<V3UnifiedActivity view={view} busy={busy||reviewRequired} readOnly={unifiedReadOnly} onCheckIn={checkIn}/>}
      {!singleCapital&&<V3PositionsList positions={view.unifiedPage?view.positions.filter(position=>!position.fromReinvestment):view.positions}/>}
      {singleCapital&&!view.unifiedPage&&<p>This account has no verified test deposits.</p>}
      {view.unifiedPage&&<V3UnifiedPositionPage page={view.unifiedPage} singleCapital={singleCapital} manualReinvest={view.manualReinvest}
       onPrevious={()=>setUnifiedPageStart(Math.max(0,view.unifiedPage!.start-view.unifiedPage!.limit))}
       onNext={()=>setUnifiedPageStart(view.unifiedPage!.start+view.unifiedPage!.limit)}/>}
      <section className="gv2-panel"><div className="gv2-panel-head"><h3>Mock test-token deposit</h3><span>NOT real money</span></div>
       {view.dailyPlan&&<p>Every external deposit and every new reward requires enough separate test-token reserve to cover all recorded principal and accrued claims.</p>}
       <p>100% of each test deposit is routed to designated wallets, including fee wallets. It does not remain as cash in the vault or establish product spending.</p>
       <div className="gv3-input-row"><label htmlFor="v3-deposit">Amount (USDT)</label><input id="v3-deposit" value={value} onChange={e=>setValue(e.target.value)} inputMode="decimal" placeholder="1000"/>
        {!view.registered&&<><label htmlFor="v3-parent">Referrer (optional)</label>
         <input id="v3-parent" value={referrer} onChange={e=>setReferrer(e.target.value)} /></>}
        <small>Wallet balance: {show(view.walletTestTokenBalance)} test USDT · Minimum deposit: 10 USDT</small>
        <button className="gv2-primary" disabled={busy||view.paused||reviewRequired||unifiedReadOnly} onClick={()=>void deposit()}>Review & sign test deposit</button></div>
      </section>
      {!config.unified?.accountReinvest&&<section className="gv2-panel"><h3>Optional manual reinvestment</h3><p>{config.unified?'Reinvestment adds recorded earnings to the same account. Each addition has its own lock.':'Manual reinvestment moves recorded earnings into a new locked position.'}{view.manualReinvest?' Unreinvested earnings earn no additional profit.':' Personal compound earnings accrue separately.'}</p>
       <div className="gv3-input-row">{config.unified?<V3UnifiedReinvestSummary positions={view.positions}/>:<><label htmlFor="v3-reinvest-id">Source position for recorded profit</label><select id="v3-reinvest-id" value={selectedPosition} onChange={e=>setSelectedPosition(e.target.value)}>
        {view.positions.map(p=><option key={p.id} value={p.id}>Position #{p.id+1} · {p.fromReinvestment?'Reinvestment':'Deposit'} · {show(p.availableProfit)} USDT profit</option>)}</select></>}
        <label htmlFor="v3-reinvest-value">Recorded profit to reinvest</label><input id="v3-reinvest-value" value={value} onChange={e=>setValue(e.target.value)} inputMode="decimal"/>
        <button disabled={busy||reviewRequired||!view.positions.length||unifiedReadOnly} onClick={reinvest}>Reinvest recorded USDT claim</button></div></section>}
     </>}
     {tab==='team'&&<>
      <V3NetworkPanel view={view} busy={busy||loading||reviewRequired} readOnly={unifiedReadOnly} onAction={(action,description)=>void perform(action,description)} onWithdraw={()=>{setRequestKind(view.networkAvailable>0n?'network':'referral');navigate('withdrawals');}}
       groupsStatus={view.networkLoadError?'error':view.networkLoaded?'ready':'loading'} onRetry={()=>void refresh()}
       onBranchPage={setBranchPage} onGroupPage={setGroupPage}/>
      {walletSession.provider&&<V3TeamDirectory key={wallet+':'+config.address} view={view} provider={walletSession.provider} config={config}/>}
     </>}
     {tab==='profile'&&<><V3ProfileSummary key={config.address+':'+wallet} view={view} contract={config.address}/>
      {!view.registered&&<div className="gv2-panel gv3-input-row">
       <label htmlFor="v3-profile-referrer">Referrer wallet or invitation link (optional)</label>
       <input id="v3-profile-referrer" value={referrer} onChange={e=>setReferrer(e.target.value)} autoComplete="off"/>
       <small>Leave empty to register without a referrer. A selected referrer must already be registered in this test contract and cannot be changed after registration.</small>
       <button className="gv2-primary" disabled={busy||view.paused||reviewRequired||unifiedReadOnly} onClick={register}>Register V3 wallet</button>
      </div>}
     </>}
     {tab==='withdrawals'&&<section className="gv2-panel"><div className="gv2-panel-head"><h3>Request a V3 testnet withdrawal</h3><Clock3 size={18}/></div>
      {view.withdrawalPage&&(requestKind==='profit'||requestKind==='principal')&&<div className="gv2-buttons">
       <span>Additions {view.withdrawalPage.start+1}–{view.withdrawalPage.start+view.withdrawalPage.lots.length} of {view.withdrawalPage.totalLots}</span>
       <button disabled={busy||loading||view.withdrawalPage.start===0} onClick={()=>setUnifiedPageStart(Math.max(0,view.withdrawalPage!.start-view.withdrawalPage!.limit))}>Previous additions</button>
       <button disabled={busy||loading||view.withdrawalPage.start+view.withdrawalPage.limit>=view.withdrawalPage.totalLots} onClick={()=>setUnifiedPageStart(view.withdrawalPage!.start+view.withdrawalPage!.limit)}>Next additions</button>
      </div>}
      <V3AccountWithdrawalForm view={view} unified={Boolean(config.unified)}
       busy={busy||loading||reviewRequired} readOnly={unifiedReadOnly}
       kind={requestKind} onKind={setRequestKind} value={value} onValue={setValue}
       onSubmit={()=>request(requestKind,value)}/>
      {view.dailyPlan&&<p>Requests for profit and team rewards are limited to 10% of external deposits. A rejected request releases the balance for a new request immediately.</p>}
      <h3>Your recent V3 requests</h3>{view.withdrawals.map(r=>withdrawItem(r))}
      {!view.withdrawals.length&&<p>No V3 requests yet.</p>}
     </section>}
     {tab==='admin'&&support&&view.canManage&&<nav className="gv3-admin-sections" aria-label="Admin sections">
      {([['settlements','Withdrawals & funding'],['members','Members'],['tickets','Support inbox'],['announcements','Announcements']] as const).map(([id,label])=>
       <button key={id} aria-pressed={adminSection===id} onClick={()=>setAdminSection(id)}>{label}</button>)}
     </nav>}
     {tab==='admin'&&support&&view.canManage&&adminSection==='tickets'&&<V3SupportTickets key={supportKey+'/admin'} client={support} admin wallet={wallet} onConnect={openWalletPicker}/>}
     {tab==='admin'&&support&&view.canManage&&adminSection==='announcements'&&<V3Announcements key={supportKey+'/admin'} client={support} admin/>}
     {tab==='admin'&&config.unified?.portfolio&&view.canManage&&adminSection==='members'&&walletSession.provider&&
      <V3ManagerVipPanel key={wallet+':'+config.address+':'+walletSession.version} provider={walletSession.provider} manager={wallet} config={config}
       busy={busy} readOnly={unifiedReadOnly||reviewRequired} onChange={perform}/>}
     {tab==='admin'&&operatorAccess&&(!support||!view.canManage||adminSection==='settlements')&&<section className="gv2-panel">
      <div className="gv2-panel-head"><h3>Funding &amp; settlement</h3></div>
      {view.dailyPlan&&view.canFund&&<div className="gv3-input-row">
       <label htmlFor="reserve-funding">Fund the plan reserve (test USDT)</label>
       <input id="reserve-funding" value={value} onChange={e=>setValue(e.target.value)} inputMode="decimal" disabled={busy}/>
       <button type="button" disabled={busy||loading||reviewRequired||unifiedReadOnly} onClick={fundReserve}>Review reserve funding</button>
      </div>}
      <p>Review each request and beneficiary before approval. Funding reserves the gross amount. Payment transfers the net amount to the recorded beneficiary.</p>
      <div className="gv2-detail"><span>Total recorded V3 principal claims</span><b>{show(view.ledger.principalLiability)} USDT</b></div>
      <div className="gv2-detail"><span>Accrued test-profit liabilities</span><b>{show(view.ledger.profitLiability)} USDT</b></div>
      <div className="gv2-detail"><span>V3 test-token cash</span><b>{show(view.ledger.cash)} USDT</b></div>
      <div className="gv2-detail"><span>Cash reserved for approved requests</span><b>{show(view.ledger.escrow)} USDT</b></div>
      <div className="gv2-detail"><span>Unfunded total liability</span><b>{claims?show(claims.overallUnfundedLiability):'—'} USDT</b></div>
      <V3SettlementQueue key={[wallet,chain,config.address,queueVersion].join('/')} wallet={wallet} config={config} busy={busy||reviewRequired}
       renderRequest={r=>withdrawItem(r,true)}/>
     </section>}
    </div>}
    {tab==='profile'&&<V3SeparateTestAccounts config={config}/>}
    </>}
    <footer className="gv2-foot">GLOBAL DROP TRADE · V3 ISOLATED TESTNET · No real deposits or guaranteed yield</footer>
   </main>
  </div>
  <nav className="gv2-mobile-bottom" aria-label="V3 five-tab mobile navigation">
   {dock.map(({id,label,Icon})=><button key={id} type="button" onClick={()=>navigate(id)}
    aria-current={tab===id?'page':undefined}><Icon size={19}/><span>{singleCapital&&id==='positions'?'Account':label}</span></button>)}
  </nav>
  {review&&<V3TransactionReview review={review} onFinish={finishReview}/>}
  <WalletPicker open={walletOpen} address={wallet} busy={connecting||busy}
   onClose={()=>setWalletOpen(false)} onConnect={chooseWallet} onDisconnect={()=>void disconnect()}/>
 </div>;
}
