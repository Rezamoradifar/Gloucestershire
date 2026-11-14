import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Interface,ZeroAddress,parseEther} from 'ethers';

const state=vi.hoisted(()=>({
 allowance:0n,balance:100000000000000000000n,registered:false,paused:false,
 failSessionAt:0,sessionCount:0,failSimulation:false,failSimulationName:'',approvalStatus:1,
 readToken:null as any,writeToken:null as any,readVault:null as any,writeVault:null as any,
 verifiedProvider:null as any,signer:{kind:'signer'},receipt:null as any,
 approvalSends:[] as bigint[],depositSends:[] as any[],registerSends:[] as any[],reads:[] as string[]
}));
vi.mock('ethers',async(importOriginal)=>{
 const real=await importOriginal<typeof import('ethers')>();
 class BrowserProvider {
  async getSigner(){return state.signer;}
  destroy(){}
 }
 class Contract {
  constructor(address:string,_abi:unknown,runner:any){
   const token=address.toLowerCase()==='0x000cdf5f6e3b4761721a5f76205bae6c8523ab89';
   if(runner?.kind==='verified')return token?state.readToken:state.readVault;
   if(runner?.kind==='signer')return token?state.writeToken:state.writeVault;
   throw Error('UNEXPECTED_CONTRACT_RUNNER');
  }
 }
 return {...real,BrowserProvider,Contract};
});
vi.mock('../src/v3-chain',async(importOriginal)=>{
 const real=await importOriginal<typeof import('../src/v3-chain')>();
 return {...real,v3ReadSession:vi.fn(async()=>{
  state.sessionCount++;
  if(state.sessionCount===state.failSessionAt)throw Error('WALLET_ACCOUNT_CHANGED');
  return {provider:state.verifiedProvider,vault:state.readVault,options:{blockTag:99},block:{number:99}};
 })};
});

import {V3_ABI} from '../src/v3-chain';
import {sendV3Action,sendV3TestTokenDeposit} from '../src/v3-actions';

const wallet='0x1000000000000000000000000000000000000001';
const vault='0x2000000000000000000000000000000000000002';
const amount=parseEther('10');
const config={address:vault,runtimeHash:'0x'+'1'.repeat(64),deploymentTx:'0x'+'2'.repeat(64)};
const provider={request:vi.fn(async({method}:{method:string})=>method==='eth_accounts'?[wallet]:method==='eth_chainId'?'0x61':undefined)};
const tx=(onConfirmed:()=>void=()=>{},approval=false)=>({hash:'0x'+'a'.repeat(64),wait:vi.fn(async(confirmations:number)=>{
 expect(confirmations).toBe(5);if(!approval||state.approvalStatus===1)onConfirmed();
 return approval?{...state.receipt,status:state.approvalStatus}:state.receipt;
})});
const simulated=(name:string)=>Object.assign(vi.fn(),{
 staticCall:vi.fn(async()=>{state.reads.push(name+':static');if(state.failSimulation||state.failSimulationName===name)throw Error('SIMULATION_FAILED');return true;}),
 estimateGas:vi.fn(async()=>{state.reads.push(name+':estimate');return 100000n;})
});

beforeEach(()=>{
 state.allowance=0n;state.balance=parseEther('100');state.registered=false;state.paused=false;
 state.failSessionAt=0;state.sessionCount=0;state.failSimulation=false;state.failSimulationName='';state.approvalStatus=1;
 provider.request.mockImplementation(async({method}:{method:string})=>method==='eth_accounts'?[wallet]:method==='eth_chainId'?'0x61':undefined);
 state.approvalSends=[];state.depositSends=[];state.registerSends=[];state.reads=[];
 const i=new Interface(V3_ABI);
 const event=i.encodeEventLog(i.getEvent('DepositRouted')!,[wallet,0,amount,amount/10n,amount/10n,amount*8n/10n]);
 state.receipt={status:1,hash:'0x'+'a'.repeat(64),logs:[{address:vault,...event}]};
 state.verifiedProvider={kind:'verified',destroy:vi.fn(),getBlock:vi.fn(async()=>({gasLimit:30000000n}))};
 const approveRead=simulated('approve');
 const depositRead=simulated('deposit');
 const registerRead=simulated('register');
 state.readToken={
  balanceOf:vi.fn(async()=>{state.reads.push('balance');return state.balance;}),
  allowance:vi.fn(async()=>{state.reads.push('allowance');return state.allowance;}),approve:approveRead,
  getFunction:vi.fn((name:string)=>name==='approve'?approveRead:undefined)
 };
 state.readVault={
  paused:vi.fn(async()=>state.paused),
  users:vi.fn(async()=>({registered:state.registered})),
  deposit:depositRead,register:registerRead,
  getFunction:vi.fn((name:string)=>name==='deposit'?depositRead:name==='register'?registerRead:undefined)
 };
 state.writeToken={approve:vi.fn(async(_to:string,value:bigint)=>{
  state.approvalSends.push(value);
  return tx(()=>{state.allowance=value;},true);
 })};
 state.writeVault={
  deposit:vi.fn(async(...args:any[])=>{state.depositSends.push(args);return tx();}),
  register:vi.fn(async(...args:any[])=>{state.registerSends.push(args);return tx();}),
  getFunction:vi.fn((name:string)=>name==='deposit'?state.writeVault.deposit:state.writeVault.register)
 };
});

describe('V3 verified transaction reads',()=>{
 it('reads allowance and simulates against the verified provider before sending approval and deposit',async()=>{
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).resolves.toBe(state.receipt.hash);
  expect(state.approvalSends).toEqual([amount]);
  expect(state.depositSends).toHaveLength(1);
  expect(state.writeToken.approve).toHaveBeenCalledWith(vault,amount,{gasLimit:125000n});
  expect(state.depositSends[0]).toEqual([amount,ZeroAddress,{gasLimit:125000n}]);
  expect(state.reads.filter(x=>x==='allowance').length).toBeGreaterThanOrEqual(2);
  expect(state.reads).toContain('deposit:static');
  expect(state.readVault.deposit.staticCall).toHaveBeenCalledWith(amount,ZeroAddress,expect.objectContaining({from:wallet}));
 });
 it('resets a nonzero allowance before setting the exact new amount',async()=>{
  state.allowance=1n;
  await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config);
  expect(state.approvalSends).toEqual([0n,amount]);
  expect(state.depositSends).toHaveLength(1);
 });
 it('does not send a deposit if the confirmed allowance is still insufficient',async()=>{
  state.writeToken.approve=vi.fn(async()=>{state.approvalSends.push(amount);return tx();});
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow();
  expect(state.approvalSends).toHaveLength(1);
  expect(state.depositSends).toHaveLength(0);
 });
 it('stops before a wallet transaction when verified simulation fails',async()=>{
  state.failSimulation=true;
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('SIMULATION_FAILED');
  expect(state.approvalSends).toHaveLength(0);
  expect(state.depositSends).toHaveLength(0);
 });
 it('does not deposit when approval receipt fails',async()=>{
  state.approvalStatus=0;
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('not confirmed');
  expect(state.approvalSends).toEqual([amount]);
  expect(state.depositSends).toHaveLength(0);
 });
 it('does not deposit when its simulation fails after an approval',async()=>{
  state.failSimulationName='deposit';
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('SIMULATION_FAILED');
  expect(state.approvalSends).toEqual([amount]);
  expect(state.depositSends).toHaveLength(0);
 });
 it('does not send if wallet switches to a different chain',async()=>{
  provider.request.mockImplementation(async({method}:{method:string})=>method==='eth_accounts'?[wallet]:method==='eth_chainId'?'0x38':undefined);
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('Wallet account or BNB Testnet changed');
  expect(state.approvalSends).toHaveLength(0);
  expect(state.depositSends).toHaveLength(0);
 });
 it('does not send if the wallet account changes',async()=>{
  provider.request.mockImplementation(async({method}:{method:string})=>method==='eth_accounts'?[]:method==='eth_chainId'?'0x61':undefined);
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('Wallet account or BNB Testnet changed');
  expect(state.approvalSends).toHaveLength(0);
  expect(state.depositSends).toHaveLength(0);
 });
 it('rejects an excessive gas estimate before any wallet action',async()=>{
  state.readToken.approve.estimateGas.mockResolvedValue(8000000n);
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('gas limit');
  expect(state.approvalSends).toHaveLength(0);
  expect(state.depositSends).toHaveLength(0);
 });
 it('does not proceed when the approval broadcast has an unknown outcome',async()=>{
  state.writeToken.approve.mockRejectedValue(Error('RPC_BROADCAST_UNCERTAIN'));
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('Check your wallet transaction history before retrying');
  expect(state.depositSends).toHaveLength(0);
 });
 it('retains the validated ethers broadcast hash without copying raw error details',async()=>{
  const hash='0x'+'b'.repeat(64);
  state.writeToken.approve.mockRejectedValue({code:'NETWORK_ERROR',info:{sendTransactionHash:hash},message:'sensitive RPC URL'});
  const result=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(result).toContain(hash);
  expect(result).toContain('NETWORK_ERROR');
  expect(result).toContain('Check its receipt before retrying');
  expect(result).not.toContain('sensitive RPC URL');
  expect(state.depositSends).toHaveLength(0);
 });
 it('does not display malformed hash data or unknown wallet error details',async()=>{
  state.writeToken.approve.mockRejectedValue({code:'SECRET_CODE',info:{sendTransactionHash:'0xsecret'},message:'secret RPC token'});
  const result=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(result).toContain('Check your wallet transaction history before retrying');
  expect(result).not.toContain('secret');
  expect(result).not.toContain('SECRET_CODE');
  expect(state.depositSends).toHaveLength(0);
 });
 it('preserves a clear declined status without exposing the wallet error message',async()=>{
  state.writeToken.approve.mockRejectedValue({code:4001,message:'sensitive wallet details'});
  const result=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(result).toBe('TEST token approval was declined in your wallet.');
  expect(state.depositSends).toHaveLength(0);
 });
 it('treats a known hash as uncertain even when the wallet also reports rejection',async()=>{
  const hash='0x'+'c'.repeat(64);
  state.writeToken.approve.mockRejectedValue({code:'ACTION_REJECTED',info:{sendTransactionHash:hash}});
  const result=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(result).toContain(hash);
  expect(result).toContain('Check its receipt before retrying');
  expect(state.depositSends).toHaveLength(0);
 });
 it('stops before sending if the verified account session changes',async()=>{
  state.failSessionAt=2;
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('WALLET_ACCOUNT_CHANGED');
  expect(state.depositSends).toHaveLength(0);
 });
 it('simulates registration against verified provider before wallet sends',async()=>{
  await expect(sendV3Action(provider as any,wallet,{kind:'register',referrer:ZeroAddress},config)).resolves.toBe(state.receipt.hash);
  expect(state.readVault.register.staticCall).toHaveBeenCalledWith(ZeroAddress,expect.objectContaining({from:wallet}));
  expect(state.registerSends).toHaveLength(1);
  expect(state.registerSends[0]).toEqual([ZeroAddress,{gasLimit:125000n}]);
 });
});
