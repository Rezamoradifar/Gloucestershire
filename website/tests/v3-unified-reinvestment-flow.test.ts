import {describe,expect,it,vi} from 'vitest';
import type {Eip1193Provider} from 'ethers';
import {runUnifiedReinvestment} from '../src/v3-unified-reinvestment-flow';
import type {V3SiteReleaseConfig} from '../src/v3-site-config';
import {sendV3UnifiedReinvestment} from '../src/v3-actions';

const wallet='0x0000000000000000000000000000000000000001';
const provider={request:vi.fn()} as unknown as Eip1193Provider;
const config={address:'0x0000000000000000000000000000000000000002',unified:{}} as V3SiteReleaseConfig;

describe('unified reinvestment flow release guard',()=>{
 it('does not invoke a wallet sender in the default read-only preview',async()=>{
  const send=vi.fn() as unknown as typeof sendV3UnifiedReinvestment;
  await expect(runUnifiedReinvestment({provider,wallet,amount:10n,config},send)).rejects.toThrow(/read-only/);
  expect(send).not.toHaveBeenCalled();expect(provider.request).not.toHaveBeenCalled();
 });
 it('forwards the exact amount only after explicit enablement and validation',async()=>{
  const send=vi.fn().mockResolvedValue({hash:'0x01',destination:2,amount:10n});
  const onProgress=vi.fn();
  const result=await runUnifiedReinvestment({enabled:true,provider,wallet,amount:10n,config,onProgress},send);
  expect(send).toHaveBeenCalledOnce();expect(send).toHaveBeenCalledWith(provider,wallet,10n,config,onProgress);
  expect(result.destination).toBe(2);
  await expect(runUnifiedReinvestment({enabled:true,provider,wallet,amount:0n,config},send)).rejects.toThrow(/positive/);
  await expect(runUnifiedReinvestment({enabled:true,provider,wallet,amount:10n,config:null},send)).rejects.toThrow(/verified unified/);
  expect(send).toHaveBeenCalledOnce();
 });
});
