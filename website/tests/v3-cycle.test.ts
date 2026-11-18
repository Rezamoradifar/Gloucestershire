import {describe,it,expect} from 'vitest';
import {parseEther} from 'ethers';
import {v3Countdown,v3CycleView} from '../src/v3-cycle';
import type {V3WalletPosition} from '../src/v3-chain';
import {formatV3Amount} from '../src/v3-format';
import {formatUtcTime} from '../src/utc-time';

const position={id:0,principal:parseEther('1000'),compoundedBasis:parseEther('10'),
 lastAccruedAt:1000} as V3WalletPosition;
describe('V3 display-only 24-hour cycle',()=>{
 it('shows a unique UTC instant for repeated local hours and preserves the unset time',()=>{
  expect(formatUtcTime('2026-11-01T01:40:00-04:00')).toBe('2026-11-01 05:40:00 UTC');
  expect(formatUtcTime('2026-11-01T01:40:00-05:00')).toBe('2026-11-01 06:40:00 UTC');
  expect(formatUtcTime('2026-11-01T01:40:00')).toBe('Not recorded');
  expect(formatUtcTime(0)).toBe('Not recorded');
 });
 it('shows the isolated hourly cycle while retaining a 24-hour activity window',()=>{
  const half=v3CycleView([position],1000,1800,1000,70,3600);
  const due=v3CycleView([position],1000,3600,1000,70,3600);
  expect(half.secondsRemaining).toBe(1800);
  expect(half.activityRemaining).toBe(86400-1800);
  expect(half.progressDaily).toBe(parseEther('3.5'));
  expect(half.progressCompound).toBe(parseEther('0.035'));
  expect(due.secondsRemaining).toBe(0);
  expect(due.activityRemaining).toBe(82800);
  expect(()=>v3CycleView([position],1000,0,1000,70,1)).toThrow();
 });
 it('updates the visual progress estimate while leaving the full cycle estimate fixed',()=>{
  const start=v3CycleView([position],1000,0,1000,70);
  const half=v3CycleView([position],1000,43200,1000,70);
  const due=v3CycleView([position],1000,172800,1000,70);
  expect(start.progressDaily).toBe(0n);
  expect(start.progressCompound).toBe(0n);
  expect(half.progressDaily).toBe(parseEther('3.5'));
  expect(half.progressCompound).toBe(parseEther('0.035'));
  expect(due.progressDaily).toBe(due.estimatedDaily);
  expect(due.progressCompound).toBe(due.estimatedCompound);
 });
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
