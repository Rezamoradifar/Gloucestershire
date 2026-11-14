import {afterEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import V3ReferralInvite from '../src/V3ReferralInvite';
import type {V3Snapshot} from '../src/v3-chain';

const wallet='0x0000000000000000000000000000000000000123';
afterEach(()=>vi.unstubAllGlobals());

describe('V3 referral invitation',()=>{
 it('builds a same-site link from the registered current wallet',()=>{
  vi.stubGlobal('window',{location:{origin:'https://globaldroptrade.com',pathname:'/'}});
  const view={wallet,registered:true,eligible:true} as V3Snapshot;
  const html=renderToStaticMarkup(<V3ReferralInvite view={view}/>);
  expect(html).toContain(wallet);
  expect(html).toContain('https://globaldroptrade.com/?ref='+wallet+'#dashboard');
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
