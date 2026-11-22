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
