import {useState} from 'react';
import {formatUnits} from 'ethers';
import {availableAccountEarnings,totalAccountEarnings} from './v3-account-earnings';
import {formatV3Amount} from './v3-format';
import {parseV3Amount} from './v3-withdrawal-form';
import type {V3Snapshot} from './v3-chain';

type Props={view:V3Snapshot;busy:boolean;readOnly:boolean;onSubmit:(amount:bigint)=>Promise<boolean|void>};

export default function V3AccountReinvestment({view,busy,readOnly,onSubmit}:Props){
 const [input,setInput]=useState('');
 const earnings=availableAccountEarnings(view),total=totalAccountEarnings(earnings);
 const headroom=50_000n*10n**18n-view.capital;
 const max=view.vipKyc||total<=headroom?total:headroom>0n?headroom:0n;
 const enabled=view.registered&&!view.suspended&&!view.paused&&!readOnly;
 let amount=0n,error='';
 if(input.trim()){
  try{amount=parseV3Amount(input);}
  catch{error='Enter a positive amount with up to 18 decimal places.';}
  if(amount>max)error='Maximum available for this account is '+formatUnits(max,18)+' test USDT.';
 }
 return <section className="gv2-panel gv3-account-earnings" aria-labelledby="account-earnings-title">
  <h3 id="account-earnings-title">Reinvest account earnings</h3>
  <div className="gv3-earnings-total"><span>Available to reinvest</span>
   <strong>{formatV3Amount(max)} <small>test USDT</small></strong></div>
  <dl>{([['Personal profit',earnings.personal],['Referral commission',earnings.referral],['Network rewards',earnings.network]] as const)
   .map(([name,value])=><div key={name}><dt>{name}</dt><dd>{formatV3Amount(value)}</dd></div>)}</dl>
  <p>Posted earnings add to your existing account when you sign. Each addition has its own 90-day lock.</p>
  {max<total&&<p>Your recorded earnings total {formatV3Amount(total)} test USDT. The account principal limit caps this addition at {formatV3Amount(max)}.</p>}
  <form className="gv3-input-row" onSubmit={async event=>{
   event.preventDefault();
   if(enabled&&!busy&&!error&&amount>0n&&await onSubmit(amount))setInput('');
  }}>
   <label htmlFor="account-earnings-amount">Amount to reinvest (test USDT)</label>
   <div className="gv3-earnings-input"><input id="account-earnings-amount" value={input} inputMode="decimal"
    placeholder="0.00" autoComplete="off" disabled={busy||!enabled} aria-invalid={Boolean(error)}
    aria-describedby={error?'account-earnings-error':undefined} onChange={event=>setInput(event.target.value)}/>
    <button type="button" disabled={busy||!enabled||max===0n} onClick={()=>setInput(formatUnits(max,18))}>Use max</button></div>
   {error&&<small id="account-earnings-error" role="status">{error}</small>}
   {total===0n&&<small>Available profit and rewards will appear here once recorded.</small>}
   <button className="gv2-primary" disabled={busy||!enabled||amount<=0n||Boolean(error)}>Review reinvestment</button>
  </form>
 </section>;
}
