import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Interface,ZeroAddress,parseEther} from 'ethers';

const state=vi.hoisted(()=>({
 allowance:0n,balance:100000000000000000000n,registered:false,paused:false,
 referrerRegistered:false,storedReferrer:'',suspended:false,vipKyc:false,capital:0n,
 failSessionAt:0,sessionCount:0,failSimulation:false,failSimulationName:'',approvalStatus:1,
 readToken:null as any,writeToken:null as any,readVault:null as any,writeVault:null as any,
 verifiedProvider:null as any,signer:null as any,receipt:null as any, lastTx:null as any, sendFailure:null as any, receiptMode:'ok', txMutation:null as any,
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

import {V3_ABI,V3_TEST_TOKEN_ABI,v3ReadSession} from '../src/v3-chain';
import {sendV3Action,sendV3TestTokenDeposit} from '../src/v3-actions';

const wallet='0x1000000000000000000000000000000000000001';
const vault='0x2000000000000000000000000000000000000002';
const amount=parseEther('10');
const config={address:vault,runtimeHash:'0x'+'1'.repeat(64),deploymentTx:'0x'+'2'.repeat(64)};
const provider={request:vi.fn(async({method}:{method:string})=>method==='eth_accounts'?[wallet]:method==='eth_chainId'?'0x61':undefined)};
const simulated=(name:string)=>Object.assign(vi.fn(),{
 staticCall:vi.fn(async()=>{state.reads.push(name+':static');if(state.failSimulation||state.failSimulationName===name)throw Error('SIMULATION_FAILED');return true;}),
 estimateGas:vi.fn(async()=>{state.reads.push(name+':estimate');return 100000n;})
});

beforeEach(()=>{
 vi.mocked(v3ReadSession).mockClear();
 state.allowance=0n;state.balance=parseEther('100');state.registered=false;state.paused=false;
 state.referrerRegistered=false;state.storedReferrer=ZeroAddress;state.suspended=false;state.vipKyc=false;state.capital=0n;
 state.failSessionAt=0;state.sessionCount=0;state.failSimulation=false;state.failSimulationName='';state.approvalStatus=1;
 provider.request.mockImplementation(async({method}:{method:string})=>method==='eth_accounts'?[wallet]:method==='eth_chainId'?'0x61':undefined);
 state.approvalSends=[];state.depositSends=[];state.registerSends=[];state.reads=[];
 const i=new Interface(V3_ABI);
 const event=i.encodeEventLog(i.getEvent('DepositRouted')!,[wallet,0,amount,amount/10n,amount/10n,amount*8n/10n]);
 const hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64);
 state.receipt={status:1,hash,from:wallet,to:vault,blockNumber:101,blockHash,logs:[{address:vault,...event}]};
 state.lastTx=null;state.sendFailure=null;state.receiptMode='ok';state.txMutation=null;
 state.signer={kind:'signer',sendUncheckedTransaction:vi.fn(async(tx:any)=>{
  if(state.sendFailure)throw state.sendFailure;
  state.lastTx={...tx,chainId:97n,hash,from:wallet};
  const token=String(tx.to).toLowerCase()==='0x000cdf5f6e3b4761721a5f76205bae6c8523ab89';
  const parsed=new Interface(token?V3_TEST_TOKEN_ABI:V3_ABI).parseTransaction({data:tx.data});
  if(parsed?.name==='approve')state.approvalSends.push(BigInt(parsed.args[1]));
  if(parsed?.name==='deposit')state.depositSends.push([parsed.args[0],parsed.args[1],{gasLimit:tx.gasLimit}]);
  if(parsed?.name==='register')state.registerSends.push([parsed.args[0],{gasLimit:tx.gasLimit}]);
  return state.receiptMode==='bad-hash'?'0xnot-a-hash':hash;
 })};
 state.verifiedProvider={kind:'verified',destroy:vi.fn(),
  getFeeData:vi.fn(async()=>({gasPrice:250000000n})),
  getBlock:vi.fn(async(tag:any)=>tag==='latest'?{gasLimit:30000000n}:{hash:blockHash}),
  getBlockNumber:vi.fn(async()=>105),
  getTransaction:vi.fn(async()=>state.receiptMode==='missing-tx'?null:state.txMutation?state.txMutation(state.lastTx):state.lastTx),
  getTransactionReceipt:vi.fn(async()=>{
   if(state.receiptMode==='timeout')throw Error('RPC_UNAVAILABLE');
   if(state.receiptMode==='missing-receipt')return null;
   const last=state.lastTx;
   if(last?.to?.toLowerCase()==='0x000cdf5f6e3b4761721a5f76205bae6c8523ab89'){
    const parsed=new Interface(V3_TEST_TOKEN_ABI).parseTransaction({data:last.data});
    if(state.approvalStatus===1&&state.receiptMode!=='no-allowance')state.allowance=BigInt(parsed!.args[1]);
   }
   return {...state.receipt,to:last.to,status:state.approvalSends.length&&last.to.toLowerCase()==='0x000cdf5f6e3b4761721a5f76205bae6c8523ab89'?state.approvalStatus:1};
  })};
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
  users:vi.fn(async(address:string)=>address.toLowerCase()===wallet.toLowerCase()?
   {registered:state.registered,referrer:state.storedReferrer,suspended:state.suspended,vipKyc:state.vipKyc,capital:state.capital}:
   {registered:state.referrerRegistered}),
  deposit:depositRead,register:registerRead,
  getFunction:vi.fn((name:string)=>name==='deposit'?depositRead:name==='register'?registerRead:undefined)
 };

});

describe('V3 verified transaction reads',()=>{
 it('rejects an unregistered referrer before requesting any token approval',async()=>{
  const referrer='0x3000000000000000000000000000000000000003';
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,referrer,config))
   .rejects.toThrow('referrer is not registered on this V3 test contract');
  expect(state.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  expect(state.readVault.users).toHaveBeenCalledWith(referrer,expect.objectContaining({blockTag:99}));
 });
 it('accepts a referrer registered on this test contract',async()=>{
  state.referrerRegistered=true;
  const referrer='0x3000000000000000000000000000000000000003';
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,referrer,config)).resolves.toBe(state.receipt.hash);
  expect(state.approvalSends).toEqual([amount]);
  expect(state.depositSends[0][1]).toBe(referrer);
 });
 it('rejects a different permanent referrer before any wallet transaction',async()=>{
  state.registered=true;
  state.storedReferrer='0x3000000000000000000000000000000000000003';
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config))
   .rejects.toThrow('does not match this account’s permanent referrer');
  expect(state.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
 });
 it('accepts the existing permanent referrer for a registered account',async()=>{
  state.registered=true;
  state.storedReferrer='0x3000000000000000000000000000000000000003';
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,state.storedReferrer,config)).resolves.toBe(state.receipt.hash);
 });
 it('rechecks the referrer after an approval before sending a deposit',async()=>{
  const referrer='0x3000000000000000000000000000000000000003';
  state.readVault.users.mockImplementation(async(address:string)=>address.toLowerCase()===wallet.toLowerCase()?
   {registered:false,referrer:ZeroAddress,suspended:false,vipKyc:false,capital:0n}:
   {registered:state.approvalSends.length===0});
  const message=await sendV3TestTokenDeposit(provider as any,wallet,amount,referrer,config).catch(e=>e.message);
  expect(message).toContain('referrer is not registered');
  expect(message).toContain('Last token approval/reset:');
  expect(state.approvalSends).toEqual([amount]);
  expect(state.depositSends).toEqual([]);
 });
 it('rejects a suspended account or a VIP-restricted deposit before any wallet transaction',async()=>{
  state.suspended=true;
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('suspended');
  state.suspended=false;state.capital=parseEther('49995');
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('VIP verification');
  expect(state.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
 });
 it('allows the exact VIP threshold without requiring VIP verification',async()=>{
  state.capital=parseEther('49990');
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).resolves.toBe(state.receipt.hash);
 });
 it('explains Invalid() during deposit simulation without revealing raw RPC payload',async()=>{
  state.allowance=amount;
  state.readVault.deposit.staticCall.mockRejectedValue({data:'0x6dac6a09',message:'sensitive URL'});
  const message=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(message).toContain('rejected during simulation');
  expect(message).toContain('no deposit was sent');
  expect(message).not.toContain('sensitive URL');
  expect(state.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
 });
 it('reads allowance and simulates against the verified provider before sending approval and deposit',async()=>{
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).resolves.toBe(state.receipt.hash);
  expect(state.approvalSends).toEqual([amount]);
  expect(state.depositSends).toHaveLength(1);
  expect(state.signer.sendUncheckedTransaction).toHaveBeenCalledWith(expect.objectContaining({to:'0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89',gasLimit:125000n,gasPrice:250000000n}));
  expect(state.depositSends[0]).toEqual([amount,ZeroAddress,{gasLimit:125000n}]);
  expect(state.reads.filter(x=>x==='allowance').length).toBeGreaterThanOrEqual(2);
  expect(state.reads).toContain('deposit:static');
  expect(state.readVault.deposit.staticCall).toHaveBeenCalledWith(amount,ZeroAddress,expect.objectContaining({from:wallet}));
  expect(vi.mocked(v3ReadSession).mock.calls.every(call=>call[3]===true)).toBe(true);
 });
 it('resets a nonzero allowance before setting the exact new amount',async()=>{
  state.allowance=1n;
  await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config);
  expect(state.approvalSends).toEqual([0n,amount]);
  expect(state.depositSends).toHaveLength(1);
 });
 it('does not send a deposit if the confirmed allowance is still insufficient',async()=>{
  state.receiptMode='no-allowance';
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
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('could not be independently confirmed');
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
 it.each([null,0n,100000000001n])('does not send when testnet gas price is invalid or excessive: %s',async(price)=>{
  state.verifiedProvider.getFeeData.mockResolvedValue({gasPrice:price});
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow(/gas price|gas fee/);
  expect(state.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
 });
 it('does not send when network gas price cannot be read',async()=>{
  state.verifiedProvider.getFeeData.mockRejectedValue(Error('PRIVATE_RPC_ERROR'));
  const message=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(message).toContain('Unable to verify the TESTNET gas price');
  expect(message).not.toContain('PRIVATE_RPC_ERROR');
  expect(state.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
 });
 it('rejects an excessive total testnet transaction fee even when the gas price is within its cap',async()=>{
  state.readToken.approve.estimateGas.mockResolvedValue(1000000n);
  state.verifiedProvider.getFeeData.mockResolvedValue({gasPrice:100000000000n});
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('gas fee exceeds');
  expect(state.signer.sendUncheckedTransaction).not.toHaveBeenCalled();
 });
 it('does not proceed when the approval broadcast has an unknown outcome',async()=>{
  state.sendFailure=Error('RPC_BROADCAST_UNCERTAIN');
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('Check your wallet transaction history before retrying');
  expect(state.depositSends).toHaveLength(0);
 });
 it('reports a validated hash when a wallet broadcast error contains one, without sending a deposit',async()=>{
  const hash='0x'+'c'.repeat(64);
  state.sendFailure={code:'NETWORK_ERROR',info:{sendTransactionHash:hash}};
  const updates:any[]=[];
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config,update=>updates.push(update))).rejects.toThrow(hash);
  expect(updates.at(-1)).toEqual({step:'verification',action:'token_approval',hash});
  expect(state.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(1);
  expect(state.depositSends).toHaveLength(0);
 });
 it('does not expose an invalid hash from a wallet error',async()=>{
  state.sendFailure={code:'NETWORK_ERROR',info:{sendTransactionHash:'0xunsafe'}};
  const updates:any[]=[];
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config,update=>updates.push(update))).rejects.toThrow('Check your wallet transaction history');
  expect(updates.at(-1)).toEqual({step:'wallet_request',action:'token_approval'});
  expect(state.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(1);
 });
 it('checks actual transaction intent against the independent reader',async()=>{
  state.txMutation=(tx:any)=>({...tx,data:'0x1234'});
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow();
  expect(state.approvalSends).toEqual([amount]);
  expect(state.depositSends).toHaveLength(0);
 });
 it.each([
  ['wrong account',(tx:any)=>({...tx,from:'0x3000000000000000000000000000000000000003'})],
  ['wrong target',(tx:any)=>({...tx,to:'0x3000000000000000000000000000000000000003'})],
  ['wrong chain',(tx:any)=>({...tx,chainId:56n})],
  ['native value',(tx:any)=>({...tx,value:1n})]
 ])('rejects a confirmed transaction with %s',async(_label,mutation)=>{
  state.txMutation=mutation;
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('independently confirmed');
  expect(state.approvalSends).toEqual([amount]);
  expect(state.depositSends).toHaveLength(0);
 });
 it('rejects a chain reorganization even after enough confirmations',async()=>{
  state.verifiedProvider.getBlock.mockImplementation(async(tag:any)=>tag==='latest'?{gasLimit:30000000n}:{hash:'0x'+'c'.repeat(64)});
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('independently confirmed');
  expect(state.depositSends).toHaveLength(0);
 });
 it('stops if the confirmation depth drops before final validation',async()=>{
  state.verifiedProvider.getBlockNumber.mockResolvedValueOnce(105).mockResolvedValue(104);
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow('independently confirmed');
  expect(state.depositSends).toHaveLength(0);
 });
 it('stops on missing confirmed transaction data and preserves its hash',async()=>{
  state.receiptMode='missing-tx';
  const message=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(message).toContain('0x'+'a'.repeat(64));
  expect(state.depositSends).toHaveLength(0);
 });
 it('stops when the verified receipt cannot be read',async()=>{
  state.receiptMode='timeout';
  const message=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(message).toContain('0x'+'a'.repeat(64));
  expect(state.depositSends).toHaveLength(0);
 });
 it('preserves the approval hash if independent verification becomes unavailable after submission',async()=>{
  state.failSessionAt=3;
  const message=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(message).toContain('0x'+'a'.repeat(64));
  expect(message).toContain('receipt before retrying');
  expect(state.approvalSends).toEqual([amount]);
  expect(state.depositSends).toHaveLength(0);
 });
 it('rejects an invalid wallet transaction hash without continuing',async()=>{
  state.receiptMode='bad-hash';
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config)).rejects.toThrow();
  expect(state.depositSends).toHaveLength(0);
 });
 it('retains the validated ethers broadcast hash without copying raw error details',async()=>{
  const hash='0x'+'b'.repeat(64);
  state.sendFailure={code:'NETWORK_ERROR',info:{sendTransactionHash:hash},message:'sensitive RPC URL'};
  const result=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(result).toContain(hash);
  expect(result).toContain('NETWORK_ERROR');
  expect(result).toContain('Check its receipt before retrying');
  expect(result).not.toContain('sensitive RPC URL');
  expect(state.depositSends).toHaveLength(0);
 });
 it('does not display malformed hash data or unknown wallet error details',async()=>{
  state.sendFailure={code:'SECRET_CODE',info:{sendTransactionHash:'0xsecret'},message:'secret RPC token'};
  const result=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(result).toContain('Check your wallet transaction history before retrying');
  expect(result).not.toContain('secret');
  expect(result).not.toContain('SECRET_CODE');
  expect(state.depositSends).toHaveLength(0);
 });
 it('reports a whitelisted nested wallet code without leaking message or payload and never retries',async()=>{
  state.sendFailure={code:'UNKNOWN_ERROR',error:{code:-32000,message:'provider secret RPC token'},payload:{secret:'must-not-appear'}};
  const result=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(result).toContain('code UNKNOWN_ERROR; wallet code -32000');
  expect(result).toContain('Check your wallet transaction history before retrying');
  expect(result).not.toContain('secret');
  expect(result).not.toContain('payload');
  expect(state.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(1);
  expect(state.depositSends).toHaveLength(0);
 });
 it('recognizes a nested gas warning using fixed wording only',async()=>{
  state.sendFailure={code:'UNKNOWN_ERROR',info:{error:{code:-32000,message:'not enough to pay for miners SECRET'}}};
  const result=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(result).toContain('Wallet reports insufficient funds for gas.');
  expect(result).not.toContain('SECRET');
  expect(state.signer.sendUncheckedTransaction).toHaveBeenCalledTimes(1);
 });
 it('does not expose unknown nested wallet codes or messages',async()=>{
  state.sendFailure={code:'UNKNOWN_ERROR',error:{code:123456,message:'secret custom response'}};
  const result=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(result).not.toContain('123456');
  expect(result).not.toContain('secret');
  expect(result).toContain('Check your wallet transaction history before retrying');
 });
 it('preserves a clear declined status without exposing the wallet error message',async()=>{
  state.sendFailure={code:4001,message:'sensitive wallet details'};
  const result=await sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config).catch(e=>e.message);
  expect(result).toBe('USDT token approval was declined in your wallet.');
  expect(state.depositSends).toHaveLength(0);
 });
 it('treats a known hash as uncertain even when the wallet also reports rejection',async()=>{
  const hash='0x'+'c'.repeat(64);
  state.sendFailure={code:'ACTION_REJECTED',info:{sendTransactionHash:hash}};
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
 it('reports registration steps only when each step is reached',async()=>{
  const steps:any[]=[];
  await sendV3Action(provider as any,wallet,{kind:'register',referrer:ZeroAddress},config,step=>steps.push(step));
  expect(steps.map(step=>step.step)).toEqual(['preflight','simulation','wallet_request','verification','confirmed']);
  expect(steps[3].hash).toMatch(/^0x[0-9a-f]{64}$/);
  expect(steps[4].hash).toBe(steps[3].hash);
 });
 it('does not report a wallet request when testnet simulation fails',async()=>{
  const steps:any[]=[];state.failSimulation=true;
  await expect(sendV3TestTokenDeposit(provider as any,wallet,amount,ZeroAddress,config,step=>steps.push(step))).rejects.toThrow('SIMULATION_FAILED');
  expect(steps.map(step=>step.step)).toEqual(['preflight','simulation']);
  expect(state.approvalSends).toHaveLength(0);
 });
 it('keeps the transaction flow independent of presentation callback errors',async()=>{
  await expect(sendV3Action(provider as any,wallet,{kind:'register',referrer:ZeroAddress},config,()=>{throw Error('UI_FAILURE');})).resolves.toBe(state.receipt.hash);
  expect(state.registerSends).toHaveLength(1);
 });
});
