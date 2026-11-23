import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseEther} from 'ethers';
import {allocateAccountEarnings,availableAccountEarnings,totalAccountEarnings} from '../src/v3-account-earnings';
import V3AccountReinvestment from '../src/V3AccountReinvestment';
import {readAccountReinvestmentPlan} from '../src/v3-reinvest-batch';
import type {V3Snapshot} from '../src/v3-chain';

const wallet='0x1111111111111111111111111111111111111111';
const units=parseEther;
const available={personal:units('7'),referral:units('.7'),network:units('35')};
describe('available account earnings',()=>{
 it('uses spendable amounts only and fills a partial amount from posted rewards first',()=>{
  const view={positions:[{availableProfit:units('7'),reservedProfit:units('1')}],
   referralAvailable:units('.7'),networkAvailable:units('35'),referralReserved:units('2'),networkReserved:units('20'),
   capital:units('1000'),registered:true} as unknown as V3Snapshot;
  const values=availableAccountEarnings(view);
  expect(values).toEqual(available);expect(totalAccountEarnings(values)).toBe(units('42.7'));
  expect(allocateAccountEarnings(values,units('5'))).toEqual({personal:0n,referral:units('.7'),network:units('4.3')});
  expect(allocateAccountEarnings(values,units('42.7'))).toEqual(available);
  expect(()=>allocateAccountEarnings(values,units('42.8'))).toThrow('exceeds');
  expect(()=>allocateAccountEarnings(values,0n)).toThrow('positive');
  const html=renderToStaticMarkup(<V3AccountReinvestment view={view} busy={false} readOnly={false} onSubmit={vi.fn()}/>);
  for(const label of ['42.7','Personal profit','Referral commission','Network rewards','Use max','Review reinvestment'])expect(html).toContain(label);
 });
 it('plans a reward-only signature without personal pages and stops a stale source split',async()=>{
  const at={blockTag:75};
  const session={config:{unified:{accountReinvest:true}},options:at,vault:{users:vi.fn().mockResolvedValue({referralAvailable:units('.7')}),
   claimableDaily:vi.fn().mockResolvedValue(0n),networkAvailable:vi.fn().mockResolvedValue(units('35'))}};
  const reviewed={personal:0n,referral:units('.7'),network:units('4.3')};
  const planned=await readAccountReinvestmentPlan(session as never,wallet,units('5'),reviewed);
  expect(planned).toEqual({sources:[],destination:0,split:reviewed});
  expect(session.vault.users).toHaveBeenCalledWith(wallet,at);
  expect(session.vault.networkAvailable).toHaveBeenCalledWith(wallet,at);
  session.vault.users.mockResolvedValue({referralAvailable:units('.5')});
  await expect(readAccountReinvestmentPlan(session as never,wallet,units('5'),reviewed)).rejects.toThrow('review the new amounts');
 });
});
