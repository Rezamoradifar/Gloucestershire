import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Interface,parseEther,type Provider} from 'ethers';
import type {V3SiteReleaseConfig} from '../src/v3-site-config';
vi.mock('../src/v3-chain',async original=>({...(await original<typeof import('../src/v3-chain')>()),v3ReadSession:vi.fn()}));
import {V3_ABI,v3ReadSession} from '../src/v3-chain';
import {readV3HistoryPage} from '../src/v3-history';

const config={address:'0x1111111111111111111111111111111111111111',runtimeHash:'0x'+'aa'.repeat(32),deploymentTx:'0x'+'bb'.repeat(32)} as V3SiteReleaseConfig;
const wallet='0x2222222222222222222222222222222222222222';
const hash='0x'+'cc'.repeat(32);
const walletProvider={request:vi.fn()};
function session(index:number,blockHash=hash){
 const getLogs=vi.fn().mockResolvedValue([]),destroy=vi.fn();
 const getBlock=vi.fn().mockResolvedValue({hash:blockHash});
 return {provider:{getBlock,getLogs,destroy} as unknown as Provider&{destroy:()=>void},getLogs,getBlock,destroy,
  block:{number:5000,hash},deploymentBlock:1000,readerIndex:index};
}
const mocked=vi.mocked(v3ReadSession);
beforeEach(()=>mocked.mockReset());
describe('history provider fallback',()=>{
 it('retries the same anchored range on a second verified source without mixing partial results',async()=>{
  const first=session(0),second=session(1);
  const iface=new Interface(V3_ABI);
  const event=iface.encodeEventLog(iface.getEvent('DepositRouted')!,[wallet,0n,parseEther('100'),parseEther('10'),parseEther('10'),parseEther('80')]);
  first.getLogs.mockResolvedValueOnce([{...event,address:config.address,blockNumber:4000,index:0,removed:false,transactionHash:'0x'+'01'.padStart(64,'0')}])
   .mockRejectedValueOnce({code:429,message:'rate limit'});
  mocked.mockResolvedValueOnce(first as never).mockResolvedValueOnce(second as never);
  const result=await readV3HistoryPage(walletProvider,wallet,config,0,null);
  expect(result.items).toEqual([]);
  expect(result.anchor).toEqual({block:5000,hash,firstBlock:1000});
  expect(mocked.mock.calls[1][4]).toBe(1);
  expect(second.getBlock).toHaveBeenCalledWith(5000);
  expect(first.destroy).toHaveBeenCalledOnce();expect(second.destroy).toHaveBeenCalledOnce();
 });
 it('refuses an anchor disagreement rather than showing data from another chain view',async()=>{
  const first=session(0),second=session(1,'0x'+'dd'.repeat(32));
  first.getLogs.mockRejectedValue({code:429,message:'rate limit'});
  mocked.mockResolvedValueOnce(first as never).mockResolvedValueOnce(second as never);
  await expect(readV3HistoryPage(walletProvider,wallet,config,0,null)).rejects.toThrow('confirmed history block changed');
  expect(mocked).toHaveBeenCalledTimes(2);
  expect(second.getLogs).not.toHaveBeenCalled();expect(second.destroy).toHaveBeenCalledOnce();
 });
});
