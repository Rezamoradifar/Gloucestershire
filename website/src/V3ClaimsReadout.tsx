// Safe, not-yet-mounted V3 TESTNET component: only display chain-97 account
// state AFTER the runtime has been independently verified and deployed.
// The current production V2 dashboard MUST NOT import this component until V3
// has a pinned, reviewed and operator-approved deployed contract address.
import {Coins,Info,ShieldAlert} from 'lucide-react';
import {v3PrepareUserClaims,type V3ClaimLedger} from './v3-claim-balance';
import {formatV3Amount} from './v3-format';
import V3ClaimValue from './V3ClaimValue';
import {V3_HOURLY_TEST} from './v3-site-config';
import './v3-claims-readout.css';

export default function V3ClaimsReadout({verifiedLedger,manualReinvest=false,showRequestLimit=true}:{verifiedLedger:V3ClaimLedger;manualReinvest?:boolean;showRequestLimit?:boolean}){
 let claims:ReturnType<typeof v3PrepareUserClaims>;
 try{claims=v3PrepareUserClaims(verifiedLedger);}
 catch{return <section className="gv3-claims-readout gv3-claims-error" role="alert">
  <ShieldAlert size={19}/> V3 contract or accounting data could not be verified. No claimable balance is shown.
 </section>;}
 const unit='USDT';
 return <section className="gv3-claims-readout" aria-label="Verified V3 on-chain accrued claims">
  <div className="gv3-claims-heading"><h2><Coins size={19}/> Internal Current · BNB Testnet</h2>
   <small>Confirmed block {claims.block.toLocaleString('en-US')}</small></div>
  <div className="gv3-current-total"><small>Available internal account credit</small>
   <strong><V3ClaimValue size="hero" value={claims.internalCurrent} block={claims.block}/></strong>
   <span>Claims accrue in your account. Confirmed withdrawals deliver tokens to your wallet.</span></div>
  <div className="gv3-claim-grid">
   <div><small>{V3_HOURLY_TEST?'Hourly test claims available':'Daily claims available'}</small>
    <strong><V3ClaimValue value={claims.outstandingDaily} block={claims.block}/></strong></div>
   {!manualReinvest&&<div><small>Available personal compound earnings</small>
    <strong><V3ClaimValue value={claims.outstandingCompound} block={claims.block}/></strong></div>}
   <div><small>Available referral commission</small>
    <strong><V3ClaimValue value={claims.outstandingReferral} block={claims.block}/></strong></div>
   <div><small>Network milestone claims available</small>
    <strong><V3ClaimValue value={claims.outstandingNetwork} block={claims.block}/></strong></div>
   <div><small>Reserved for pending requests</small>
    <strong><V3ClaimValue value={claims.pendingInternal} block={claims.block}/></strong></div>
   {showRequestLimit&&<div><small>Maximum for one new request under current cooldown/cap</small>
    <strong><V3ClaimValue value={claims.maxSingleRequest} block={claims.block}/></strong></div>}
  </div>
  <p className="gv3-claims-warning"><Info size={17}/> Recorded claims are not wallet funds.
   V3 test-token funding shortfall: {formatV3Amount(claims.overallUnfundedLiability)} {unit}.
   Withdrawals require approval, funding and a confirmed payment.</p>
 </section>;
}
