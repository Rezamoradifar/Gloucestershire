import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {V2_APPROVAL_REASONS} from '../src/v2-admin';
import {V2_EVENT_ABI,V2_MAX_LOG_WINDOW} from '../src/v2-audit';

const read=(name:string)=>fs.readFileSync(path.join(process.cwd(),name),'utf8');
describe('V2 manager security and transparent bounded reporting',()=>{
 it('checks independent KYC and withdrawal roles before any signed transaction',()=>{
  const file=read('src/v2-admin.ts');
  expect(file).toContain('KYC_ADMIN_ROLE');
  expect(file).toContain('WITHDRAWAL_APPROVER_ROLE');
  expect(file).toContain('GUARDIAN_ROLE');
  expect(file).toContain('hasRole(role,manager,options)');
  expect(file).toContain('.staticCall(...parameters)');
  expect(file).toContain("wait(3)");
  expect(file).not.toContain("privateKey");
  expect(file).not.toContain("batchProfit");
 });
 it('keeps KYC approval human-reviewed and no identity files are sent to chain',()=>{
  const ui=read('src/V2AdminConsole.tsx');
  expect(ui).toContain('I have personally reviewed sufficient authentic identity evidence');
  expect(ui).toContain('reviewConfirm.trim().toLowerCase()');
  expect(ui).toContain('identityReviewed');
  expect(ui).toContain("kind:'kyc'");
  expect(ui).toContain('This interface does not inspect or store identity documents');
  expect(ui).not.toContain('input type="file"');
  expect(ui).not.toContain('uploadIdentity');
 });
 it('separates both-assets principal, profit and vault cash shortfalls without claiming audit assurance',()=>{
  const ui=read('src/V2AdminConsole.tsx');
  expect(ui).toContain('Treasury coverage · BNB and USDT separately');
  expect(ui).toContain('a.unfunded');
  expect(ui).toContain('profit liabilities');
  expect(ui).toContain('not an independent audit');
 });
 it('provides full role-based customer lookup and explicit manager approval/rejection',()=>{
  const ui=read('src/V2AdminConsole.tsx');
  expect(ui).toContain('readV2AdminCustomer');
  expect(ui).toContain('readV2AdminRequests');
  expect(ui).toContain('readV2AdminMembers');
  expect(ui).toContain("kind:'approve'");
  expect(ui).toContain("kind:'reject'");
  expect(ui).toContain('V2HistoryPanel');
  expect(ui).toContain('Approval is never automatic');
 });
 it('defines only documented withdrawal rejection codes and bounded event ABI',()=>{
  expect(V2_APPROVAL_REASONS.map(x=>x.code)).toEqual([
   'TERMS_NOT_MET','DUPLICATE_REQUEST','COMPLIANCE_REVIEW','INVALID_REQUEST','OTHER_REVIEW'
  ]);
  expect(new Set(V2_APPROVAL_REASONS.map(x=>x.code)).size).toBe(5);
  expect(V2_MAX_LOG_WINDOW).toBeLessThanOrEqual(2000);
  expect(V2_EVENT_ABI.join(' ')).toContain('ReferralProfitCredited');
  expect(V2_EVENT_ABI.join(' ')).toContain('PersonalProfitCredited');
 });
});
