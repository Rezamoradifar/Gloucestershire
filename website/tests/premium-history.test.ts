import {describe,it,expect} from 'vitest';
import {Interface,type Log} from 'ethers';
import {parseFinancialLog} from '../src/EventHistory';
const abi=new Interface([
 'event Deposited(address indexed user,address indexed asset,uint256 indexed position,uint256 amount,uint256 usd,uint256 feeEach)',
 'event ProfitCredited(address indexed user,address indexed asset,uint256 amount,bytes32 indexed id)',
 'event Reinvested(address indexed user,address indexed asset,uint256 amount,uint256 position)',
 'event Withdrawal(address indexed user,address indexed asset,uint256 gross,uint256 fee,bool principal)'
]);
const user='0x1111111111111111111111111111111111111111';
const token='0x2222222222222222222222222222222222222222';
function event(name:string,params:unknown[]){
 const fragment=abi.getEvent(name)!;
 const encoded=abi.encodeEventLog(fragment,params);
 return {topics:encoded.topics,data:encoded.data,transactionHash:'0x'+'a'.repeat(64),index:7,blockNumber:142_100_000} as unknown as Log;
}
describe('read-only public ledger history parsing',()=>{
 it('labels on-chain deposits without treating them as credited profit',()=>{
  const row=parseFinancialLog(event('Deposited',[user,token,3n,500_000_000n,500_000_000_000_000_000_000n,25_000n]));
  expect(row).toMatchObject({kind:'deposit',wallet:user,amount:500_000_000n,position:3n,block:142_100_000});
 });
 it('distinguishes internal profit credits from wallet withdrawals',()=>{
  const credit=parseFinancialLog(event('ProfitCredited',[user,token,18_000_000n,'0x'+'b'.repeat(64)]));
  const withdrawal=parseFinancialLog(event('Withdrawal',[user,token,40_000_000n,2_000_000n,false]));
  expect(credit).toMatchObject({kind:'profit',amount:18_000_000n,fee:0n});
  expect(withdrawal).toMatchObject({kind:'withdrawal',amount:40_000_000n,fee:2_000_000n});
  expect(withdrawal?.tx).toBe(credit?.tx);
 });
 it('records reinvestment events as reinvestments, not deposits',()=>{
  expect(parseFinancialLog(event('Reinvested',[user,token,70_000_000n,4n]))).toMatchObject({
   kind:'reinvest',position:4n,amount:70_000_000n
  });
 });
});
