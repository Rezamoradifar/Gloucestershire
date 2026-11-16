import {describe,expect,it,vi} from 'vitest';
import {Interface,parseEther} from 'ethers';
import type {Contract} from 'ethers';
import {readV3NetworkPreview} from '../src/v3-network-preview';

const wallet='0x1000000000000000000000000000000000000001';
const target=parseEther('500'),reward=parseEther('35'),options={blockTag:42};
const response={eligible:true,volumeUsd:target,rewardUsd:reward,consume:[parseEther('300'),parseEther('200')]};

describe('V3 bounded network preview',()=>{
 it('uses the confirmed block and exposes a complete eligible group',async()=>{
  const rewardPreview=vi.fn(async()=>response);
  const result=await readV3NetworkPreview({rewardPreview} as unknown as Contract,wallet,0,2,target,reward,options);
  expect(result).toEqual({eligible:true,volume:target});
  expect(rewardPreview).toHaveBeenCalledWith(wallet,0,options);
 });
 it('accepts the decoded ethers result used by the deployed contract',async()=>{
  const abi=new Interface(['function rewardPreview(address,uint256) view returns(bool eligible,uint256 volumeUsd,uint256 rewardUsd,uint256[] consume)']);
  const encoded=abi.encodeFunctionResult('rewardPreview',[true,target,reward,response.consume]);
  const decoded=abi.decodeFunctionResult('rewardPreview',encoded);
  const vault={rewardPreview:vi.fn(async()=>decoded)} as unknown as Contract;
  await expect(readV3NetworkPreview(vault,wallet,0,2,target,reward,options)).resolves.toEqual({eligible:true,volume:target});
 });
 it('keeps the prepare flow available when a preview fails or disagrees with verified terms',async()=>{
  for(const value of [
   {...response,eligible:false},
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
 it('does not call an unbounded preview for a large group',async()=>{
  const rewardPreview=vi.fn();
  const vault={rewardPreview} as unknown as Contract;
  await expect(readV3NetworkPreview(vault,wallet,0,65,target,reward,options)).resolves.toBeNull();
  expect(rewardPreview).not.toHaveBeenCalled();
 });
});
