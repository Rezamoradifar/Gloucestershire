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
  expect(page.items[2].detail).toContain('10% / 10% / 80%');
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
});
