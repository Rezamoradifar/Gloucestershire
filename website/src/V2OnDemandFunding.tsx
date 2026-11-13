import {useEffect,useState} from 'react';
import {AlertTriangle,CheckCircle2,Coins,ExternalLink,RefreshCw} from 'lucide-react';
import {getWalletProvider} from './wallet';
import {V2_EXPLORER,v2Money,v2Short} from './v2-chain';
import {readV2OnDemandPayout,canFundV2PayoutOnDemand,
 fundAndPayV2ApprovedWithdrawal,type V2PayoutOnDemandQuote} from './v2-on-demand-payout';
import './v2-on-demand-payout.css';

export default function V2OnDemandFunding({wallet,requestId,onChanged}:{
 wallet:string;requestId:number;onChanged:()=>void
}){
 const [quote,setQuote]=useState<V2PayoutOnDemandQuote|null>(null);
 const [checking,setChecking]=useState(false),[paying,setPaying]=useState(false);
 const [ack,setAck]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const [hash,setHash]=useState(''),[paidHash,setPaidHash]=useState('');
 useEffect(()=>{
  setQuote(null);setAck(false);setError('');setStatus('');setHash('');setPaidHash('');
 },[wallet,requestId]);
 async function check(){
  const provider=getWalletProvider();
  if(!provider){setError('Connect the manager TESTNET wallet.');return;}
  setChecking(true);setError('');setQuote(null);setAck(false);
  try{
   const fresh=await readV2OnDemandPayout(provider,wallet,requestId);
   if(provider===getWalletProvider())setQuote(fresh);
  }catch(e){setError(e instanceof Error?e.message:'Cannot read the approved request.');}
  finally{setChecking(false);}
 }
 async function fundAndPay(){
  if(!quote||paying||!ack||!canFundV2PayoutOnDemand(quote))return;
  const provider=getWalletProvider();
  if(!provider)return setError('Connect the manager TESTNET wallet.');
  const shortfall=v2Money(quote.fundingShortfall,quote.decimals,8);
  const explanation='BNB TESTNET ONLY — VALueless MOCK USDT.\n\n'+
   'Approved request #'+(requestId+1)+'\n'+
   'Original beneficiary: '+quote.beneficiary+'\n'+
   'Gross requested: '+v2Money(quote.gross,quote.decimals)+' TEST USDT\n'+
   'Payout fee: '+v2Money(quote.fee,quote.decimals)+' TEST USDT\n'+
   'Exact current required vault top-up: '+shortfall+' TEST USDT\n\n'+
   'If the contract has other credited profit liabilities, V2 may require backing ALL of them before paying this one request.'+
   '\nThe wallet separately signs allowance (if needed), funding (if needed), and final payout.'+
   '\nNo other request will be paid by this action. Continue?';
  if(!window.confirm(explanation))return;
  setPaying(true);setError('');setStatus('Revalidating the approved V2 request and cash shortfall…');setHash('');setPaidHash('');
  try{
   const receipt=await fundAndPayV2ApprovedWithdrawal(provider,wallet,quote,(msg,tx)=>{
    setStatus(msg);if(tx)setHash(tx);
   });
   setPaidHash(receipt.paymentTxHash);
   setStatus('Approved request paid to its original beneficiary on BNB Testnet. Verified receipt below.');
   setQuote(null);setAck(false);onChanged();
  }catch(e){setError(e instanceof Error?e.message:'Could not fund and pay this TESTNET request.');}
  finally{setPaying(false);}
 }
 return <div className="gv2-on-demand" aria-label={'On-demand payout of approved request '+(requestId+1)}>
  <div className="gv2-on-demand-title"><Coins size={16}/><strong>Fund and pay only this approved withdrawal</strong></div>
  <p>No advance 1,000,000-token treasury top-up. Testnet cash is supplied at payout time only, after manager approval.</p>
  <button type="button" disabled={checking||paying} onClick={()=>void check()}>
   <RefreshCw size={15}/>{checking?'Verifying request…':'Check exact funding needed'}
  </button>
  {quote&&<div className="gv2-on-demand-quote">
   <div><small>Beneficiary</small><b title={quote.beneficiary}>{v2Short(quote.beneficiary)}</b></div>
   <div><small>Gross request</small><b>{v2Money(quote.gross,18)} TEST USDT</b></div>
   <div><small>Available V2 cash</small><b>{v2Money(quote.cash,18)} TEST USDT</b></div>
   <div><small>Other profit backing requirement</small><b>{v2Money(quote.profitLiability,18)} TEST USDT</b></div>
   <div><small>Exact top-up necessary</small><b>{v2Money(quote.fundingShortfall,18)} TEST USDT</b></div>
   <div><small>Manager wallet balance</small><b>{v2Money(quote.walletBalance,18)} TEST USDT</b></div>
   {quote.fundingShortfall>quote.gross&&<p className="gv2-on-demand-warning"><AlertTriangle size={15}/>
    This deployed V2 requires more than the individual request because its global credited-profit liabilities must be funded first.</p>}
   {!canFundV2PayoutOnDemand(quote)&&<p className="gv2-on-demand-warning">Wallet lacks the verified shortfall or test gas. Do not attempt payment.</p>}
   <label><input type="checkbox" checked={ack} disabled={paying} onChange={e=>setAck(e.target.checked)}/>
    I verified the beneficiary, approved amount, and exact test-token cash shortfall. Only this request may be paid.</label>
   <button type="button" className="gv2-primary" disabled={!ack||paying||!canFundV2PayoutOnDemand(quote)} onClick={()=>void fundAndPay()}>
    <CheckCircle2 size={16}/>{paying?'Waiting for wallet confirmations…':'Fund shortfall and pay request'}
   </button>
  </div>}
  {error&&<p role="alert" className="gv2-error">{error} {hash&&'A transaction may have been sent: inspect it before retrying.'}</p>}
  {status&&<p role="status" className="gv2-message">{status}</p>}
  {hash&&<a href={V2_EXPLORER+'/tx/'+hash} rel="noopener noreferrer" target="_blank">Inspect last broadcast transaction <ExternalLink size={14}/></a>}
  {paidHash&&<a href={V2_EXPLORER+'/tx/'+paidHash} rel="noopener noreferrer" target="_blank">View confirmed payout receipt <ExternalLink size={14}/></a>}
 </div>;
}
