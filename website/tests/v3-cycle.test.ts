import {describe,it,expect} from 'vitest';
import {parseEther} from 'ethers';
import {v3Countdown,v3CycleView} from '../src/v3-cycle';
import type {V3WalletPosition} from '../src/v3-chain';
import {formatV3Amount} from '../src/v3-format';

const position={id:0,principal:parseEther('1000'),compoundedBasis:parseEther('10'),
 lastAccruedAt:1000} as V3WalletPosition;
describe('V3 display-only 24-hour cycle',()=>{
 it('uses each confirmed position timestamp and exact per-component integer rounding',()=>{
  const result=v3CycleView([position],1000,0,1000,70);
  expect(result.secondsRemaining).toBe(86400);
  expect(result.activityRemaining).toBe(86400);
  expect(result.estimatedDaily).toBe(parseEther('7'));
  expect(result.estimatedCompound).toBe(parseEther('0.07'));
  expect(v3Countdown(result.secondsRemaining!)).toBe('24:00:00');
 });
 it('reaches due without inventing a credit and expires activity at 24 hours',()=>{
  const result=v3CycleView([position],1000,86400,1000,70);
  expect(result.secondsRemaining).toBe(0);
  expect(result.activityRemaining).toBe(0);
  expect(v3Countdown(result.secondsRemaining!)).toBe('00:00:00');
 });
 it('handles no positions and uses the earliest of multiple position clocks',()=>{
  expect(v3CycleView([],1000,30,0,50).secondsRemaining).toBe(null);
  const later={...position,id:1,lastAccruedAt:2000};
  expect(v3CycleView([later,position],2000,30,0,50).secondsRemaining).toBe(85370);
  expect(()=>v3CycleView([position],1000,-1,0,50)).toThrow();
 });
 it('does not render a tiny nonzero test claim as zero',()=>{
  expect(formatV3Amount(0n)).toBe('0.00');
  expect(formatV3Amount(1n)).toBe('<0.000001');
  expect(formatV3Amount(parseEther('12.123456789'))).toBe('12.123456');
 });
});
