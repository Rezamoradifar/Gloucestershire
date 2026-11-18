import {describe,expect,it,vi} from 'vitest';
import type {Eip1193Provider} from 'ethers';
import {runV3Deposit,runV3Registration} from '../src/v3-account-flow';
import type {V3SiteReleaseConfig} from '../src/v3-site-config';

const wallet='0x0000000000000000000000000000000000000001';
const referrer='0x0000000000000000000000000000000000000000';
const provider={request:vi.fn()} as unknown as Eip1193Provider;
const legacy={address:'0x0000000000000000000000000000000000000002',runtimeHash:'0x',deploymentTx:'0x'} as V3SiteReleaseConfig;
const unified={...legacy,unified:{}} as V3SiteReleaseConfig;
function setup(){
 const register=vi.fn().mockResolvedValue('legacy-register');
 const deposit=vi.fn().mockResolvedValue('legacy-deposit');
 const unifiedRegister=vi.fn().mockResolvedValue('unified-register');
 const unifiedDeposit=vi.fn().mockResolvedValue('unified-deposit');
 const deps={register,deposit,unifiedRegister,unifiedDeposit} as unknown as NonNullable<Parameters<typeof runV3Deposit>[1]>;
 return {register,deposit,unifiedRegister,unifiedDeposit,deps};
}
describe('unified account flow routing',()=>{
 it('blocks registration and deposits before touching the provider by default',async()=>{
  const d=setup(),input={provider,wallet,referrer,config:unified};
  await expect(runV3Registration(input,d.deps)).rejects.toThrow(/read-only/);
  await expect(runV3Deposit({...input,amount:10n},d.deps)).rejects.toThrow(/read-only/);
  for(const call of [d.register,d.deposit,d.unifiedRegister,d.unifiedDeposit])expect(call).not.toHaveBeenCalled();
  expect(provider.request).not.toHaveBeenCalled();
 });
 it('routes unified actions only after explicit enabling with the exact account and amount',async()=>{
  const d=setup(),onProgress=vi.fn();
  const input={provider,wallet,referrer,config:unified,unifiedEnabled:true,onProgress};
  expect(await runV3Registration(input,d.deps)).toBe('unified-register');
  expect(await runV3Deposit({...input,amount:123n},d.deps)).toBe('unified-deposit');
  expect(d.unifiedRegister).toHaveBeenCalledWith(provider,wallet,referrer,unified,{enabled:true,onProgress});
  expect(d.unifiedDeposit).toHaveBeenCalledWith(provider,wallet,123n,referrer,unified,{enabled:true,onProgress});
  expect(d.register).not.toHaveBeenCalled();expect(d.deposit).not.toHaveBeenCalled();
  await expect(runV3Deposit({...input,amount:0n},d.deps)).rejects.toThrow(/positive/);
  expect(d.unifiedDeposit).toHaveBeenCalledOnce();
 });
 it('keeps legacy actions on their original senders without a unified opt-in',async()=>{
  const d=setup(),input={provider,wallet,referrer,config:legacy};
  expect(await runV3Registration(input,d.deps)).toBe('legacy-register');
  expect(await runV3Deposit({...input,amount:99n},d.deps)).toBe('legacy-deposit');
  expect(d.register).toHaveBeenCalledWith(provider,wallet,{kind:'register',referrer},legacy,undefined);
  expect(d.deposit).toHaveBeenCalledWith(provider,wallet,99n,referrer,legacy,undefined);
  expect(d.unifiedRegister).not.toHaveBeenCalled();expect(d.unifiedDeposit).not.toHaveBeenCalled();
 });
});
