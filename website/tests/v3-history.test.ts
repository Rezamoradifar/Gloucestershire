import {describe,expect,it,vi} from 'vitest';
import {Interface,parseEther,zeroPadValue,type Log,type Provider} from 'ethers';
import {V3_ABI} from '../src/v3-chain';
import {V3_TEST_TOKEN} from '../src/v3-site-config';
import {queryV3HistoryWindow,v3HistoryRange} from '../src/v3-history';

const iface=new Interface(V3_ABI);
const contract='0x1111111111111111111111111111111111111111';
const wallet='0x2222222222222222222222222222222222222222';
const other='0x3333333333333333333333333333333333333333';
const networkContract='0x4444444444444444444444444444444444444444';
const blockHash='0x'+'aa'.repeat(32);
const to=(value:string)=>parseEther(value);
const log=(name:string,values:unknown[],blockNumber:number,index:number):Log=>{
 const encoded=iface.encodeEventLog(iface.getEvent(name)!,values);
 return {...encoded,address:contract,blockNumber,index,removed:false,transactionHash:'0x'+String(index+1).padStart(64,'0')} as Log;
};
function source(first:Log[],second:Log[]=[]){
 const getLogs=vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValue([]);
 const getBlock=vi.fn().mockResolvedValue({hash:blockHash});
 return {getLogs,getBlock,provider:{getLogs,getBlock} as unknown as Provider};
}
describe('wallet-specific confirmed V3 activity',()=>{
 it('paginates stable, non-overlapping bounded block ranges',()=>{
  expect(v3HistoryRange(5000,0)).toEqual({from:3001,to:5000});
  expect(v3HistoryRange(5000,1)).toEqual({from:1001,to:3000});
  expect(v3HistoryRange(5000,2)).toEqual({from:0,to:1000});
  expect(()=>v3HistoryRange(5000,3)).toThrow();
  expect(v3HistoryRange(5000,0,4200)).toEqual({from:4200,to:5000});
  expect(()=>v3HistoryRange(5000,1,4200)).toThrow();
 });
 it('shows actual deposits, split claims and paid transfers distinctly',async()=>{
  const deposit=log('DepositRouted',[wallet,0n,to('100'),to('10'),to('10'),to('80')],4000,0);
  const daily=log('DailyClaimAccrued',[wallet,0n,to('1'),to('0.02'),to('1.02'),4000n],4001,1);
  const paid=log('WithdrawalPaid',[2n,wallet,to('0.97'),to('0.03')],4002,2);
  const src=source([deposit,daily],[paid]);
  const page=await queryV3HistoryWindow(src.provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0);
  expect(page.items.map(item=>item.title)).toEqual(['Withdrawal paid','Daily claim recorded','Test-token deposit']);
  expect(page.items[0].value).toBe('0.97 USDT');
  expect(page.items[1].detail).toContain('Personal compound 0.02 USDT');
  expect(page.items[1].value).toBe('1.02 USDT');
  expect(page.items[2].detail).toContain('Routed to designated wallets');
  expect(src.getLogs.mock.calls[0][0].topics[1]).toBe(zeroPadValue(wallet,32));
  expect(src.getLogs.mock.calls[1][0].topics[2]).toBe(zeroPadValue(wallet,32));
 });

 it('shows a pooled reinvestment once with the exact sources',async()=>{
  const reinvest=log('AccountEarningsReinvested',[wallet,0n,to('7'),to('.7'),to('35'),to('42.7')],4001,0);
  const page=await queryV3HistoryWindow(source([reinvest]).provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0);
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({title:'Account earnings reinvested',value:'42.7 USDT',
   detail:'Personal profit 7.00 USDT · Referral commission 0.7 USDT · Network rewards 35.00 USDT'});
 });

 it('identifies the member and referral level for each commission credit',async()=>{
  const referral=log('ReferralClaimAccrued',[wallet,other,2,to('0.35')],4000,0);
  const page=await queryV3HistoryWindow(source([referral]).provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0);
  expect(page.items[0]).toMatchObject({title:'Referral commission recorded',value:'0.35 USDT',detail:'Level 2 · Member 0x333333…333333'});
 });

 it('records only approvals to this contract and separates network details from claims',async()=>{
  const approvalInterface=new Interface(['event Approval(address indexed owner,address indexed spender,uint256 value)']);
  const encoded=approvalInterface.encodeEventLog(approvalInterface.getEvent('Approval')!,[wallet,contract,to('100')]);
  const approval={...encoded,address:V3_TEST_TOKEN,blockNumber:4001,index:2,removed:false,transactionHash:'0x'+'03'.padStart(64,'0')} as Log;
  const network=log('NetworkRewardEarned',[wallet,0n,0n,to('500'),to('35')],4000,0);
  const getLogs=vi.fn().mockResolvedValueOnce([network]).mockResolvedValueOnce([]).mockResolvedValueOnce([approval]);
  const provider={getLogs,getBlock:vi.fn().mockResolvedValue({hash:blockHash})} as unknown as Provider;
  const page=await queryV3HistoryWindow(provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0);
  expect(page.items.map(item=>item.title)).toEqual(['Test-token approval','Network milestone completed']);
  expect(page.items[0].detail).toContain('not a deposit');
  expect(page.items[1].detail).toContain('Included in the network claim');
  expect(getLogs.mock.calls[2][0].topics.slice(1)).toEqual([zeroPadValue(wallet,32),zeroPadValue(contract,32)]);
  const wrong=approvalInterface.encodeEventLog(approvalInterface.getEvent('Approval')!,[wallet,other,to('100')]);
  getLogs.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{...approval,...wrong}]);
  await expect(queryV3HistoryWindow(provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0)).rejects.toThrow('wallet mismatch');
 });
 it('reads unified network events only from the verified separate component',async()=>{
  const claim=log('NetworkClaimAccrued',[wallet,0n,to('35'),1n],4001,0);
  const group={...log('RewardGroupCreated',[wallet,0n,[other]],4002,1),address:networkContract} as Log;
  const earned={...log('NetworkRewardEarned',[wallet,0n,0n,to('500'),to('35')],4003,2),address:networkContract} as Log;
  const queued={...log('NetworkVolumeQueued',[1n,wallet,to('100')],4004,3),address:networkContract} as Log;
  const getLogs=vi.fn().mockResolvedValueOnce([claim]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
   .mockResolvedValueOnce([group,earned]).mockResolvedValueOnce([queued]);
  const provider={getLogs,getBlock:vi.fn().mockResolvedValue({hash:blockHash})} as unknown as Provider;
  const page=await queryV3HistoryWindow(provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0,networkContract);
  expect(page.items.map(item=>item.title)).toEqual(['Network volume queued','Network milestone completed','Network reward group created','Network claim recorded']);
  expect(getLogs.mock.calls.map(([filter])=>filter.address)).toEqual([contract,contract,V3_TEST_TOKEN,networkContract,networkContract]);
  expect(getLogs.mock.calls[3][0].topics[1]).toBe(zeroPadValue(wallet,32));
  expect(getLogs.mock.calls[4][0].topics[2]).toBe(zeroPadValue(wallet,32));
  const firstTopics=getLogs.mock.calls[0][0].topics[0] as string[];
  expect(firstTopics).toContain(iface.getEvent('NetworkClaimAccrued')!.topicHash);
  expect(firstTopics).not.toContain(iface.getEvent('NetworkRewardEarned')!.topicHash);
 });
 it('rejects wrong-source events and fails closed when the unified component cannot be scanned',async()=>{
  const wrongVault=log('NetworkRewardEarned',[wallet,0n,0n,to('500'),to('35')],4003,0);
  const badFirst=source([wrongVault]);
  await expect(queryV3HistoryWindow(badFirst.provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0,networkContract))
   .rejects.toThrow('Unexpected V3 history event.');
  const wrongNetwork={...log('CheckIn',[wallet,4000n],4000,0),address:networkContract} as Log;
  const getLogs=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
   .mockResolvedValueOnce([wrongNetwork]).mockResolvedValueOnce([]);
  const provider={getLogs,getBlock:vi.fn().mockResolvedValue({hash:blockHash})} as unknown as Provider;
  await expect(queryV3HistoryWindow(provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0,networkContract))
   .rejects.toThrow('Unexpected V3 history event.');
  getLogs.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
   .mockRejectedValueOnce({code:429,message:'rate limit exceeded'});
  await expect(queryV3HistoryWindow(provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0,networkContract))
   .rejects.toThrow('Unable to load the complete activity');
  await expect(queryV3HistoryWindow(provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0,contract))
   .rejects.toThrow('Invalid unified network history contract.');
 });
 it('rejects mismatched wallet, altered routing and changed block anchor',async()=>{
  const wrongUser=source([log('CheckIn',[other,4000n],4000,0)]);
  await expect(queryV3HistoryWindow(wrongUser.provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0)).rejects.toThrow(/wallet mismatch/);
  const invalid=source([log('DepositRouted',[wallet,0n,to('100'),to('11'),to('10'),to('79')],4000,0)]);
  await expect(queryV3HistoryWindow(invalid.provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0)).rejects.toThrow(/routing/);
  const reorganized=source([]);
  reorganized.getBlock.mockResolvedValueOnce({hash:blockHash}).mockResolvedValueOnce({hash:'0x'+'bb'.repeat(32)});
  await expect(queryV3HistoryWindow(reorganized.provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0)).rejects.toThrow(/changed/);
 });
 it('splits rejected ranges into complete, non-overlapping smaller ranges',async()=>{
  const deposit=log('DepositRouted',[wallet,0n,to('100'),to('10'),to('10'),to('80')],4000,0);
  const paid=log('WithdrawalPaid',[2n,wallet,to('0.97'),to('0.03')],4002,2);
  const getLogs=vi.fn(async(filter:any)=>{
   const from=Number(filter.fromBlock),to=Number(filter.toBlock);
   if(to-from+1>500)throw {code:'UNKNOWN_ERROR',info:{error:{code:-32005,message:'limit exceeded'}}};
   if(filter.address===V3_TEST_TOKEN)return [];
   const event=filter.topics[2]?paid:deposit;
   return event.blockNumber>=from&&event.blockNumber<=to?[event]:[];
  });
  const provider={getLogs,getBlock:vi.fn().mockResolvedValue({hash:blockHash})} as unknown as Provider;
  const page=await queryV3HistoryWindow(provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0);
  expect(page.from).toBe(3001);expect(page.to).toBe(5000);
  expect(page.items.map(item=>item.title)).toEqual(['Withdrawal paid','Test-token deposit']);
  expect(getLogs).toHaveBeenCalledTimes(21);
  for(const isSecond of [false,true]){
   const ranges=getLogs.mock.calls.map(([filter])=>filter).filter(filter=>filter.address===contract&&Boolean(filter.topics[2])===isSecond&&Number(filter.toBlock)-Number(filter.fromBlock)<500);
   expect(ranges.map(filter=>[filter.fromBlock,filter.toBlock])).toEqual([[3001,3500],[3501,4000],[4001,4500],[4501,5000]]);
  }
 });
 it('does not retry rate-limited and non-range provider errors or leak provider details',async()=>{
  for(const failure of [{code:429,message:'Too many requests at https://secret.example/key'},
   {code:-32005,message:'rate limit exceeded at https://secret.example/key'},
   {code:'NETWORK_ERROR',message:'https://secret.example/key'}]){
   const getLogs=vi.fn().mockRejectedValue(failure);
   const provider={getLogs,getBlock:vi.fn().mockResolvedValue({hash:blockHash})} as unknown as Provider;
   await expect(queryV3HistoryWindow(provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0))
    .rejects.toThrow('Unable to load the complete activity');
   expect(getLogs).toHaveBeenCalledTimes(1);
  }
 });
 it('fails closed at a single block or the request budget without returning partial history',async()=>{
  for(const anchor of [{block:5000,hash:blockHash,firstBlock:5000},{block:5000,hash:blockHash,firstBlock:0}]){
   const getLogs=vi.fn().mockRejectedValue({code:-32005,message:'limit exceeded'});
   const provider={getLogs,getBlock:vi.fn().mockResolvedValue({hash:blockHash})} as unknown as Provider;
   await expect(queryV3HistoryWindow(provider,contract,wallet,anchor,0)).rejects.toThrow('Unable to load the complete activity');
   expect(getLogs.mock.calls.length).toBeLessThanOrEqual(64);
   if(anchor.firstBlock===anchor.block)expect(getLogs).toHaveBeenCalledTimes(1);
  }
 });
 it('discards successfully read events if another part of the range fails',async()=>{
  const deposit=log('DepositRouted',[wallet,0n,to('100'),to('10'),to('10'),to('80')],4000,0);
  const getLogs=vi.fn().mockResolvedValueOnce([deposit]).mockRejectedValueOnce({code:429,message:'rate limit exceeded'});
  const provider={getLogs,getBlock:vi.fn().mockResolvedValue({hash:blockHash})} as unknown as Provider;
  await expect(queryV3HistoryWindow(provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0))
   .rejects.toThrow('Unable to load the complete activity');
  expect(getLogs).toHaveBeenCalledTimes(2);
 });
 it('stops at the bounded request budget when a provider requires tiny ranges',async()=>{
  const getLogs=vi.fn(async(filter:any)=>{
   if(Number(filter.toBlock)-Number(filter.fromBlock)+1>31)throw {code:-32005,message:'limit exceeded'};
   return [];
  });
  const provider={getLogs,getBlock:vi.fn().mockResolvedValue({hash:blockHash})} as unknown as Provider;
  await expect(queryV3HistoryWindow(provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0))
   .rejects.toThrow('Unable to load the complete activity');
  expect(getLogs).toHaveBeenCalledTimes(64);
 });
 it('still rejects a changed anchor after split queries',async()=>{
  const getLogs=vi.fn(async(filter:any)=>{
   if(Number(filter.toBlock)-Number(filter.fromBlock)>=500)throw {code:-32005,message:'limit exceeded'};
   return [];
  });
  const getBlock=vi.fn().mockResolvedValueOnce({hash:blockHash}).mockResolvedValueOnce({hash:'0x'+'bb'.repeat(32)});
  const provider={getLogs,getBlock} as unknown as Provider;
  await expect(queryV3HistoryWindow(provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0)).rejects.toThrow(/changed/);
  expect(getLogs.mock.calls.length).toBeGreaterThan(2);
 });
});
