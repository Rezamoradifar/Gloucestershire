import {describe,it,expect} from 'vitest';
import {parseEther} from 'ethers';
import fs from 'node:fs';
import {summarizeV3AccrualStatus} from '../src/v3-profit-status';

const now=1750000000;
const base={
 registered:true,suspended:false,paused:false,
 eligible:true,capital:parseEther('1000'),asOf:now,
 lastCheckIn:now-10,
 positions:[{id:0,principal:parseEther('1000'),lastAccruedAt:now-86400}]
};
const read=(path:string)=>fs.readFileSync(new URL('../src/'+path,import.meta.url),'utf8');

describe('V3 live internal profit readiness, no fake payments',()=>{
 it('shows due state but never claims that the keeper has sent a transaction',()=>{
  const r=summarizeV3AccrualStatus(base);
  expect(r.code).toBe('DUE_NEEDS_KEEPER_OR_USER_TX');
  expect(r.eligibleDueCount).toBe(1);
  expect(r.shouldAccrueWithoutCheckIn).toBe(true);
  expect(r.canSignCheckIn).toBe(false);
 });
 it('shows missing or expired user check-in even when a position is mature',()=>{
  const r=summarizeV3AccrualStatus({...base,lastCheckIn:now-86401,eligible:false});
  expect(r.code).toBe('CHECKIN_REQUIRED');
  expect(r.canSignCheckIn).toBe(true);
 });
 it('shows zero actual V3 deposits as a blocker, not an invented profit claim',()=>{
  expect(summarizeV3AccrualStatus({...base,positions:[],capital:0n}).code).toBe('NO_POSITION');
  expect(summarizeV3AccrualStatus({...base,registered:false}).code).toBe('UNREGISTERED');
 });
 it('shows paused, suspended and not matured statuses without claiming wallet deposits',()=>{
  expect(summarizeV3AccrualStatus({...base,paused:true}).code).toBe('PAUSED');
  expect(summarizeV3AccrualStatus({...base,suspended:true}).code).toBe('SUSPENDED');
  const r=summarizeV3AccrualStatus({...base,positions:[{
   id:0,principal:parseEther('1000'),lastAccruedAt:now-60
  }]});
  expect(r.code).toBe('NOT_YET_DUE');
  expect(r.eligibleDueCount).toBe(0);
  expect(r.nextDueAt).toBe(now+86340);
 });
 it('app only triggers user-authorized actual on-chain accrual with no manager role',()=>{
  const dashboard=read('V3Dashboard.tsx');
  const actions=read('v3-actions.ts');
  expect(dashboard).toContain('summarizeV3AccrualStatus(');
  expect(dashboard).toContain('data-testid="v3-profit-readiness"');
  expect(dashboard).toContain("kind:'accrueDaily'");
  expect(actions).toContain("case 'accrueDaily':");
  expect(actions).toContain("name='accrueDaily';args=[getAddress(wallet),action.positionId]");
  expect(read('v3-chain.ts')).toContain("'function accrueDaily(address,uint256)'");
  expect(dashboard).not.toContain('AUTO_CREDIT_WITHOUT_CHAIN');
 });
});
