import {getAddress,parseEther} from 'ethers';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
import {V3SettlementBreakdown} from '../src/V3SettlementQueue';
import {readV3ManagerQueue} from '../src/v3-actions';
import {recheckOperatorWithdrawal} from '../src/v3-unified-settlement';
import {v3ReadSession} from '../src/v3-chain';
import type {V3SiteReleaseConfig} from '../src/v3-site-config';

vi.mock('../src/v3-chain',async original=>({...await original<typeof import('../src/v3-chain')>(),v3ReadSession:vi.fn()}));
const provider={request:vi.fn()},admin=getAddress('0x'+'12'.repeat(20)),member=getAddress('0x'+'23'.repeat(20)),hash='0x'+'ab'.repeat(32);
const config={unified:{portfolio:true},address:'0x'+'11'.repeat(20)} as V3SiteReleaseConfig;
const anchor={block:98,hash},parts={personal:parseEther('10'),referral:parseEther('2'),network:parseEther('3'),principal:parseEther('5')};
const raw={beneficiary:member,gross:parseEther('20'),fee:parseEther('1.8'),requestedAt:1794760000n,status:0n,kind:4n,positionId:0n};
function source(manage=true,fund=false){
 const vault={MANAGER_ROLE:vi.fn().mockResolvedValue('manager'),FUNDER_ROLE:vi.fn().mockResolvedValue('funder'),
  hasRole:vi.fn(async(role:string)=>role==='manager'?manage:fund),withdrawalCount:vi.fn().mockResolvedValue(43n),
  withdrawalOf:vi.fn().mockResolvedValue(raw),withdrawalAllocation:vi.fn().mockResolvedValue(parts)};
 const getBlock=vi.fn().mockResolvedValue({hash}),destroy=vi.fn();
 const s={vault,deploymentBlock:1,block:{number:100,hash},options:{blockTag:100},provider:{getBlock,destroy}};
 vi.mocked(v3ReadSession).mockResolvedValue(s as never);
 return {vault,getBlock,destroy};
}
beforeEach(()=>{vi.clearAllMocks();});
it('pins pagination and verifies each source and both fee components for settlement operators',async()=>{
 const {vault,getBlock,destroy}=source();
 const result=await readV3ManagerQueue(provider,admin,config,2,anchor);
 expect(result.requests.map(r=>r.id)).toEqual([2,1,0]);expect(result.count).toBe(43);
 expect(vault.hasRole).toHaveBeenCalledWith('manager',admin,{blockTag:100});
 for(const id of [2,1,0])expect(vault.withdrawalAllocation).toHaveBeenCalledWith(id,{blockTag:98});
 expect(getBlock).toHaveBeenCalledTimes(2);expect(destroy).toHaveBeenCalledOnce();
 const html=renderToStaticMarkup(<V3SettlementBreakdown request={result.requests[0]}/>);
 for(const value of ['Personal profit','10 test USDT','Referral commission','2 test USDT','Network rewards','3 test USDT',
  'Unlocked principal','5 test USDT','Earnings fee (2%)','0.3 test USDT','Principal deduction (30%)','1.5 test USDT','18.2 test USDT'])expect(html).toContain(value);
});
it('finds a single request identically for a funder and does not manufacture missing requests',async()=>{
 const {vault}=source(false,true);
 expect((await readV3ManagerQueue(provider,admin,config,0,null,33)).requests.map(r=>r.id)).toEqual([33]);
 expect((await readV3ManagerQueue(provider,admin,config,0,null,43)).requests).toEqual([]);
 expect(vault.withdrawalOf).toHaveBeenCalledTimes(1);
});
it('requires a current role before returning a previous block and rejects mismatched gross or fees',async()=>{
 const denied=source(false,false);
 await expect(readV3ManagerQueue(provider,admin,config,0,anchor)).rejects.toThrow('authorized');
 expect(denied.vault.withdrawalCount).not.toHaveBeenCalled();expect(denied.destroy).toHaveBeenCalledOnce();
 for(const invalid of [{...raw,gross:raw.gross+1n},{...raw,fee:raw.fee-1n},{...raw,kind:0n}]){
  const s=source();s.vault.withdrawalOf.mockResolvedValue(invalid);
  await expect(readV3ManagerQueue(provider,admin,config,0,anchor,2)).rejects.toThrow();
 }
 const reorg=source();reorg.getBlock.mockResolvedValueOnce({hash}).mockResolvedValueOnce({hash:'0x'+'cc'.repeat(32)});
 await expect(readV3ManagerQueue(provider,admin,config,0,anchor,1)).rejects.toThrow('changed');
});

it('rechecks the exact reviewed state, role and source split at the current block before each signature',async()=>{
 const action={kind:'rejectWithdrawal' as const,id:0},s=source();
 const reviewed=(await readV3ManagerQueue(provider,admin,config,0,anchor,0)).requests[0];
 await expect(recheckOperatorWithdrawal(s.vault as never,admin,true,action,reviewed,105)).resolves.toBeUndefined();
 expect(s.vault.hasRole).toHaveBeenCalledWith('manager',admin,{blockTag:105});
 s.vault.withdrawalOf.mockResolvedValue({...raw,status:1n});
 // Both requested and approved are rejectable on chain, but a state change requires a new review.
 await expect(recheckOperatorWithdrawal(s.vault as never,admin,true,action,reviewed,105)).rejects.toThrow('changed after review');
 s.vault.withdrawalOf.mockResolvedValue(raw);
 s.vault.withdrawalAllocation.mockResolvedValue({...parts,personal:parts.personal+1n,network:parts.network-1n});
 await expect(recheckOperatorWithdrawal(s.vault as never,admin,true,action,reviewed,106)).rejects.toThrow('changed after review');
 s.vault.hasRole.mockResolvedValue(false);
 await expect(recheckOperatorWithdrawal(s.vault as never,admin,true,action,reviewed,107)).rejects.toThrow('role changed');
 await expect(recheckOperatorWithdrawal(s.vault as never,admin,true,{kind:'payWithdrawal',id:0},reviewed,108)).rejects.toThrow('role changed');
});
