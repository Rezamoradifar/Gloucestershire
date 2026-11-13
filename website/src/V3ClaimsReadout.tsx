// Safe, not-yet-mounted V3 TESTNET component: only display chain-97 account
// state AFTER the runtime has been independently verified and deployed.
// The current production V2 dashboard MUST NOT import this component until V3
// has a pinned, reviewed and operator-approved deployed contract address.
import {Coins,Info,ShieldAlert} from 'lucide-react';
import {v3PrepareUserClaims,type V3ClaimLedger} from './v3-claim-balance';
import {v2Money} from './v2-chain';
import './v3-claims-readout.css';

export default function V3ClaimsReadout({verifiedLedger}:{verifiedLedger:V3ClaimLedger}){
 let claims:ReturnType<typeof v3PrepareUserClaims>;
 try{claims=v3PrepareUserClaims(verifiedLedger);}
 catch{return <section className="gv3-claims-readout gv3-claims-error" role="alert">
  <ShieldAlert size={19}/> V3 contract or accounting data could not be verified. No claimable balance is shown.
 </section>;}
 const unit='TEST USDT';
 return <section className="gv3-claims-readout" aria-label="Verified V3 on-chain accrued claims">
  <div className="gv3-claims-heading"><h2><Coins size={19}/> V3 accrued claims · BNB Testnet</h2>
   <small>Confirmed block {claims.block.toLocaleString('en-US')}</small></div>
  <div className="gv3-claim-grid">
   <div><small>Daily claims available · سود روزانه قابل درخواست</small>
    <strong>{v2Money(claims.outstandingDaily,18,6)} {unit}</strong></div>
   <div><small>Profit-on-profit claims available · سود از سود قابل درخواست</small>
    <strong>{v2Money(claims.outstandingCompound,18,6)} {unit}</strong></div>
   <div><small>Referral claims available</small>
    <strong>{v2Money(claims.outstandingReferral,18,6)} {unit}</strong></div>
   <div><small>Maximum for one new request under current cooldown/cap</small>
    <strong>{v2Money(claims.maxSingleRequest,18,6)} {unit}</strong></div>
  </div>
  <p className="gv3-claims-warning"><Info size={17}/> These amounts are recorded TESTNET claims, not transferable wallet funds.
   Total V3 cash shortfall is {v2Money(claims.overallUnfundedLiability,18,6)} {unit}.
   Cash must still be reserved and paid under a separately approved, confirmed transaction.</p>
 </section>;
}
