import {Contract,ZeroAddress,parseEther} from 'ethers';
import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import V3NetworkPanel from '../src/V3NetworkPanel';
import V3MilestoneProgress from '../src/V3MilestoneProgress';
import {checkV3GroupBranches} from '../src/v3-actions';

const wallet='0x1000000000000000000000000000000000000001';
const first='0x2000000000000000000000000000000000000002';
const second='0x3000000000000000000000000000000000000003';
const other='0x4000000000000000000000000000000000000004';
const options={blockTag:42};
function source(assigned:string[]=[],parent=wallet){
 const groupedBranch=vi.fn(async(_who:string,address:string)=>assigned.includes(address));
 const users=vi.fn(async()=>({registered:true,referrer:parent}));
 return {vault:{groupedBranch,users} as unknown as Contract,groupedBranch,users};
}

describe('V3 team group validation',()=>{
 it('rejects an already assigned branch before any wallet action',async()=>{
  const {vault,groupedBranch}=source([first]);
  await expect(checkV3GroupBranches(vault,wallet,[first,second],options))
   .rejects.toThrow('already in a reward group');
  expect(groupedBranch).toHaveBeenCalledWith(wallet,first,options);
  expect(groupedBranch).toHaveBeenCalledWith(wallet,second,options);
 });
 it('allows available direct branches and reads each condition at the confirmed block',async()=>{
  const {vault,users,groupedBranch}=source();
  await expect(checkV3GroupBranches(vault,wallet,[first,second],options)).resolves.toBeUndefined();
  expect(users).toHaveBeenCalledWith(first,options);
  expect(users).toHaveBeenCalledWith(second,options);
  expect(groupedBranch).toHaveBeenCalledWith(wallet,first,options);
 });
 it('rejects wrong parents, duplicate addresses and unavailable reads',async()=>{
  await expect(checkV3GroupBranches(source([],other).vault,wallet,[first],options)).rejects.toThrow('not a registered direct referral');
  await expect(checkV3GroupBranches(source().vault,wallet,[first,first],options)).rejects.toThrow('distinct');
  const failed=source();failed.groupedBranch.mockRejectedValueOnce(Error('READ_UNAVAILABLE'));
  await expect(checkV3GroupBranches(failed.vault,wallet,[first],options)).rejects.toThrow('READ_UNAVAILABLE');
 });
 it('bounds simultaneous public RPC reads for large selections',async()=>{
  let active=0,peak=0;
  async function read<T>(value:T){active++;peak=Math.max(peak,active);await Promise.resolve();active--;return value;}
  const vault={users:async()=>read({registered:true,referrer:wallet}),groupedBranch:async()=>read(false)} as unknown as Contract;
  const addresses=Array.from({length:12},(_,i)=>'0x'+(i+20).toString(16).padStart(40,'0'));
  await expect(checkV3GroupBranches(vault,wallet,addresses,options)).resolves.toBeUndefined();
  expect(peak).toBeGreaterThan(1);expect(peak).toBeLessThanOrEqual(10);
 });
 it('marks and disables an assigned branch while leaving an available branch selectable',()=>{
  const view={wallet,registered:true,eligible:true,qualifiedDirects:2,requiredDirects:8,qualifiedVolume:0n,requiredVolume:0n,
   dailyRateBps:70,maximumRateBps:100,referrer:ZeroAddress,referralAvailable:0n,networkAvailable:0n,networkReserved:0n,
   cumulativeNetwork:0n,networkBranchPage:0,networkBranchCount:2,networkGroupPage:0,networkGroupCount:1,
   networkBranches:[{address:first,volume:parseEther('100'),grouped:true},{address:second,volume:parseEther('100'),grouped:false}],
   networkGroups:[{id:0,stage:0,prepared:0n,branches:1,target:parseEther('500'),reward:parseEther('35')}],paused:false} as any;
  const html=renderToStaticMarkup(<V3NetworkPanel view={view} busy={false} onAction={()=>{}} onWithdraw={()=>{}} onBranchPage={()=>{}} onGroupPage={()=>{}}/>);
  const assigned=html.match(/<label class="gv3-branch-assigned">([\s\S]*?)<\/label>/)?.[1]??'';
  const available=html.match(/<label>([\s\S]*?)<\/label>/g)?.find(row=>row.includes(second))??'';
  expect(assigned).toContain('disabled');expect(assigned).toContain('Already in a reward group');
  expect(available).toContain('Available to add');expect(available).not.toContain('disabled');
  expect(html).toContain('Add to group');
  const automatic=renderToStaticMarkup(<V3NetworkPanel view={{...view,manualReinvest:true}} busy={false}
   onAction={()=>{}} onWithdraw={()=>{}} onBranchPage={()=>{}} onGroupPage={()=>{}}/>);
  expect(automatic).toContain('Assigned automatically');
  expect(automatic).toContain('Record stage claim');
  expect(automatic).not.toMatch(/type="checkbox"|Create reward group|Add to group|branches selected for this transaction/);
 });
 it('enables one-step recording only when bounded preview confirms the stage',()=>{
  const base={wallet,registered:true,eligible:true,qualifiedDirects:2,requiredDirects:8,qualifiedVolume:0n,requiredVolume:0n,
   dailyRateBps:70,maximumRateBps:100,referrer:ZeroAddress,referralAvailable:0n,networkAvailable:0n,networkReserved:0n,
   cumulativeNetwork:0n,networkBranchPage:0,networkBranchCount:0,networkGroupPage:0,networkGroupCount:1,
   networkBranches:[],paused:false} as any;
  const group={id:0,stage:0,prepared:0n,branches:2,target:parseEther('500'),reward:parseEther('35')};
  const markup=(preview:any)=>renderToStaticMarkup(<V3NetworkPanel view={{...base,networkGroups:[{...group,preview}]}}
   busy={false} onAction={()=>{}} onWithdraw={()=>{}} onBranchPage={()=>{}} onGroupPage={()=>{}}/>);
  const button=(html:string)=>html.match(/<button[^>]*>Record stage claim<\/button>/)?.[0]??'';
  const ready=markup({eligible:true,volume:parseEther('500')});
  expect(button(ready)).not.toContain('disabled');
  expect(ready).toContain('One wallet transaction can prepare this volume and record the stage claim');
  expect(button(markup(null))).toContain('disabled');
  expect(button(markup({eligible:false,volume:parseEther('300')}))).toContain('disabled');
 });
 it('draws confirmed branch contributions and the exact stage deficit; partial scans stay labelled',()=>{
  const target=parseEther('500'),reward=parseEther('35'),counted=parseEther('300');
  const group={id:0,stage:0,branches:2,target,reward,prepared:parseEther('100'),branchAddresses:[first,second],
   preview:{volume:counted,eligible:false,byBranch:[counted,0n]}};
  const chart=renderToStaticMarkup(<V3MilestoneProgress group={group}/>);
  expect(chart).toContain('200.00 test USDT');
  expect(chart).toContain('100.00 already prepared');
  expect(chart).toContain('300.00 test USDT (60%)');
  expect(chart).toContain(first);expect(chart).toContain(second);
  const partial=renderToStaticMarkup(<V3MilestoneProgress group={{...group,branches:65,preview:null}}/>);
  expect(partial).toContain('Confirmed prepared volume');expect(partial).toContain('Partial view');
  expect(partial).not.toContain('Still needed');
 });
 it('keeps network pagination available while preview actions are read-only',()=>{
  const view={wallet,registered:true,eligible:true,qualifiedDirects:2,requiredDirects:8,qualifiedVolume:0n,requiredVolume:0n,
   dailyRateBps:70,maximumRateBps:100,referrer:ZeroAddress,referralAvailable:0n,networkAvailable:0n,networkReserved:0n,
   cumulativeNetwork:0n,networkBranchPage:0,networkBranchCount:25,networkGroupPage:0,networkGroupCount:1,
   networkBranches:[{address:second,volume:parseEther('100'),grouped:false}],paused:false,
   networkGroups:[{id:0,stage:0,prepared:parseEther('500'),branches:2,target:parseEther('500'),reward:parseEther('35')}] } as any;
  const html=renderToStaticMarkup(<V3NetworkPanel view={view} busy={false} readOnly onAction={()=>{}} onWithdraw={()=>{}} onBranchPage={()=>{}} onGroupPage={()=>{}}/>);
  expect(html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0]).toContain('disabled');
  expect(html.match(/<button[^>]*>Record stage claim<\/button>/)?.[0]).toContain('disabled');
  expect(html.match(/<button[^>]*>Next branches<\/button>/)?.[0]).not.toContain('disabled');
 });
});
