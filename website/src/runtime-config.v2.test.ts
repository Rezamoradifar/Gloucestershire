import {describe,expect,it,vi} from 'vitest';
import {fetchPublicConfig,parsePublicConfig} from './runtime-config';

const oldVault='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
const newVault='0xA98D8d3709f5D3730BAD5d76C334731784e7CF07';

describe('V2-only site contract routing',()=>{
 it('rejects the historical contract even if public API returns version 1',()=>{
  expect(()=>parsePublicConfig({version:1,chainId:97,vaultAddress:oldVault})).toThrow(/old contract/i);
 });
 it('accepts a new explicitly configured address without claiming ABI compatibility',()=>{
  expect(parsePublicConfig({version:1,chainId:97,vaultAddress:newVault}).vaultAddress.toLowerCase()).toBe(newVault.toLowerCase());
 });
 it('blocks any different contract even on the same testnet',()=>{
  expect(()=>parsePublicConfig({version:1,chainId:97,vaultAddress:'0x0000000000000000000000000000000000000123'})).toThrow(/approved isolated V2/i);
 });
 it('blocks mainnet config until a separately reviewed deployment',()=>{
  expect(()=>parsePublicConfig({version:1,chainId:56,vaultAddress:newVault})).toThrow(/approved isolated V2/i);
 });
 it('never trusts the legacy trading feed for the transaction address',()=>{
  expect(()=>parsePublicConfig({source:'contract-sales-settlements',status:'live',chainId:97,contract:newVault},true)).toThrow(/Legacy contract discovery/i);
 });
 it('uses only no-store public config, never a legacy fallback on 404',async()=>{
  const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>({ok:false,status:404}) as Response);
  await expect(fetchPublicConfig(fetcher as unknown as typeof fetch)).rejects.toThrow(/unavailable/i);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('/api/config');
  expect(fetcher.mock.calls[0][1]).toMatchObject({cache:'no-store'});
 });
});
