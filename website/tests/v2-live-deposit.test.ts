import {describe,it,expect} from 'vitest';
import {ZeroAddress} from 'ethers';
import {V2_TEST_TOKEN,V2_VAULT_DEPLOYMENT_BLOCK,v2ResolveDepositReferrer} from '../src/v2-live-deposit';
const user='0x1111111111111111111111111111111111111111';
const parent='0x2222222222222222222222222222222222222222';
const stranger='0x3333333333333333333333333333333333333333';
describe('V2 testnet real-deposit preflight identity and referrer checks',()=>{
 it('uses a pinned chain-97 mock token and the NEW V2 deployment, never mainnet real USDT',()=>{
  expect(V2_TEST_TOKEN.toLowerCase()).toBe('0x000cdf5f6e3b4761721a5f76205bae6c8523ab89');
  expect(V2_VAULT_DEPLOYMENT_BLOCK).toBe(142416836);
 });
 it('keeps an immutable V2 referrer for already registered wallets',()=>{
  expect(v2ResolveDepositReferrer(parent,true,parent,user)).toBe(parent);
  expect(v2ResolveDepositReferrer('',true,ZeroAddress,user)).toBe(ZeroAddress);
  expect(()=>v2ResolveDepositReferrer(stranger,true,parent,user)).toThrow(/original/);
  expect(()=>v2ResolveDepositReferrer('',true,parent,user)).toThrow(/original/);
 });
 it('allows the zero referrer only on first V2 registration and blocks self-referrals',()=>{
  expect(v2ResolveDepositReferrer('',false,ZeroAddress,user)).toBe(ZeroAddress);
  expect(v2ResolveDepositReferrer(parent,false,ZeroAddress,user)).toBe(parent);
  expect(()=>v2ResolveDepositReferrer(user,false,ZeroAddress,user)).toThrow(/Self-referral/);
  expect(()=>v2ResolveDepositReferrer('garbled',false,ZeroAddress,user)).toThrow();
 });
});
