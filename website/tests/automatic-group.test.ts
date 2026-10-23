import {beforeEach,describe,it,expect,vi} from 'vitest';
import {Interface} from 'ethers';
import {deferredAbi,hasAutomaticGroup} from '../src/reward-mode';
import {executeNetwork} from '../src/network';
import {session} from '../src/chain';
import freshArtifact from '../../artifacts/AutomaticGroupVault.json';

vi.mock('../src/chain',()=>({session:vi.fn()}));
const who='0x1111111111111111111111111111111111111111';
const branch='0x2222222222222222222222222222222222222222';
const transaction=()=>Object.assign(vi.fn(async()=>({hash:'submitted',wait:async()=>({status:1,hash:'confirmed'})})),{staticCall:vi.fn(async()=>{})});
beforeEach(()=>vi.resetAllMocks());
describe('automatic first reward group',()=>{
 it('uses the fresh artifact selector and reads only explicit version 1',async()=>{
  const client=new Interface(deferredAbi),fresh=new Interface(freshArtifact.abi);
  expect(client.getFunction('AUTO_REWARD_GROUP_VERSION')?.selector).toBe(fresh.getFunction('AUTO_REWARD_GROUP_VERSION')?.selector);
  const getter=vi.fn(async()=>1n);
  expect(await hasAutomaticGroup({AUTO_REWARD_GROUP_VERSION:getter} as any,{blockTag:123})).toBe(true);
  expect(getter).toHaveBeenCalledWith({blockTag:123});
  expect(await hasAutomaticGroup({} as any)).toBe(false);
  expect(await hasAutomaticGroup({AUTO_REWARD_GROUP_VERSION:async()=>{throw {code:'CALL_EXCEPTION'};}} as any)).toBe(false);
 });
 it('stops on unknown versions and RPC failure instead of offering manual controls',async()=>{
  await expect(hasAutomaticGroup({AUTO_REWARD_GROUP_VERSION:async()=>2n} as any)).rejects.toThrow('Unsupported');
  await expect(hasAutomaticGroup({AUTO_REWARD_GROUP_VERSION:async()=>{throw Error('RPC unavailable');}} as any)).rejects.toThrow('RPC unavailable');
 });
 it('rejects stale manual create and append actions before simulation or signing on a fresh vault',async()=>{
  const vault={NETWORK_PLAN_VERSION:async()=>2n,AUTO_REWARD_GROUP_VERSION:async()=>1n,createRewardGroup:transaction(),addRewardBranches:transaction()};
  vi.mocked(session).mockResolvedValue({vault} as any);
  for(const action of [{kind:'create' as const,branches:[branch]},{kind:'append' as const,group:0n,branches:[branch]}])await expect(executeNetwork(action,who,vi.fn())).rejects.toThrow('automatically');
  for(const method of [vault.createRewardGroup,vault.addRewardBranches]){expect(method.staticCall).not.toHaveBeenCalled();expect(method).not.toHaveBeenCalled();}
 });
 it('keeps legacy manual actions and fresh stage-bound preparation and claims',async()=>{
  const vault={NETWORK_PLAN_VERSION:async()=>2n,AUTO_REWARD_GROUP_VERSION:vi.fn(async()=>{throw {code:'CALL_EXCEPTION'};}),createRewardGroup:transaction(),prepareNetworkRewardAtStage:transaction(),claimNetworkRewards:transaction()};
  vi.mocked(session).mockResolvedValue({vault} as any);
  expect(await executeNetwork({kind:'create',branches:[branch]},who,vi.fn())).toBe('confirmed');
  expect(vault.createRewardGroup.staticCall).toHaveBeenCalledWith([branch]);
  vault.AUTO_REWARD_GROUP_VERSION.mockImplementation(async()=>1n);
  await executeNetwork({kind:'prepare',group:0n,stage:7},who,vi.fn());
  await executeNetwork({kind:'claim',group:0n,stage:7,count:2},who,vi.fn());
  expect(vault.prepareNetworkRewardAtStage.staticCall).toHaveBeenCalledWith(0n,7,64);
  expect(vault.claimNetworkRewards.staticCall).toHaveBeenCalledWith(0n,7,2);
 });
});
