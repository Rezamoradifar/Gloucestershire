import {describe,it,expect} from 'vitest';
import {parseEther} from 'ethers';
import fs from 'node:fs';
import {v3PrepareUserClaims,type V3ClaimLedger} from '../src/v3-claim-balance';

const u=(value:string)=>parseEther(value);
const contract=fs.readFileSync(new URL('../../contracts/v3/GlobalV3DeferredTestnet.sol',import.meta.url),'utf8');
const dashboard=fs.readFileSync(new URL('../src/V3Dashboard.tsx',import.meta.url),'utf8');
const readout=fs.readFileSync(new URL('../src/V3ClaimsReadout.tsx',import.meta.url),'utf8');

const example:V3ClaimLedger={
 chainId:97,runtimeVerified:true,block:142800000,
 asOf:1794600000,nextRequestAt:0,
 registered:true,suspended:false,pendingWithdrawal:false,
 requestCap:u('100'),referralAvailable:u('1.2'),referralReserved:0n,
 principalLiability:u('1000'),profitLiability:u('15.249'),
 cash:u('1000'),escrow:0n,
 positions:[{
  id:0,principal:u('1000'),availableProfit:u('14.049'),
  availableDaily:u('14'),availableCompound:u('0.049'),
  cumulativeDaily:u('14'),cumulativeCompound:u('0.049'),reservedProfit:0n
 }]
};
describe('V3 user Current داخلى tracks actual recorded TEST claims, never synthetic wallet transfers',()=>{
 it('Current = daily + compound + referral; compound is included exactly once',()=>{
  const r=v3PrepareUserClaims(example);
  expect(r.outstandingDaily).toBe(u('14'));
  expect(r.outstandingCompound).toBe(u('0.049'));
  expect(r.internalCurrent).toBe(u('15.249'));
  expect(r.internalRecordedTotal).toBe(r.internalCurrent);
  expect(r.currentWalletTransfer).toBe(0n);
 });
 it('requesting profit removes the reserved amount from available Current, not from the global ledger',()=>{
  const r=v3PrepareUserClaims({
   ...example,
   positions:[{...example.positions[0],availableProfit:u('9.049'),
    availableDaily:u('9'),availableCompound:u('0.049'),reservedProfit:u('5')}]
  });
  expect(r.internalCurrent).toBe(u('10.249'));
  expect(r.pendingInternal).toBe(u('5'));
  expect(r.internalRecordedTotal).toBe(u('15.249'));
  expect(r.currentWalletTransfer).toBe(0n);
 });
 it('wallet balance remains separate from internal Current in user account and withdrawal screens',()=>{
  expect(readout).toContain('data-testid="v3-internal-current"');
  expect(readout).toContain('data-testid="v3-daily-internal"');
  expect(readout).toContain('data-testid="v3-compound-internal"');
  expect(readout).toContain('No daily reward or profit-on-profit token was sent to your wallet');
  expect(dashboard).toContain('data-testid="v3-current-hero"');
  expect(dashboard).toContain('show(view.walletTestTokenBalance)');
  expect(dashboard).toContain('show(claims.pendingInternal)');
  expect(dashboard).not.toContain('SIMULATED_USER_CURRENT');
 });
 it('accrual changes only internal on-chain accounting; wallet transfers are limited to actual funded payout',()=>{
  const accrual=contract.slice(contract.indexOf('    function _accrueDaily('),contract.indexOf('    function _creditReferrals('));
  expect(accrual).toContain('p.availableProfit+=gross;');
  expect(accrual).toContain('p.compoundedBasis+=gross;');
  expect(accrual).toContain('claimableDaily[who][positionId]+=personal;');
  expect(accrual).toContain('claimableCompound[who][positionId]+=compound;');
  expect(accrual).not.toContain('asset.safeTransfer');
  expect(accrual).not.toContain('transferFrom');
  expect(accrual).not.toContain('fundWithdrawal');
  const payout=contract.slice(contract.indexOf('    function payWithdrawal('),contract.indexOf('    function rejectWithdrawal('));
  expect(payout).toContain('if(r.status!=2)revert FundingRequired();');
  expect(payout).toContain('asset.safeTransfer(r.beneficiary,r.gross-r.fee);');
 });
 it('fails closed when internally recorded credits are larger than actual on-chain V3 liabilities',()=>{
  expect(()=>v3PrepareUserClaims({...example,profitLiability:u('10')})).toThrow();
  expect(()=>v3PrepareUserClaims({...example,runtimeVerified:false})).toThrow();
 });
});
