import {describe,expect,it,vi} from 'vitest';
import {parseEther} from 'ethers';
import {renderToStaticMarkup} from 'react-dom/server';
import V3UnifiedWithdrawalForm,{unifiedWithdrawalFormState,type V3UnifiedWithdrawalFormProps} from '../src/V3UnifiedWithdrawalForm';
import type {UnifiedPositionPage} from '../src/v3-unified-position';

const E=(value:string)=>parseEther(value);
const page={wallet:'0x0000000000000000000000000000000000000001',positionId:2,block:1234,
 asOf:9000000,start:0,limit:8,totalLots:10,principal:E('20'),daily:E('4'),compound:0n,reservedProfit:0n,
 availableProfitOnPage:E('4.000000000000000001'),maturedPrincipalOnPage:E('8.5'),
 lots:Array.from({length:8},(_,id)=>({id}))} as unknown as UnifiedPositionPage;
const props:V3UnifiedWithdrawalFormProps={page,busy:false,readOnly:false,registered:true,suspended:false,
 paused:false,pendingWithdrawal:false,nextRequestAt:0,requestCap:E('3'),value:'2.000000000000000001',
 onValue:vi.fn(),onSubmit:vi.fn(),onPrevious:vi.fn(),onNext:vi.fn()};

describe('unified testnet withdrawal form',()=>{
 it('shows only the selected page, exact limits, fees, funding and read-only status',()=>{
  const html=renderToStaticMarkup(<V3UnifiedWithdrawalForm {...props} readOnly/>);
  expect(html).toContain('Additions 1–8 of 10');
  expect(html).toContain('4.000000000000000001 TEST');
  expect(html).toContain('8.5 TEST');
  expect(html).toContain('Maximum profit request on this page: <strong>3.0 TEST</strong>');
  expect(html).toContain('Profit request fee: 3%');
  expect(html).toContain('Principal request penalty: 30%');
  expect(html).toContain('only the additions shown on this page');
  expect(html).toContain('manager approval and actual test-token funding');
  expect(html).toContain('Gross: 2.000000000000000001 TEST');
  expect(html).toContain('Fee: 0.06 TEST');
  expect(html).toContain('Net: 1.940000000000000001 TEST');
  expect(html).toContain('This test preview is read-only');
  expect(html).toMatch(/<button type="submit" disabled=""/);
 });
 it('explains when settlement is not ready and keeps the request disabled',()=>{
  const html=renderToStaticMarkup(<V3UnifiedWithdrawalForm {...props} readOnly
   disabledReason="Withdrawal requests are disabled until testnet settlement is ready."/>);
  expect(html).toContain('Withdrawal requests are disabled until testnet settlement is ready.');
  expect(html).toMatch(/<button type="submit" disabled=""/);
 });
 it('enforces exact profit cap and computes fee without floating point rounding',()=>{
  const state=unifiedWithdrawalFormState(props,'profit');
  expect(state.canSubmit).toBe(true);
  expect(state.fee).toBe(60000000000000000n);
  expect(state.net).toBe(1940000000000000001n);
  const tooMuch=unifiedWithdrawalFormState({...props,value:'3.000000000000000001'},'profit');
  expect(tooMuch.canSubmit).toBe(false);expect(tooMuch.error).toMatch(/cap/i);
 });
 it('requires matured unreserved principal and calculates the 30% penalty',()=>{
  const state=unifiedWithdrawalFormState({...props,value:'8.5'},'principal');
  expect(state.canSubmit).toBe(true);expect(state.fee).toBe(E('2.55'));expect(state.net).toBe(E('5.95'));
  const tooMuch=unifiedWithdrawalFormState({...props,value:'8.500000000000000001'},'principal');
  expect(tooMuch.canSubmit).toBe(false);expect(tooMuch.error).toMatch(/unlocked principal/i);
 });
 it('disables requests while pending, cooling down, paused or unverified',()=>{
  expect(unifiedWithdrawalFormState({...props,pendingWithdrawal:true},'profit').canSubmit).toBe(false);
  expect(unifiedWithdrawalFormState({...props,nextRequestAt:page.asOf+1},'profit').canSubmit).toBe(false);
  expect(unifiedWithdrawalFormState({...props,paused:true},'profit').canSubmit).toBe(false);
  expect(unifiedWithdrawalFormState({...props,readOnly:true},'profit').canSubmit).toBe(false);
  expect(unifiedWithdrawalFormState({...props,page:{...page,limit:16}},'profit').canSubmit).toBe(false);
  expect(unifiedWithdrawalFormState({...props,page:{...page,lots:page.lots.slice(0,7)}},'profit').canSubmit).toBe(false);
  expect(unifiedWithdrawalFormState({...props,value:'0'},'profit').canSubmit).toBe(false);
 });
});
