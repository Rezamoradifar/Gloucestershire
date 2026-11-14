import {describe,expect,it,vi} from 'vitest';
import {Interface,parseEther,zeroPadValue,type Log,type Provider} from 'ethers';
import {V3_ABI} from '../src/v3-chain';
import {queryV3HistoryWindow,v3HistoryRange} from '../src/v3-history';

const iface=new Interface(V3_ABI);
const contract='0x1111111111111111111111111111111111111111';
const wallet='0x2222222222222222222222222222222222222222';
const other='0x3333333333333333333333333333333333333333';
const blockHash='0x'+'aa'.repeat(32);
const to=(value:string)=>parseEther(value);
const log=(name:string,values:unknown[],blockNumber:number,index:number):Log=>{
 const encoded=iface.encodeEventLog(iface.getEvent(name)!,values);
 return {...encoded,address:contract,blockNumber,index,removed:false,transactionHash:'0x'+String(index+1).padStart(64,'0')} as Log;
};
function source(first:Log[],second:Log[]=[]){
 const getLogs=vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
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
  expect(page.items[0].value).toBe('0.97 TEST USDT');
  expect(page.items[1].detail).toContain('Profit-on-profit 0.02 TEST USDT');
  expect(page.items[1].value).toBe('1.02 TEST USDT');
  expect(page.items[2].detail).toContain('Routed to designated wallets');
  expect(src.getLogs.mock.calls[0][0].topics[1]).toBe(zeroPadValue(wallet,32));
  expect(src.getLogs.mock.calls[1][0].topics[2]).toBe(zeroPadValue(wallet,32));
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
   const event=filter.topics[2]?paid:deposit;
   return event.blockNumber>=from&&event.blockNumber<=to?[event]:[];
  });
  const provider={getLogs,getBlock:vi.fn().mockResolvedValue({hash:blockHash})} as unknown as Provider;
  const page=await queryV3HistoryWindow(provider,contract,wallet,{block:5000,hash:blockHash,firstBlock:0},0);
  expect(page.from).toBe(3001);expect(page.to).toBe(5000);
  expect(page.items.map(item=>item.title)).toEqual(['Withdrawal paid','Test-token deposit']);
  expect(getLogs).toHaveBeenCalledTimes(14);
  for(const isSecond of [false,true]){
   const ranges=getLogs.mock.calls.map(([filter])=>filter).filter(filter=>Boolean(filter.topics[2])===isSecond&&Number(filter.toBlock)-Number(filter.fromBlock)<500);
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
