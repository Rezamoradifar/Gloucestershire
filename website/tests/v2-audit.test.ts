import {describe,it,expect} from 'vitest';
import {ZeroAddress} from 'ethers';
import {decodeV2WalletEvents,V2_DEPLOYMENT_BLOCK,V2_MAX_EVENTS_PER_WINDOW,v2Window,v2Events} from '../src/v2-audit';
import {V2_ADDRESS} from '../src/v2-chain';

const alice='0x1111111111111111111111111111111111111111';
const bob='0x2222222222222222222222222222222222222222';
const otherContract='0x3333333333333333333333333333333333333333';
const tx='0x'+'a'.repeat(64);
function mock(name:string,args:unknown[],index:number,contract=V2_ADDRESS){
 const fragment=v2Events.getEvent(name);
 if(!fragment)throw Error('V2_TEST_EVENT_MISSING');
 const encoded=v2Events.encodeEventLog(fragment,args);
 return {address:contract,topics:encoded.topics,data:encoded.data,
  blockNumber:V2_DEPLOYMENT_BLOCK+9,index,transactionHash:tx};
}
describe('Bounded V2-only verified event attribution',()=>{
 it('identifies exact personally credited and funded referral amounts and the source wallet',()=>{
  const rows=decodeV2WalletEvents([
   mock('PersonalProfitCredited',[alice,ZeroAddress,'0x'+'1'.repeat(64),1000n],0),
   mock('ReferralProfitCredited',[alice,bob,'0x'+'2'.repeat(64),2,500,ZeroAddress,50n],1),
   mock('PersonalProfitCredited',[bob,ZeroAddress,'0x'+'3'.repeat(64),900n],2),
   mock('PersonalProfitCredited',[alice,ZeroAddress,'0x'+'4'.repeat(64),999n],3,otherContract),
  ],alice);
  expect(rows).toHaveLength(2);
  expect(rows[0].name).toBe('ReferralProfitCredited');
  expect(rows[0].amount).toBe(50n);
  expect(rows[0].source).toBe(bob);
  expect(rows[0].level).toBe(2);
  expect(rows[0].rateBps).toBe(500);
  expect(rows[1].name).toBe('PersonalProfitCredited');
  expect(rows[1].amount).toBe(1000n);
  expect(rows[1].proof).toBe('0x'+'1'.repeat(64));
 });
 it('deduplicates exact log keys and does not misattribute withdrawal resolution by request ID',()=>{
  const e=mock('WithdrawalRequested',[12,alice,ZeroAddress,false,100n,3n],0);
  const items=decodeV2WalletEvents([e,e,mock('WithdrawalApproved',[12,bob],1),
   mock('WithdrawalResolved',[12,2,'0x'+'0'.repeat(64)],2)],alice);
  expect(items).toHaveLength(1);
  expect(items[0].requestId).toBe(12);
  expect(items[0].amount).toBe(100n);
 });
 it('documents that all history is bounded, enforces safe limits and starts at V2 deployment',()=>{
  expect(v2Window(V2_DEPLOYMENT_BLOCK+100).from).toBe(V2_DEPLOYMENT_BLOCK);
  expect(v2Window(V2_DEPLOYMENT_BLOCK+3000).hasOlder).toBe(true);
  expect(()=>v2Window(V2_DEPLOYMENT_BLOCK-1)).toThrow(/WINDOW_INVALID/);
  expect(()=>v2Window(V2_DEPLOYMENT_BLOCK+100,-1)).toThrow(/WINDOW_INVALID/);
  expect(()=>decodeV2WalletEvents([], 'not a wallet')).toThrow(/WALLET_INVALID/);
  const log=mock('CheckIn',[alice,1800000000],0);
  expect(()=>decodeV2WalletEvents(Array(V2_MAX_EVENTS_PER_WINDOW+1).fill(log),alice))
   .toThrow(/TOO_MANY_EVENTS/);
 });
});
