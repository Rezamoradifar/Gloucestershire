import {afterEach,describe,it,expect,vi} from 'vitest';
const primary='0x1111111111111111111111111111111111111111',old='0x2222222222222222222222222222222222222222';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();});
async function config(search:string,legacy=old){vi.stubEnv('VITE_CHAIN_ID','97');vi.stubEnv('VITE_VAULT_ADDRESS',primary);vi.stubEnv('VITE_LEGACY_VAULT_ADDRESS',legacy);vi.stubGlobal('window',{location:{search}});vi.resetModules();return import('../src/config');}
describe('explicit previous-contract account access',()=>{
 it('uses the new contract by default and the reviewed old contract only on an explicit switch',async()=>{expect((await config('')).vaultAddress).toBe(primary);const c=await config('?vault=previous');expect(c.vaultAddress).toBe(old);expect(c.usingLegacy).toBe(true);});
 it('does not accept arbitrary contract addresses from URLs or invalid legacy settings',async()=>{expect((await config('?vault='+old)).vaultAddress).toBe(primary);expect((await config('?vault=previous','oops')).vaultAddress).toBe(primary);expect((await config('?vault=previous',primary)).usingLegacy).toBe(false);});
});
