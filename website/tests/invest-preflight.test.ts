import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,MaxUint256,ZeroAddress,parseEther as E,type Contract} from 'ethers';
import {checkInvestmentRequirements} from '../src/invest-preflight';

const fast=JSON.parse(fs.readFileSync(new URL('../../config/fresh-fast-testnet.json',import.meta.url),'utf8'));
let rpc:any,provider:BrowserProvider,signers:any[],addresses:string[],vault:any,token:any,owner:any,selected:string,snapshot:string;
let chain:typeof import('../src/chain'),wallet:typeof import('../src/wallet');
let writes:any[]=[];
let rejectUserRead=false,switchAfterApproval=false;
const send=async(promise:Promise<any>)=>(await promise).wait();
const artifact=(name:string)=>JSON.parse(fs.readFileSync(new URL('../../artifacts/'+name+'.json',import.meta.url),'utf8'));
const action=(s:any,extra:Record<string,unknown>={})=>({kind:'deposit' as const,value:'10',expectedFee:0n,expectedLock:s.lock,expectedPenalty:s.penalty,referrer:addresses[0],...extra});

beforeAll(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:8,defaultBalance:1000,unlockedAccounts:[fast.owner,fast.deployer]},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:8},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 for(const who of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[who,'0x'+E('10').toString(16)]});
 owner=await provider.getSigner(fast.owner);const operator=await provider.getSigner(fast.deployer);await rpc.request({method:'evm_setAccountNonce',params:[fast.deployer,'0x10']});
 const deploy=async(name:string,args:unknown[],signer=signers[0])=>{const a=artifact(name),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 token=await deploy('MockToken',[18]);const feed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('FastTestnetVault',[fast.owner,token.target,feed.target,feed.target,86400,fast.partners,addresses[7]],operator);
 await send(vault.connect(signers[0]).register(ZeroAddress));
 for(const who of addresses.slice(1,6))await send(token.mint(who,E('100000')));
 vi.stubEnv('VITE_CHAIN_ID','97');vi.stubEnv('VITE_VAULT_ADDRESS',vault.target);vi.resetModules();
 vi.stubGlobal('window',{ethereum:{request:async({method,params=[]}:any)=>{
  if(['eth_accounts','eth_requestAccounts'].includes(method))return[selected];
  if(rejectUserRead&&method==='eth_call'&&params[0]?.data?.startsWith(vault.interface.getFunction('users').selector))throw Error('INVESTMENT_RPC_UNAVAILABLE');
  if(method==='eth_sendTransaction')writes.push(params[0]);
  const result=await rpc.request({method,params});
  if(switchAfterApproval&&method==='eth_sendTransaction'&&params[0]?.to?.toLowerCase()===String(token.target).toLowerCase())selected=addresses[5];
  return result;
 }}});
 chain=await import('../src/chain');wallet=await import('../src/wallet');snapshot=await rpc.request({method:'evm_snapshot',params:[]});
},60000);
beforeEach(async()=>{
 await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});
 writes=[];rejectUserRead=false;switchAfterApproval=false;selected=addresses[1];await wallet.wallets.connect('injected');
});
afterAll(async()=>{await wallet?.wallets.disconnect();vi.unstubAllGlobals();vi.unstubAllEnvs();await provider?.destroy();await rpc?.disconnect();});

describe('Investment preflight against the deployed fast contract implementation',()=>{
 it('explains unregistered and self referrers before any token approval or wallet transaction',async()=>{
  const s=await chain.readSnapshot(selected,'USDT',20);
  for(const [referrer,message]of [[fast.owner,'not registered'],[selected,'own referrer']]){
   await expect(vault.connect(signers[1]).deposit.staticCall(token.target,E('10'),referrer)).rejects.toMatchObject({revert:{name:'Invalid'}});
   await expect(chain.execute(action(s,{referrer}),s,vi.fn())).rejects.toThrow(message);
   expect(writes).toEqual([]);expect(await token.allowance(selected,vault.target)).toBe(0n);expect((await vault.users(selected)).registered).toBe(false);
  }
 });
 it('keeps the explicit no-referrer acknowledgement instead of changing the referral automatically',async()=>{
  const s=await chain.readSnapshot(selected,'USDT',20);
  await expect(chain.execute(action(s,{referrer:''}),s,vi.fn())).rejects.toThrow('Confirm that you want to register without a referrer');expect(writes).toEqual([]);
  await chain.execute(action(s,{referrer:'',noReferrerAcknowledged:true}),s,vi.fn());
  expect((await vault.users(selected)).referrer).toBe(ZeroAddress);expect((await vault.accounts(selected,token.target)).principal).toBe(E('10'));
 },20000);
 it('checks VIP cumulative capital and KYC before asking for another allowance',async()=>{
  await send(token.connect(signers[1]).approve(vault.target,MaxUint256));await send(vault.connect(signers[1]).deposit(token.target,E('49995'),addresses[0]));
  await expect(vault.connect(signers[1]).deposit.staticCall(token.target,E('10'),addresses[0])).rejects.toMatchObject({revert:{name:'Unauthorized'}});
  await send(token.connect(signers[1]).approve(vault.target,0));const s=await chain.readSnapshot(selected,'USDT',20);
  await expect(chain.execute(action(s),s,vi.fn())).rejects.toThrow('Administrator KYC approval is required');
  expect(writes).toEqual([]);expect(await token.allowance(selected,vault.target)).toBe(0n);expect((await vault.users(selected)).vipKyc).toBe(false);
  await send(vault.connect(owner).setCustomerStatus(selected,false,true));
  await chain.execute(action(s),s,vi.fn());expect((await vault.accounts(selected,token.target)).principal).toBe(E('50005'));
 },30000);
 it('allows a valid token deposit when approval is needed, and sends its canonical existing referrer',async()=>{
  const s=await chain.readSnapshot(selected,'USDT',20);await chain.execute(action(s),s,vi.fn());
  expect(writes).toHaveLength(2);expect(writes[0].to.toLowerCase()).toBe(String(token.target).toLowerCase());
  expect((await vault.users(selected)).referrer).toBe(addresses[0]);
  const updated=await chain.readSnapshot(selected,'USDT',20);await chain.execute(action(updated,{referrer:addresses[6]}),updated,vi.fn());
  expect((await vault.users(selected)).referrer).toBe(addresses[0]);expect((await vault.accounts(selected,token.target)).principal).toBe(E('20'));
 },30000);
 it('retains a sufficient allowance and simulates a valid deposit without asking for another approval',async()=>{
  await send(token.connect(signers[1]).approve(vault.target,E('10')));const s=await chain.readSnapshot(selected,'USDT',20);
  await chain.execute(action(s),s,vi.fn());expect(writes).toHaveLength(1);expect(writes[0].to.toLowerCase()).toBe(String(vault.target).toLowerCase());
 },20000);
 it('rejects stale token precision, unsupported assets and the oracle USD minimum before signing',async()=>{
  const s=await chain.readSnapshot(selected,'USDT',20);
  await expect(chain.execute(action(s),{...s,decimals:6},vi.fn())).rejects.toThrow('token precision');
  await expect(chain.execute(action(s),{...s,asset:addresses[7]},vi.fn())).rejects.toThrow('selected asset');
  const bnb=await chain.readSnapshot(selected,'BNB',20);
  await expect(chain.execute(action(bnb,{value:'1'}),bnb,vi.fn())).rejects.toThrow('minimum deposit');expect(writes).toEqual([]);
 });
 it('propagates a failed current-state read and an account switch without sending a deposit',async()=>{
  const s=await chain.readSnapshot(selected,'USDT',20);rejectUserRead=true;
  await expect(chain.execute(action(s),s,vi.fn())).rejects.toMatchObject({code:'CALL_EXCEPTION'});expect(writes).toEqual([]);rejectUserRead=false;
  switchAfterApproval=true;await expect(chain.execute(action(s),s,vi.fn())).rejects.toThrow('account changed');
  expect(writes).toHaveLength(1);expect(writes[0].to.toLowerCase()).toBe(String(token.target).toLowerCase());expect((await vault.users(addresses[1])).registered).toBe(false);
 },20000);
 it('detects a new contract pause before requesting a token allowance',async()=>{
  const s=await chain.readSnapshot(selected,'USDT',20);await send(vault.connect(owner).setPaused(true));
  await expect(chain.execute(action(s),s,vi.fn())).rejects.toThrow('investments are paused');expect(writes).toEqual([]);expect(await token.allowance(selected,vault.target)).toBe(0n);
 });
 it('rejects an amount outside uint256 before any contract read',async()=>{
  const usdt=vi.fn();const reader={usdt}as unknown as Contract;
  await expect(checkInvestmentRequirements(reader,{kind:'deposit',who:selected,asset:ZeroAddress,amount:MaxUint256+1n,decimals:18})).rejects.toThrow('supported token range');expect(usdt).not.toHaveBeenCalled();
 });
});
