import {describe,it,expect} from 'vitest';
import {readReferralInvite,referralLink,resolveReferralInput,reviewReferralForDeposit} from '../src/referral-invite';

const referrer='0x1111111111111111111111111111111111111111';
const investor='0x2222222222222222222222222222222222222222';
const origin='https://globaldroptrade.com';

describe('permanent on-chain referral code and first-deposit invitation',()=>{
 it('creates a shareable dashboard link containing only the canonical referral wallet',()=>{
  const url=referralLink(referrer,origin,'/');
  expect(url).toBe(origin+'/?ref='+referrer+'#dashboard');
  expect(new URL(url).hash).toBe('#dashboard');
  expect(readReferralInvite(new URL(url).search)).toEqual({status:'valid',address:referrer});
  expect(referralLink(referrer,origin,'//malicious.example')).toBe(origin+'/?ref='+referrer+'#dashboard');
 });
 it('accepts the on-chain address or same-site invite and the official www variant',()=>{
  expect(resolveReferralInput(referrer,origin)).toBe(referrer);
  expect(resolveReferralInput(referralLink(referrer,origin),origin)).toBe(referrer);
  expect(resolveReferralInput('https://www.globaldroptrade.com/?ref='+referrer+'#dashboard',origin)).toBe(referrer);
  expect(reviewReferralForDeposit(referrer,origin,investor)).toBe(referrer);
  expect(reviewReferralForDeposit('',origin,investor)).toBe('');
 });
 it('rejects self-referrals and never replaces a first depositor with its own address',()=>{
  expect(()=>reviewReferralForDeposit(investor,origin,investor)).toThrow(/own wallet/);
  expect(()=>reviewReferralForDeposit(origin+'/?ref='+investor+'#dashboard',origin,investor)).toThrow(/own wallet/);
 });
 it('rejects invalid, duplicate and zero-address invitation codes rather than silently dropping them',()=>{
  expect(readReferralInvite('?ref=invalid')).toEqual({status:'invalid',address:''});
  expect(readReferralInvite('?ref='+referrer+'&ref='+investor)).toEqual({status:'invalid',address:''});
  expect(readReferralInvite('?ref=0x0000000000000000000000000000000000000000')).toEqual({status:'invalid',address:''});
  expect(readReferralInvite('?other=1')).toEqual({status:'absent',address:''});
  expect(()=>resolveReferralInput(origin+'/?ref=invalid',origin)).toThrow(/does not contain/);
  expect(()=>resolveReferralInput(origin+'/?ref='+referrer+'&ref='+investor,origin)).toThrow(/does not contain/);
 });
 it('refuses external domains, javascript links and chain-unresolvable short code aliases',()=>{
  expect(()=>resolveReferralInput('https://example.com/?ref='+referrer,origin)).toThrow(/Global website/);
  expect(()=>resolveReferralInput('javascript:alert(1)',origin)).toThrow(/Global website/);
  expect(()=>resolveReferralInput('ABC123',origin)).toThrow(/wallet address/);
  expect(()=>referralLink('ABC123',origin)).toThrow(/wallet address/);
  expect(()=>referralLink(referrer,'http://globaldroptrade.com')).toThrow(/origin/);
  expect(()=>resolveReferralInput('https://globaldroptrade.com.evil.example/?ref='+referrer,origin)).toThrow(/Global website/);
 });
 it('supports local development without assuming an unapproved live website URL',()=>{
  const link=referralLink(referrer,'http://localhost:5173','/');
  expect(link).toContain('http://localhost:5173/?ref='+referrer+'#dashboard');
  expect(resolveReferralInput(link,'http://localhost:5173')).toBe(referrer);
 });
});
