import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,parseEther} from 'ethers';
import {compileUnifiedTestnet} from '../scripts/compile-global-v3-unified-testnet.mjs';

const TOKEN='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const E=value=>parseEther(String(value));
const done=async promise=>{const receipt=await(await promise).wait();assert.equal(receipt.status,1);return receipt;};

test('multiple profit sources reinvest atomically into one position on local testnet',async()=>{
 const artifact=compileUnifiedTestnet().GlobalV3UnifiedTestnet;
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const mock=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:3,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 try{
  const manager=await provider.getSigner(0),user=await provider.getSigner(1),other=await provider.getSigner(2);
  const who=await user.getAddress(),admin=await manager.getAddress();
  const original=await new ContractFactory(mock.abi,'0x'+mock.evm.bytecode.object,manager).deploy(18);
  await original.waitForDeployment();
  await rpc.request({method:'evm_setAccountCode',params:[TOKEN,await provider.getCode(original.target)]});
  const token=new Contract(TOKEN,mock.abi,manager);
  const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,manager)
   .deploy(admin,TOKEN,admin,{gasLimit:25000000});
  await vault.waitForDeployment();
  const book=new Contract(await vault.reinvestmentBook(),[
   'function position(address) view returns(uint256 principal,uint256 reservedPrincipal,uint256 daily,uint256 compound,uint256 basis,uint256 reservedProfit,uint256 cumulativeDaily,uint256 cumulativeCompound,uint256 lots)',
   'function lot(address,uint256) view returns(tuple(uint256 principal,uint256 reservedPrincipal,uint256 daily,uint256 compound,uint256 basis,uint256 reservedProfit,uint64 openedAt,uint64 lastAccruedAt))',
   'function consumeProfitPage(address,uint256,uint256,uint256) returns(uint256,uint256)'
  ],provider);
  await done(token.mint(who,E(3000)));
  await done(token.connect(user).approve(vault.target,E(3000)));
  for(let i=0;i<3;i++)await done(vault.connect(user).deposit(E(1000),ZeroAddress));
  await done(vault.connect(user).checkIn());
  await rpc.request({method:'evm_increaseTime',params:[3601]});await rpc.request({method:'evm_mine',params:[]});
  for(let i=0;i<3;i++)await done(vault.accrueDaily(who,i));
  for(let i=0;i<3;i++)assert.equal((await vault.positionOf(who,i)).availableProfit,E(9));
  const balance=await token.balanceOf(who);
  const batch=[{positionId:0,amount:E(3),start:0,limit:0},
   {positionId:1,amount:E(4),start:0,limit:0},{positionId:2,amount:E(2),start:0,limit:0}];
  await assert.rejects(vault.connect(other).reinvestMany.staticCall(batch));
  const receipt=await done(vault.connect(user).reinvestMany(batch,{gasLimit:5000000}));
  const events=receipt.logs.flatMap(log=>{try{return [vault.interface.parseLog(log)];}catch{return [];}})
   .filter(event=>event?.name==='ProfitReinvested');
  assert.equal(events.length,3);
  assert.ok(events.every(event=>event.args.newPositionId===3n));
  assert.equal(await vault.positionCount(who),4n);
  assert.equal(await vault.reinvestmentPositionPlusOne(who),4n);
  assert.equal((await book.position(who)).principal,E(9));
  assert.equal((await book.position(who)).lots,1n);
  assert.equal((await book.lot(who,0)).principal,E(9));
  assert.equal((await vault.positionOf(who,0)).availableProfit,E(6));
  assert.equal((await vault.positionOf(who,1)).availableProfit,E(5));
  assert.equal((await vault.positionOf(who,2)).availableProfit,E(7));
  assert.equal(await vault.principalLiability(),E(3009));
  assert.equal(await vault.profitLiability(),E(18));
  assert.equal(await token.balanceOf(who),balance);

  await rpc.request({method:'evm_increaseTime',params:[3601]});await rpc.request({method:'evm_mine',params:[]});
  await done(vault.accrueReinvestmentPage(who,0,8));
  assert.equal((await vault.positionOf(who,3)).availableProfit,E('0.081'));
  await assert.rejects(book.connect(user).consumeProfitPage.staticCall(who,1,0,1));
  const mixed=[{positionId:1,amount:E(2),start:0,limit:0},
   {positionId:3,amount:E('0.05'),start:0,limit:1}];
  await done(vault.connect(user).reinvestMany(mixed,{gasLimit:5000000}));
  assert.equal(await vault.positionCount(who),4n);
  assert.equal((await book.position(who)).principal,E('11.05'));
  assert.equal((await book.position(who)).lots,2n);
  assert.equal((await book.lot(who,1)).principal,E('2.05'));
  assert.equal((await vault.positionOf(who,3)).availableProfit,E('0.031'));
  assert.equal(await vault.principalLiability(),E('3011.05'));
  assert.equal(await vault.profitLiability(),E('16.031'));

  const principalBefore=(await book.position(who)).principal;
  const capitalBefore=(await vault.users(who)).capital;
  const firstBefore=(await vault.positionOf(who,0)).availableProfit;
  await assert.rejects(async()=>done(vault.connect(user).reinvestMany([
   {positionId:0,amount:E(1),start:0,limit:0},
   {positionId:2,amount:E(100),start:0,limit:0}
  ],{gasLimit:5000000})));
  assert.equal((await book.position(who)).principal,principalBefore);
  assert.equal((await vault.users(who)).capital,capitalBefore);
  assert.equal((await vault.positionOf(who,0)).availableProfit,firstBefore);
  await assert.rejects(vault.connect(user).reinvestMany.staticCall([]));
  await assert.rejects(vault.connect(user).reinvestMany.staticCall(Array(17).fill(batch[0])));
  await assert.rejects(vault.connect(user).reinvestMany.staticCall([{positionId:3,amount:1n,start:0,limit:65}]));
  await assert.rejects(vault.connect(user).reinvestMany.staticCall(Array(3).fill({positionId:3,amount:1n,start:0,limit:64})));
  await assert.rejects(vault.connect(user).reinvestMany.staticCall([{positionId:0,amount:1n,start:1,limit:0}]));
 }finally{provider.destroy();await rpc.disconnect();}
});
