import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {rewardBudgetHealth} from '../src/reward-budget';
import RewardFundingStatus from '../src/RewardFundingStatus';
const data={rewards:100n,liquidBalance:180n,totalProfit:50n,reserve:10n,queuedProfit:20n,decimals:0};
describe('reward budget and owner capital access',()=>{
 it('does not count existing profit, fees or pending requests twice as new reward cash',()=>{
  expect(rewardBudgetHealth(data)).toMatchObject({available:100n,covered:100n,shortfall:0n,priorClaims:80n});
  expect(rewardBudgetHealth({...data,liquidBalance:90n})).toMatchObject({available:10n,shortfall:90n});
 });
 it('reports an owner cash deployment without changing budget records or hiding owner access',()=>{
  const reduced={...data,liquidBalance:0n},before={...reduced};const h=rewardBudgetHealth(reduced);
  expect(h.available).toBe(0n);expect(h.shortfall).toBe(100n);expect(h.existingProfitShortfall).toBe(true);expect(reduced).toEqual(before);
  const html=renderToStaticMarkup(createElement(RewardFundingStatus,{data:reduced,asset:'USDT'}));
  expect(html).toContain('role="alert"');expect(html).toContain('Owner capital deployment remains available');expect(html).not.toContain('<button');
 });
 it('keeps reward budget and actual treasury cash separate in the displayed balances',()=>{
  const html=renderToStaticMarkup(createElement(RewardFundingStatus,{data,asset:'USDT'}));
  expect(html).toContain('Recorded reward budget');expect(html).toContain('Treasury cash');expect(html).not.toContain('role="alert"');
 });
});
