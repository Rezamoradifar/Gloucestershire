import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,MaxUint256,ZeroAddress,parseEther as E} from 'ethers';

let rpc:any,provider:BrowserProvider,vault:any,token:any,signers:any[],addresses:string[],selected:string,snapshot:string;
let chain:typeof import('../src/chain'),wallet:typeof import('../src/wallet');
let wrongChain=false;
const writes:any[]=[];
const send=async(promise:Promise<any>)=>(await promise).wait();
const artifact=(name:string)=>JSON.parse(fs.readFileSync(new URL('../../artifacts/'+name+'.json',import.meta.url),'utf8'));
const deposit=(review:any,value='10')=>({kind:'deposit' as const,value,referrer:addresses[0],expectedFee:0n,expectedLock:review.lock,expectedPenalty:review.penalty});

beforeAll(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:8,defaultBalance:1000},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:8},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const deploy=async(name:string,args:unknown[])=>{const a=artifact(name),contract=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await contract.waitForDeployment();return contract;};
 token=await deploy('MockToken',[18]);const bnbFeed=await deploy('MockFeed',[60000000000n]),tokenFeed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('AutomaticGroupVault',[addresses[0],token.target,bnbFeed.target,tokenFeed.target,86400,addresses.slice(0,7),addresses[7]]);
 await send(vault.register(ZeroAddress));await send(token.mint(addresses[1],E('100000')));
 vi.stubEnv('VITE_CHAIN_ID','56');vi.stubEnv('VITE_VAULT_ADDRESS',vault.target);vi.resetModules();
 vi.stubGlobal('window',{safepalProvider:{request:async({method,params=[]}:any)=>{
  if(['eth_accounts','eth_requestAccounts'].includes(method))return [selected];
  if(method==='eth_chainId'&&wrongChain)return '0x61';
  if(method==='eth_sendTransaction')writes.push(params[0]);
  return rpc.request({method,params});
 }}});
 chain=await import('../src/chain');wallet=await import('../src/wallet');snapshot=await rpc.request({method:'evm_snapshot',params:[]});
},60000);
beforeEach(async()=>{
 await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});
 selected=addresses[1];wrongChain=false;writes.length=0;await wallet.wallets.connect('injected');
});
afterAll(async()=>{await wallet?.wallets.disconnect();vi.unstubAllGlobals();vi.unstubAllEnvs();await provider?.destroy();await rpc?.disconnect();});

describe('Fresh standard contract client on local BNB mainnet chain ID 56',()=>{
 it('reads production contract rules and deposits USDT and BNB through the selected SafePal provider',async()=>{
  expect(vault.interface.hasFunction('FAST_TESTNET_VERSION')).toBe(false);
  const review=await chain.readSnapshot(selected,'USDT',20);
  expect(review).toMatchObject({chainId:56,vaultAddress:vault.target,deferredRewards:true,pendingWithdrawal:false,decimals:18});
  expect(review.lock).toBe(await vault.lockDuration());expect(review.lock).not.toBe(3600n);
  const hash=await chain.execute(deposit(review),review,vi.fn());expect((await provider.getTransaction(hash))!.chainId).toBe(56n);
  expect(writes).toHaveLength(2);expect(writes[0].to.toLowerCase()).toBe(String(token.target).toLowerCase());expect(writes[1].to.toLowerCase()).toBe(String(vault.target).toLowerCase());
  expect((await vault.accounts(selected,token.target)).principal).toBe(E('10'));expect((await vault.users(selected)).referrer).toBe(addresses[0]);
  const native=await chain.readSnapshot(selected,'BNB',20),nativeHash=await chain.execute(deposit(native,'0.02'),native,vi.fn());
  expect((await provider.getTransaction(nativeHash))!.chainId).toBe(56n);expect(writes).toHaveLength(3);
  expect((await vault.accounts(selected,ZeroAddress)).principal).toBe(E('0.02'));
 },30000);
 it('stops a switch to testnet before any approval or contract transaction',async()=>{
  const review=await chain.readSnapshot(selected,'USDT',20);wrongChain=true;
  await expect(chain.execute(deposit(review),review,vi.fn())).rejects.toThrow('different network');
  expect(writes).toEqual([]);expect(await token.allowance(selected,vault.target)).toBe(0n);
 });
 it('preserves cumulative VIP KYC preflight on chain 56 before requesting an allowance',async()=>{
  await send(token.connect(signers[1]).approve(vault.target,MaxUint256));await send(vault.connect(signers[1]).deposit(token.target,E('49995'),addresses[0]));await send(token.connect(signers[1]).approve(vault.target,0));
  const review=await chain.readSnapshot(selected,'USDT',20);
  await expect(chain.execute(deposit(review),review,vi.fn())).rejects.toThrow('Administrator KYC approval is required');
  expect(writes).toEqual([]);expect(await token.allowance(selected,vault.target)).toBe(0n);expect((await vault.users(selected)).vipKyc).toBe(false);
 });
});
