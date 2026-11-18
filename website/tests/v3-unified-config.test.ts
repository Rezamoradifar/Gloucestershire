import {describe,expect,it,vi} from 'vitest';
import {ZeroAddress} from 'ethers';
import {v3ParseReleaseConfig,unifiedWalletEnabled} from '../src/v3-site-config';
import {sendV3Action,sendV3FundWithdrawal,sendV3TestTokenDeposit} from '../src/v3-actions';

const base={address:'0x1111111111111111111111111111111111111111',
 runtimeHash:'0x'+'aa'.repeat(32),deploymentTx:'0x'+'bb'.repeat(32)};
const unified={...base,unifiedMode:'unified-testnet',book:'0x2222222222222222222222222222222222222222',
 network:'0x3333333333333333333333333333333333333333',
 bookRuntimeHash:'0x'+'cc'.repeat(32),networkRuntimeHash:'0x'+'dd'.repeat(32)};

describe('unified testnet release identity',()=>{
 it('keeps an existing V3 release unchanged without an explicit unified profile',()=>{
  expect(v3ParseReleaseConfig(base)).toEqual(base);
 });
 it('requires both distinct components and pinned runtime hashes',()=>{
  expect(v3ParseReleaseConfig(unified)?.unified).toEqual({book:unified.book,network:unified.network,
   bookRuntimeHash:unified.bookRuntimeHash,networkRuntimeHash:unified.networkRuntimeHash});
  expect(v3ParseReleaseConfig({...unified,bookRuntimeHash:'0x01'})).toBeNull();
  expect(v3ParseReleaseConfig({...unified,network:unified.book})).toBeNull();
  expect(v3ParseReleaseConfig({...unified,book:base.address})).toBeNull();
  expect(v3ParseReleaseConfig({...unified,network:ZeroAddress})).toBeNull();
  expect(v3ParseReleaseConfig({...unified,unifiedMode:'mainnet'})).toBeNull();
  expect(v3ParseReleaseConfig({...base,address:ZeroAddress})).toBeNull();
 });
 it('opens wallet actions only in the explicitly enabled separate hourly build',()=>{
  const config=v3ParseReleaseConfig(unified),mode='verified-isolated-testnet',primary='verified-testnet';
  expect(unifiedWalletEnabled(config,'/unified-test/',true,primary,mode)).toBe(true);
  for(const path of ['/','/hourly-test/','/unified-test/other','/unified-test2/'])
   expect(unifiedWalletEnabled(config,path,true,primary,mode)).toBe(false);
  expect(unifiedWalletEnabled(base,'/unified-test/',true,primary,mode)).toBe(false);
  expect(unifiedWalletEnabled(config,'/unified-test/',false,primary,mode)).toBe(false);
  expect(unifiedWalletEnabled(config,'/unified-test/',true,'',mode)).toBe(false);
  expect(unifiedWalletEnabled(config,'/unified-test/',true,primary,'')).toBe(false);
 });
 it('blocks every wallet-writing entry point in the unfinished unified preview',async()=>{
  const request=vi.fn(),provider={request} as any,config=v3ParseReleaseConfig(unified)!;
  await expect(sendV3Action(provider,base.address,{kind:'register',referrer:ZeroAddress},config)).rejects.toThrow(/read-only preview/);
  await expect(sendV3TestTokenDeposit(provider,base.address,10n**19n,ZeroAddress,config)).rejects.toThrow(/read-only preview/);
  await expect(sendV3FundWithdrawal(provider,base.address,0,config)).rejects.toThrow(/read-only preview/);
  expect(request).not.toHaveBeenCalled();
 });
});
