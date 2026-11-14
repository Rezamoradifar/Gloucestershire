import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import V3CommercePanel,{readCommerceSummary} from '../src/V3CommercePanel';

const now=Date.parse('2026-11-14T12:00:00Z');
const live={version:1,source:'ebay',status:'live',updatedAt:'2026-11-14T11:59:59Z',
 windowStart:'2026-10-15T11:58:59Z',windowEnd:'2026-11-14T11:58:59Z',paidOrders:4,
 commercialProfit:null,profitStatus:'unverified_costs_and_fees'};
describe('commercial activity requires actual seller records',()=>{
 it('accepts a fresh paid-order aggregate without claiming profit',()=>{
  expect(readCommerceSummary(live,now)?.paidOrders).toBe(4);
  expect(readCommerceSummary(live,now)?.commercialProfit).toBeNull();
 });
 it('rejects stale data, unverified profit and incomplete counts',()=>{
  expect(readCommerceSummary({...live,updatedAt:'2026-11-14T11:55:00Z'},now)).toBeNull();
  expect(readCommerceSummary({...live,commercialProfit:100},now)).toBeNull();
  expect(readCommerceSummary({...live,status:'incomplete',paidOrders:4},now)).toBeNull();
  expect(readCommerceSummary({...live,paidOrders:-1},now)).toBeNull();
 });
 it('does not invent a profit or paid order count during loading',()=>{
  const html=renderToStaticMarkup(<V3CommercePanel/>);
  expect(html).toContain('Verified commercial profit');
  expect(html).toContain('must be reconciled first');
  expect(html).toContain('Checking seller connection');
  expect(html).not.toContain('0.00');
 });
});
