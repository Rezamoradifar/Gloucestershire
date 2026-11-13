import {useEffect,useState} from 'react';
import {AlertTriangle,CheckCircle2,Coins,ExternalLink,RefreshCw,ShieldCheck,Wallet} from 'lucide-react';
import {getWalletProvider} from './wallet';
import {v2Money} from './v2-chain';
import {readV2TreasuryFundingQuote,fundV2TestnetTreasury,v2TreasuryHasTestFunds,
 V2_TREASURY_TEST_AMOUNT,type V2TreasuryFundingQuote} from './v2-treasury-funding';
import './v2-treasury-funding.css';

export default function V2TreasuryFunding({wallet,onChanged}:{wallet:string;onChanged:()=>void}){
 const [quote,setQuote]=useState<V2TreasuryFundingQuote|null>(null);
 const [readBusy,setReadBusy]=useState(false),[sendBusy,setSendBusy]=useState(false);
 const [checked,setChecked]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const [hash,setHash]=useState('');
 useEffect(()=>{setQuote(null);setChecked(false);setError('');setStatus('');setHash('');},[wallet]);
 async function check(){
  const provider=getWalletProvider();
  if(!provider){setError('Reconnect the TESTNET funding wallet.');return;}
  setReadBusy(true);setError('');setQuote(null);setChecked(false);
  try{
   const result=await readV2TreasuryFundingQuote(provider,wallet);
   if(provider===getWalletProvider())setQuote(result);
  }catch(e){setError(e instanceof Error?e.message:'Could not verify V2 testnet treasury.');}
  finally{setReadBusy(false);}
 }
 async function submit(){
  if(!quote||!checked||sendBusy||!v2TreasuryHasTestFunds(quote))return;
  const provider=getWalletProvider();
  if(!provider){setError('Reconnect the wallet before funding.');return;}
  const message='AUTHORIZE TESTNET FUNDING ONLY.\n\n'+
   'Source: your connected TESTNET wallet\n'+
   'Asset: MOCK test USDT — not real Tether\n'+
   'Amount: 1,000,000 TEST USDT\n'+
   'Chain: BNB Testnet (97)\n'+
   'Contract: 0xA98D8d3709f5D3730BAD5d76C334731784e7CF07\n\n'+
   'This transfers your test tokens into the vault. It does NOT create user profit, real USDT, or new principal claims.\n'+
   'The wallet will ask you to confirm approval (if needed) and funding separately. Continue?';
  if(!window.confirm(message))return;
  setSendBusy(true);setError('');setStatus('Rechecking TESTNET token balance…');setHash('');
  try{
   const receipt=await fundV2TestnetTreasury(provider,wallet,quote,(msg)=>setStatus(msg));
   setHash(receipt.txHash);
   setStatus('1,000,000 mock USDT funding confirmed on BNB Testnet. See the transaction receipt.');
   setChecked(false);setQuote(null);onChanged();
  }catch(e){setError(e instanceof Error?e.message:'Funding could not be confirmed.');setStatus('');}
  finally{setSendBusy(false);}
 }
 return <section className="gv2-panel gv2-treasury-testnet" aria-label="V2 TESTNET treasury funding">
  <div className="gv2-panel-head"><h3><Coins size={19}/> Fund V2 testnet treasury</h3><span>Operator-initiated · mock tokens only</span></div>
  <p className="gv2-treasury-testnet-warning"><AlertTriangle size={18}/> This is <strong>1,000,000 MOCK USDT test tokens</strong>, not 1,000,000 real Tether. No funds can be fabricated or credited by changing the website.</p>
  <div className="gv2-treasury-testnet-amount">
   <span>Exact requested funding</span>
   <strong>{V2_TREASURY_TEST_AMOUNT.replace(/\B(?=(\d{3})+(?!\d))/g,',')} <small>TEST USDT</small></strong>
   <span>Chain 97 · V2 contract · User-signed transfer only</span>
  </div>
  <button type="button" disabled={readBusy||sendBusy} onClick={()=>void check()}><RefreshCw size={16}/> {readBusy?'Checking verified on-chain balances…':'Check funding wallet and contract'}</button>
  {quote&&<div className="gv2-treasury-testnet-readout">
   <div><span>Funding wallet test-token balance</span><strong>{v2Money(quote.walletBalance,quote.decimals)} TEST USDT</strong></div>
   <div><span>Current vault test-token cash</span><strong>{v2Money(quote.vaultCash,quote.decimals)} TEST USDT</strong></div>
   <div><span>Recorded V2 principal liabilities</span><strong>{v2Money(quote.principalLiability,quote.decimals)} TEST USDT</strong></div>
   <div><span>Recorded credited-profit liabilities</span><strong>{v2Money(quote.profitLiability,quote.decimals)} TEST USDT</strong></div>
   <div><span>Vault cash if transfer confirms (other flows unchanged)</span><strong>{v2Money(quote.vaultCash+quote.amount,quote.decimals)} TEST USDT</strong></div>
   <div><span>Verified at block</span><strong>{quote.block.toLocaleString('en-US')}</strong></div>
  </div>}
  {quote&&!v2TreasuryHasTestFunds(quote)&&<p className="gv2-treasury-testnet-warning"><Wallet size={17}/> Funding wallet does not hold the required 1,000,000 test tokens. Obtain them from the authorized MOCK token issuer before continuing. This app does not mint them.</p>}
  {quote&&v2TreasuryHasTestFunds(quote)&&<>
   <label className="gv2-treasury-testnet-confirm"><input type="checkbox" checked={checked} disabled={sendBusy} onChange={e=>setChecked(e.target.checked)}/>
    <span>I confirm these are valueless BNB Testnet tokens; this operation transfers the exact amount from my wallet and does not create real USDT or guarantee user withdrawals.</span>
   </label>
   <button type="button" className="gv2-primary" onClick={()=>void submit()} disabled={!checked||sendBusy||readBusy}>
    <ShieldCheck size={17}/> {sendBusy?'Waiting for wallet confirmation…':'Approve and fund exactly 1,000,000 TEST USDT'}
   </button>
  </>}
  {status&&<p role="status" className="gv2-message">{status}</p>}
  {error&&<p role="alert" className="gv2-error">{error}</p>}
  {hash&&<a className="gv2-treasury-testnet-receipt" target="_blank" rel="noopener noreferrer" href={'https://testnet.bscscan.com/tx/'+hash}>
   <CheckCircle2 size={17}/> View confirmed TESTNET funding receipt <ExternalLink size={15}/>
  </a>}
  <p className="gv2-small">Funding increases the contract's actual test-token cash balance; it does not credit daily profit to users. Real capital remains blocked pending audit and enforceable backing.</p>
 </section>;
}
