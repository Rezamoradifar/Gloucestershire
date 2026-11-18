import {useId,type FormEvent} from 'react';
import {formatUnits} from 'ethers';
import {formatUtcTime} from './utc-time';
import type {V3Snapshot} from './v3-chain';
import type {V3WithdrawalKind} from './v3-withdrawal-form';
import {planV3AccountWithdrawal,summarizeV3AccountWithdrawal,v3AccountTotals} from './v3-account-withdrawal';

export type V3AccountWithdrawalFormProps={view:V3Snapshot;unified:boolean;busy:boolean;readOnly:boolean;
 value:string;kind:V3WithdrawalKind;onValue:(value:string)=>void;onKind:(kind:V3WithdrawalKind)=>void;onSubmit:()=>void};

export function accountWithdrawalFormState(props:V3AccountWithdrawalFormProps){
 const {view,unified,kind,value}=props;
 let totals:ReturnType<typeof v3AccountTotals>|null=null;
 let summary:ReturnType<typeof summarizeV3AccountWithdrawal>|null=null,balanceError='',coverageError='',error='';
 try{totals=v3AccountTotals(view.positions);}
 catch(e){balanceError=e instanceof Error?e.message:'The account balances could not be verified.';}
 try{summary=summarizeV3AccountWithdrawal(view,unified);}
 catch(e){coverageError=e instanceof Error?e.message:'Complete withdrawal records are unavailable.';}
 let plan:ReturnType<typeof planV3AccountWithdrawal>|null=null;
 if(value.trim())try{plan=planV3AccountWithdrawal(view,value,kind,unified);}
 catch(e){error=e instanceof Error?e.message:'Invalid withdrawal request.';}
 const amount=plan?.source==='position'?plan.action.amount:plan?.amount??null;
 const fee=amount===null?null:amount*(kind==='principal'?3000n:300n)/10000n;
 const ready=view.registered&&!view.suspended&&!view.paused&&!view.pendingWithdrawal&&view.asOf>=view.nextRequestAt;
 const cap=view.ledger.requestCap;
 const balance=kind==='referral'?view.referralAvailable:view.networkAvailable;
 const maximum=kind==='profit'?summary?.maxProfit??null:kind==='principal'?summary?.maxPrincipal??null:
  ready?(balance<cap?balance:cap):0n;
 return {totals,summary,balanceError,coverageError:(kind==='profit'||kind==='principal')?coverageError:'',error,
  amount,fee,net:amount===null||fee===null?null:amount-fee,maximum,
  canSubmit:totals!==null&&!props.busy&&!props.readOnly&&plan!==null&&!error};
}

export default function V3AccountWithdrawalForm(props:V3AccountWithdrawalFormProps){
 const id=useId(),state=accountWithdrawalFormState(props),totals=state.totals;
 function submit(event:FormEvent){event.preventDefault();if(state.canSubmit)props.onSubmit();}
 if(!totals)return <section aria-label="Account withdrawal"><h3>Withdraw from your account</h3>
  <p role="alert">{state.balanceError}</p><p>Refresh the verified account before requesting a withdrawal.</p></section>;
 return <section aria-label="Account withdrawal">
  <h3>Withdraw from your account</h3>
  <div className="gv2-detail"><span>Total principal</span><b>{formatUnits(totals.principal,18)} USDT</b></div>
  <div className="gv2-detail"><span>Total recorded profit</span><b>{formatUnits(totals.profit,18)} USDT</b></div>
  <div className="gv2-detail"><span>Recorded daily profit</span><b>{formatUnits(totals.daily,18)} USDT</b></div>
  <div className="gv2-detail"><span>Recorded profit-on-profit</span><b>{formatUnits(totals.compound,18)} USDT</b></div>
  <div className="gv2-detail"><span>Profit reserved for pending withdrawal</span><b>{formatUnits(totals.pendingProfit,18)} USDT</b></div>
  <p>Enter the amount once. Eligible records are selected automatically. Existing contract limits apply to each request.</p>
  <form onSubmit={submit} className="gv3-input-row">
   <label htmlFor={id+'-kind'}>Withdrawal type</label>
   <select id={id+'-kind'} value={props.kind} disabled={props.busy} onChange={e=>props.onKind(e.target.value as V3WithdrawalKind)}>
    <option value="profit">Accrued profit</option><option value="referral">Referral claim</option>
    <option value="network">Network milestone claim</option><option value="principal">Unlocked principal</option>
   </select>
   <label htmlFor={id+'-amount'}>Gross amount in USDT</label>
   <input id={id+'-amount'} value={props.value} onChange={e=>props.onValue(e.target.value)} disabled={props.busy}
    inputMode="decimal" autoComplete="off" placeholder="0.00"/>
   <p>Maximum this dashboard can submit in one request: <strong>{state.maximum===null?'Awaiting complete records':formatUnits(state.maximum,18)+' USDT'}</strong>.</p>
   {props.view.nextRequestAt>props.view.asOf&&<p>Withdrawal cooldown ends at {formatUtcTime(props.view.nextRequestAt)}.</p>}
   {props.kind==='principal'?<p>Each addition keeps its 90-day lock. Principal withdrawal penalty: 30%.</p>:
    <p>Profit, referral and network withdrawal fee: 3%.</p>}
   {state.amount!==null&&state.fee!==null&&state.net!==null&&<p aria-live="polite">
    Gross: {formatUnits(state.amount,18)} USDT · Fee: {formatUnits(state.fee,18)} USDT · Net: {formatUnits(state.net,18)} USDT.
   </p>}
   {state.coverageError&&<p role="status">{state.coverageError}</p>}
   {state.error&&state.error!==state.coverageError&&<p role="alert">{state.error}</p>}
   {props.readOnly&&<p role="status">This testnet release is open for viewing only. Wallet requests are disabled.</p>}
   <p>Requests need manager approval and actual test-token funding before payment.{!props.view.singleCapital&&' The current contract cannot combine separate positions into one request.'}</p>
   <button className="gv2-primary" type="submit" disabled={!state.canSubmit}>Review & sign withdrawal request</button>
  </form>
 </section>;
}
