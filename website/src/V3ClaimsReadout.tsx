// V3 internal Current: read-only on-chain accrued test claims.
// No signers, transfers, synthetic data or wallet top-ups are performed.
// V3 stays unavailable until its public TESTNET runtime/deployment is verified.
import {Coins,Info,ShieldAlert,Wallet} from 'lucide-react';
import {v3PrepareUserClaims,type V3ClaimLedger} from './v3-claim-balance';
import {v2Money} from './v2-chain';
import './v3-claims-readout.css';

export default function V3ClaimsReadout({verifiedLedger}:{verifiedLedger:V3ClaimLedger}){
 let claims:ReturnType<typeof v3PrepareUserClaims>;
 try{claims=v3PrepareUserClaims(verifiedLedger);}
 catch{return <section className="gv3-claims-readout gv3-claims-error" role="alert">
  <ShieldAlert size={19}/> V3 contract or accounting data could not be verified. No internal Current is shown.
 </section>;}
 const unit='TEST USDT';
 return <section className="gv3-claims-readout" aria-label="Verified internal Current of accrued V3 test claims">
  <div className="gv3-claims-heading">
   <h2><Coins size={19}/> Global V3 · Internal Current</h2>
   <small>Confirmed on-chain block {claims.block.toLocaleString('en-US')}</small>
  </div>
  <div className="gv3-internal-current">
   <span>Current داخلی حساب · سود ثبت‌شده قابل درخواست</span>
   <strong data-testid="v3-internal-current">{v2Money(claims.internalCurrent,18,6)} <small>{unit}</small></strong>
   <p><Wallet size={15}/> Only internal ledger credit. No daily reward or profit-on-profit token was sent to your wallet.</p>
  </div>
  <div className="gv3-claim-grid">
   <div><small>Daily internal credit · سود روزانه</small>
    <strong data-testid="v3-daily-internal">{v2Money(claims.outstandingDaily,18,6)} {unit}</strong></div>
   <div><small>Automatic compounding internal credit · سود از سود</small>
    <strong data-testid="v3-compound-internal">{v2Money(claims.outstandingCompound,18,6)} {unit}</strong>
    <span>Already included in Internal Current, never added twice</span></div>
   <div><small>Internal referral credit · سود معرفی</small>
    <strong>{v2Money(claims.outstandingReferral,18,6)} {unit}</strong></div>
   <div><small>Reserved internal credit · درخواست برداشت در انتظار</small>
    <strong>{v2Money(claims.pendingInternal,18,6)} {unit}</strong>
    <span>Excluded from available Current until the request is resolved</span></div>
  </div>
  <div className="gv3-internal-summary">
   <div><small>Total recorded internal claims incl. pending</small><b>{v2Money(claims.internalRecordedTotal,18,6)} {unit}</b></div>
   <div><small>Max one new request under 72h cooldown / 10% cap</small><b>{v2Money(claims.maxSingleRequest,18,6)} {unit}</b></div>
  </div>
  <p className="gv3-claims-warning"><Info size={17}/>
   Internal Current is a recorded TESTNET accounting claim, <b>not wallet cash or a funded payout</b>.
   The V3 vault's overall cash shortfall is {v2Money(claims.overallUnfundedLiability,18,6)} {unit}.
   External wallet payment occurs only after a separate withdrawal request, manager approval,
   exact real TEST-token funding/escrow and confirmed payment transaction.</p>
 </section>;
}
