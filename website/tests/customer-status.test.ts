import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,parseEther as E} from 'ethers';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const fast=JSON.parse(fs.readFileSync(new URL('../../config/fresh-fast-testnet.json',import.meta.url),'utf8'));
let rpc:any,provider:BrowserProvider,signers:any[],addresses:string[],owner:any,vault:any,selected:string,snapshot:string;
let chain:typeof import('../src/chain'),wallet:typeof import('../src/wallet'),CustomerStatus:typeof import('../src/CustomerStatus').default;
let writes:any[]=[],afterSimulation:'status'|'wallet'|null=null,rejectRoleRead=false;
const send=async(p:Promise<any>)=>(await p).wait();
const artifact=(name:string)=>JSON.parse(fs.readFileSync(new URL('../../artifacts/'+name+'.json',import.meta.url),'utf8'));
beforeAll(async()=>{
 rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:8,defaultBalance:1000,unlockedAccounts:[fast.owner,fast.deployer]},miner:{blockGasLimit:30000000}});
 provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:8},(_,i)=>provider.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 for(const who of [fast.owner,fast.deployer])await rpc.request({method:'evm_setAccountBalance',params:[who,'0x'+E('10').toString(16)]});
 await rpc.request({method:'evm_setAccountNonce',params:[fast.deployer,'0x10']});owner=await provider.getSigner(fast.owner);const operator=await provider.getSigner(fast.deployer);
 const deploy=async(name:string,args:unknown[],signer=signers[0])=>{const a=artifact(name),c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const token=await deploy('MockToken',[18]),feed=await deploy('MockFeed',[100000000n]);
 vault=await deploy('FastTestnetVault',[fast.owner,token.target,feed.target,feed.target,86400,fast.partners,addresses[7]],operator);
 await send(vault.connect(signers[0]).register(ZeroAddress));await send(vault.connect(signers[1]).register(addresses[0]));
 vi.stubEnv('VITE_CHAIN_ID','97');vi.stubEnv('VITE_VAULT_ADDRESS',vault.target);vi.resetModules();
 vi.stubGlobal('window',{ethereum:{request:async({method,params=[]}:any)=>{
  if(['eth_accounts','eth_requestAccounts'].includes(method))return[selected];
  if(rejectRoleRead&&method==='eth_call'&&params[0]?.data?.startsWith(vault.interface.getFunction('reporters').selector))throw Error('STATUS_RPC_UNAVAILABLE');
  if(method==='eth_sendTransaction')writes.push(params[0]);
  const result=await rpc.request({method,params});
  if(afterSimulation&&method==='eth_call'&&params[0]?.data?.startsWith(vault.interface.getFunction('setCustomerStatus').selector)){
   const change=afterSimulation;afterSimulation=null;
   if(change==='status')await send(vault.connect(owner).setCustomerStatus(addresses[1],true,false));else selected=addresses[3];
  }
  return result;
 }}});
 chain=await import('../src/chain');wallet=await import('../src/wallet');CustomerStatus=(await import('../src/CustomerStatus')).default;
 snapshot=await rpc.request({method:'evm_snapshot',params:[]});
},60000);
beforeEach(async()=>{await rpc.request({method:'evm_revert',params:[snapshot]});snapshot=await rpc.request({method:'evm_snapshot',params:[]});writes=[];afterSimulation=null;rejectRoleRead=false;selected=fast.owner;await wallet.wallets.connect('injected');});
afterAll(async()=>{await wallet?.wallets.disconnect();vi.unstubAllGlobals();vi.unstubAllEnvs();await provider?.destroy();await rpc?.disconnect();});

describe('Explicit administrator customer activity and KYC updates',()=>{
 it('renders a load-and-review panel without submitting or loading customer status automatically',()=>{
  const submit=vi.fn();const html=renderToStaticMarkup(createElement(CustomerStatus,{who:selected,connected:true,disabled:false,onSubmit:submit}));
  expect(html).toContain('Load customer status');expect(html).not.toContain('Confirm status in wallet');expect(submit).not.toHaveBeenCalled();expect(writes).toEqual([]);
 });
 it('reads registered customer flags without changing activity, KYC or direct counts',async()=>{
  const review=await chain.readCustomerStatus(selected,addresses[1]);
  expect(review).toMatchObject({chainId:97,vaultAddress:vault.target,operator:fast.owner,customer:addresses[1],active:false,kyc:false});expect(writes).toEqual([]);
  expect((await vault.users(addresses[0])).activeDirect).toBe(0n);expect((await vault.users(addresses[1])).vipKyc).toBe(false);
 });
 it('updates only explicitly reviewed flags and lets the contract derive active-direct counts',async()=>{
  const first=await chain.readCustomerStatus(selected,addresses[1]);
  const hash=await chain.executeCustomerStatus(selected,{review:first,active:true,kyc:false},vi.fn());expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  expect(writes).toHaveLength(1);expect(writes[0].to.toLowerCase()).toBe(String(vault.target).toLowerCase());expect(BigInt(writes[0].value||0)).toBe(0n);
  expect(vault.interface.parseTransaction({data:writes[0].data}).name).toBe('setCustomerStatus');
  expect((await vault.users(addresses[1])).active).toBe(true);expect((await vault.users(addresses[1])).vipKyc).toBe(false);expect((await vault.users(addresses[0])).activeDirect).toBe(1n);
  const second=await chain.readCustomerStatus(selected,addresses[1]);await chain.executeCustomerStatus(selected,{review:second,active:false,kyc:true},vi.fn());
  expect(writes).toHaveLength(2);expect((await vault.users(addresses[1])).active).toBe(false);expect((await vault.users(addresses[1])).vipKyc).toBe(true);expect((await vault.users(addresses[0])).activeDirect).toBe(0n);
 },20000);
 it('rejects unregistered customers, no-op reviews and callers without an existing contract role',async()=>{
  await expect(chain.readCustomerStatus(selected,addresses[2])).rejects.toThrow('not registered');
  await expect(chain.readCustomerStatus(selected,ZeroAddress)).rejects.toThrow('valid registered customer');
  const review=await chain.readCustomerStatus(selected,addresses[1]);await expect(chain.executeCustomerStatus(selected,{review,active:false,kyc:false},vi.fn())).rejects.toThrow('Choose a customer status change');
  selected=addresses[3];await expect(chain.readCustomerStatus(selected,addresses[1])).rejects.toThrow('authorized reporter is required');
  await expect(chain.executeCustomerStatus(selected,{review:{...review,operator:selected},active:true,kyc:false},vi.fn())).rejects.toThrow('authorized reporter is required');
  await expect(vault.connect(signers[3]).setCustomerStatus.staticCall(addresses[1],true,false)).rejects.toMatchObject({revert:{name:'Unauthorized'}});expect(writes).toEqual([]);
 });
 it('does not treat ownership alone as the reporter permission required by the contract',async()=>{
  await send(vault.connect(owner).transferOwnership(addresses[3]));await send(vault.connect(signers[3]).acceptOwnership());selected=addresses[3];
  expect(await vault.owner()).toBe(selected);expect(await vault.reporters(selected)).toBe(false);
  await expect(chain.readCustomerStatus(selected,addresses[1])).rejects.toThrow('owner must also hold the reporter role');
  await expect(vault.connect(signers[3]).setCustomerStatus.staticCall(addresses[1],true,false)).rejects.toMatchObject({revert:{name:'Unauthorized'}});expect(writes).toEqual([]);
 });
 it('rejects changed administrator identities, networks and contract targets before requesting a signature',async()=>{
  const review=await chain.readCustomerStatus(selected,addresses[1]);
  for(const changed of [{...review,chainId:56},{...review,vaultAddress:addresses[7]}])await expect(chain.executeCustomerStatus(selected,{review:changed,active:true,kyc:false},vi.fn())).rejects.toThrow('contract changed');
  await expect(chain.executeCustomerStatus(selected,{review:{...review,operator:addresses[3]},active:true,kyc:false},vi.fn())).rejects.toThrow('administrator wallet changed');expect(writes).toEqual([]);
 });
 it('requires a fresh review when customer flags changed after loading or after simulation',async()=>{
  const review=await chain.readCustomerStatus(selected,addresses[1]);afterSimulation='status';
  await expect(chain.executeCustomerStatus(selected,{review,active:true,kyc:false},vi.fn())).rejects.toThrow('Customer status changed after review');expect(writes).toEqual([]);
  await expect(chain.executeCustomerStatus(selected,{review,active:false,kyc:true},vi.fn())).rejects.toThrow('Customer status changed after review');expect(writes).toEqual([]);
 });
 it('rejects a wallet change after simulation and propagates failed permission reads without sending',async()=>{
  const review=await chain.readCustomerStatus(selected,addresses[1]);afterSimulation='wallet';
  await expect(chain.executeCustomerStatus(selected,{review,active:true,kyc:false},vi.fn())).rejects.toThrow('account changed');expect(writes).toEqual([]);
  selected=fast.owner;rejectRoleRead=true;await expect(chain.executeCustomerStatus(selected,{review,active:true,kyc:false},vi.fn())).rejects.toMatchObject({code:'CALL_EXCEPTION'});expect(writes).toEqual([]);
 });
});
