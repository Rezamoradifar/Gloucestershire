import {describe,expect,it,vi} from 'vitest';
import {Interface,parseEther} from 'ethers';
import type {Contract} from 'ethers';
import {readGroupAddresses,readV3NetworkPreview,stageBranchCapBps} from '../src/v3-network-preview';

const wallet='0x1000000000000000000000000000000000000001';
const target=parseEther('500'),reward=parseEther('35'),options={blockTag:42};
const response={eligible:true,volumeUsd:target,rewardUsd:reward,consume:[parseEther('300'),parseEther('200')]};

describe('V3 bounded network preview',()=>{
 it('uses the confirmed block and exposes a complete eligible group',async()=>{
  const rewardPreview=vi.fn(async()=>response);
  const result=await readV3NetworkPreview({rewardPreview} as unknown as Contract,wallet,0,2,target,reward,options);
  expect(result).toEqual({eligible:true,volume:target,byBranch:response.consume});
  expect(rewardPreview).toHaveBeenCalledWith(wallet,0,options);
 });
 it('accepts the decoded ethers result used by the deployed contract',async()=>{
  const abi=new Interface(['function rewardPreview(address,uint256) view returns(bool eligible,uint256 volumeUsd,uint256 rewardUsd,uint256[] consume)']);
  const encoded=abi.encodeFunctionResult('rewardPreview',[true,target,reward,response.consume]);
  const decoded=abi.decodeFunctionResult('rewardPreview',encoded);
  const vault={rewardPreview:vi.fn(async()=>decoded)} as unknown as Contract;
  await expect(readV3NetworkPreview(vault,wallet,0,2,target,reward,options)).resolves.toEqual({eligible:true,volume:target,byBranch:response.consume});
 });
 it('keeps the prepare flow available when a preview fails or disagrees with verified terms',async()=>{
  for(const value of [
   {...response,eligible:false},
   {...response,consume:[parseEther('400'),parseEther('100')]},
   {...response,rewardUsd:reward+1n},
   {...response,consume:[target+1n,0n]},
   {...response,consume:[target]},
  ]){
   const vault={rewardPreview:vi.fn(async()=>value)} as unknown as Contract;
   await expect(readV3NetworkPreview(vault,wallet,0,2,target,reward,options)).resolves.toBeNull();
  }
  const vault={rewardPreview:vi.fn().mockRejectedValue(Error('RPC unavailable'))} as unknown as Contract;
  await expect(readV3NetworkPreview(vault,wallet,0,2,target,reward,options)).resolves.toBeNull();
 });
 it('keeps the existing reservation inside the counted total and refuses an undercount',async()=>{
  const value={...response,eligible:false,consume:[parseEther('300'),0n]};
  const vault={rewardPreview:vi.fn(async()=>value)} as unknown as Contract;
  const read=(prepared:bigint)=>readV3NetworkPreview(vault,wallet,0,2,target,reward,options,false,prepared);
  expect((await read(parseEther('250')))?.volume).toBe(parseEther('300'));
  expect(await read(parseEther('301'))).toBeNull();
 });
 it('only labels bounded, matching groups with their actual branch addresses',async()=>{
  const second='0x1000000000000000000000000000000000000002';
  const rewardGroup=vi.fn(async()=>({branches:[wallet,second],preparedUsd:0n,stage:0n}));
  const network={rewardGroup} as unknown as Contract;
  expect(await readGroupAddresses(network,wallet,2,0,2,0n,options)).toEqual([wallet,second]);
  expect(rewardGroup).toHaveBeenCalledWith(wallet,2,options);
  expect(await readGroupAddresses(network,wallet,2,1,2,0n,options)).toBeUndefined();
  rewardGroup.mockClear();
  expect(await readGroupAddresses(network,wallet,2,0,65,0n,options)).toBeUndefined();
  expect(rewardGroup).not.toHaveBeenCalled();
 });
 it('uses the plan cap at stage boundaries',()=>{
  expect([500,10000,30000,100000,300000,10000000].map(n=>stageBranchCapBps(parseEther(String(n)))))
   .toEqual([6000n,6000n,4500n,4500n,3500n,3500n]);
 });
 it('does not call an unbounded preview for a large group',async()=>{
  const rewardPreview=vi.fn();
  const vault={rewardPreview} as unknown as Contract;
  await expect(readV3NetworkPreview(vault,wallet,0,65,target,reward,options)).resolves.toBeNull();
  expect(rewardPreview).not.toHaveBeenCalled();
 });
});
