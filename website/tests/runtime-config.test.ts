import {describe,it,expect,vi} from 'vitest';
import {fetchPublicConfig,parsePublicConfig} from '../src/runtime-config';
const address='0x1111111111111111111111111111111111111111';
describe('server contract connection',()=>{
 it('accepts only supported networks and nonzero valid contract addresses',()=>{
  expect(parsePublicConfig({version:1,chainId:97,vaultAddress:address})).toEqual({chainId:97,vaultAddress:address});
  for(const value of [{version:1,chainId:1,vaultAddress:address},{version:1,chainId:97,vaultAddress:'0x'+'0'.repeat(40)},{version:2,chainId:97,vaultAddress:address},{version:1,chainId:'97',vaultAddress:address}])expect(()=>parsePublicConfig(value)).toThrow();
 });
 it('uses the existing confirmed sales API only when the new config route is absent',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:404})).mockResolvedValueOnce(Response.json({status:'live',source:'contract-sales-settlements',chainId:97,contract:address}));
  expect(await fetchPublicConfig(fetcher)).toEqual({chainId:97,vaultAddress:address});
  expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/api/config','/api/trades?limit=1']);
 });
 it('stops on a failed or malformed config rather than switching targets silently',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{}',{status:503}));
  await expect(fetchPublicConfig(fetcher)).rejects.toThrow('unavailable');expect(fetcher).toHaveBeenCalledTimes(1);
  expect(()=>parsePublicConfig({status:'stale',source:'contract-sales-settlements',chainId:97,contract:address},true)).toThrow();
 });
});
