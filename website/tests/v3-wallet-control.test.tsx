import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import V3WalletControl from '../src/V3WalletControl';

const noop=()=>{};
const address='0x1234567890123456789012345678901234567890';

describe('V3 wallet control',()=>{
 it('offers connection when no wallet is selected',()=>{
  const html=renderToStaticMarkup(<V3WalletControl address="" busy={false} onConnect={noop} onDisconnect={noop}/>);
  expect(html).toContain('Connect wallet');
  expect(html).not.toContain('Disconnect');
 });
 it('shows the connected account and an explicit disconnect action',()=>{
  const html=renderToStaticMarkup(<V3WalletControl address={address} busy={false} onConnect={noop} onDisconnect={noop}/>);
  expect(html).toContain('Disconnect');
  expect(html).toContain('aria-label="Disconnect wallet"');
  expect(html).toContain('0x1234…7890');
  expect(html).toContain(address);
 });
 it('disables disconnect during a pending wallet action',()=>{
  const html=renderToStaticMarkup(<V3WalletControl address={address} busy={true} onConnect={noop} onDisconnect={noop}/>);
  expect(html).toMatch(/disabled=""[^>]*aria-label="Disconnect wallet"/);
 });
});
