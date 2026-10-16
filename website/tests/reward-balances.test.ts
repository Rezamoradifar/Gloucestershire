import {describe,it,expect} from 'vitest';
import {branchBalances} from '../src/RewardBranchBalances';
describe('carried-forward branch volume',()=>{
 it('deducts only 500 used for claimed rewards and includes new investment',()=>{
  expect(branchBalances(45000n,500n,0n).remaining).toBe(44500n);
  expect(branchBalances(46000n,500n,0n).remaining).toBe(45500n);
 });
 it('does not mislabel current stage reservations as previously claimed volume',()=>{
  expect(branchBalances(46000n,1100n,600n)).toEqual({claimed:500n,reserved:600n,remaining:45500n});
 });
 it('rejects inconsistent snapshots instead of displaying negative balances',()=>{
  expect(()=>branchBalances(100n,101n,0n)).toThrow();
  expect(()=>branchBalances(100n,10n,20n)).toThrow();
 });
});
