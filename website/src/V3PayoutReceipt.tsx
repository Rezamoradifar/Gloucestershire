import {useEffect,useRef,useState} from 'react';
import {getAddress} from 'ethers';
import {V3_EXPLORER,type V3Withdrawal} from './v3-chain';
import {formatV3Amount} from './v3-format';

type ReceiptProps={vault:string;row:V3Withdrawal};
export default function V3PayoutReceipt(props:ReceiptProps){
 const {vault,row}=props;
 return <ReceiptCheck key={[vault,row.id,row.beneficiary,row.gross,row.fee].join('/')} {...props}/>;
}
function ReceiptCheck({vault,row}:ReceiptProps){
 const [proof,setProof]=useState<{tx:string;block:number}|null>(null),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[hash,setHash]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function read(){
  active.current?.abort();const abort=new AbortController();active.current=abort;
  setBusy(true);setError('');setProof(null);
  const params=new URLSearchParams({vault,wallet:row.beneficiary,id:String(row.id)});
  if(hash.trim())params.set('tx',hash.trim());
  const timeout=window.setTimeout(()=>abort.abort(),90000);
  try{
   const response=await fetch('/api/v3/payout-receipt?'+params,{cache:'no-store',signal:abort.signal});
   if(!response.ok)throw Error();
   const body=await response.json(),p=body.payout;
   if(body.version!==1||body.chainId!==97||getAddress(body.vault)!==getAddress(vault)||getAddress(body.wallet)!==getAddress(row.beneficiary)||
    getAddress(p.beneficiary)!==getAddress(row.beneficiary)||p.id!==row.id||!/^0x[0-9a-f]{64}$/i.test(p.transactionHash)||
    (params.has('tx')&&p.transactionHash.toLowerCase()!==hash.trim().toLowerCase())||p.gross!==String(row.gross)||p.fee!==String(row.fee)||
    p.net!==String(row.gross-row.fee)||!Number.isSafeInteger(p.block)||!Number.isSafeInteger(body.anchor?.block)||!Number.isSafeInteger(body.anchor.firstBlock)||
    p.block<body.anchor.firstBlock||p.block>body.anchor.block||!/^0x[0-9a-f]{64}$/i.test(p.blockHash))throw Error();
   if(!abort.signal.aborted)setProof({tx:p.transactionHash,block:p.block});
  }catch{if(active.current===abort)setError('Receipt unavailable. Retry or enter the payment transaction hash from History.');}
  finally{window.clearTimeout(timeout);if(active.current===abort){active.current=null;setBusy(false);}}
 }
 return <div className="gv3-payout-proof">
  {proof?<div role="status"><strong>{formatV3Amount(row.gross-row.fee)} test USDT delivered</strong>
   <small>Beneficiary transfer verified · Block {proof.block.toLocaleString('en-US')}</small>
   <a href={V3_EXPLORER+'/tx/'+proof.tx} target="_blank" rel="noreferrer">View payment receipt</a></div>:<>
   {error&&<><small role="alert">{error}</small><label>Payment transaction hash<input value={hash} onChange={e=>setHash(e.target.value)} spellCheck={false} autoCapitalize="none"/></label></>}
   <button type="button" disabled={busy||(Boolean(hash.trim())&&!/^0x[0-9a-f]{64}$/i.test(hash.trim()))} onClick={()=>void read()}>{busy?'Checking transfer…':'Verify payment receipt'}</button></>}
 </div>;
}
