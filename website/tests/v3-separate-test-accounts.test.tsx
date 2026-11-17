import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import V3SeparateTestAccounts,{PREVIOUS_HOURLY_TEST_PATH} from '../src/V3SeparateTestAccounts';
import type {V3SiteReleaseConfig} from '../src/v3-site-config';

const base={address:'0x0000000000000000000000000000000000000001',
 runtimeHash:'0x'+'a'.repeat(64),deploymentTx:'0x'+'b'.repeat(64)} satisfies V3SiteReleaseConfig;
const unified={...base,unified:{book:'0x0000000000000000000000000000000000000002',
 bookRuntimeHash:'0x'+'c'.repeat(64),network:'0x0000000000000000000000000000000000000003',
 networkRuntimeHash:'0x'+'d'.repeat(64)}} satisfies V3SiteReleaseConfig;

describe('separate BNB test account navigation',()=>{
 it('uses only the previous hourly test path and clearly separates account data',()=>{
  const html=renderToStaticMarkup(<V3SeparateTestAccounts config={unified}/>);
  expect(PREVIOUS_HOURLY_TEST_PATH).toBe('/hourly-test/');
  expect(html).toContain('href="/hourly-test/"');
  expect(html).toContain('Positions, balances and requests on the previous hourly test contract remain separate.');
  expect(html).toContain('They are not automatically transferred or combined with this account.');
  expect(html).not.toContain('?ref=');
  expect(html).not.toContain('TEST USDT');
  expect(html).not.toContain('0x0000000000000000000000000000000000000001');
 });
 it('does not add a notice or link to a legacy or unconfigured profile',()=>{
  expect(renderToStaticMarkup(<V3SeparateTestAccounts config={base}/>)).toBe('');
  expect(renderToStaticMarkup(<V3SeparateTestAccounts config={null}/>)).toBe('');
 });
});
