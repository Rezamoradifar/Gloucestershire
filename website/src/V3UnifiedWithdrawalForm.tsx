import {useId,useState,type FormEvent} from 'react';
import {formatUnits} from 'ethers';
import {parseV3Amount,v3WithdrawalFee,v3ProfitFeeBps} from './v3-withdrawal-form';
import {prepareUnifiedPageAction,type UnifiedPositionPage} from './v3-unified-position';

type WithdrawalKind='profit'|'principal';
export type V3UnifiedWithdrawalFormProps={
 page:UnifiedPositionPage;manualReinvest?:boolean;busy:boolean;readOnly:boolean;disabledReason?:string;registered:boolean;suspended:boolean;
 paused:boolean;pendingWithdrawal:boolean;nextRequestAt:number;requestCap:bigint;
 value:string;onValue:(value:string)=>void;onSubmit:(kind:WithdrawalKind)=>void;
 onPrevious:()=>void;onNext:()=>void;
};

// The request adapter re-reads exactly eight additions starting at page.start.
// Fail closed if the displayed page would describe a different range.
export function unifiedWithdrawalFormState(props:V3UnifiedWithdrawalFormProps,kind:WithdrawalKind){
 const {page,value,registered,suspended,paused,pendingWithdrawal,nextRequestAt,requestCap,busy,readOnly}=props;
 const pageValid=Number.isSafeInteger(page.start)&&page.start>=0&&page.limit===8&&
  Number.isSafeInteger(page.totalLots)&&page.totalLots>page.start&&
  Number.isSafeInteger(page.asOf)&&page.asOf>=0&&Number.isSafeInteger(page.block)&&page.block>0&&
  page.lots.length===Math.min(8,page.totalLots-page.start)&&
  page.lots.every((lot,index)=>lot.id===page.start+index);
 let amount:bigint|null=null,error='';
 if(!pageValid)error='The selected page cannot be verified. Refresh before continuing.';
 else if(value.trim()){
  try{
   amount=parseV3Amount(value);
   prepareUnifiedPageAction(page,{registered,suspended,paused,pendingWithdrawal,nextRequestAt,requestCap},kind,amount);
  }catch(e){error=e instanceof Error?e.message:'Invalid withdrawal request.';amount=null;}
 }
 const active=registered&&!suspended&&!paused&&!pendingWithdrawal&&
  Number.isSafeInteger(nextRequestAt)&&nextRequestAt>=0&&page.asOf>=nextRequestAt;
 const fee=amount===null?null:v3WithdrawalFee(amount,kind==='principal',props.manualReinvest);
 return {amount,fee,net:fee===null||amount===null?null:amount-fee,error,
  canSubmit:pageValid&&active&&!busy&&!readOnly&&amount!==null&&!error};
}

export default function V3UnifiedWithdrawalForm(props:V3UnifiedWithdrawalFormProps){
 const {page,busy,readOnly,value,onValue,onSubmit,onPrevious,onNext}=props;
 const [kind,setKind]=useState<WithdrawalKind>('profit');
 const id=useId(),state=unifiedWithdrawalFormState(props,kind);
 const last=page.start+page.lots.length;
 const maximumProfit=props.requestCap<page.availableProfitOnPage?props.requestCap:page.availableProfitOnPage;
 function submit(event:FormEvent){
  event.preventDefault();
  if(state.canSubmit)onSubmit(kind);
 }
 return <section className="gv2-panel" aria-label="Unified reinvestment withdrawal">
  <h3>Request from reinvestment position #{page.positionId+1}</h3>
  <p>Verified block {page.block.toLocaleString('en-US')} · Additions {page.start+1}–{last} of {page.totalLots}.</p>
  <p>Recorded profit on this page: <strong>{formatUnits(page.availableProfitOnPage,18)} USDT</strong> ·
   {' '}Unlocked principal on this page: <strong>{formatUnits(page.maturedPrincipalOnPage,18)} USDT</strong>.</p>
  <p>Maximum profit request on this page: <strong>{formatUnits(maximumProfit,18)} USDT</strong>.</p>
  <p>Each request uses only the additions shown on this page, up to eight. Other additions require a separate request and its cooldown.</p>
  <div className="gv2-buttons">
   <button type="button" disabled={busy||page.start===0} onClick={onPrevious}>Previous additions</button>
   <button type="button" disabled={busy||last>=page.totalLots} onClick={onNext}>Next additions</button>
  </div>
  <form onSubmit={submit} className="gv3-input-row">
   <label htmlFor={id+'-kind'}>Request type</label>
   <select id={id+'-kind'} disabled={busy} value={kind} onChange={event=>setKind(event.target.value as WithdrawalKind)}>
    <option value="profit">Recorded position profit</option><option value="principal">Unlocked principal</option>
   </select>
   <label htmlFor={id+'-amount'}>Gross amount in USDT</label>
   <input id={id+'-amount'} disabled={busy} value={value} onChange={event=>onValue(event.target.value)}
    inputMode="decimal" autoComplete="off" placeholder="0.00"/>
   <p>Profit request fee: {Number(v3ProfitFeeBps(props.manualReinvest))/100}%. Principal request penalty: 30%.</p>
   <p>{kind==='profit'?'The verified profit request cap also applies.':
    'Each addition must be past its own 90-day lock.'}</p>
   {state.amount!==null&&state.fee!==null&&state.net!==null&&<p aria-live="polite">
    Gross: {formatUnits(state.amount,18)} USDT · Fee: {formatUnits(state.fee,18)} USDT · Net: {formatUnits(state.net,18)} USDT.
   </p>}
   {state.error&&<p role="alert">{state.error}</p>}
   {readOnly&&<p role="status">{props.disabledReason??'This test preview is read-only; a withdrawal request cannot be submitted.'}</p>}
   <p>Requests need manager approval and actual test-token funding. A request is not a payment.</p>
   <button type="submit" disabled={!state.canSubmit}>Review withdrawal request</button>
  </form>
 </section>;
}
