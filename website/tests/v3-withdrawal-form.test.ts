import {describe,expect,it} from 'vitest';
import {parseEther} from 'ethers';
import {parseV3Amount,prepareV3WithdrawalRequest} from '../src/v3-withdrawal-form';
import type {V3Snapshot} from '../src/v3-chain';

const to=(value:string)=>parseEther(value);
const now=200*86400;
const view={registered:true,suspended:false,pendingWithdrawal:false,asOf:now,nextRequestAt:0,
 referralAvailable:to('10'),networkAvailable:to('20'),ledger:{requestCap:to('5')},
 positions:[{id:0,availableProfit:to('9'),principal:to('100'),reservedPrincipal:to('10'),openedAt:now-90*86400}]} as unknown as V3Snapshot;
describe('classic form uses current V3 withdrawal rules',()=>{
 it('builds a profit request with the exact position and amount',()=>{
  expect(prepareV3WithdrawalRequest(view,'3.25','0','profit')).toEqual({kind:'requestProfit',positionId:0,amount:to('3.25')});
  expect(()=>prepareV3WithdrawalRequest(view,'5.01','0','profit')).toThrow(/cap|limit/i);
  expect(()=>prepareV3WithdrawalRequest({...view,positions:[{...view.positions[0],availableProfit:to('2')}]},'3','0','profit')).toThrow(/claim/i);
 });
 it('blocks pending, suspended, unregistered, and cooldown accounts',()=>{
  for(const changed of [{pendingWithdrawal:true},{suspended:true},{registered:false},{nextRequestAt:now+1}])
   expect(()=>prepareV3WithdrawalRequest({...view,...changed},'1','0','profit')).toThrow(/pending|suspended|cooldown/i);
 });
 it('preserves principal lock and referral/network caps',()=>{
  expect(prepareV3WithdrawalRequest(view,'90','0','principal').kind).toBe('requestPrincipal');
  expect(()=>prepareV3WithdrawalRequest(view,'91','0','principal')).toThrow(/reserved/i);
  expect(()=>prepareV3WithdrawalRequest({...view,asOf:now-1},'1','0','principal')).toThrow(/lock/i);
  expect(prepareV3WithdrawalRequest(view,'4','0','referral').kind).toBe('requestReferral');
  expect(prepareV3WithdrawalRequest(view,'4','0','network').kind).toBe('requestNetworkReward');
  expect(()=>prepareV3WithdrawalRequest(view,'6','0','referral')).toThrow(/cap/i);
 });
 it('rejects invalid and zero input',()=>{
  for(const value of ['', '-1','0','1e3','2..3'])expect(()=>parseV3Amount(value)).toThrow();
 });
});
