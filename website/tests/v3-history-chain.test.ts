import {describe,expect,it} from 'vitest';
import ganache from 'ganache';
import solc from 'solc';
import {BrowserProvider,ContractFactory,parseEther} from 'ethers';
import {queryV3HistoryWindow} from '../src/v3-history';

// An in-process EVM verifies the actual indexed event filters. This emitter is
// limited to event fixtures and does not stand in for the deployed contract.
const source=`pragma solidity ^0.8.30;
contract EventFixture {
 event DepositRouted(address indexed user,uint256 indexed positionId,uint256 amount,uint256 fee1,uint256 fee2,uint256 operations);
 event DailyClaimAccrued(address indexed user,uint256 indexed positionId,uint256 personal,uint256 compounded,uint256 total,uint256 at);
 event WithdrawalRequested(uint256 indexed id,address indexed user,uint8 kind,uint256 gross,uint256 fee);
 event WithdrawalPaid(uint256 indexed id,address indexed beneficiary,uint256 net,uint256 fee);
 function deposit(uint256 amount) external {emit DepositRouted(msg.sender,0,amount,amount/10,amount/10,amount-2*(amount/10));}
 function accrue(uint256 daily,uint256 compound) external {emit DailyClaimAccrued(msg.sender,0,daily,compound,daily+compound,block.timestamp);}
 function request(uint256 value) external {emit WithdrawalRequested(0,msg.sender,0,value,value*3/100);}
 function pay(address beneficiary,uint256 net,uint256 fee) external {emit WithdrawalPaid(0,beneficiary,net,fee);}
}`;
const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'fixture.sol':{content:source}},
 settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
if(output.errors?.some((entry:{severity:string})=>entry.severity==='error'))throw Error('History event fixture did not compile.');
const artifact=output.contracts['fixture.sol'].EventFixture;
const to=(value:string)=>parseEther(value);

describe('V3 history log queries against an in-process EVM',()=>{
 it('filters indexed wallet events and distinguishes claims from paid tokens',async()=>{
  const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:3}});
  const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=25;
  try{
   const owner=await provider.getSigner(0),user=await provider.getSigner(1),other=await provider.getSigner(2);
   const wallet=await user.getAddress();
   const fixture=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,owner).deploy();
   await fixture.waitForDeployment();
   for(const tx of [
    await fixture.connect(user).getFunction('deposit')(to('100')),
    await fixture.connect(other).getFunction('deposit')(to('30')),
    await fixture.connect(user).getFunction('accrue')(to('1'),to('0.02')),
    await fixture.connect(user).getFunction('request')(to('1')),
    await fixture.getFunction('pay')(wallet,to('0.97'),to('0.03'))
   ])expect((await tx.wait())?.status).toBe(1);
   const height=await provider.getBlockNumber(),block=await provider.getBlock(height);
   const page=await queryV3HistoryWindow(provider,await fixture.getAddress(),wallet,{block:height,hash:block!.hash!,firstBlock:0},0);
   expect(page.items.map(item=>item.title)).toEqual([
    'Withdrawal paid','Withdrawal requested','Daily claim recorded','Test-token deposit'
   ]);
   expect(page.items[0].value).toBe('0.97 TEST USDT');
   expect(page.items[2].value).toBe('1.02 TEST USDT');
   expect(page.items[3].value).toBe('100.00 TEST USDT');
  }finally{provider.destroy();await rpc.disconnect();}
 },30000);
});
