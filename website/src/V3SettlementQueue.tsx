import {useEffect,useRef,useState,type ReactNode} from 'react';
import {formatUnits} from 'ethers';
import {getWalletProvider} from './wallet';
import {readV3ManagerQueue} from './v3-actions';
import {v3WithdrawalFee} from './v3-withdrawal-form';
import type {V3Withdrawal} from './v3-chain';
import type {V3SiteReleaseConfig} from './v3-site-config';
import type {V3WithdrawalAnchor} from './v3-withdrawal-history';

type Queue=Awaited<ReturnType<typeof readV3ManagerQueue>>;
const amount=(value:bigint)=>formatUnits(value,18).replace(/\.0$/,'')+' test USDT';

export function V3SettlementBreakdown({request}:{request:V3Withdrawal}){
 const parts=request.allocation;
 if(!parts)return null;
 const earnings=parts.personal+parts.referral+parts.network;
 const lines=[
  ['Personal profit',parts.personal],['Referral commission',parts.referral],['Network rewards',parts.network],
  ['Unlocked principal',parts.principal],['Earnings fee (2%)',v3WithdrawalFee(earnings,false,true)],
  ['Principal deduction (30%)',v3WithdrawalFee(parts.principal,true)],['Net payout',request.gross-request.fee]
 ] as const;
 return <details className="gdp-member-more gv3-settlement-breakdown">
  <summary>Sources and deductions</summary><dl>{lines.map(([label,value])=>
   <div key={label}><dt>{label}</dt><dd>{amount(value)}</dd></div>)}</dl>
 </details>;
}

export default function V3SettlementQueue({wallet,config,busy,renderRequest}:{
 wallet:string;config:V3SiteReleaseConfig;busy:boolean;renderRequest:(request:V3Withdrawal)=>ReactNode
}){
 const [page,setPage]=useState(0),[attempt,setAttempt]=useState(0);
 const [input,setInput]=useState(''),[requestId,setRequestId]=useState<number|null>(null),[inputError,setInputError]=useState('');
 const [data,setData]=useState<Queue|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const anchor=useRef<V3WithdrawalAnchor|null>(null);
 useEffect(()=>{
  let active=true;
  const provider=getWalletProvider();
  setLoading(true);setData(null);setError('');
  if(!provider){setLoading(false);setError('Reconnect an authorized wallet to load the queue.');return;}
  void readV3ManagerQueue(provider,wallet,config,page,anchor.current,requestId).then(result=>{
   if(active){anchor.current=result.anchor;setData(result);}
  }).catch(reason=>{
   if(active)setError(reason instanceof Error&&reason.message.length<175?reason.message:'Unable to verify this queue. Refresh to retry.');
  }).finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[wallet,config,page,requestId,attempt]);
 function refresh(id=requestId){
  anchor.current=null;setPage(0);setRequestId(id);setAttempt(n=>n+1);
 }
 function find(){
  if(!/^[1-9]\d*$/.test(input.trim())||!Number.isSafeInteger(Number(input))){
   setInputError('Enter a whole request number starting at 1.');return;
  }
  setInputError('');refresh(Number(input)-1);
 }
 return <section className="gv3-settlement-queue" aria-labelledby="gv3-settlement-title">
  <div className="gv2-panel-head"><h3 id="gv3-settlement-title">Withdrawal queue</h3>
   <button type="button" disabled={busy||loading} onClick={()=>refresh()}>Refresh queue</button></div>
  <form className="gv3-settlement-search" onSubmit={e=>{e.preventDefault();find();}}>
   <label>Request number<input type="text" inputMode="numeric" value={input} onChange={e=>setInput(e.target.value)} placeholder="e.g. 12"/></label>
   <button type="submit" disabled={busy||loading}>Find request</button>
   {requestId!==null&&<button type="button" disabled={busy||loading} onClick={()=>{setInput('');setInputError('');refresh(null);}}>Show latest</button>}
  </form>
  {inputError&&<p role="alert" className="gv2-error">{inputError}</p>}
  {loading&&<p role="status">Loading confirmed withdrawal requests…</p>}
  {error&&<p role="alert" className="gv2-error">{error}</p>}
  {data&&!loading&&<>
   <p className="gv3-history-range">{requestId===null?'Page '+(page+1)+' · ':''}{data.count} total requests · Confirmed block {data.anchor.block.toLocaleString('en-US')}</p>
   {data.requests.map(renderRequest)}
   {!data.requests.length&&<p>{requestId!==null?'This request number does not exist at the confirmed block.':'No withdrawal requests have been recorded.'}</p>}
   {requestId===null&&data.count>20&&<div className="gv2-buttons">
    <button type="button" disabled={busy||page===0} onClick={()=>setPage(n=>n-1)}>Newer requests</button>
    <button type="button" disabled={busy||(page+1)*20>=data.count} onClick={()=>setPage(n=>n+1)}>Older requests</button>
   </div>}
  </>}
 </section>;
}
