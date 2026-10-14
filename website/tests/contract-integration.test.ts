import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther,ZeroAddress,keccak256,toUtf8Bytes} from 'ethers';
const E=parseEther;
let rpc:any,provider:BrowserProvider,signers:any[],addresses:string[],vault:any,token:any,selected:string,saved:string;
let chain:typeof import('../src/chain'),network:typeof import('../src/network'),wallet:typeof import('../src/wallet');
async function send(p:Promise<any>){return(await p).wait();}
async function deploy(name:string,args:unknown[]=[]){const a=JSON.parse(fs.readFileSync(new URL('../../artifacts/'+name+'.json',import.meta.url),'utf8'));const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;}
beforeAll(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97},wallet:{totalAccounts:16,defaultBalance:10000}});provider=new BrowserProvider(rpc);provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:16},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 token=await deploy('MockToken',[18]);const bnb=await deploy('MockFeed',[600n*10n**8n]),usd=await deploy('MockFeed',[10n**8n]);
 vault=await deploy('DropshippingVault',[addresses[0],token.target,bnb.target,usd.target,86400,addresses.slice(0,7),addresses[14]]);
 for(const i of [0,3,4,5]){await send(token.mint(addresses[i],E('10000')));await send(token.connect(signers[i]).approve(vault.target,E('10000')));}
 await send(vault.connect(signers[3]).deposit(token.target,E('100'),ZeroAddress));
 await send(vault.connect(signers[4]).deposit(token.target,E('300'),addresses[3]));await send(vault.connect(signers[5]).deposit(token.target,E('200'),addresses[3]));
 await send(vault.fundRewards(token.target,E('100')));
 await send(vault.batchProfit(keccak256(toUtf8Bytes('small-profit')),token.target,[addresses[3]],[E('1')]));
 vi.stubEnv('VITE_CHAIN_ID','97');vi.stubEnv('VITE_VAULT_ADDRESS',vault.target);vi.resetModules();
 vi.stubGlobal('window',{ethereum:{request:async({method,params}:any)=>['eth_accounts','eth_requestAccounts'].includes(method)?[selected]:rpc.request({method,params:params||[]})}});
 chain=await import('../src/chain');network=await import('../src/network');wallet=await import('../src/wallet');saved=await rpc.request({method:'evm_snapshot',params:[]});
},60000);
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[saved]});saved=await rpc.request({method:'evm_snapshot',params:[]});selected=addresses[3];await wallet.wallets.connect('injected');});
afterAll(async()=>{await wallet?.wallets.disconnect();vi.unstubAllGlobals();vi.unstubAllEnvs();await provider?.destroy();await rpc?.disconnect();});
describe('Actual wallet client against a local contract',()=>{
 it('blocks a first deposit with no referrer until the reviewed warning is acknowledged',async()=>{
  selected=addresses[6];const snapshot=await chain.readSnapshot(selected,'USDT',20);
  await expect(chain.execute({kind:'deposit',value:'10',expectedFee:0n},snapshot,vi.fn())).rejects.toThrow('Confirm that you want to register without a referrer');
  expect((await vault.users(selected)).registered).toBe(false);
  await send(token.mint(selected,E('10')));
  await chain.execute({kind:'deposit',value:'10',expectedFee:0n,expectedLock:snapshot.lock,expectedPenalty:snapshot.penalty,noReferrerAcknowledged:true},snapshot,vi.fn());
  expect((await vault.users(selected)).registered).toBe(true);expect((await vault.users(selected)).referrer).toBe(ZeroAddress);
 },20000);
 it('reads exact level totals from the real network volume ledger',async()=>{
  const {readLevelVolumes}=await import('../src/levels');const block=await provider.getBlockNumber();
  const result=await readLevelVolumes(vault,addresses[3],block);
  expect(result.map(x=>x.volume)).toEqual([E('500'),0n,0n]);
 });
 it('allows reinvesting one dollar of funded profit while keeping the deposit minimum',async()=>{
  const s=await chain.readSnapshot(addresses[3],'USDT',20),status=vi.fn();
  expect(s.reinvested).toBe(0n);
  const action={kind:'reinvest' as const,value:'1',expectedFee:0n,expectedLock:s.lock,expectedPenalty:s.penalty};
  await chain.execute(action,s,status);
  expect((await vault.accounts(addresses[3],token.target)).principal).toBe(E('101'));
  expect((await vault.accounts(addresses[3],token.target)).profit).toBe(0n);
  expect(await vault.cumulativeReinvested(addresses[3],token.target)).toBe(E('1'));
  const updated=await chain.readSnapshot(addresses[3],'USDT',20);
  expect(updated.reinvested).toBe(E('1'));
  expect(updated.withdrawalLimit).toBe((updated.externalDeposited+updated.reinvested)/10n);
  await expect(chain.execute({...action,kind:'deposit'},s,status)).rejects.toThrow('minimum deposit');
 },45000);
 it('creates a group, prepares and claims the exact reward through the real frontend methods',async()=>{
  const status=vi.fn();
  await network.executeNetwork({kind:'create',branches:[addresses[4]]},addresses[3],status);
  await network.executeNetwork({kind:'append',group:0n,branches:[addresses[5]]},addresses[3],status);
  await network.executeNetwork({kind:'prepare',group:0n,stage:0},addresses[3],status);
  expect((await vault.rewardProgress(addresses[3],0)).preparedUsd).toBe(E('500'));
  await network.executeNetwork({kind:'claim',group:0n,stage:0},addresses[3],status);
  expect((await vault.accounts(addresses[3],token.target)).profit).toBe(E('36'));
  expect((await vault.rewardProgress(addresses[3],0)).stage).toBe(1n);
  await expect(network.executeNetwork({kind:'claim',group:0n,stage:0},addresses[3],status)).rejects.toMatchObject({revert:{name:'NetworkStageChanged'}});
  const page=await network.loadNetwork(addresses[3],0n,0n);
  expect(page.branchCount).toBe(2n);expect(page.groups[0].stage).toBe(1);expect(page.stages[0]).toEqual({goal:E('500'),reward:E('35'),cap:6000n});
  expect(page.tiers[4]).toEqual([1600n,800n,600n,400n]);
 },60000);
 it('refuses an account switch before requesting a network transaction',async()=>{
  selected=addresses[4];const before=await provider.getTransactionCount(addresses[4],'latest');
  await expect(network.executeNetwork({kind:'create',branches:[addresses[5]]},addresses[3],vi.fn())).rejects.toThrow('account changed');
  expect(await provider.getTransactionCount(addresses[4],'latest')).toBe(before);
 },15000);
});
