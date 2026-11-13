import {describe,it,expect,vi} from 'vitest';
import {fetchPublicConfig,parsePublicConfig} from '../src/runtime-config';

const approved='0xA98D8d3709f5D3730BAD5d76C334731784e7CF07';
const historical='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
describe('isolated V2 server contract connection',()=>{
 it('accepts only the designated V2 testnet contract and valid public config',()=>{
  expect(parsePublicConfig({version:1,chainId:97,vaultAddress:approved})).toEqual({chainId:97,vaultAddress:approved});
  for(const value of [
   {version:1,chainId:1,vaultAddress:approved},
   {version:1,chainId:56,vaultAddress:approved},
   {version:1,chainId:97,vaultAddress:historical},
   {version:1,chainId:97,vaultAddress:'0x'+'0'.repeat(40)},
   {version:1,chainId:97,vaultAddress:'0x1111111111111111111111111111111111111111'},
   {version:2,chainId:97,vaultAddress:approved},
   {version:1,chainId:'97',vaultAddress:approved}
  ])expect(()=>parsePublicConfig(value)).toThrow();
 });
 it('does not fall back to historical trade API when V2 config route is absent',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:404}));
  await expect(fetchPublicConfig(fetcher)).rejects.toThrow(/unavailable/);
  expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/api/config']);
 });
 it('stops on a failed or malformed config rather than switching targets silently',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{}',{status:503}));
  await expect(fetchPublicConfig(fetcher)).rejects.toThrow('unavailable');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(()=>parsePublicConfig({status:'live',source:'contract-sales-settlements',chainId:97,contract:approved},true)).toThrow();
 });
});
