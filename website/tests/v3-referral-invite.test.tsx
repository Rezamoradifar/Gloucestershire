import {afterEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import V3ReferralInvite from '../src/V3ReferralInvite';
import type {V3Snapshot} from '../src/v3-chain';

const wallet='0x0000000000000000000000000000000000000123';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('V3 referral invitation',()=>{
 it('builds a same-site link from the registered current wallet',()=>{
  vi.stubGlobal('window',{location:{origin:'https://globaldroptrade.com',pathname:'/'}});
  const view={wallet,registered:true,eligible:true} as V3Snapshot;
  const html=renderToStaticMarkup(<V3ReferralInvite view={view}/>);
  expect(html).toContain(wallet);
  expect(html).toContain('https://globaldroptrade.com/?ref='+wallet+'#dashboard');
 });
 it('shares the promoted account at the main dashboard and keeps isolated referrals on their own route',()=>{
  vi.stubEnv('VITE_V3_UNIFIED_PRIMARY','single-capital-testnet');
  vi.stubGlobal('window',{location:{origin:'https://globaldroptrade.com',pathname:'/hourly-test/'}});
  const view={wallet,registered:true,singleCapital:true} as V3Snapshot;
  expect(renderToStaticMarkup(<V3ReferralInvite view={view}/>)).toContain('/?ref='+wallet+'#dashboard');
  vi.stubEnv('VITE_V3_UNIFIED_PRIMARY','');
  expect(renderToStaticMarkup(<V3ReferralInvite view={view}/>)).toContain('/hourly-test/?ref='+wallet+'#dashboard');
 });
 it('explains daily referral eligibility at maturity even if posting is delayed',()=>{
  const view={wallet,registered:true,eligible:true,dailyPlan:true} as V3Snapshot;
  const html=renderToStaticMarkup(<V3ReferralInvite view={view}/>);
  expect(html).toContain('when that daily cycle ends');
  expect(html).toContain('An inactive level earns zero');
  expect(html).not.toContain('when a referral claim is recorded');
 });
 it('does not offer an invitation for an unregistered wallet',()=>{
  vi.stubGlobal('window',{location:{origin:'https://globaldroptrade.com',pathname:'/'}});
  const view={wallet,registered:false,eligible:false} as V3Snapshot;
  const html=renderToStaticMarkup(<V3ReferralInvite view={view}/>);
  expect(html).toContain('Register this wallet before sharing an invitation.');
  expect(html).not.toContain(wallet);
  expect(html).not.toContain('?ref=');
 });
});
