import {afterEach,describe,expect,it,vi} from 'vitest';
import {getAddress,ZeroAddress} from 'ethers';
import {v3ReadSession,V3_INDEPENDENT_READER_COUNT} from '../src/v3-chain';
import {readV3TeamDirectory,type TeamMember} from '../src/v3-team-directory';

vi.mock('../src/v3-chain',()=>({v3ReadSession:vi.fn(),V3_INDEPENDENT_READER_COUNT:2}));
const addr=(n:number)=>getAddress('0x'+n.toString(16).padStart(40,'0'));
const root=addr(1),hash='0x'+'a'.repeat(64),block=80;
const provider={request:vi.fn()},config={address:addr(20),runtimeHash:hash,deploymentTx:hash};
// Member 3 is a direct without capital. Its descendants appear after a page boundary.
const parents=[0,0,1,2,2,4,6,2,3,9,10,11,12,13,14,1,16];
function source(index:number,failAt=-1){
 const verify=vi.fn(async()=>({hash}));
 const vault={
  memberCount:vi.fn(async()=>BigInt(parents.length)),
  memberAt:vi.fn(async(i:number,at:{blockTag:number})=>{
   expect(at.blockTag).toBe(block);if(i===failAt)throw Error('Read unavailable');return addr(i+1);
  }),
  users:vi.fn(async(a:string,at:{blockTag:number})=>{
   expect(at.blockTag).toBe(block);const n=Number(BigInt(a));
   return {registered:true,referrer:parents[n-1]?addr(parents[n-1]):ZeroAddress,capital:n===3?0n:100n,suspended:n===9};
  }),
  tierOf:vi.fn(async()=>0n),referralBps:vi.fn(async(_tier:number,level:number)=>[800n,400n,200n,0n][level]),
  isEligible:vi.fn(async(a:string,at:{blockTag:number})=>{expect(at.blockTag).toBe(block);return ![3,9].includes(Number(BigInt(a)));})
 };
 return {readerIndex:index,block:{number:block,hash},vault,provider:{send:verify,destroy:vi.fn()}};
}
afterEach(()=>vi.resetAllMocks());
describe('confirmed referral directory',()=>{
 it('includes unfunded directs and all generations, recovers the same page and excludes other trees',async()=>{
  const first=source(0,8),second=source(1);
  vi.mocked(v3ReadSession).mockResolvedValueOnce(first as never).mockResolvedValueOnce(second as never);
  const members:TeamMember[]=[],scanned:number[]=[];
  await readV3TeamDirectory(provider,config,root,new AbortController().signal,chunk=>{members.push(...chunk.members);scanned.push(chunk.scanned);});
  expect(scanned).toEqual([0,8,16,17]);expect(members.map(m=>[Number(BigInt(m.wallet)),m.level])).toEqual([[3,1],[9,2],[10,3],[11,4],[12,5],[13,6],[14,7],[15,8],[16,1],[17,2]]);
  expect(members[0]).toMatchObject({eligible:false,capital:0n,rateBps:800});expect(members[1].suspended).toBe(true);
  expect(first.provider.destroy).toHaveBeenCalledOnce();expect(second.provider.destroy).toHaveBeenCalledOnce();
 });
 it('does not publish a chunk whose block changed or report partial coverage as complete',async()=>{
  const progress=vi.fn();for(let n=0;n<V3_INDEPENDENT_READER_COUNT;n++){
   const s=source(n);s.provider.send.mockResolvedValueOnce({hash}).mockResolvedValue({hash:'changed'});vi.mocked(v3ReadSession).mockResolvedValueOnce(s as never);
  }
  await expect(readV3TeamDirectory(provider,config,root,new AbortController().signal,progress)).rejects.toThrow('block changed');
  expect(progress.mock.calls.every(([chunk])=>chunk.scanned===0&&chunk.members.length===0)).toBe(true);
 });
 it('stops background reads as soon as the wallet view changes',async()=>{
  const controller=new AbortController();controller.abort();
  await expect(readV3TeamDirectory(provider,config,root,controller.signal,vi.fn())).rejects.toThrow();
  expect(v3ReadSession).not.toHaveBeenCalled();
 });
});
