import {REFERRAL_BPS} from './referral-rates';
import {formatV3Amount} from './v3-format';
import type {V3Snapshot} from './v3-chain';

const capitalBands=['10 – 500','>500 – 2,500','>2,500 – 10,000','>10,000 – 50,000','VIP · >50,000'];

type ReferralView=Pick<V3Snapshot,'dailyPlan'|'baseProfitReferrals'|'manualReinvest'|'uplineRates'> & Partial<Pick<V3Snapshot,'tier'|'capital'>>;
export default function V3ReferralSchedule({view}:{view:ReferralView}){
 const baseOnly=view.dailyPlan||view.baseProfitReferrals;
 const ownBand=view.uplineRates&&view.capital!==undefined&&view.capital>=10n*10n**18n?view.tier:undefined;
 return <section className="gv2-panel gv3-referral-schedule" aria-labelledby="referral-rates-heading">
  <h3 id="referral-rates-heading">Commission on team profit</h3>
  <p>{view.uplineRates?'Your own principal selects the row. Your distance above the earning member selects the column. The member keeps all personal profit.':view.manualReinvest?'The member retains all profit on principal. Active uplines earn their share of that base profit. A member can add earnings to principal through manual reinvestment.':baseOnly?'The member keeps all personal profit. Each active upline earns a separate share of profit on the member’s principal. Personal compound and referral credits earn no additional commission.':
   'This earlier hourly account calculates commission on the member’s base profit plus personal compound. The member keeps their full profit.'}</p>
  {view.uplineRates&&view.capital!==undefined&&<p>Your recorded principal: <strong>{formatV3Amount(view.capital)} test USDT</strong> · {ownBand===undefined?'Below the 10-unit minimum':`Your band: ${capitalBands[ownBand]}`}</p>}
  <table aria-label={view.uplineRates?'Commission by the upline’s own principal in test USDT':'Commission by the earning member’s capital in test USDT'}>
   <thead><tr><th scope="col">{view.uplineRates?'Your principal':'Member capital'}<br/><small>test USDT</small></th>
    {[1,2,3,4].map(level=><th scope="col" key={level}>Level {level}</th>)}</tr></thead>
   <tbody>{REFERRAL_BPS.map((rates,tier)=><tr key={tier} aria-current={ownBand===tier?'true':undefined}>
    <th scope="row">{capitalBands[tier]}</th>
    {rates.map((bps,i)=><td key={i}>{bps===0n?<span aria-label="No commission">—</span>:`${Number(bps)/100}%`}</td>)}
   </tr>)}</tbody>
  </table>
  {baseOnly&&<p className="gv3-referral-example"><strong>1,000 principal · 7 personal profit</strong>
   <span>{view.uplineRates?'The member keeps 7 test USDT. An eligible direct referrer with 100 principal earns 0.56 (8%). A level 2 referrer with 5,000 earns 0.42 (6%). A level 3 referrer with 1,000 earns 0.21 (3%).':'The member keeps 7 test USDT. Active levels 1, 2 and 3 receive 0.70, 0.35 and 0.21 test USDT. Level 4 receives zero.'}</span></p>}
  <p>{view.dailyPlan?'Eligibility is checked at cycle maturity.':'Eligibility is checked when the claim is posted.'} An inactive level earns zero. Higher levels keep their own percentages. VIP recipients need verified KYC. Level 4 requires both the earning member and the recipient to be VIP.</p>
 </section>;
}
