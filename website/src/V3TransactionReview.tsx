import {useCallback,useEffect,useRef,useState} from 'react';

type Review={title:string;description:string;wallet:string;contract:string;confirmLabel?:string};

export function useV3TransactionReview(){
 const [review,setReview]=useState<Review|null>(null);
 const pending=useRef<((accepted:boolean)=>void)|null>(null);
 const finish=useCallback((accepted:boolean)=>{
  const resolve=pending.current;
  if(!resolve)return;
  pending.current=null;
  setReview(null);
  resolve(accepted);
 },[]);
 const request=useCallback((details:Review)=>{
  if(pending.current)return Promise.resolve(false);
  return new Promise<boolean>(resolve=>{pending.current=resolve;setReview(details);});
 },[]);
 useEffect(()=>()=>{pending.current?.(false);pending.current=null;},[]);
 return {review,request,finish};
}

export function V3TransactionReview({review,onFinish}:{review:Review;onFinish:(accepted:boolean)=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const element=dialog.current;
  if(!element)return;
  if(typeof element.showModal==='function')element.showModal();
  else element.setAttribute('open','');
  return ()=>{if(typeof element.close==='function')element.close();};
 },[]);
 return <dialog ref={dialog} className="confirm-dialog gv3-transaction-review" aria-labelledby="v3-review-title"
  onCancel={event=>{event.preventDefault();onFinish(false);}}>
  <h2 id="v3-review-title">{review.title}</h2>
  <p>BNB Smart Chain Testnet · Chain 97</p>
  {review.description.split(/\n+/).map((line,index)=><p key={index}>{line}</p>)}
  <dl><dt>Connected wallet</dt><dd>{review.wallet}</dd><dt>Test contract</dt><dd>{review.contract}</dd></dl>
  <div className="dialog-actions">
   <button type="button" className="small-button" autoFocus onClick={()=>onFinish(false)}>Cancel</button>
   <button type="button" className="primary-button" onClick={()=>onFinish(true)}>{review.confirmLabel??'Continue to wallet'}</button>
  </div>
 </dialog>;
}
