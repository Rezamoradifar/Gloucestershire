import {REFERRAL_BPS} from './referral-rates';
import type {V3Snapshot} from './v3-chain';

const capitalBands=['10 – 500','>500 – 2,500','>2,500 – 10,000','>10,000 – 50,000','VIP · >50,000'];

export default function V3ReferralSchedule({view}:{view:Pick<V3Snapshot,'dailyPlan'|'baseProfitReferrals'>}){
 const baseOnly=view.dailyPlan||view.baseProfitReferrals;
 return <section className="gv2-panel gv3-referral-schedule" aria-labelledby="referral-rates-heading">
  <h3 id="referral-rates-heading">Commission on team profit</h3>
  <p>{baseOnly?'The member keeps all personal profit. Each active upline earns a separate share of profit on the member’s principal. Personal compound and referral credits earn no additional commission.':
   'This earlier hourly account calculates commission on the member’s base profit plus personal compound. The member keeps their full profit.'}</p>
  <table aria-label="Commission by the earning member’s capital in test USDT">
   <thead><tr><th scope="col">Member capital<br/><small>test USDT</small></th>
    {[1,2,3,4].map(level=><th scope="col" key={level}>Level {level}</th>)}</tr></thead>
   <tbody>{REFERRAL_BPS.map((rates,tier)=><tr key={tier}>
    <th scope="row">{capitalBands[tier]}</th>
    {rates.map((bps,i)=><td key={i}>{bps===0n?<span aria-label="No commission">—</span>:`${Number(bps)/100}%`}</td>)}
   </tr>)}</tbody>
  </table>
  {baseOnly&&<p className="gv3-referral-example"><strong>1,000 principal · 7 personal profit</strong>
   <span>The member keeps 7 test USDT. Active levels 1, 2 and 3 receive 0.70, 0.35 and 0.21 test USDT. Level 4 receives zero.</span></p>}
  <p>{view.dailyPlan?'Eligibility is checked at cycle maturity.':'Eligibility is checked when the claim is posted.'} An inactive level earns zero. Higher levels keep their own percentages. VIP recipients need verified KYC. Level 4 requires both the earning member and the recipient to be VIP.</p>
 </section>;
}
