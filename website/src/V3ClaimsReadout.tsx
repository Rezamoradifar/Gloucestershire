// Safe, not-yet-mounted V3 TESTNET component: only display chain-97 account
// state AFTER the runtime has been independently verified and deployed.
// The current production V2 dashboard MUST NOT import this component until V3
// has a pinned, reviewed and operator-approved deployed contract address.
import {Coins,Info,ShieldAlert} from 'lucide-react';
import {v3PrepareUserClaims,type V3ClaimLedger} from './v3-claim-balance';
import {formatV3Amount} from './v3-format';
import DigitalValue from './DigitalValue';
import './v3-claims-readout.css';

export default function V3ClaimsReadout({verifiedLedger}:{verifiedLedger:V3ClaimLedger}){
 let claims:ReturnType<typeof v3PrepareUserClaims>;
 try{claims=v3PrepareUserClaims(verifiedLedger);}
 catch{return <section className="gv3-claims-readout gv3-claims-error" role="alert">
  <ShieldAlert size={19}/> V3 contract or accounting data could not be verified. No claimable balance is shown.
 </section>;}
 const unit='TEST USDT';
 return <section className="gv3-claims-readout" aria-label="Verified V3 on-chain accrued claims">
  <div className="gv3-claims-heading"><h2><Coins size={19}/> Internal Current · BNB Testnet</h2>
   <small>Confirmed block {claims.block.toLocaleString('en-US')}</small></div>
  <div className="gv3-current-total"><small>Available internal account credit</small>
   <strong><DigitalValue size="hero" value={formatV3Amount(claims.internalCurrent)} unit={unit}/></strong>
   <span>Recorded in your account; daily accrual does not transfer tokens to your wallet.</span></div>
  <div className="gv3-claim-grid">
   <div><small>Daily claims available</small>
    <strong><DigitalValue value={formatV3Amount(claims.outstandingDaily)} unit={unit}/></strong></div>
   <div><small>Profit-on-profit claims available</small>
    <strong><DigitalValue value={formatV3Amount(claims.outstandingCompound)} unit={unit}/></strong></div>
   <div><small>Referral claims available</small>
    <strong><DigitalValue value={formatV3Amount(claims.outstandingReferral)} unit={unit}/></strong></div>
   <div><small>Network milestone claims available</small>
    <strong><DigitalValue value={formatV3Amount(claims.outstandingNetwork)} unit={unit}/></strong></div>
   <div><small>Reserved for pending requests</small>
    <strong><DigitalValue value={formatV3Amount(claims.pendingInternal)} unit={unit}/></strong></div>
   <div><small>Maximum for one new request under current cooldown/cap</small>
    <strong><DigitalValue value={formatV3Amount(claims.maxSingleRequest)} unit={unit}/></strong></div>
  </div>
  <p className="gv3-claims-warning"><Info size={17}/> Recorded claims are not wallet funds.
   V3 test-token funding shortfall: {formatV3Amount(claims.overallUnfundedLiability)} {unit}.
   Withdrawals require approval, funding and a confirmed payment.</p>
 </section>;
}
