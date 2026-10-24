import {useEffect,useRef,useState} from 'react';
import {errorText,readCustomerStatus,type CustomerStatusAction,type CustomerStatusSnapshot} from './chain';

export default function CustomerStatus({who,connected,disabled,onSubmit}:{who:string;connected:boolean;disabled:boolean;onSubmit:(action:CustomerStatusAction)=>Promise<boolean>}){
 const [customer,setCustomer]=useState(''),[loaded,setLoaded]=useState<CustomerStatusSnapshot|null>(null),[active,setActive]=useState(false),[kyc,setKyc]=useState(false),[review,setReview]=useState<CustomerStatusAction|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const revision=useRef(0),inFlight=useRef(false);
 useEffect(()=>{revision.current++;setLoaded(null);setReview(null);setError('');setNotice('');setLoading(false);return()=>{revision.current++;};},[who,connected]);
 const busy=disabled||loading;
 async function load(){
  if(!connected||busy||inFlight.current)return;const id=++revision.current;inFlight.current=true;setLoading(true);setError('');setNotice('');setLoaded(null);setReview(null);
  try{const result=await readCustomerStatus(who,customer.trim());if(id===revision.current){setLoaded(result);setActive(result.active);setKyc(result.kyc);}}
  catch(e){if(id===revision.current)setError(errorText(e));}
  finally{inFlight.current=false;if(id===revision.current)setLoading(false);}
 }
 async function submit(){
  if(!review||!connected||busy||inFlight.current)return;const id=++revision.current;inFlight.current=true;setLoading(true);setError('');setNotice('');
  try{if(await onSubmit(review)&&id===revision.current){const result=await readCustomerStatus(who,review.review.customer);if(id===revision.current){setLoaded(result);setActive(result.active);setKyc(result.kyc);setReview(null);setNotice('Current customer status has been read again from the contract.');}}}
  catch(e){if(id===revision.current)setError(errorText(e));}
  finally{inFlight.current=false;if(id===revision.current)setLoading(false);}
 }
 return <section className="panel"><div className="panel-title"><h2>Customer activity & KYC</h2></div><p className="muted">An authorized reporter, including an owner with that role, can review a registered customer and explicitly update their activity or KYC status. Active-direct counts follow the contract automatically. Set KYC only after completing your verification process.</p>
  <label className="field">Registered customer wallet<input dir="ltr" value={customer} placeholder="0x…" disabled={!connected||busy} onChange={e=>{revision.current++;setCustomer(e.target.value);setLoaded(null);setReview(null);setError('');setNotice('');}}/></label>
  <button className="small-button" type="button" disabled={!connected||busy||!customer.trim()} onClick={()=>void load()}>{loading?'Checking…':'Load customer status'}</button>
  {error&&<p className="inline-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {loaded&&<><div className="plan-detail"><span>Customer</span><bdi>{loaded.customer}</bdi></div><div className="plan-detail"><span>Current activity</span><strong>{loaded.active?'Active':'Inactive'}</strong></div><div className="plan-detail"><span>Current KYC</span><strong>{loaded.kyc?'Verified':'Not verified'}</strong></div><p className="muted">Read from block {loaded.block}.</p>
   <label className="field"><span><input type="checkbox" style={{width:'auto',marginRight:8}} checked={active} disabled={busy} onChange={e=>{setActive(e.target.checked);setReview(null);}}/>Requested activity: active</span></label>
   <label className="field"><span><input type="checkbox" style={{width:'auto',marginRight:8}} checked={kyc} disabled={busy} onChange={e=>{setKyc(e.target.checked);setReview(null);}}/>Requested KYC: verified</span></label>
   <button className="small-button" type="button" disabled={busy||(active===loaded.active&&kyc===loaded.kyc)} onClick={()=>setReview({review:loaded,active,kyc})}>Review status change</button>
  </>}
  {review&&<div className="operation-summary"><h3>Review customer status change</h3><p>Customer: <bdi>{review.review.customer}</bdi></p><p>Activity: {review.review.active?'Active':'Inactive'} → {review.active?'Active':'Inactive'}<br/>KYC: {review.review.kyc?'Verified':'Not verified'} → {review.kyc?'Verified':'Not verified'}</p><p>Network: {review.review.chainId}<br/>Contract: <bdi>{review.review.vaultAddress}</bdi><br/>Administrator wallet: <bdi>{review.review.operator}</bdi></p><button className="primary-button" type="button" disabled={busy||!connected} onClick={()=>void submit()}>Confirm status in wallet</button><button className="small-button" type="button" disabled={busy} onClick={()=>setReview(null)}>Cancel review</button></div>}
 </section>;
}
