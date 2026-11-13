import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {v2PickReadSource,v2WithTimeout,V2_ADDRESS,V2_CHAIN_ID,V2_READ_RPCS} from '../src/v2-chain';

describe('V2 account reads on mobile wallet RPC',()=>{
 it('uses the exact newly deployed V2 testnet contract and independent read-only RPCs',()=>{
  expect(V2_CHAIN_ID).toBe(97);
  expect(V2_ADDRESS.toLowerCase()).toBe('0xa98d8d3709f5d3730bad5d76c334731784e7cf07');
  expect(V2_READ_RPCS.length).toBeGreaterThan(1);
  const source=fs.readFileSync(new URL('../src/v2-chain.ts',import.meta.url),'utf8');
  expect(source).toContain("provider.getCode(V2_ADDRESS,'latest')");
  expect(source).toContain('keccak256(code).toLowerCase()!==V2_CODE_HASH');
  expect(source).not.toContain('/api/config');
  expect(source).not.toContain('0x4C0F6141b18971db4b14e45c0bE8CddB09febc14');
 });
 it('selects the responsive read source if another wallet RPC fails',async()=>{
  const answer=await v2PickReadSource([
   async()=>{throw Error('wallet RPC archive unavailable');},
   async()=>({chain:97,verified:true})
  ]);
  expect(answer).toEqual({chain:97,verified:true});
 });
 it('times out hung reads instead of freezing the mobile spinner indefinitely',async()=>{
  await expect(v2WithTimeout(new Promise<void>(()=>{}),15,'RPC timeout')).rejects.toThrow('RPC timeout');
  await expect(v2PickReadSource([()=>new Promise<void>(()=>{})],15)).rejects.toThrow(/timed out/i);
 });
 it('fails closed when all read providers error',async()=>{
  await expect(v2PickReadSource([
   async()=>{throw Error('HTTP 403');},
   async()=>{throw Error('RPC unavailable');}
  ])).rejects.toThrow(/could not verify/i);
 });
 it('does not claim connectivity success while account records have not loaded',()=>{
  const ui=fs.readFileSync(new URL('../src/V2Dashboard.tsx',import.meta.url),'utf8');
  expect(ui).toContain('Wallet connected — account data unavailable');
  expect(ui).toContain('Retry secure account read');
  expect(ui).toContain('readGeneration.current');
  expect(ui).toContain('setLoading(false)');
  expect(ui).not.toContain('Connect your V2 wallet to load verified records for this section. Old contract');
 });
});
