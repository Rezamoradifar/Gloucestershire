import {useEffect,useMemo,useState} from 'react';
import {ZeroAddress,isAddress} from 'ethers';
import {AlertTriangle,Calculator,CheckCircle2,Coins,ExternalLink,Layers,RefreshCw,ShieldCheck} from 'lucide-react';
import {getWalletProvider} from './wallet';
import {V2_ADDRESS,V2_EXPLORER,readV2InvestmentQuote,v2Money,v2Short,type V2Snapshot} from './v2-chain';
import {previewV2Investment,V2_PLAN_NAMES,V2_PLAN_DAILY_BPS,type V2PreviewAsset} from './v2-investment-preview';
import {readReferralInvite} from './referral-invite';
import './v2-investment.css';

type DemoPosition={id:number;asset:V2PreviewAsset;amount:bigint;decimals:number;usd:bigint;tier:number;time:number};
const tierRanges=['10–500 USD','Above 500 USD','Above 2,500 USD','Above 10,000 USD','Above 50,000 USD'];
export default function V2Investment({snapshot,wallet}:{snapshot:V2Snapshot|null;wallet:string}){
 const [asset,setAsset]=useState<V2PreviewAsset>('USDT'),[amount,setAmount]=useState('1000');
 const [bnbPrice,setBnbPrice]=useState('');
 const [referrer,setReferrer]=useState(()=>{
  const invite=readReferralInvite(window.location.search);return invite.status==='valid'?invite.address:'';
 });
 const [positions,setPositions]=useState<DemoPosition[]>([]);
 const [quote,setQuote]=useState<{usd:bigint;block:number}|null>(null);
 const [quoteBusy,setQuoteBusy]=useState(false),[quoteError,setQuoteError]=useState(''),[message,setMessage]=useState('');
 const decimals=asset==='BNB'?18:(snapshot?.accounts.find(x=>x.symbol==='USDT')?.decimals??18);
 const hypotheticalPrice=asset==='USDT'?'1':bnbPrice.trim();
 const prior=positions.reduce((sum,p)=>sum+p.usd,0n);
 const previewResult=useMemo(()=>{
  try{return {data:previewV2Investment({asset,amount,decimals,assumedPriceUsd:hypotheticalPrice,
   existingCapitalUsd:(snapshot?.capitalUsd??0n)+prior,kycVerified:snapshot?.kyc??false}),error:''};}
  catch(e){return {data:null,error:e instanceof Error?e.message:'Invalid illustrative amount.'};}
 },[asset,amount,decimals,hypotheticalPrice,snapshot?.capitalUsd,snapshot?.kyc,prior]);
 const preview=previewResult.data;
 useEffect(()=>{setQuote(null);setQuoteError('');},[asset,amount,hypotheticalPrice,wallet]);
 function runDemo(){
  if(!preview)return;
  if(referrer.trim()&&(!isAddress(referrer)||(wallet&&referrer.toLowerCase()===wallet.toLowerCase()))){
   setMessage('Use a valid referrer wallet other than your own.');return;
  }
  const position={id:positions.length+1,asset,amount:preview.amount,decimals,usd:preview.usdValue,
   tier:preview.tier,time:Date.now()};
  setPositions(prev=>[...prev,position].slice(-50));
  setMessage('Demo position #'+position.id+' created in this browser only. NO real deposit, signature, allowance or blockchain position.');
 }
 async function readOracle(){
  setQuote(null);setQuoteError('');
  const provider=getWalletProvider();
  if(!provider||!wallet||!snapshot||!preview){
   setQuoteError('Connect a verified BNB Testnet V2 wallet and enter a valid amount.');return;
  }
  setQuoteBusy(true);
  try{
   const output=await readV2InvestmentQuote(provider,wallet,asset==='BNB'?ZeroAddress:snapshot.token,preview.amount);
   if(provider===getWalletProvider())setQuote({usd:output.usd,block:output.block});
  }catch(e){setQuoteError(e instanceof Error?e.message:'Oracle quote unavailable.');}
  finally{setQuoteBusy(false);}
 }
 return <div className="gv2-investment">
  <div className="gv2-investment-heading">
   <div><span className="gv2-page-label">V2 · INVESTMENT WORKSPACE</span><h2>Choose a plan. <em>Test the entire flow.</em></h2>
    <p>The familiar Global investment calculator is restored. All positions below are local simulations, not real money.</p></div>
   <span className="gv2-investment-demo"><ShieldCheck size={16}/> SIMULATION · NO TRANSFERS</span>
  </div>
  <div className="gv2-plan-grid" aria-label="Five contract rate tiers">
   {V2_PLAN_NAMES.map((name,i)=><article key={name} className={'gv2-plan-card '+(preview?.tier===i?'selected':'')}>
    <small>PLAN 0{i+1}</small><strong>{name}</strong><b>{Number(V2_PLAN_DAILY_BPS[i])/100}%</b>
    <small>Maximum daily rate · not guaranteed</small><p>{tierRanges[i]}</p>
   </article>)}
  </div>
  <div className="gv2-investment-grid">
   <section className="gv2-panel">
    <div className="gv2-panel-head"><h3><Calculator size={19}/> Simulate an investment</h3><span>No wallet signature</span></div>
    <div className="gv2-field">
     <label>Select asset</label><div className="gv2-invest-assets">
      {(['USDT','BNB'] as const).map(x=><button key={x} type="button"
       aria-pressed={asset===x} className={asset===x?'selected':''} onClick={()=>{setAsset(x);setMessage('');}}>{x==='USDT'?'₮':'◆'} {x}</button>)}
     </div>
     <label htmlFor="gv2-invest-amount">Amount ({asset})</label>
     <input id="gv2-invest-amount" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="1000"/>
     {asset==='USDT'&&<div className="gv2-invest-examples" aria-label="Try a sample capital amount">
      {['10','501','2501','10001','50001'].map(sample=>
       <button type="button" key={sample} onClick={()=>{setAmount(sample);setMessage('');}}>{sample} demo USDT</button>)}
     </div>}
     {asset==='BNB'&&<>
      <label htmlFor="gv2-bnb-price">Hypothetical USD per BNB (not live price)</label>
      <input id="gv2-bnb-price" inputMode="decimal" placeholder="Enter assumed USD price" value={bnbPrice} onChange={e=>setBnbPrice(e.target.value)}/>
     </>}
     <p className="gv2-small">{asset==='USDT'?'Demo assumes 1 USD per USDT unit; the on-chain oracle may differ.':
      'This preview uses only the manually entered BNB price. The real price may differ.'}</p>
     <label htmlFor="gv2-invest-ref">Referrer address (optional in this test)</label>
     <input id="gv2-invest-ref" value={referrer} onChange={e=>setReferrer(e.target.value)} placeholder="0x…"/>
     {snapshot?.registered&&<p className="gv2-small">Registered V2 referrer: {snapshot.referrer===ZeroAddress?'None':v2Short(snapshot.referrer)}. This cannot be modified by a demo.</p>}
    </div>
    {previewResult.error&&<p className="gv2-error" role="alert">{previewResult.error}</p>}
    {preview&&<>
     <div className="gv2-invest-values">
      <div><span>Gross principal recorded (hypothetically)</span><b>{v2Money(preview.amount,decimals)} {asset}</b></div>
      <div><span>Illustrative USD value</span><b>USD {v2Money(preview.usdValue,18,2)}</b></div>
      <div><span>Resulting plan</span><b>{preview.plan}</b></div>
      <div><span>Principal lock / post-lock penalty</span><b>90 days / 30%</b></div>
      <div><span>Profit withdrawal fee / approval</span><b>3% / manager required</b></div>
      <div><span>Withdrawal cooldown / gross profit cap</span><b>72 hours / 10% of deposits + reinvest</b></div>
      <div><span>Activity eligibility</span><b>On-chain wallet check-in every 24h</b></div>
     </div>
     {preview.requiresAdminVipKyc&&<p className="gv2-invest-warning"><AlertTriangle size={16}/> VIP capital requires admin-approved KYC before a real contract deposit.</p>}
     <div className="gv2-buttons">
      <button type="button" className="gv2-primary" onClick={runDemo}><CheckCircle2 size={17}/> Run demo investment</button>
      <button type="button" onClick={()=>void readOracle()} disabled={!snapshot||!wallet||quoteBusy}>
       <RefreshCw size={16}/>{quoteBusy?'Reading…':'Read V2 oracle quote'}</button>
     </div>
     {quote&&<p className="gv2-message">Read-only on-chain quote: USD {v2Money(quote.usd,18,2)}, block {quote.block}. No deposit is authorized.</p>}
     {quoteError&&<p className="gv2-error" role="alert">{quoteError}</p>}
    </>}
    {message&&<p className="gv2-message" role="status">{message}</p>}
    <p className="gv2-small">No real BNB/USDT is transferred and no principal or profit appears in a public wallet or contract.</p>
   </section>
   <div className="gv2-investment-side">
    <section className="gv2-panel"><div className="gv2-panel-head"><h3><Coins size={18}/> Deposit routing preview</h3></div>
     {preview?<div className="gv2-invest-values">
      <div><span>Gross recorded principal</span><b>{v2Money(preview.amount,decimals)} {asset}</b></div>
      <div><span>Fee wallet A (10%)</span><b>{v2Money(preview.feeWallet1,decimals)}</b></div>
      <div><span>Fee wallet B (10%)</span><b>{v2Money(preview.feeWallet2,decimals)}</b></div>
      <div><span>Operations (remaining 80%)</span><b>{v2Money(preview.operations,decimals)}</b></div>
      <div><span>Cash retained in V2 vault from this deposit</span><b>0 {asset}</b></div>
     </div>:<p>Enter a valid amount to preview fund routing.</p>}
     <p className="gv2-invest-warning"><AlertTriangle size={16}/> Current V2 sends deposits to external wallets while recording full principal. Public deposits are disabled pending verifiable backing and independent audit.</p>
    </section>
    <section className="gv2-panel"><div className="gv2-panel-head"><h3><Layers size={18}/> Funded earnings and referral example</h3></div>
     {preview?<div className="gv2-invest-values">
      <div><span>Hypothetical daily allocation ceiling</span><b>{v2Money(preview.hypotheticalDailyCap,decimals)} {asset}</b></div>
      {preview.referralLevels.map(level=><div key={level.level}>
       <span>Referral level {level.level} · {Number(level.bps)/100}% of funded personal profit</span>
       <b>{v2Money(level.maximumForEligibleUpline,decimals)} {asset}</b>
      </div>)}
      <div><span>Funding needed if all uplines qualify</span><b>{v2Money(preview.maximumIllustrativeFundedRevenueNeeded,decimals)} {asset}</b></div>
     </div>:<p>Enter a valid amount to see conditional referral shares.</p>}
     <p className="gv2-small">These are examples and upper bounds. Contract credits depend on independently funded earnings and eligible accounts; returns are not guaranteed.</p>
    </section>
   </div>
  </div>
  <section className="gv2-panel">
   <div className="gv2-panel-head"><h3><Layers size={18}/> Demo positions — this browser only</h3>
    <button type="button" disabled={!positions.length} onClick={()=>{setPositions([]);setMessage('Local demo positions cleared.');}}>Reset simulation</button></div>
   {!positions.length?<p>Use Run demo investment to add a hypothetical position here without moving funds.</p>:
    positions.map(p=><div className="gv2-position" key={p.id}>
     <div><strong>Demo position #{p.id}</strong><small>Not on chain · {new Date(p.time).toLocaleTimeString()}</small></div>
     <div><b>{v2Money(p.amount,p.decimals)} {p.asset}</b><small>Illustrative USD {v2Money(p.usd,18,2)}</small></div>
     <div><span>{V2_PLAN_NAMES[p.tier]}</span><small>90-day illustrative lock</small></div>
    </div>)}
  </section>
  <div className="gv2-investment-foot"><a href={V2_EXPLORER+'/address/'+V2_ADDRESS} target="_blank" rel="noopener noreferrer">
   Inspect independent V2 contract <ExternalLink size={16}/></a>
   <p>Real deposits and investment commitments are not enabled in this unaudited testnet prototype.</p>
  </div>
 </div>;
}
