import {describe,it,expect,vi} from 'vitest';
import ganache from 'ganache';
import fs from 'node:fs';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,parseEther,keccak256} from 'ethers';
import {compileHourly} from '../../scripts/compile-global-v3-hourly-testnet.mjs';

// The chain reader is replaced with a local EVM-backed session. Contract calls,
// simulated gas estimation, wallet signing and receipts use real ethers objects.
const g=vi.hoisted(()=>({eip:null as any}));
vi.mock('../src/v3-chain',async(importOriginal)=>{
 const real=await importOriginal<typeof import('../src/v3-chain')>();
 const {BrowserProvider,Contract}=await import('ethers');
 return {...real,v3ReadSession:async(_wallet:any,_who:any,config:any)=>{
  const provider=new BrowserProvider(g.eip,undefined,{cacheTimeout:-1});
  provider.pollingInterval=20;
  const height=Number(BigInt(await g.eip.request({method:'eth_blockNumber',params:[]})));
  const block=await provider.getBlock(height-3);
  return {provider,vault:new Contract(config.address,real.V3_ABI,provider),options:{blockTag:height-3},block};
 }};
});
import {sendV3Action,sendV3TestTokenDeposit} from '../src/v3-actions';

describe('V3 wallet read RPC isolation on a local EVM',()=>{
 it('registers, deposits and manages groups using verified read calls',async()=>{
  const previous=process.cwd();
  let artifact;
  try{process.chdir('..');artifact=compileHourly();}finally{process.chdir(previous);}
  const mock='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
  const tokenArtifact=JSON.parse(fs.readFileSync('../artifacts/MockToken.json','utf8'));
  const eip=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000},wallet:{totalAccounts:5,defaultBalance:50}});
  g.eip=eip;
  const rpc=new BrowserProvider(eip as any,undefined,{cacheTimeout:-1});
  rpc.pollingInterval=20;
  try{
   const owner=await rpc.getSigner(0),user=await rpc.getSigner(1),wallet=await user.getAddress();
   const tk=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,owner).deploy(18);
   await tk.waitForDeployment();
   await eip.request({method:'evm_setAccountCode',params:[mock,await rpc.getCode(await tk.getAddress())]});
   const token=new Contract(mock,tokenArtifact.abi,owner);
   const factory=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,owner);
   const vault=await factory.deploy('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632',mock,'0x74015dedf36677485793f1714ec7bd4893907b26');
   await vault.waitForDeployment();
   // A sponsor on a separate older deployment is not a sponsor here.
   const older=await factory.deploy('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632',mock,'0x74015dedf36677485793f1714ec7bd4893907b26');
   await older.waitForDeployment();
   const oldReferrer=await owner.getAddress();
   await (await older.getFunction('register')(ZeroAddress)).wait();
   await (await token.mint(wallet,parseEther('100'))).wait();
   await (await token.connect(user).getFunction('approve')(await vault.getAddress(),1n)).wait();
   for(let i=0;i<6;i++)await eip.request({method:'evm_mine',params:[]});
   const address=await vault.getAddress();
   const config={address,runtimeHash:keccak256(await rpc.getCode(address)),deploymentTx:vault.deploymentTransaction()!.hash};
   const denied:string[]=[],sent:string[]=[];
   const walletProvider={request:async({method,params}:any)=>{
    if(['eth_call','eth_estimateGas','eth_getTransactionByHash','eth_getTransactionReceipt'].includes(method)){
     denied.push(method);throw Error('WALLET_READ_RPC_BLOCKED');
    }
    if(method==='eth_accounts'||method==='eth_requestAccounts')return [wallet];
    const result=await eip.request({method,params:params||[]});
    if(method==='eth_sendTransaction'){
     sent.push(String(result));
     for(let i=0;i<6;i++)await eip.request({method:'evm_mine',params:[]});
    }
    return result;
   }};
   expect((await older.users(oldReferrer)).registered).toBe(true);
   expect((await vault.users(oldReferrer)).registered).toBe(false);
   await expect(sendV3TestTokenDeposit(walletProvider as any,wallet,parseEther('10'),oldReferrer,config))
    .rejects.toThrow('referrer is not registered on this V3 test contract');
   expect(sent).toEqual([]);
   expect(await token.allowance(wallet,address)).toBe(1n);
   const registration=await sendV3Action(walletProvider as any,wallet,{kind:'register',referrer:ZeroAddress},config);
   expect(registration).toMatch(/^0x[0-9a-f]{64}$/);
   expect((await vault.users(wallet)).registered).toBe(true);
   const deposit=await sendV3TestTokenDeposit(walletProvider as any,wallet,parseEther('10'),ZeroAddress,config);
   expect(deposit).toMatch(/^0x[0-9a-f]{64}$/);
   expect(await vault.positionCount(wallet)).toBe(1n);
   expect((await vault.positionOf(wallet,0)).principal).toBe(parseEther('10'));
   expect(await token.allowance(wallet,address)).toBe(0n);
   expect(sent).toHaveLength(4); // registration, reset, approval, deposit
   // An already grouped branch must never be submitted again. An available
   // direct branch can be added through a wallet that cannot perform reads.
   const branchOne=await rpc.getSigner(2),branchTwo=await rpc.getSigner(3);
   const first=await branchOne.getAddress(),second=await branchTwo.getAddress();
   await (await vault.connect(branchOne).getFunction('register')(wallet)).wait();
   await (await vault.connect(branchTwo).getFunction('register')(wallet)).wait();
   await (await vault.connect(user).getFunction('createRewardGroup')([first])).wait();
   for(let i=0;i<6;i++)await eip.request({method:'evm_mine',params:[]});
   await expect(sendV3Action(walletProvider as any,wallet,{kind:'createRewardGroup',branches:[first,second]},config))
    .rejects.toThrow('already in a reward group');
   expect(sent).toHaveLength(4);
   const groupHash=await sendV3Action(walletProvider as any,wallet,{kind:'addRewardBranches',group:0,branches:[second]},config);
   expect(groupHash).toMatch(/^0x[0-9a-f]{64}$/);
   expect(await vault.groupedBranch(wallet,second)).toBe(true);
   expect(sent).toHaveLength(5);
   const branchThree=await rpc.getSigner(4),third=await branchThree.getAddress();
   await (await vault.connect(branchThree).getFunction('register')(wallet)).wait();
   for(let i=0;i<6;i++)await eip.request({method:'evm_mine',params:[]});
   const newGroup=await sendV3Action(walletProvider as any,wallet,{kind:'createRewardGroup',branches:[third]},config);
   expect(newGroup).toMatch(/^0x[0-9a-f]{64}$/);
   expect(await vault.rewardGroupCount(wallet)).toBe(2n);
   expect(await vault.groupedBranch(wallet,third)).toBe(true);
   expect(sent).toHaveLength(6);
   expect(denied).toEqual([]);
  }finally{rpc.destroy();await (eip as any).disconnect();}
 },120000);
});
