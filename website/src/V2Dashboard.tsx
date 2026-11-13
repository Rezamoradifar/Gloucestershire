import {useCallback,useEffect,useState} from 'react';
import {ZeroAddress,getAddress,isAddress,parseUnits} from 'ethers';
import {Activity,AlertTriangle,ArrowUpRight,CheckCircle2,Clock3,Coins,Copy,ExternalLink,LogOut,RefreshCw,ShieldCheck,Users,Wallet,Menu,X,LayoutDashboard,Layers,ChevronLeft,SunMoon,House,Settings2,UserRound,Info,Megaphone} from 'lucide-react';
import {wallets,getWalletProvider,walletConnectionError,switchWalletNetwork,walletConnectReady,type WalletKind} from './wallet';
import {V2_ADDRESS,V2_CHAIN_ID,V2_EXPLORER,V2_CODE_HASH,
 readV2Snapshot,sendV2Action,v2Date,v2Money,v2Short,v2WithdrawalStatus,
 type V2Asset,type V2Action,type V2Snapshot} from './v2-chain';
import V2HistoryPanel from './V2HistoryPanel';
import V2AdminConsole from './V2AdminConsole';
import V2Investment from './V2Investment';
import V2Network from './V2Network';
import V2Community from './V2Community';
import V2Profile from './V2Profile';
import './v2-dashboard.css';
import './v2-classic-shell.css';
import './v2-classic-refinement.css';

type Section='overview'|'invest'|'positions'|'team'|'history'|'profile'|'tickets'|'announcements'|'withdrawals'|'admin'|'contract';
const navItems=[
 {id:'overview' as Section,label:'Overview',Icon:LayoutDashboard},
 {id:'invest' as Section,label:'Invest / plans',Icon:Coins},
 {id:'positions' as Section,label:'My positions',Icon:Layers},
 {id:'team' as Section,label:'Team & referrals',Icon:Users},
 {id:'history' as Section,label:'Profit & deposits',Icon:Clock3},
 {id:'profile' as Section,label:'My profile',Icon:UserRound},
 {id:'tickets' as Section,label:'Support tickets',Icon:Info},
 {id:'announcements' as Section,label:'Announcements',Icon:Megaphone},
 {id:'withdrawals' as Section,label:'Withdrawals',Icon:Coins},
 {id:'admin' as Section,label:'Administration',Icon:Settings2},
 {id:'contract' as Section,label:'Contract & safety',Icon:ShieldCheck}
];
const explorerAddress=(address:string)=>V2_EXPLORER+'/address/'+address;
const explorerTx=(hash:string)=>V2_EXPLORER+'/tx/'+hash;

export default function V2Dashboard(){
 const [wallet,setWallet]=useState(''),[network,setNetwork]=useState<number|null>(null);
 const [connecting,setConnecting]=useState(false),[loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [transaction,setTransaction]=useState(''),[snapshot,setSnapshot]=useState<V2Snapshot|null>(null);
 const [section,setSection]=useState<Section>('overview'),[symbol,setSymbol]=useState<V2Asset>('USDT');
 const [amount,setAmount]=useState(''),[principalPosition,setPrincipalPosition]=useState('0');
 const [referrer,setReferrer]=useState(ZeroAddress);
 const [mobileMenu,setMobileMenu]=useState(false);

 useEffect(()=>{
  let mounted=true,revision=0;
  const sync=async()=>{
   const id=++revision,provider=getWalletProvider();
   if(!provider){if(mounted){setWallet('');setNetwork(null);setSnapshot(null);}return;}
   try{
    const [accounts,chain]=await Promise.all([
     provider.request({method:'eth_accounts'}),
     provider.request({method:'eth_chainId'})
    ]);
    if(mounted&&id===revision){
     setWallet(Array.isArray(accounts)&&typeof accounts[0]==='string'?getAddress(accounts[0]):'');
     setNetwork(Number(chain));
    }
   }catch{
    if(mounted&&id===revision){setWallet('');setNetwork(null);}
   }
  };
  const unsubscribe=wallets.subscribe(()=>{void sync();});void sync();
  return()=>{mounted=false;revision++;unsubscribe();};
 },[]);

 const refresh=useCallback(async()=>{
  const provider=getWalletProvider();
  if(!provider||!wallet||network!==V2_CHAIN_ID){setSnapshot(null);return;}
  setLoading(true);setError('');
  try{
   const view=await readV2Snapshot(provider,wallet);
   if(provider===getWalletProvider())setSnapshot(view);
  }catch(e){setSnapshot(null);setError(e instanceof Error?e.message:'The V2 contract could not be verified.');}
  finally{setLoading(false);}
 },[wallet,network]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{
  if(!wallet||network!==V2_CHAIN_ID)return;
  const interval=setInterval(()=>{if(document.visibilityState==='visible'&&!busy)void refresh();},45000);
  return()=>clearInterval(interval);
 },[wallet,network,busy,refresh]);

 async function connect(kind:WalletKind){
  setConnecting(true);setError('');
  try{await wallets.connect(kind);}
  catch(e){setError(walletConnectionError(e));}
  finally{setConnecting(false);}
 }
 async function disconnect(){await wallets.disconnect();setSnapshot(null);setTransaction('');}

 const account=snapshot?.accounts.find(a=>a.symbol===symbol);
 const canManage=Boolean(snapshot?.canApprove||snapshot?.canKyc);
 const assetName=(asset:string)=>asset.toLowerCase()===ZeroAddress.toLowerCase()?'BNB':'USDT';
 const decimalsFor=(asset:string)=>asset.toLowerCase()===ZeroAddress.toLowerCase()?18:(snapshot?.accounts[1].decimals??18);

 async function perform(action:V2Action,description:string){
  if(!wallet||network!==V2_CHAIN_ID||busy||!snapshot)return;
  const message=description+'\n\nNetwork: BNB Testnet (97)\nContract: '+V2_ADDRESS+
   '\n\nOnly continue if you recognize this action. A separate wallet transaction is required.';
  if(!window.confirm(message))return;
  const provider=getWalletProvider();
  if(!provider){setError('Wallet disconnected.');return;}
  setBusy(true);setError('');setNotice('Review the action in your wallet…');setTransaction('');
  try{
   const hash=await sendV2Action(provider,wallet,action);
   setTransaction(hash);setNotice('Transaction confirmed on BNB Testnet.');setAmount('');
   await refresh();
  }catch(e){
   setNotice('');setError(e instanceof Error?e.message:'The transaction was not confirmed.');
  }finally{setBusy(false);}
 }

 const amountValue=()=>{
  if(!account)throw Error('Choose a supported asset.');
  const cleaned=amount.trim();
  if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(cleaned))throw Error('Enter a positive numeric amount.');
  const parsed=parseUnits(cleaned,account.decimals);
  if(parsed<=0n)throw Error('Amount must be positive.');
  return parsed;
 };
 const submitReinvest=()=>{
  try{
   const value=amountValue();
   if(!account||value>account.profit)throw Error('Amount exceeds the recorded available profit.');
   void perform({kind:'reinvest',asset:account.address,amount:value},
    'Manually reinvest '+amount.trim()+' '+symbol+' from credited profit. This creates a new locked position.');
  }catch(e){setError((e as Error).message);}
 };
 const submitProfitRequest=()=>{
  try{
   const value=amountValue();
   if(!account||value>account.profit||value>account.cap)
    throw Error('Requested profit exceeds available profit or the per-request withdrawal cap.');
   if(account.requestPending||snapshot && Date.now()/1000<account.nextRequestAt)
    throw Error('Withdrawal is already pending or the 72-hour cooldown has not elapsed.');
   void perform({kind:'requestProfit',asset:account.address,amount:value},
    'Request withdrawal of '+amount.trim()+' '+symbol+'; fee is 3%. A manager must approve the exact request.');
  }catch(e){setError((e as Error).message);}
 };
 const submitPrincipalRequest=()=>{
  try{
   const value=amountValue(),position=Number(principalPosition);
   if(!Number.isSafeInteger(position)||position<0)throw Error('Choose a valid position.');
   const p=snapshot?.positions.find(x=>x.id===position);
   if(!account||!p||p.asset.toLowerCase()!==account.address.toLowerCase()||
      value>p.principal-p.reserved)throw Error('The selected position lacks enough unreserved principal.');
   if(snapshot&&snapshot.asOf<p.openedAt+90*86400)
    throw Error('The principal position has not completed its 90-day lock.');
   void perform({kind:'requestPrincipal',asset:account.address,amount:value,positionId:position},
    'Request '+amount.trim()+' '+symbol+' principal withdrawal with 30% penalty. Manager approval is required.');
  }catch(e){setError((e as Error).message);}
 };

 return <div className="gv2 shell gv2-classic" dir="ltr">
  <aside id="gv2-menu" className={'sidebar gv2-sidebar '+(mobileMenu?'open':'')} aria-label="Global V2 navigation" aria-hidden={mobileMenu?undefined:undefined}>
   <button className="gv2-sidebar-close" aria-label="Close navigation" onClick={()=>setMobileMenu(false)}><X size={18}/></button>
   <a className="brand" href="#" onClick={()=>setMobileMenu(false)}><span className="brand-icon">G</span><div><strong>GLOBAL</strong><small>DROP TRADE · V2 TESTNET</small></div></a>
   <div className="sidebar-caption">YOUR WORKSPACE</div>
   <nav>{navItems.filter(item=>item.id!=='admin'||canManage).map(({id,label,Icon})=>
    <button key={id} className={section===id?'active':''} aria-current={section===id?'page':undefined}
     onClick={()=>{setSection(id);setAmount('');setError('');setMobileMenu(false);}}>
     <Icon size={19}/><span>{label}</span>{section===id&&<ChevronLeft size={15}/>}
    </button>)}</nav>
   <div className="gv2-sidebar-bottom">
    <a href="#"><House size={15}/> Back to website</a>
    <button onClick={()=>window.dispatchEvent(new Event('global-theme-toggle'))}><SunMoon size={16}/> Change appearance</button>
    <div className="gv2-detail"><span>Network</span><b>BNB Testnet · 97</b></div>
    <small>Global V2 · Verified new contract only</small>
   </div>
  </aside>
  {mobileMenu&&<button className="gv2-scrim" aria-label="Close mobile navigation" onClick={()=>setMobileMenu(false)}/>}
  <div className="workspace gv2-workspace">
   <header className="topbar gv2-classic-topbar">
    <div className="breadcrumb">
     <button className="icon-button mobile-menu" aria-label="Open dashboard menu" aria-controls="gv2-menu" aria-expanded={mobileMenu}
      onClick={()=>setMobileMenu(v=>!v)}><Menu size={21}/></button>
     <span>Dashboard</span><ChevronLeft size={15}/><strong>{navItems.find(x=>x.id===section)?.label}</strong>
    </div>
    <div className="top-actions"><span className="network-label">V2 TESTNET</span>
     {wallet?<button className="wallet-button" onClick={()=>void disconnect()}><LogOut size={16}/>{v2Short(wallet)}</button>:
      <button className="wallet-button" onClick={()=>void connect('injected')} disabled={connecting}>
       <Wallet size={17}/> {connecting?'Connecting…':'Connect wallet'}</button>}
    </div>
   </header>
  <main className="gv2-wrap">
   <div className="gv2-heading"><div><span className="gv2-page-label">GLOBAL FINANCE · V2 TESTNET</span>
    <h1>{navItems.find(x=>x.id===section)?.label??'Account overview'}</h1>
    <p>Full account workspace · balances, team, rewards, positions and manager controls on the new V2 network.</p>
   </div>
    {wallet&&<button onClick={()=>void refresh()} disabled={loading||busy}><RefreshCw size={17} className={loading?'gv2-spin':''}/> Refresh</button>}
   </div>
   <div className="gv2-release" role="status">
    <ShieldCheck size={19} aria-hidden="true"/>
    <div className="gv2-release-copy">
     <strong>Global V2 · New testnet contract</strong>
     <span>{v2Short(V2_ADDRESS)} · BNB Testnet · Unaudited test environment — real deposits disabled</span>
    </div>
    <a href={explorerAddress(V2_ADDRESS)} target="_blank" rel="noopener noreferrer">View contract <ExternalLink size={14}/></a>
   </div>
   {error&&<p className="gv2-error" role="alert">{error}</p>}
   {notice&&<p className="gv2-message" role="status">{notice}{transaction&&<> · <a href={explorerTx(transaction)} target="_blank" rel="noopener noreferrer">View transaction <ExternalLink size={14}/></a></>}</p>}

   {!wallet&&<div className="gv2-account-entry">
    <div className="gv2-classic-welcome gv2-panel">
     <div className="gv2-classic-welcome-copy">
      <small>GLOBAL DROP TRADE · ACCOUNT CENTER</small>
      <h2>Your original Global workspace, upgraded for V2.</h2>
      <p>Open your personal account, positions, team and settlement history with your wallet. Only verified V2 blockchain information is displayed.</p>
      <div className="gv2-classic-connect-actions">
       <button className="gv2-primary" disabled={connecting} onClick={()=>void connect('injected')}><Wallet size={17}/> {connecting?'Connecting…':'Connect wallet'}</button>
       <button disabled={connecting||!walletConnectReady} onClick={()=>void connect('walletconnect')}>WalletConnect / Mobile</button>
       <button onClick={()=>setSection('invest')}>Explore plans</button>
      </div>
     </div>
     <div className="gv2-classic-welcome-mark" aria-hidden="true"><span>G</span><small>GLOBAL V2</small></div>
    </div>
    <div className="gv2-classic-quick-grid" aria-label="Global account sections">
     <button onClick={()=>setSection('invest')}><Coins size={19}/><strong>Investment plans</strong><small>On-chain testnet only</small></button>
     <button onClick={()=>setSection('positions')}><Layers size={19}/><strong>My positions</strong><small>Connect to view</small></button>
     <button onClick={()=>setSection('team')}><Users size={19}/><strong>Network & team</strong><small>V2 referral records</small></button>
     <button onClick={()=>setSection('withdrawals')}><Clock3 size={19}/><strong>Withdrawals</strong><small>Manager approval required</small></button>
    </div>
   </div>}
   {wallet&&network!==V2_CHAIN_ID&&<div className="gv2-connect gv2-panel">
    <h2>Wrong network</h2><p>Please switch your wallet to BNB Testnet (Chain 97).</p>
    <button className="gv2-primary" onClick={()=>void switchWalletNetwork().catch(e=>setError((e as Error).message))}>Switch network</button>
   </div>}
   {wallet&&network===V2_CHAIN_ID&&loading&&!snapshot&&<div className="gv2-panel gv2-loading">Verifying V2 contract bytecode and loading on-chain balances…</div>}

   {section==='invest'&&!snapshot&&<V2Investment snapshot={null} wallet={wallet}/>}
   {snapshot&&<div className="gv2-content">
    <div className="gv2-summary">
     <div className="gv2-metric"><small>Membership</small><strong>{snapshot.registered?'Registered':'Not registered'}</strong><span>On-chain registry</span></div>
     <div className="gv2-metric"><small>24h activity</small><strong>{snapshot.eligible?'Eligible now':'Not eligible'}</strong><span>Live on-chain check-in</span></div>
     <div className="gv2-metric"><small>Capital · USD</small><strong>{v2Money(snapshot.capitalUsd,18,2)}</strong><span>Recorded principal, not cash</span></div>
     <div className="gv2-metric"><small>VIP verification</small><strong>{snapshot.kyc?'Admin verified':'Unverified'}</strong><span>Manager-only KYC</span></div>
    </div>
    {section==='invest'&&<V2Investment snapshot={snapshot} wallet={wallet} onConfirmed={()=>void refresh()}/>}
    {section==='overview'&&<>
     <div className="gv2-section-head"><h2>Asset accounting</h2><span>Verified at block {snapshot.block.toLocaleString('en-US')}</span></div>
     <div className="gv2-asset-row">{snapshot.accounts.map(a=><article key={a.symbol} className="gv2-panel">
      <div className="gv2-panel-head"><strong>{a.symbol}</strong><Coins size={18}/></div>
      <div className="gv2-detail"><span>Recorded principal</span><b>{v2Money(a.principal,a.decimals)} {a.symbol}</b></div>
      <div className="gv2-detail"><span>Credited profit (personal + referrals)</span><b>{v2Money(a.profit,a.decimals)} {a.symbol}</b></div>
      <div className="gv2-detail"><span>External deposits</span><b>{v2Money(a.deposited,a.decimals)}</b></div>
      <div className="gv2-detail"><span>Manual reinvestments</span><b>{v2Money(a.reinvested,a.decimals)}</b></div>
      <div className="gv2-detail"><span>Per-request profit cap</span><b>{v2Money(a.cap,a.decimals)}</b></div>
      <div className="gv2-detail"><span>System-wide principal without vault cash</span><b>{v2Money(a.unfunded,a.decimals)}</b></div>
     </article>)}</div>
     <div className="gv2-panel"><div className="gv2-panel-head"><h3>On-chain actions</h3><Activity size={18}/></div>
      {!snapshot.registered?<div className="gv2-field"><label htmlFor="gv2-referrer">Inviter's wallet (optional)</label>
       <input id="gv2-referrer" value={referrer} onChange={e=>setReferrer(e.target.value)} placeholder="0x…" spellCheck={false}/>
       <button disabled={busy||!isAddress(referrer)} onClick={()=>void perform({kind:'register',referrer:getAddress(referrer)},
        'Register this wallet under the displayed inviter. The referrer cannot be changed later.')}>Register V2 test account</button>
      </div>:<div className="gv2-buttons"><button className="gv2-primary" disabled={busy||snapshot.suspended||snapshot.lastCheckIn>0&&snapshot.asOf-snapshot.lastCheckIn<3600}
       onClick={()=>void perform({kind:'checkIn'},'Record a new 24-hour on-chain activity check-in.')}><CheckCircle2 size={17}/> Check in (24h)</button>
       <span>Last check-in: {v2Date(snapshot.lastCheckIn)}</span></div>}
      <button type="button" className="gv2-primary" onClick={()=>setSection('invest')}>Explore plans and test investment</button>
      <p className="gv2-small">Real deposits are disabled pending independently verified cash backing; the investment preview is a no-transfer simulation.</p>
     </div>
    </>}
    {section==='positions'&&<div className="gv2-panel">
     <div className="gv2-panel-head"><h2>Investment positions</h2><span>{snapshot.positionsTotal} recorded</span></div>
     {snapshot.positions.map(p=><div className="gv2-position" key={p.id}>
      <div><strong>Position #{p.id+1}</strong><small>Opened {v2Date(p.openedAt)} · Lock ends {v2Date(p.openedAt+90*86400)}</small></div>
      <div><b>{v2Money(p.principal,decimalsFor(p.asset))} {assetName(p.asset)}</b><small>USD {v2Money(p.capitalUsd,18,2)}</small></div>
      <div><small>Reserved for withdrawal</small><b>{v2Money(p.reserved,decimalsFor(p.asset))}</b></div>
     </div>)}
     {!snapshot.positionsTotal&&<p>No positions have been opened on this V2 contract.</p>}
     {snapshot.positionsTotal>10&&<p>Showing 10 positions. More pages require a verified indexer.</p>}
    </div>}
    {section==='team'&&<V2Network wallet={wallet} snapshot={snapshot}/>}
    {section==='history'&&<V2HistoryPanel requester={wallet} subject={wallet} token={snapshot.token} decimals={snapshot.accounts[1].decimals}/>}
    {section==='profile'&&<V2Profile snapshot={snapshot}/>}
    {section==='tickets'&&<V2Community mode="tickets" who={wallet} admin={snapshot.canApprove||snapshot.canKyc}/>}
    {section==='announcements'&&<V2Community mode="announcements" who={wallet} admin={snapshot.canApprove||snapshot.canKyc}/>}
    {section==='withdrawals'&&<>
     <div className="gv2-panel"><div className="gv2-panel-head"><h2>Request manager-approved withdrawal</h2><Clock3 size={18}/></div>
      <p>Every request requires manager approval. Profit fee: 3%. Cooldown: 72 hours per asset. Principal lock: 90 days, followed by a 30% penalty.</p>
      <div className="gv2-field">
       <label htmlFor="gv2-asset">Asset</label><select id="gv2-asset" value={symbol} onChange={e=>{setSymbol(e.target.value as V2Asset);setAmount('');}}>
        <option value="USDT">USDT</option><option value="BNB">BNB</option></select>
       <label htmlFor="gv2-amount">Amount ({symbol})</label><input id="gv2-amount" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" />
       <p className="gv2-small">Credited profit: {account?v2Money(account.profit,account.decimals):'—'} · Per-request limit: {account?v2Money(account.cap,account.decimals):'—'} · Next request after: {account?v2Date(account.nextRequestAt):'—'}</p>
       <div className="gv2-buttons"><button className="gv2-primary" disabled={busy||!snapshot.registered||account?.requestPending}
         onClick={submitProfitRequest}>Request profit · 3% fee</button>
       <select value={principalPosition} onChange={e=>setPrincipalPosition(e.target.value)} aria-label="Principal position">
        {snapshot.positions.map(p=><option value={p.id} key={p.id}>Position #{p.id+1} · {assetName(p.asset)}</option>)}
       </select>
       <button disabled={busy||!snapshot.positions.length||account?.requestPending} onClick={submitPrincipalRequest}>Request principal · 30% penalty</button>
       <button disabled={busy||!snapshot.registered||!account||account.profit===0n} onClick={submitReinvest}>Manually reinvest credited profit</button></div>
      </div>
     </div>
     <div className="gv2-panel"><div className="gv2-panel-head"><h3>Your requests</h3><span>{snapshot.withdrawalsTotal} recorded</span></div>
      {snapshot.withdrawals.map(r=><div className="gv2-position" key={r.id}><div><strong>Request #{r.id+1}</strong><small>{r.principal?'Principal':'Profit'} · {v2Date(r.requestedAt)}</small></div>
       <div><b>{v2Money(r.gross,decimalsFor(r.asset))} {assetName(r.asset)}</b><small>Fee {v2Money(r.fee,decimalsFor(r.asset))}</small></div>
       <div><span>{v2WithdrawalStatus(r.status)}</span>{r.status===1&&<button disabled={busy} onClick={()=>void perform({kind:'payWithdrawal',id:r.id},
        'Execute approved request #'+(r.id+1)+' to its original beneficiary. Recipient cannot change.')}>Pay approved</button>}</div></div>)}
      {!snapshot.withdrawalsTotal&&<p>No V2 withdrawal requests yet.</p>}
     </div>
    </>}
    {section==='admin'&&canManage&&<V2AdminConsole wallet={wallet} snapshot={snapshot} onChanged={()=>void refresh()}/>}
    {section==='contract'&&<div className="gv2-panel">
     <div className="gv2-panel-head"><h2>Verified V2 contract</h2><ShieldCheck size={20}/></div>
     <div className="gv2-detail"><span>Network</span><b>BNB Testnet · 97</b></div>
     <div className="gv2-detail"><span>Contract</span><b className="gv2-break">{V2_ADDRESS}</b><button onClick={()=>void navigator.clipboard.writeText(V2_ADDRESS)} aria-label="Copy V2 contract"><Copy size={14}/></button></div>
     <div className="gv2-detail"><span>Runtime hash</span><b className="gv2-break">{V2_CODE_HASH}</b></div>
     <div className="gv2-detail"><span>Confirmed block</span><b>{snapshot.block}</b></div>
     <div className="gv2-detail"><span>Profit withdrawal fee</span><b>3%</b></div>
     <div className="gv2-detail"><span>Withdrawal cooldown</span><b>72 hours</b></div>
     <div className="gv2-detail"><span>Registered V2 accounts</span><b>{snapshot.memberCount}</b></div>
     <a className="gv2-explorer" href={explorerAddress(V2_ADDRESS)} target="_blank" rel="noopener noreferrer">Inspect on BscScan Testnet <ArrowUpRight size={15}/></a>
     <div className="gv2-safety-disclosure">
      <AlertTriangle size={18} aria-hidden="true"/>
      <div><strong>Important: experimental testnet contract, not approved for real investments.</strong>
       <p>The V2 vault is unaudited and contains no migrated balances. Deposits are disabled in this website because its 10% + 10% fee routing and 80% operations transfer leave no matching cash in the vault to back the gross 100% principal obligation. The contract itself still exposes a deposit function, so do not send real funds directly to it. Existing users' previous balances and blockchain records remain separate and cannot be erased or automatically transferred. Do not rely on on-chain accounting as proof that funds are withdrawable.</p>
      </div>
     </div>
    </div>}
    <footer className="gv2-foot">GLOBAL DROP TRADE V2 · TESTNET ONLY · No guaranteed returns · Blockchain is the source of truth</footer>
   </div>}
  </main>
  </div>
 </div>;
}
