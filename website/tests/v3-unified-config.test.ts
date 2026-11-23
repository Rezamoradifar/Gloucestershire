import {describe,expect,it,vi} from 'vitest';
import {ZeroAddress} from 'ethers';
import {v3ParseReleaseConfig,unifiedWalletEnabled} from '../src/v3-site-config';
import {networkActionTarget} from '../src/v3-unified-network';
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
  const single=v3ParseReleaseConfig({...unified,unifiedMode:'single-capital-testnet'});
  expect(single?.unified?.singleCapital).toBe(true);
  expect(unifiedWalletEnabled(single,'/single-capital-test/',true,primary,mode)).toBe(true);
  expect(unifiedWalletEnabled(single,'/unified-test/',true,primary,mode)).toBe(false);
  expect(unifiedWalletEnabled(config,'/single-capital-test/',true,primary,mode)).toBe(false);
 });
 it('keeps the gas-only operator separate from the investment contract identity',()=>{
  const keeper='0x4444444444444444444444444444444444444444';
  const config=v3ParseReleaseConfig({...unified,unifiedMode:'single-capital-testnet',keeper});
  expect(config?.unified?.keeper).toBe(keeper);
  expect(unifiedWalletEnabled(config,'/single-capital-test/',true,'verified-testnet','verified-isolated-testnet')).toBe(true);
  for(const keeper of [ZeroAddress,unified.address,unified.book,unified.network,'invalid'])
   expect(v3ParseReleaseConfig({...unified,keeper})).toBeNull();
 });
 it('enables the main-domain account only for the explicitly promoted single-capital build',()=>{
  const config=v3ParseReleaseConfig({...unified,unifiedMode:'single-capital-testnet'});
  const enabled=(path:string,rootMode='single-capital-testnet')=>
   unifiedWalletEnabled(config,path,true,'verified-testnet','verified-isolated-testnet',rootMode);
  expect(enabled('/')).toBe(true);
  expect(enabled('/index.html')).toBe(true);
  expect(enabled('/hourly-test/')).toBe(true);
  expect(enabled('/hourly-test')).toBe(true);
  expect(enabled('/single-capital-test/')).toBe(true);
  expect(enabled('/single-capital-test/index.html')).toBe(true);
  expect(enabled('/hourly-test/index.html')).toBe(true);
  expect(enabled('/hourly-test/index.html','')).toBe(false);
  expect(enabled('/unified-test/index.html')).toBe(false);
  expect(enabled('/previous-hourly-test/index.html')).toBe(false);
  expect(enabled('/single-capital-test/other/index.html')).toBe(false);
  expect(enabled('/','')).toBe(false);
  for(const path of ['/unified-test/','/other/','/previous-hourly-test/'])expect(enabled(path)).toBe(false);
  expect(unifiedWalletEnabled(v3ParseReleaseConfig(unified),'/',true,'verified-testnet',
   'verified-isolated-testnet','single-capital-testnet')).toBe(false);
 });
 it('blocks every wallet-writing entry point in the unfinished unified preview',async()=>{
  const request=vi.fn(),provider={request} as any,config=v3ParseReleaseConfig(unified)!;
  await expect(sendV3Action(provider,base.address,{kind:'register',referrer:ZeroAddress},config)).rejects.toThrow(/read-only preview/);
  await expect(sendV3TestTokenDeposit(provider,base.address,10n**19n,ZeroAddress,config)).rejects.toThrow(/read-only preview/);
  await expect(sendV3FundWithdrawal(provider,base.address,0,config)).rejects.toThrow(/read-only preview/);
  expect(request).not.toHaveBeenCalled();
 });
});

it('locks the daily profile to its verified daily test route and period',()=>{
 const daily=v3ParseReleaseConfig({...unified,unifiedMode:'daily-capital-testnet'});
 const enabled=(path:string,hourly=false)=>unifiedWalletEnabled(daily,path,hourly,
  'verified-testnet','verified-isolated-testnet','single-capital-testnet');
 expect(daily?.unified).toMatchObject({dailyPlan:true,singleCapital:true});
 expect(enabled('/daily-capital-test/')).toBe(true);
 expect(enabled('/daily-capital-test/',true)).toBe(false);
 for(const route of ['/','/unified-test/','/hourly-test/','/single-capital-test/'])expect(enabled(route)).toBe(false);
});

it('binds the corrected referral account to its own route or explicitly verified root',()=>{
 const config=v3ParseReleaseConfig({...unified,unifiedMode:'referral-profit-testnet'});
 expect(config?.unified?.baseProfitReferrals).toBe(true);
 const enabled=(path:string,rootMode='')=>unifiedWalletEnabled(config,path,true,'verified-testnet','verified-isolated-testnet',rootMode);
 expect(enabled('/referral-profit-test/')).toBe(true);
 expect(enabled('/')).toBe(false);
 expect(enabled('/','single-capital-testnet')).toBe(false);
 expect(enabled('/','referral-profit-testnet')).toBe(true);
 for(const path of ['/hourly-test/','/single-capital-test/','/daily-capital-test/','/unified-test/'])
  expect(enabled(path,'referral-profit-testnet')).toBe(false);
});


it('binds the manual-reinvestment account to its own verified route and rejects manual group writes',()=>{
 const mode='manual-reinvest-testnet';
 const config=v3ParseReleaseConfig({...unified,unifiedMode:mode})!;
 expect(config.unified).toMatchObject({singleCapital:true,baseProfitReferrals:true,manualReinvest:true});
 const enabled=(path:string,primary='')=>unifiedWalletEnabled(config,path,true,'verified-testnet','verified-isolated-testnet',primary);
 expect(enabled('/manual-reinvest-test/')).toBe(true);
 expect(enabled('/',mode)).toBe(true);
 expect(enabled('/','referral-profit-testnet')).toBe(false);
 for(const path of ['/hourly-test/','/single-capital-test/','/referral-profit-test/','/daily-capital-test/'])
  expect(enabled(path,mode)).toBe(false);
 expect(()=>networkActionTarget(config,{kind:'createRewardGroup',branches:[base.address]})).toThrow('automatically');
 expect(networkActionTarget(config,{kind:'claimNetworkRewards',group:0,stage:0,count:1})).toBe(base.address);
});

it('enables recipient-rate wallet actions only on the matching test route or verified primary',()=>{
 const mode='upline-rates-testnet';
 const config=v3ParseReleaseConfig({...unified,unifiedMode:mode})!;
 expect(config.unified).toMatchObject({singleCapital:true,baseProfitReferrals:true,manualReinvest:true,uplineRates:true});
 const enabled=(path:string,primary='')=>unifiedWalletEnabled(config,path,true,'verified-testnet','verified-isolated-testnet',primary);
 expect(enabled('/upline-rates-test/')).toBe(true);
 expect(enabled('/',mode)).toBe(true);
 expect(enabled('/','manual-reinvest-testnet')).toBe(false);
 expect(enabled('/manual-reinvest-test/',mode)).toBe(false);
});

it('gates pooled earnings on the matching version and route',()=>{
 const mode='account-reinvest-testnet';
 const config=v3ParseReleaseConfig({...unified,unifiedMode:mode})!;
 expect(config.unified).toMatchObject({singleCapital:true,manualReinvest:true,uplineRates:true,accountReinvest:true});
 const enabled=(path:string,primary='')=>unifiedWalletEnabled(config,path,true,'verified-testnet','verified-isolated-testnet',primary);
 expect(enabled('/account-reinvest-test/')).toBe(true);
 expect(enabled('/',mode)).toBe(true);
 expect(enabled('/','upline-rates-testnet')).toBe(false);
 expect(enabled('/upline-rates-test/',mode)).toBe(false);
 expect(v3ParseReleaseConfig({...unified,unifiedMode:'upline-rates-testnet'})?.unified?.accountReinvest).toBeUndefined();
});
