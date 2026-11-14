import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseEther} from 'ethers';
import DigitalValue from '../src/DigitalValue';
import V3CycleCard from '../src/V3CycleCard';
import V3ClaimsReadout from '../src/V3ClaimsReadout';
import type {V3Snapshot} from '../src/v3-chain';
import type {V3ClaimLedger} from '../src/v3-claim-balance';

const to=(value:string)=>parseEther(value);
describe('digital account instruments',()=>{
 it('preserves the exact accessible value, punctuation and unit',()=>{
  const html=renderToStaticMarkup(<DigitalValue value="1,234.50" unit="TEST USDT"/>);
  expect(html).toContain('aria-label="1,234.50 TEST USDT"');
  expect((html.match(/class="gv3-digital-digit"/g)||[]).length).toBe(6);
  expect(renderToStaticMarkup(<DigitalValue value="<0.000001"/>)).toContain('aria-label="&lt;0.000001"');
 });
 it('shows the 24-hour timer using the verified position timestamp',()=>{
  const view={asOf:1000,lastCheckIn:1000,dailyRateBps:70,registered:true,
   suspended:false,paused:false,positions:[{id:0,principal:to('1000'),
    compoundedBasis:to('10'),lastAccruedAt:1000}]} as V3Snapshot;
  const html=renderToStaticMarkup(<V3CycleCard view={view} busy={false} onCheckIn={()=>{}} onPositions={()=>{}}/>);
  expect(html).toContain('Estimated time remaining 24:00:00');
  expect(html).toContain('LIVE ESTIMATED PROGRESS');
  expect(html).toContain('CONDITIONAL CYCLE ESTIMATE');
  expect(html).toContain('aria-label="0.00 TEST USDT"');
  expect(html).toContain('aria-label="7.07 TEST USDT"');
  expect(html).toContain('Next check-in in 01:00:00');
  expect(html).toContain('disabled=""');
 });
 it('renders separate recorded daily, compound and referral values',()=>{
  const ledger:V3ClaimLedger={chainId:97,runtimeVerified:true,block:1234,asOf:1000,
   nextRequestAt:0,registered:true,suspended:false,pendingWithdrawal:false,
   requestCap:to('100'),referralAvailable:to('1.2'),principalLiability:to('1000'),
   profitLiability:to('15.249'),cash:to('1000'),escrow:0n,
   positions:[{id:0,principal:to('1000'),availableProfit:to('14.049'),
    availableDaily:to('14'),availableCompound:to('0.049'),cumulativeDaily:to('14'),
    cumulativeCompound:to('0.049'),reservedProfit:0n}]};
  const html=renderToStaticMarkup(<V3ClaimsReadout verifiedLedger={ledger}/>);
  for(const value of ['15.249','14.00','0.049','1.2'])
   expect(html).toContain(`aria-label="${value} TEST USDT"`);
  expect(html).toContain('funding shortfall: 15.249 TEST USDT');
 });
});
