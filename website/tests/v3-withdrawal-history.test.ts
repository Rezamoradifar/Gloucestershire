import {beforeEach,describe,expect,it,vi} from 'vitest';
import {parseEther,type Provider} from 'ethers';
import type {V3SiteReleaseConfig} from '../src/v3-site-config';
vi.mock('../src/v3-chain',async original=>({...(await original<typeof import('../src/v3-chain')>()),v3ReadSession:vi.fn()}));
import {v3ReadSession} from '../src/v3-chain';
import {readV3WithdrawalPage} from '../src/v3-withdrawal-history';

const wallet='0x2222222222222222222222222222222222222222';
const config={address:'0x1111111111111111111111111111111111111111',runtimeHash:'0x'+'aa'.repeat(32),deploymentTx:'0x'+'bb'.repeat(32)} as V3SiteReleaseConfig;
const hash='0x'+'cc'.repeat(32),walletProvider={request:vi.fn()};
function source(){
 const getBlock=vi.fn().mockResolvedValue({hash}),destroy=vi.fn();
 const vault={userWithdrawalCount:vi.fn().mockResolvedValue(22n),userWithdrawalId:vi.fn(async(_who:string,index:number)=>BigInt(index)),
  withdrawalOf:vi.fn(async()=>({beneficiary:wallet,positionId:0n,gross:parseEther('10'),fee:parseEther('0.3'),requestedAt:1794760000n,status:3n,kind:0n}))};
 return {getBlock,destroy,vault,provider:{getBlock,destroy} as unknown as Provider&{destroy:()=>void},block:{number:5000,hash},deploymentBlock:1000,readerIndex:0};
}
const mocked=vi.mocked(v3ReadSession);
beforeEach(()=>mocked.mockReset());
describe('verified withdrawal index',()=>{
 it('paginates older requests and their actual status at one confirmed block',async()=>{
  const src=source();mocked.mockResolvedValueOnce(src as never);
  const result=await readV3WithdrawalPage(walletProvider,wallet,config,1,{block:5000,hash});
  expect(result.total).toBe(22);expect(result.items.map(x=>x.id)).toEqual([1,0]);
  expect(result.items[0].status).toBe(3);expect(result.items[0].requestedAt).toBe(1794760000);
  expect(src.vault.userWithdrawalCount).toHaveBeenCalledWith(wallet,{blockTag:5000});
  expect(src.vault.withdrawalOf).toHaveBeenCalledWith(1n,{blockTag:5000});
  expect(src.getBlock).toHaveBeenCalledTimes(2);expect(src.destroy).toHaveBeenCalledOnce();
 });
 it('rejects a request for another wallet and any changed anchor',async()=>{
  const src=source();src.vault.withdrawalOf.mockResolvedValueOnce({beneficiary:'0x3333333333333333333333333333333333333333',positionId:0n,gross:1n,fee:0n,requestedAt:1794760000n,status:0n,kind:0n});
  mocked.mockResolvedValueOnce(src as never);
  await expect(readV3WithdrawalPage(walletProvider,wallet,config,1,null)).rejects.toThrow('does not match');
  const reorg=source();reorg.getBlock.mockResolvedValueOnce({hash}).mockResolvedValueOnce({hash:'0x'+'dd'.repeat(32)});
  mocked.mockResolvedValueOnce(reorg as never);
  await expect(readV3WithdrawalPage(walletProvider,wallet,config,1,null)).rejects.toThrow('changed');
 });
});
