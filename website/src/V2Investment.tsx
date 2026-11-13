import {useEffect,useState} from 'react';
import {ZeroAddress,getAddress,isAddress} from 'ethers';
import {AlertTriangle,Calculator,CheckCircle2,Coins,ExternalLink,Layers,RefreshCw,ShieldCheck,Wallet} from 'lucide-react';
import {getWalletProvider} from './wallet';
import {V2_ADDRESS,V2_EXPLORER,v2Money,v2Short,type V2Snapshot} from './v2-chain';
import {readV2DepositQuote,sendV2TestnetDeposit,type V2DepositAsset,type V2DepositQuote} from './v2-live-deposit';
import {tierFromRecordedUsd,V2_PLAN_NAMES,V2_PLAN_DAILY_BPS,V2_REFERRAL_BPS} from './v2-investment-preview';
import {readReferralInvite} from './referral-invite';
import './v2-investment.css';

const tierRanges=['From 10 USD','Over 500 USD','Over 2,500 USD','Over 10,000 USD','Over 50,000 USD'];
const titleOf=(asset:V2DepositAsset)=>asset==='TEST_USDT'?'V2 test token':'tBNB';
type Props={wallet:string;snapshot:V2Snapshot|null;onConfirmed?:()=>void};
export default function V2Investment({wallet,snapshot,onConfirmed}:Props){
 const [asset,setAsset]=useState<V2DepositAsset>('TEST_USDT'),[amount,setAmount]=useState('1000');
 const [referrer,setReferrer]=useState(()=>{
  const invite=readReferralInvite(window.location.search);
  return invite.status==='valid'?invite.address:'';
 });
 const [quote,setQuote]=useState<V2DepositQuote|null>(null);
 const [loading,setLoading]=useState(false),[sending,setSending]=useState(false);
 const [confirmed,setConfirmed]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 const [txHash,setTxHash]=useState('');
 useEffect(()=>{setQuote(null);setConfirmed(false);setError('');setStatus('');setTxHash('');},[wallet,asset,amount,referrer]);
 const available=Boolean(wallet&&snapshot);
 const effectiveReferrer=snapshot?.registered?snapshot.referrer:(referrer.trim()?referrer.trim():ZeroAddress);
 async function quoteV2(){
  if(!wallet||!snapshot)return setError('Connect a wallet on BNB Testnet to use the deployed V2 contract.');
  const provider=getWalletProvider();
  if(!provider)return setError('The wallet is disconnected.');
  setLoading(true);setError('');setQuote(null);setConfirmed(false);
  try{
   const result=await readV2DepositQuote(provider,wallet,asset,amount,effectiveReferrer);
   if(provider===getWalletProvider())setQuote(result);
  }catch(e){setError(e instanceof Error?e.message:'Unable to obtain verified on-chain quote.');}
  finally{setLoading(false);}
 }
 async function deposit(){
  if(!quote||!wallet||!snapshot||sending||!confirmed)return;
  if(quote.requiresKyc)return setError('VIP-level capital requires verified KYC by the contract administrator.');
  if(quote.paused)return setError('The V2 contract has paused deposits.');
  if(quote.amount>quote.userBalance)return setError('Insufficient balance of the selected TESTNET asset.');
  const provider=getWalletProvider();
  if(!provider)return setError('Reconnect the wallet.');
  const text='You are making a REAL blockchain deposit on BNB TESTNET ONLY.\n'+
   'Asset: '+titleOf(quote.label)+'\nAmount: '+v2Money(quote.amount,quote.decimals)+'\n'+
   'Contract: '+V2_ADDRESS+'\n'+
   '10% and 10% go to fee wallets, and 80% goes to operations.\n'+
   '100% principal is recorded, but it is NOT backed by matching vault cash.\n'+
   'No earnings or future withdrawal are guaranteed. Testnet assets must have no monetary value.\n'+
   'Do you want to sign the testnet transfer?';
  if(!window.confirm(text))return;
  setSending(true);setError('');setStatus('Checking live V2 contract conditions…');setTxHash('');
  try{
   const receipt=await sendV2TestnetDeposit(provider,wallet,quote,(info)=>setStatus(info));
   setStatus('Confirmed ON-CHAIN on BNB Testnet. Open the transaction to verify.');
   setTxHash(receipt.txHash);
   setQuote(null);setConfirmed(false);
   onConfirmed?.();
  }catch(e){setError(e instanceof Error?e.message:'The V2 testnet deposit did not confirm.');setStatus('');}
  finally{setSending(false);}
 }
 const tier=quote?tierFromRecordedUsd(quote.capitalAfterUsd):null;
 const currentBase=tier===null?null:quote!.amount*V2_PLAN_DAILY_BPS[tier]/10000n;
 return <div className="gv2-investment">
  <div className="gv2-investment-heading">
   <div><span className="gv2-page-label">GLOBAL · NEW V2 SMART CONTRACT</span>
    <h2>Investment plans and capital management</h2>
    <p>The original Global investment workspace now reads and signs real transactions only for the deployed V2 contract.</p>
   </div>
   <span className="gv2-investment-demo"><ShieldCheck size={16}/> BNB TESTNET · ON-CHAIN</span>
  </div>
  <div className="gv2-plan-grid" aria-label="Current V2 contract tiers">
   {V2_PLAN_NAMES.map((name,i)=><div key={name} className={'gv2-plan-card '+(tier===i?'selected':'')}>
    <small>PLAN 0{i+1}</small><strong>{name}</strong><b>{Number(V2_PLAN_DAILY_BPS[i])/100}%</b>
    <small>Contract maximum per funded day, not a promised payout</small>
    <p>{tierRanges[i]} recorded capital</p>
   </div>)}
  </div>
  <div className="gv2-investment-grid">
   <section className="gv2-panel">
    <div className="gv2-panel-head"><h3><Calculator size={19}/> New V2 deposit</h3><span>Contract verified · chain 97</span></div>
    <p className="gv2-invest-warning"><AlertTriangle size={16}/> TESTNET ONLY. This public prototype is unaudited, and its external deposit routing does not fully back recorded principal. Do not send real-money assets.</p>
    {!available&&<p className="gv2-invest-warning"><Wallet size={16}/> Connect your wallet to obtain a verified contract quote and submit a testnet transaction. No fabricated balances are displayed.</p>}
    <div className="gv2-field">
     <label htmlFor="gv2-invest-asset">Asset</label>
     <select id="gv2-invest-asset" value={asset} onChange={e=>setAsset(e.target.value as V2DepositAsset)} disabled={sending}>
      <option value="TEST_USDT">V2 mock USDT test token (no monetary value)</option>
      <option value="tBNB">BNB Testnet (tBNB)</option>
     </select>
     <label htmlFor="gv2-invest-amount">Deposit amount ({titleOf(asset)})</label>
     <input id="gv2-invest-amount" inputMode="decimal" value={amount} disabled={sending}
      onChange={e=>setAmount(e.target.value)} placeholder="Enter testnet amount"/>
     <label htmlFor="gv2-invest-referrer">Referrer wallet</label>
     <input id="gv2-invest-referrer" value={snapshot?.registered?effectiveReferrer:referrer} disabled={Boolean(snapshot?.registered)||sending}
      onChange={e=>setReferrer(e.target.value)} placeholder="0x… (optional)"/>
     <p className="gv2-small">{snapshot?.registered?'Your V2 referrer is fixed and cannot change.':
      'The chosen referrer must already be registered on V2; leaving it blank registers without one.'}</p>
     <button className="gv2-primary" disabled={!available||loading||sending} onClick={()=>void quoteV2()}>
      <RefreshCw size={17}/> {loading?'Reading contract…':'Check amount, wallet balance and on-chain quote'}</button>
    </div>
    {error&&<p className="gv2-error" role="alert">{error}</p>}
    {quote&&<div className="gv2-invest-values">
     <div><span>Actual contract USD quote (confirmed block {quote.block})</span><b>USD {v2Money(quote.quotedUsd,18,2)}</b></div>
     <div><span>Wallet balance (testnet asset)</span><b>{v2Money(quote.userBalance,quote.decimals)} {titleOf(quote.label)}</b></div>
     <div><span>Gross principal registered if transaction confirms</span><b>{v2Money(quote.recordedPrincipal,quote.decimals)}</b></div>
     <div><span>Resulting on-chain tier</span><b>{tier!==null?V2_PLAN_NAMES[tier]:'—'}</b></div>
     <div><span>Locked principal / penalty after lock</span><b>90 days / 30%</b></div>
     <div><span>Liquidity retained from this deposit</span><b>0 (external routing)</b></div>
     <div><span>KYC policy</span><b>{quote.requiresKyc?'Manager approval required':'No new VIP gate'}</b></div>
    </div>}
    {quote&&<div className="gv2-field">
     <label className="gv2-invest-confirm">
      <input type="checkbox" checked={confirmed} disabled={sending}
       onChange={e=>setConfirmed(e.target.checked)}/>
      <span>I understand this is an actual BNB Testnet transaction with valueless test assets, the deposit is routed externally, and principal or profit withdrawals are not guaranteed.</span>
     </label>
     <button className="gv2-primary" type="button" disabled={!confirmed||sending||quote.paused||
      quote.requiresKyc||quote.userBalance<quote.amount} onClick={()=>void deposit()}>
      <CheckCircle2 size={18}/>{sending?'Confirm in wallet…':'Submit V2 Testnet deposit'}
     </button>
    </div>}
    {status&&<p className="gv2-message" role="status">{status}</p>}
    {txHash&&<a href={V2_EXPLORER+'/tx/'+txHash} target="_blank" rel="noopener noreferrer">
     View verified V2 deposit receipt <ExternalLink size={16}/></a>}
   </section>
   <aside className="gv2-investment-side">
    <section className="gv2-panel">
     <div className="gv2-panel-head"><h3><Coins size={18}/> Deposit allocation · contract rules</h3></div>
     {!quote?<p>Read the V2 contract quote to inspect the exact routing and principal recorded.</p>:
      <div className="gv2-invest-values">
       <div><span>Gross amount</span><b>{v2Money(quote.amount,quote.decimals)}</b></div>
       <div><span>Fee wallet 1 · 10%</span><b>{v2Money(quote.fee1,quote.decimals)}</b></div>
       <div><span>Fee wallet 2 · 10%</span><b>{v2Money(quote.fee2,quote.decimals)}</b></div>
       <div><span>Operations · remaining 80%</span><b>{v2Money(quote.operations,quote.decimals)}</b></div>
       <div><span>Retained vault cash</span><b>0</b></div>
      </div>}
     <p className="gv2-small">No 100% principal cash remains in the vault after this routing. This is a transparent testnet-only operation, not a solvency claim.</p>
    </section>
    <section className="gv2-panel">
     <div className="gv2-panel-head"><h3><Layers size={18}/> Funded earnings and referrals</h3></div>
     {tier!==null&&currentBase!==null&&quote?<div className="gv2-invest-values">
      <div><span>Maximum funded daily personal amount</span><b>{v2Money(currentBase,quote.decimals)} {titleOf(quote.label)}</b></div>
      {V2_REFERRAL_BPS[tier].map((bps,i)=><div key={i}>
       <span>Upline level {i+1}: {Number(bps)/100}% of funded profit</span>
       <b>{v2Money(currentBase*bps/10000n,quote.decimals)}</b>
      </div>)}
     </div>:<p>Read the contract quote to see the current tier and conditional referral allocation.</p>}
     <p className="gv2-small">The contract never creates these credits automatically. A revenue funder must separately transfer actual testnet assets and settle earnings; activity and KYC conditions apply.</p>
    </section>
   </aside>
  </div>
  <section className="gv2-panel">
   <div className="gv2-panel-head"><h3><Layers size={18}/> Real V2 positions</h3>
    <span>{snapshot?.positionsTotal??'Connect wallet'} recorded</span></div>
   {!snapshot?<p>Connect a wallet to read the real investment positions from V2. No browser-demo positions are created.</p>:
    snapshot.positions.length?snapshot.positions.map(row=><div className="gv2-position" key={row.id}>
     <div><b>Position #{row.id+1}</b><small>Recorded in V2 at {new Date(row.openedAt*1000).toLocaleString()}</small></div>
     <div><b>{v2Money(row.principal,row.asset.toLowerCase()===ZeroAddress.toLowerCase()?18:snapshot.accounts[1].decimals)}</b>
      <small>Recorded capital USD {v2Money(row.capitalUsd,18,2)}</small></div>
     <div><b>Locked until {new Date((row.openedAt+90*86400)*1000).toLocaleDateString()}</b></div>
    </div>):<p>No positions are recorded for this wallet on V2.</p>}
   {snapshot&&snapshot.positionsTotal>snapshot.positions.length&&<p className="gv2-small">Showing the first {snapshot.positions.length} of {snapshot.positionsTotal} on-chain positions. Full pagination still needs further UI work.</p>}
  </section>
  <div className="gv2-investment-foot">
   <a href={V2_EXPLORER+'/address/'+V2_ADDRESS} target="_blank" rel="noopener noreferrer">Inspect V2 deployed testnet contract <ExternalLink size={15}/></a>
   <p>This is a real testnet interaction, not a browser simulation or an invitation to invest real funds.</p>
  </div>
 </div>;
}
