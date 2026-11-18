import {describe,it,expect} from 'vitest';
import {parseEther} from 'ethers';
import fs from 'node:fs';
import {
 getV3UnifiedAccount,planV3UnifiedWithdrawal,type V3UnderlyingPosition
} from '../src/v3-unified-account';

const u=(x:string)=>parseEther(x);
const p=(id:number,principal:string,profit:string,openedAt=1000000):V3UnderlyingPosition=>({
 id,principal:u(principal),reservedPrincipal:0n,
 availableProfit:u(profit),availableDaily:u(profit),availableCompound:0n,
 reservedProfit:0n,openedAt,lastAccruedAt:openedAt
});
const now=1000000+91*86400;
const script=fs.readFileSync(new URL('../src/V3Dashboard.tsx',import.meta.url),'utf8');
const contract=fs.readFileSync(new URL('../../contracts/v3/GlobalV3DeferredTestnet.sol',import.meta.url),'utf8');

describe('Global V3 one visible investment, safe automatic on-chain position routing',()=>{
 it('shows one combined account and accurate sum of underlying daily and compound balances',()=>{
  const positions=[p(0,'100','2'),{...p(1,'200','3'),availableDaily:u('2.5'),
   availableCompound:u('0.5')}];
  const result=getV3UnifiedAccount(positions,now,u('100'));
  expect(result.principal).toBe(u('300'));
  expect(result.currentProfit).toBe(u('5'));
  expect(result.currentDaily).toBe(u('4.5'));
  expect(result.currentCompound).toBe(u('0.5'));
  expect(result.maxSingleProfitRequest).toBe(u('3'));
  expect(result.maxSinglePrincipalRequest).toBe(u('200'));
  expect(result.maturedPrincipal).toBe(u('300'));
  expect(result.underlyingPositions).toBe(2);
 });
 it('selects an eligible underlying position deterministically with no position selector',()=>{
  const positions=[p(1,'100','2',1000001),p(0,'200','6',1000000)];
  const plan=planV3UnifiedWithdrawal('profit',u('5'),positions,now,u('100'));
  expect(plan.kind).toBe('requestProfit');
  expect(plan.positionId).toBe(0);
  expect(plan.amount).toBe(u('5'));
  expect(plan.accountTotal).toBe(u('8'));
  const principal=planV3UnifiedWithdrawal('principal',u('150'),positions,now,u('100'));
  expect(principal.positionId).toBe(0);
  expect(principal.kind).toBe('requestPrincipal');
 });
 it('fails closed when aggregate is enough but contract cannot consume multiple positions in one request',()=>{
  const positions=[p(0,'100','3'),p(1,'100','4')];
  expect(()=>planV3UnifiedWithdrawal('profit',u('6'),positions,now,u('100')))
   .toThrow(/one underlying position/);
  expect(()=>planV3UnifiedWithdrawal('principal',u('150'),positions,now,u('100')))
   .toThrow(/one underlying position/);
 });
 it('obeys 90-day lock, verified free principal and per-request profit cap',()=>{
  const recent=p(0,'400','60',now-10);
  expect(getV3UnifiedAccount([recent],now,u('10')).maturedPrincipal).toBe(0n);
  expect(()=>planV3UnifiedWithdrawal('principal',u('1'),[recent],now,u('10'))).toThrow();
  expect(()=>planV3UnifiedWithdrawal('profit',u('11'),[recent],now,u('10'))).toThrow(/10%/);
  const older={...p(1,'100','0'),reservedPrincipal:u('90')};
  expect(planV3UnifiedWithdrawal('principal',u('10'),[older],now,u('10')).positionId).toBe(1);
  expect(()=>planV3UnifiedWithdrawal('principal',u('11'),[older],now,u('10'))).toThrow();
 });
 it('rejects mismatched, duplicated, or invented position credits',()=>{
  expect(()=>getV3UnifiedAccount([p(0,'100','1'),p(0,'200','2')],now,u('10'))).toThrow();
  expect(()=>getV3UnifiedAccount([{...p(0,'100','3'),availableDaily:u('0')}],now,u('10'))).toThrow();
  expect(()=>getV3UnifiedAccount([{...p(0,'100','3'),reservedPrincipal:u('101')}],now,u('10'))).toThrow();
  expect(()=>planV3UnifiedWithdrawal('profit',0n,[p(0,'100','1')],now,u('10'))).toThrow();
 });
 it('removes Position 1/2 selector from both withdrawal and investment panels',()=>{
  expect(script).toContain('data-testid="v3-unified-position"');
  expect(script).toContain('planV3UnifiedWithdrawal(');
  expect(script).toContain('getV3UnifiedAccount(');
  expect(script).not.toContain('selectedPosition');
  expect(script).not.toContain('id="v3-request-position"');
  expect(script).not.toContain('Position #{p.id+1}');
  expect(script).toContain('immutable deployed V3');
 });
 it('does not pretend immutable on-chain V3 has one actual position or aggregate withdraw method',()=>{
  expect(contract).toContain('positions[msg.sender].push(Position(');
  expect(contract).toContain('function requestProfit(uint256 positionId,uint256 amount)');
  expect(contract).toContain('function requestPrincipal(uint256 positionId,uint256 amount)');
  expect(contract).toContain('u.pendingRequest=true');
  expect(contract).not.toContain('function requestProfitAggregate(');
 });
});
