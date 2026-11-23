import {useId} from 'react';
import {formatUnits} from 'ethers';
import {ArrowDownLeft,Check,Coins,GitBranch,Users} from 'lucide-react';
import {availableAccountEarnings,totalAccountEarnings} from './v3-account-earnings';
import {accountWithdrawalFormState,type V3AccountWithdrawalFormProps} from './V3AccountWithdrawalForm';
import {formatV3Amount as money} from './v3-format';
import {formatUtcTime} from './utc-time';
import type {V3WithdrawalKind} from './v3-withdrawal-form';
import {v3ProfitFeeBps} from './v3-withdrawal-form';

const sources=[
 {kind:'profit',balance:'personal',label:'Personal profit',Icon:Coins},
 {kind:'referral',balance:'referral',label:'Referral commission',Icon:Users},
 {kind:'network',balance:'network',label:'Network rewards',Icon:GitBranch}
] as const;

type Props=V3AccountWithdrawalFormProps&{
 onKind:(kind:V3WithdrawalKind)=>void;
 onPage:(start:number)=>void;
};

export default function V3EarningsWithdrawal(props:Props){
 const id=useId();
 const {view,kind,busy,readOnly,onKind}=props;
 const state=accountWithdrawalFormState(props);
 const earnings=availableAccountEarnings(view);
 const reserved=view.positions.reduce((sum,p)=>sum+p.reservedProfit,view.referralReserved+view.networkReserved);
 const principal=kind==='principal';
 const sourceName=sources.find(source=>source.kind===kind)?.label??'Unlocked principal';
 const needsLots=principal||kind==='profit';
 const page=needsLots?view.withdrawalPage:undefined;
 const feeRate=principal?30:Number(v3ProfitFeeBps(view.manualReinvest))/100;
 let hold='';
 if(readOnly)hold='This testnet release is open for viewing only.';
 else if(view.paused)hold='The contract has paused withdrawals.';
 else if(view.suspended)hold='Withdrawals are suspended for this account.';
 else if(!view.registered)hold='Register this wallet to request a withdrawal.';
 else if(view.pendingWithdrawal)hold='An earlier request is open. Follow its status below.';
 else if(view.asOf<view.nextRequestAt)hold='The next request opens at '+formatUtcTime(view.nextRequestAt)+'.';
 function choose(next:V3WithdrawalKind){
  if(next!==kind){props.onValue('');onKind(next);}
 }
 return <section className="gv2-panel gv3-withdraw-center" aria-labelledby="account-withdraw-heading">
  <header className="gv3-earnings-head"><div><h2 id="account-withdraw-heading" tabIndex={-1}>Withdraw earnings</h2>
   <p>Available across all earnings sources</p></div><ArrowDownLeft aria-hidden="true" size={24}/></header>
  <div className="gv3-pool-total"><strong>{money(totalAccountEarnings(earnings))}</strong><span>test USDT</span></div>
  {reserved>0n&&<p className="gv3-held-amount">Reserved for open requests <b>{money(reserved)} test USDT</b></p>}
  <form onSubmit={event=>{event.preventDefault();if(!hold&&state.canSubmit)props.onSubmit();}}>
   <fieldset disabled={busy} className="gv3-earnings-sources"><legend>Choose one source per request</legend>
    {sources.map(({kind:source,balance,label,Icon})=><label className={'gv3-source gv3-source-'+balance} key={source}>
     <input type="radio" name={id+'-source'} checked={kind===source} value={source} onChange={()=>choose(source)}/>
     <Icon size={18} aria-hidden="true"/><span>{label}<strong>{money(earnings[balance])}</strong></span>
     <Check className="gv3-source-check" size={16} aria-hidden="true"/>
    </label>)}
    <label className="gv3-principal-source"><input type="radio" name={id+'-source'} checked={principal} value="principal"
     onChange={()=>choose('principal')}/> Withdraw unlocked principal separately</label>
   </fieldset>
   <div className="gv3-withdraw-editor">
    <div className="gv3-withdraw-limit"><span>{sourceName} · request limit now</span>
     <strong>{state.maximum===null?'Awaiting records':money(state.maximum)+' test USDT'}</strong></div>
    {page&&<div className="gv3-window"><span>Additions {page.start+1}–{page.start+page.lots.length} of {page.totalLots}</span>
     <button type="button" disabled={busy||page.start===0} onClick={()=>props.onPage(Math.max(0,page.start-page.limit))}>Previous additions</button>
     <button type="button" disabled={busy||page.start+page.lots.length>=page.totalLots} onClick={()=>props.onPage(page.start+page.limit)}>Next additions</button></div>}
    <label htmlFor={id+'-amount'}>Gross amount (test USDT)</label>
    <div className="gv3-withdraw-input"><input id={id+'-amount'} inputMode="decimal" autoComplete="off" value={props.value}
     placeholder="0.00" disabled={busy||Boolean(hold)} onChange={event=>props.onValue(event.target.value)}
     aria-invalid={Boolean(state.error)} aria-describedby={state.error?id+'-error':undefined}/>
     <button type="button" disabled={busy||Boolean(hold)||!state.maximum} onClick={()=>state.maximum!==null&&props.onValue(formatUnits(state.maximum,18))}>Use max</button></div>
    {state.amount!==null&&state.net!==null&&state.fee!==null?<dl className="gv3-withdraw-receipt" aria-live="polite">
     <div><dt>{principal?'Deduction':'Fee'} ({feeRate}%)</dt><dd>{formatUnits(state.fee,18)} test USDT</dd></div>
     <div><dt>Net if paid</dt><dd>{formatUnits(state.net,18)} test USDT</dd></div>
    </dl>:<p>{principal?'Each addition unlocks after 90 days. Principal deduction: '+feeRate+'%.':'Withdrawal fee: '+feeRate+'%.'}</p>}
    {state.coverageError&&!hold&&<p role="status">{state.coverageError}</p>}
    {state.error&&state.error!==state.coverageError&&!hold&&<p className="gv3-field-error" role="status" id={id+'-error'}>{state.error}</p>}
    {hold&&<p role="status">{hold}</p>}
    <button type="submit" className="gv2-primary" disabled={Boolean(hold)||!state.canSubmit}>Review withdrawal</button>
   </div>
  </form>
  <p className="gv3-withdraw-note">One request can be open at a time. Payment requires manager approval and available test tokens.</p>
 </section>;
}
