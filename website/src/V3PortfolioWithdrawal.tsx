import {useId,useState} from 'react';
import {formatUnits} from 'ethers';
import {ArrowDownLeft,ArrowRight,LockKeyhole} from 'lucide-react';
import type {V3Snapshot} from './v3-chain';
import {availableAccountEarnings,totalAccountEarnings} from './v3-account-earnings';
import {portfolioLimits,portfolioQuote,type PortfolioAction} from './v3-portfolio';
import {formatShare,formatV3Amount as money} from './v3-format';
import {parseV3Amount} from './v3-withdrawal-form';
import {formatUtcTime} from './utc-time';

const sources=[['personal','Personal profit'],['referral','Referral commission'],['network','Network rewards']] as const;
type Props={view:V3Snapshot;value:string;busy:boolean;readOnly:boolean;onValue:(s:string)=>void;
 onPage:(start:number)=>void;onSubmit:(action:PortfolioAction,description:string)=>void};

export default function V3PortfolioWithdrawal({view,value,onValue,onPage,busy,readOnly,onSubmit}:Props){
 const id=useId(),[includePrincipal,setIncludePrincipal]=useState(false);
 const balances=availableAccountEarnings(view),total=totalAccountEarnings(balances);
 let limits:ReturnType<typeof portfolioLimits>|undefined,quote:ReturnType<typeof portfolioQuote>|undefined,error='';
 try{limits=portfolioLimits(view);}catch(e){error=(e as Error).message;}
 if(value.trim()&&limits)try{quote=portfolioQuote(limits,parseV3Amount(value),includePrincipal);}catch(e){error=(e as Error).message;}
 const hold=readOnly?'This release is read-only.':view.paused?'Withdrawals are paused.':view.suspended?'Account suspended.':
  !view.registered?'Register your wallet to request a withdrawal.':view.pendingWithdrawal?'An earlier request is open.':
  view.nextRequestAt>view.asOf?'Next request opens '+formatUtcTime(view.nextRequestAt)+'.':'';
 const maximum=limits?limits.earnings+(includePrincipal?limits.principal:0n):null;
 const disabled=busy||!!hold||!limits||!maximum;
 const reserved=view.referralReserved+view.networkReserved+view.positions.reduce((sum,p)=>sum+p.reservedProfit,0n);
 const totalBasis=view.originalDeposits+view.reinvestments;
 const page=view.withdrawalPage;
 function submit(){
  if(!quote||disabled)return;
  const {action,earningsFee,principalFee,net}=quote,p=action.parts;
  const exact=(n:bigint)=>formatUnits(n,18);
  onSubmit(action,'One withdrawal of '+exact(action.amount)+' test USDT. Personal profit '+exact(p.personal)+
   ', referral '+exact(p.referral)+', network '+exact(p.network)+', unlocked principal '+exact(p.principal)+
   '. Earnings fee '+exact(earningsFee)+', principal deduction '+exact(principalFee)+'. Net if paid '+exact(net)+' test USDT.');
 }
 return <section className="gv2-panel gdp-withdraw" aria-labelledby="account-withdraw-heading">
  <header className="gdp-title"><div><h2 id="account-withdraw-heading" tabIndex={-1}>Withdraw earnings</h2><p>One request across your account</p></div><ArrowDownLeft aria-hidden="true"/></header>
  <div className="gdp-withdraw-balance"><small>Available to request now</small><strong>{maximum===null?'—':money(maximum)} <span>test USDT</span></strong>
   <small>{limits&&total>0n?formatShare(limits.earnings,total)+' of posted earnings available':'Posted earnings '+money(total)+' test USDT'}</small></div>
  <div className="gdp-sources">{sources.map(([key,label])=><div key={key} data-source={key}><i/><span>{label}</span><b>{money(balances[key])}</b><small>{formatShare(balances[key],total)}</small></div>)}</div>
  <p className="gdp-caption">Earnings cap per request <b>{money(view.ledger.requestCap)} test USDT</b> · {totalBasis?formatShare(view.ledger.requestCap,totalBasis):'10%'} of deposits and reinvestments. {reserved>0n&&('Reserved earnings '+money(reserved)+' test USDT.')}</p>
  {page&&<div className="gv3-window"><span>Additions {page.start+1}–{page.start+page.lots.length} of {page.totalLots}</span>
   <button disabled={busy||page.start===0} onClick={()=>onPage(Math.max(0,page.start-page.limit))}>Previous additions</button>
   <button disabled={busy||page.start+page.limit>=page.totalLots} onClick={()=>onPage(page.start+page.limit)}>Next additions</button></div>}
  {(page||(view.unifiedPage?.totalLots??0)>64)&&<p className="gdp-caption">The request limit uses up to 64 consecutive additions per balance within the verified records shown.</p>}
  <form onSubmit={e=>{e.preventDefault();submit();}}>
   <label className="gdp-principal"><input type="checkbox" checked={includePrincipal} disabled={busy||!!hold||!limits?.principal}
    onChange={e=>{setIncludePrincipal(e.target.checked);onValue('');}}/><span>Include unlocked principal<small>{limits?money(limits.principal):'—'} test USDT · 90-day lock · 30% deduction</small></span><LockKeyhole size={16}/></label>
   <label htmlFor={id+'-gross'}>Gross amount</label><div className="gdp-amount"><input id={id+'-gross'} inputMode="decimal" autoComplete="off" value={value}
    disabled={disabled} onChange={e=>onValue(e.target.value)} placeholder="0.00" aria-invalid={!!error&&!!value}/><span>test USDT</span></div>
   <div className="gdp-presets" aria-label="Share of the current withdrawal limit">{[25,50,75,100].map(n=><button key={n} type="button"
    disabled={disabled||!maximum||maximum*BigInt(n)/100n===0n} onClick={()=>onValue(formatUnits(maximum!*BigInt(n)/100n,18))}>{n}%</button>)}</div>
   {quote&&<div className="gdp-receipt" aria-live="polite"><div><span>Earnings fee · 2%</span><b>{formatUnits(quote.earningsFee,18)}</b></div>
    {quote.action.parts.principal>0n&&<div><span>Principal deduction · 30%</span><b>{formatUnits(quote.principalFee,18)}</b></div>}
    <div><span>Net if paid</span><strong>{formatUnits(quote.net,18)} test USDT</strong></div>
    <details><summary>Amounts included</summary>{[...sources,['principal','Unlocked principal'] as const].map(([key,label])=>
     <div key={key}><span>{label}</span><b>{formatUnits(quote!.action.parts[key],18)}</b></div>)}</details></div>}
   {(hold||error)&&<p role="status" className="gdp-caption">{hold||error}</p>}
   <button type="submit" className="gv2-primary" disabled={disabled||!quote}>Review withdrawal <ArrowRight size={16}/></button>
  </form><p className="gdp-caption">Manager approval and funding are required for payment. The plan allows one open request and a 72-hour interval.</p>
 </section>;
}
