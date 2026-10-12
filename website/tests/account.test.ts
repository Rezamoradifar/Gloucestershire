import {describe,it,expect} from 'vitest';
import {profitAvailability} from '../src/account';

const base={profit:300_000_000n,withdrawalLimit:150_000_000n,liquidBalance:500_000_000n,nextWithdrawal:0n,blockTime:1_000,fee:500n};
describe('withdrawal details shown to the account holder',()=>{
 it('deducts the fee from the capped gross amount, not from the whole profit',()=>{
  const p=profitAvailability(base);expect(p.gross).toBe(150_000_000n);expect(p.net).toBe(142_500_000n);expect(p.gross-p.fee).toBe(p.net);
 });
 it('cannot display spendable proceeds above the shared treasury cash or recorded profit',()=>{
  expect(profitAvailability({...base,liquidBalance:31_000_001n}).net).toBe(29_450_001n);
  expect(profitAvailability({...base,profit:20_000_000n}).gross).toBe(20_000_000n);
  expect(profitAvailability({...base,liquidBalance:0n}).net).toBe(0n);
 });
 it('shows zero during cooldown and applies the exact loaded-block boundary',()=>{
  expect(profitAvailability({...base,nextWithdrawal:1001n}).net).toBe(0n);
  expect(profitAvailability({...base,nextWithdrawal:1000n}).gross).toBe(base.withdrawalLimit);
 });
});
