import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import V3AccountSteps from '../src/V3AccountSteps';
import CompanyDocuments from '../src/CompanyDocuments';

describe('V3 landing uses the connected account workflow',()=>{
 it('links to the real contract workspace and explains the separate payout steps',()=>{
  const html=renderToStaticMarkup(<V3AccountSteps/>);
  for(const text of ['Connect your wallet','Open a position','Follow your daily cycle',
   'Request and verify payment','BNB Testnet','test USDT','href="#dashboard"'])
   expect(html).toContain(text);
  expect(html).toContain('Approval, test-token funding and the confirmed payment are separate steps.');
  expect(html).not.toContain('ILLUSTRATIVE DATA');
 });
 it('shows missing original documents without a sample picture in the V3 release',()=>{
  const html=renderToStaticMarkup(<CompanyDocuments showSampleImages={false}/>);
  expect(html).toContain('Document not yet published');
  expect(html).not.toContain('SAMPLE IMAGE');
  expect(html).not.toContain('company-registration-sample.webp');
 });
});
