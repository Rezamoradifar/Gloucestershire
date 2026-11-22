import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import V3ReferralSchedule from '../src/V3ReferralSchedule';

it('shows the contract tiers and the base-only example for both corrected test clocks',()=>{
 for(const view of [{dailyPlan:true},{baseProfitReferrals:true}] as const){
  const html=renderToStaticMarkup(<V3ReferralSchedule view={view}/>);
  expect([...html.matchAll(/<td>(\d+%)<\/td>/g)].map(m=>m[1])).toEqual([
   '8%','4%','2%','10%','5%','3%','12%','6%','4%','14%','7%','5%','16%','8%','6%','4%'
  ]);
  expect(html).toContain('0.70, 0.35 and 0.21');
  expect(html).toContain('The member keeps 7');
  expect(html).toContain('Higher levels keep their own percentages');
  expect(html).toContain('both the earning member and the recipient');
 }
 const legacy=renderToStaticMarkup(<V3ReferralSchedule view={{}}/>);
 expect(legacy).toContain('base profit plus personal compound');
 expect(legacy).not.toContain('0.70, 0.35 and 0.21');
});

it('shows the recipient principal, matching band and mixed-depth example on the upline release',()=>{
 const view={uplineRates:true,manualReinvest:true,baseProfitReferrals:true,capital:5000n*10n**18n,tier:2} as const;
 const html=renderToStaticMarkup(<V3ReferralSchedule view={view}/>);
 expect(html).toContain('Your recorded principal: <strong>5,000.00 test USDT');
 expect(html).toMatch(/<tr aria-current="true"><th scope="row">&gt;2,500 – 10,000/);
 expect(html).toContain('0.56 (8%)');
 expect(html).toContain('0.42 (6%)');
 expect(html).not.toContain('0.70, 0.35 and 0.21');
 const unfunded=renderToStaticMarkup(<V3ReferralSchedule view={{...view,capital:0n,tier:0}}/>);
 expect(unfunded).toContain('Below the 10-unit minimum');
 expect(unfunded).not.toContain('aria-current="true"');
});
