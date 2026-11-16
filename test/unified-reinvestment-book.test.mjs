import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ganache from 'ganache';
import solc from 'solc';
import {BrowserProvider,Contract,ContractFactory,parseEther} from 'ethers';

const E=value=>parseEther(String(value));
let cachedArtifact;
function compile(){
 if(cachedArtifact)return cachedArtifact;
 const file='contracts/v3/UnifiedReinvestmentBook.sol';
 const input={language:'Solidity',sources:{[file]:{content:fs.readFileSync(file,'utf8')}},settings:{
  optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',
  outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}
 }};
 const out=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{
  try{return {contents:fs.readFileSync(path.resolve('node_modules',name),'utf8')};}
  catch{return {error:'Missing import '+name};}
 }}));
 const errors=(out.errors||[]).filter(item=>item.severity==='error');
 assert.deepEqual(errors,[]);
 cachedArtifact=out.contracts[file].UnifiedReinvestmentBook;
 return cachedArtifact;
}
const done=async promise=>{const receipt=await(await promise).wait();assert.equal(receipt.status,1);return receipt;};
async function reconcile(book,who){
 const p=await book.position(who),fields=['principal','reservedPrincipal','daily','compound','basis','reservedProfit'];
 const totals=Object.fromEntries(fields.map(field=>[field,0n]));
 for(let i=0;i<Number(p.lots);i++){
  const l=await book.lot(who,i);
  for(const field of fields)totals[field]+=l[field];
  assert.equal(l.basis,l.daily+l.compound);
  assert.ok(l.reservedPrincipal<=l.principal);
 }
 for(const field of fields)assert.equal(p[field],totals[field]);
}
function compileHarness(){
 const files=['contracts/v3/UnifiedReinvestmentBook.sol','test/fixtures/UnifiedVaultHarness.sol'];
 const sources=Object.fromEntries(files.map(file=>[file,{content:fs.readFileSync(file,'utf8')}]));
 const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'shanghai',
  outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
 const out=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{
  try{return {contents:fs.readFileSync(path.resolve('node_modules',name),'utf8')};}
  catch{return {error:'Missing import '+name};}
 }}));
 assert.deepEqual((out.errors||[]).filter(item=>item.severity==='error'),[]);
 return out.contracts['test/fixtures/UnifiedVaultHarness.sol'].UnifiedVaultHarness;
}

test('one testnet reinvestment position preserves separate lot cycles, locks and claims',async()=>{
 const artifact=compile();
 assert.ok(artifact.evm.deployedBytecode.object.length/2<24576);
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:4,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 try{
  const vault=await provider.getSigner(0),attacker=await provider.getSigner(1);
  const user=await provider.getSigner(2),other=await provider.getSigner(3);
  const who=await user.getAddress(),otherAddress=await other.getAddress();
  const factory=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,vault);
  const book=await factory.deploy(await vault.getAddress());await book.waitForDeployment();
  const advanceTo=async target=>{
   const block=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]});
   const delta=Number(target)-Number(BigInt(block.timestamp));
   if(delta>0)await rpc.request({method:'evm_increaseTime',params:[delta]});
   await rpc.request({method:'evm_mine',params:[]});
  };
  await assert.rejects(book.connect(attacker).record.staticCall(who,E(1)));
  await done(book.record(who,E(100)));
  const first=await book.lot(who,0);
  assert.equal(await book.positionCount(who),1n);
  await advanceTo(first.openedAt+1800n);
  await done(book.record(who,E(50)));
  const second=await book.lot(who,1);
  assert.equal(await book.positionCount(who),1n);
  assert.equal((await book.position(who)).principal,E(150));
  assert.ok(second.openedAt>first.openedAt);

  await advanceTo(first.openedAt+3601n);
  const preview=await book.accruePage.staticCall(who,0,64,70);
  assert.deepEqual(Array.from(preview.grossByLot),[E('0.7'),0n]);
  await done(book.accruePage(who,0,64,70));
  let position=await book.position(who);
  assert.equal(position.daily,E('0.7'));assert.equal(position.compound,0n);
  await done(book.accruePage(who,0,64,70));
  assert.equal((await book.position(who)).daily,E('0.7'));
  await advanceTo(second.openedAt+3601n);
  await done(book.accruePage(who,0,64,70));
  position=await book.position(who);
  assert.equal(position.daily,E('1.05'));assert.equal(position.compound,0n);
  await advanceTo(first.openedAt+7202n);
  await done(book.accruePage(who,0,64,70));
  position=await book.position(who);
  assert.equal(position.daily,E('1.75'));assert.equal(position.compound,E('0.0049'));
  assert.equal(position.basis,position.daily+position.compound);
  await reconcile(book,who);

  // Profit under a pending request does not compound; release restores its split.
  await done(book.reserveProfit(who,7,E('0.5'),0,64));
  position=await book.position(who);
  assert.equal(position.daily,E('1.25'));assert.equal(position.reservedProfit,E('0.5'));
  assert.equal(position.basis,E('1.2549'));
  await reconcile(book,who);
  await advanceTo(first.openedAt+10805n);
  await done(book.accruePage(who,0,64,70));
  position=await book.position(who);
  assert.equal(position.compound,E('0.0136843'));
  assert.equal(position.reservedProfit,E('0.5'));
  await done(book.releaseProfit(7));
  position=await book.position(who);
  assert.equal(position.reservedProfit,0n);
  assert.equal(position.basis,position.daily+position.compound);
  await reconcile(book,who);
  await assert.rejects(book.releaseProfit.staticCall(7));
  await assert.rejects(book.settleProfit.staticCall(7));
  await done(book.reserveProfit(who,8,E('0.25'),0,64));
  await done(book.settleProfit(8));
  position=await book.position(who);
  assert.equal(position.reservedProfit,0n);
  assert.equal((await book.reservation(8)).status,2n);

  // Reinvestment of verified group profit increases the same logical position.
  const before=await book.position(who);
  await done(book.reinvestProfitPage(who,E(1),0,64));
  const after=await book.position(who);
  assert.equal(await book.positionCount(who),1n);
  assert.equal(after.lots,3n);assert.equal(after.principal,E(151));
  assert.equal(after.basis,before.basis-E(1));
  assert.equal(before.principal+before.daily+before.compound+before.reservedProfit,
   after.principal+after.daily+after.compound+after.reservedProfit);
  await reconcile(book,who);
  await assert.rejects(book.reinvestProfitPage.staticCall(who,E(1000),0,64));
  assert.equal((await book.position(who)).principal,E(151));
  await assert.rejects(book.accruePage.staticCall(who,0,65,70));
  await done(book.record(otherAddress,E(3)));
  assert.equal((await book.position(otherAddress)).principal,E(3));
  assert.equal((await book.position(who)).principal,E(151));

  // Later additions do not extend or bypass the first lot's 90-day lock.
  await advanceTo(first.openedAt+90n*86400n+1n);
  assert.equal((await book.maturedPrincipalPage(who,0,64)).available,E(100));
  await assert.rejects(book.reservePrincipal.staticCall(who,40,E('100.1'),0,64));
  await done(book.reservePrincipal(who,41,E(100),0,64));
  assert.equal((await book.maturedPrincipalPage(who,0,64)).available,0n);
  await done(book.accruePage(who,0,1,70));
  assert.equal((await book.lot(who,0)).principal,E(100));
  await done(book.releasePrincipal(41));
  assert.equal((await book.maturedPrincipalPage(who,0,64)).available,E(100));
  await done(book.reservePrincipal(who,42,E(60),0,64));
  await done(book.settlePrincipal(42));
  position=await book.position(who);
  assert.equal(position.principal,E(91));assert.equal(position.reservedPrincipal,0n);
  assert.equal((await book.lot(who,0)).principal,E(40));
  await reconcile(book,who);
  await assert.rejects(book.settlePrincipal.staticCall(42));
  await assert.rejects(book.reserveProfit.staticCall(who,42,E(1),0,64));
  await assert.rejects(book.connect(attacker).settlePrincipal.staticCall(42));
 }finally{provider.destroy();await rpc.disconnect();}
});

test('more than 64 additions stay in one position and process in bounded pages',async()=>{
 const artifact=compile();
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:2,defaultBalance:100}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 try{
  const vault=await provider.getSigner(0),user=await provider.getSigner(1),who=await user.getAddress();
  const book=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,vault).deploy(await vault.getAddress());
  await book.waitForDeployment();
  for(let i=0;i<70;i++)await done(book.record(who,E(1)));
  assert.equal(await book.positionCount(who),1n);
  assert.equal((await book.position(who)).lots,70n);
  await rpc.request({method:'evm_increaseTime',params:[3601]});
  await rpc.request({method:'evm_mine',params:[]});
  const first=await done(book.accruePage(who,0,64,50));
  assert.ok(first.gasUsed<15000000n);
  assert.equal((await book.position(who)).daily,E('0.32'));
  await done(book.accruePage(who,64,64,50));
  assert.equal((await book.position(who)).daily,E('0.35'));
  assert.equal((await book.position(who)).principal,E(70));
  await assert.rejects(book.accruePage.staticCall(who,0,65,50));
  await rpc.request({method:'evm_increaseTime',params:[90*86400+1]});
  await rpc.request({method:'evm_mine',params:[]});
  assert.equal((await book.maturedPrincipalPage(who,0,64)).available,E(64));
  assert.equal((await book.maturedPrincipalPage(who,64,64)).available,E(6));
  await assert.rejects(book.reservePrincipal.staticCall(who,1,E(65),0,64));
  await done(book.reservePrincipal(who,1,E(64),0,64));
  await done(book.reservePrincipal(who,2,E(6),64,64));
  assert.equal((await book.position(who)).reservedPrincipal,E(70));
  await done(book.settlePrincipal(1));await done(book.releasePrincipal(2));
  assert.equal((await book.position(who)).principal,E(6));
  assert.equal((await book.position(who)).reservedPrincipal,0n);
 }finally{provider.destroy();await rpc.disconnect();}
});

test('per-lot integer rounding and bounded pages never create an early credit',async()=>{
 const artifact=compile();
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:2,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 try{
  const vault=await provider.getSigner(0),user=await provider.getSigner(1),who=await user.getAddress();
  const book=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,vault).deploy(await vault.getAddress());
  await book.waitForDeployment();
  const principals=[1n,142n,143n,200n,1234567890123456789n];
  for(const principal of principals)await done(book.record(who,principal));
  await done(book.accruePage(who,0,64,70));
  assert.equal((await book.position(who)).daily,0n);
  await rpc.request({method:'evm_increaseTime',params:[3601]});
  await rpc.request({method:'evm_mine',params:[]});
  await done(book.accruePage(who,0,2,70));
  assert.equal((await book.position(who)).daily,0n);
  await done(book.accruePage(who,2,64,70));
  const expected=principals.reduce((sum,value)=>sum+(value*70n/10000n),0n);
  const position=await book.position(who);
  assert.equal(position.daily,expected);
  assert.equal(position.basis,expected);
  assert.equal(position.compound,0n);
  assert.equal(await book.positionCount(who),1n);
  await assert.rejects(book.accruePage.staticCall(who,6,1,70));
  await assert.rejects(book.accruePage.staticCall(who,0,0,70));
 }finally{provider.destroy();await rpc.disconnect();}
});

test('book refuses deployment on mainnet',async()=>{
 const artifact=compile();
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});
 try{
  const signer=await provider.getSigner();
  const factory=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signer);
  await assert.rejects(factory.deploy(await signer.getAddress()));
 }finally{provider.destroy();await rpc.disconnect();}
});

test('local fixture atomically debits multiple source claims into one position',async()=>{
 const artifact=compileHarness();
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:3,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 try{
  const tester=await provider.getSigner(0),user=await provider.getSigner(1),attacker=await provider.getSigner(2);
  const who=await user.getAddress();
  const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,tester).deploy();
  await vault.waitForDeployment();
  const book=new Contract(await vault.book(),compile().abi,provider);
  await assert.rejects(vault.connect(attacker).seed.staticCall(who,0,E(10)));
  await done(vault.seed(who,0,E(10)));await done(vault.seed(who,1,E(20)));
  await done(vault.connect(user).reinvestSource(0,E(6)));
  await done(vault.connect(user).reinvestSource(1,E(12)));
  assert.equal(await book.positionCount(who),1n);
  let position=await book.position(who);
  assert.equal(position.principal,E(18));assert.equal(position.lots,2n);
  assert.equal(await vault.sourceClaim(who,0),E(4));assert.equal(await vault.sourceClaim(who,1),E(8));
  assert.equal(await vault.principalLiability(),E(18));assert.equal(await vault.profitLiability(),E(12));
  await assert.rejects(vault.connect(user).reinvestSource.staticCall(0,E(100)));
  await assert.rejects(book.connect(user).record.staticCall(who,E(100)));
  assert.equal((await book.position(who)).principal,E(18));
  await rpc.request({method:'evm_increaseTime',params:[3601]});
  await rpc.request({method:'evm_mine',params:[]});
  await done(vault.connect(user).accrue(0,64));
  assert.equal(await vault.profitLiability(),E('12.126'));
  await done(vault.connect(user).reinvestGroup(E('0.1'),0,64));
  position=await book.position(who);
  assert.equal(await book.positionCount(who),1n);
  assert.equal(position.principal,E('18.1'));assert.equal(position.lots,3n);
  assert.equal(await vault.principalLiability(),E('18.1'));
  assert.equal(await vault.profitLiability(),E('12.026'));
 }finally{provider.destroy();await rpc.disconnect();}
});
