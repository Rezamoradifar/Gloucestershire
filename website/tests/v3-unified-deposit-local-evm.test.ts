import {describe,expect,it,vi} from 'vitest';
import ganache from 'ganache';
import fs from 'node:fs';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,keccak256,parseEther} from 'ethers';
import {compileUnifiedTestnet} from '../../scripts/compile-global-v3-unified-testnet.mjs';

const shared=vi.hoisted(()=>({rpc:null as any}));
vi.mock('ethers',async importOriginal=>{
 const real=await importOriginal<typeof import('ethers')>();
 class LocalReader extends real.BrowserProvider{
  constructor(){super(shared.rpc,undefined,{cacheTimeout:-1});this.pollingInterval=20;}
 }
 return {...real,JsonRpcProvider:LocalReader};
});

describe('explicitly enabled unified testnet registration and deposit adapters',()=>{
 it('preserves the preview guard and verifies local registration, exact approvals and routed deposits',async()=>{
  vi.stubEnv('VITE_V3_HOURLY_TEST','isolated-1h');
  const {sendV3Action,sendV3TestTokenDeposit,sendV3UnifiedRegistration,sendV3UnifiedTestTokenDeposit}=await import('../src/v3-actions');
  const previous=process.cwd();let artifact;
  try{process.chdir('..');artifact=compileUnifiedTestnet().GlobalV3UnifiedTestnet;}finally{process.chdir(previous);}
  const mock='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
  const manager='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
  const fee='0x74015dedf36677485793f1714ec7bd4893907b26';
  const tokenArtifact=JSON.parse(fs.readFileSync('../artifacts/MockToken.json','utf8'));
  const eip=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
   miner:{blockGasLimit:30000000},wallet:{totalAccounts:4,defaultBalance:50}});
  shared.rpc=eip;
  const rpc=new BrowserProvider(eip as any,undefined,{cacheTimeout:-1});rpc.pollingInterval=20;
  try{
   const deployer=await rpc.getSigner(0),user=await rpc.getSigner(1),second=await rpc.getSigner(2);
   const wallet=await user.getAddress(),secondWallet=await second.getAddress(),unregistered=await deployer.getAddress();
   const original=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,deployer).deploy(18);
   await original.waitForDeployment();
   await eip.request({method:'evm_setAccountCode',params:[mock,await rpc.getCode(await original.getAddress())]});
   const token=new Contract(mock,tokenArtifact.abi,deployer);
   const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,deployer)
    .deploy(manager,mock,fee,{gasLimit:25000000});
   await vault.waitForDeployment();
   const address=await vault.getAddress(),book=await vault.reinvestmentBook(),network=await vault.networkPlan();
   const config={address,runtimeHash:keccak256(await rpc.getCode(address)),deploymentTx:vault.deploymentTransaction()!.hash,
    unified:{book,bookRuntimeHash:keccak256(await rpc.getCode(book)),network,networkRuntimeHash:keccak256(await rpc.getCode(network))}};
   await (await token.mint(wallet,parseEther('100'))).wait();
   await (await token.mint(secondWallet,parseEther('100'))).wait();
   await (await token.connect(user).getFunction('approve')(address,1n)).wait();
   for(let i=0;i<6;i++)await eip.request({method:'evm_mine',params:[]});
   let selected=wallet;const sent:string[]=[];const denied:string[]=[];
   const walletProvider={request:async({method,params}:any)=>{
    if(['eth_call','eth_estimateGas','eth_getTransactionByHash','eth_getTransactionReceipt'].includes(method)){
     denied.push(method);throw Error('WALLET_READ_RPC_BLOCKED');
    }
    if(method==='eth_accounts'||method==='eth_requestAccounts')return [selected];
    const result=await eip.request({method,params:params||[]});
    if(method==='eth_sendTransaction'){
     sent.push(String(result));
     for(let i=0;i<6;i++)await eip.request({method:'evm_mine',params:[]});
    }
    return result;
   }};
   await expect(sendV3Action(walletProvider as any,wallet,{kind:'register',referrer:ZeroAddress},config)).rejects.toThrow(/read-only/);
   await expect(sendV3TestTokenDeposit(walletProvider as any,wallet,parseEther('10'),ZeroAddress,config)).rejects.toThrow(/read-only/);
   await expect(sendV3UnifiedRegistration(walletProvider as any,wallet,ZeroAddress,config)).rejects.toThrow(/read-only/);
   await expect(sendV3UnifiedTestTokenDeposit(walletProvider as any,wallet,parseEther('10'),ZeroAddress,config)).rejects.toThrow(/read-only/);
   expect(sent).toEqual([]);
   await expect(sendV3UnifiedRegistration(walletProvider as any,wallet,unregistered,config,{enabled:true})).rejects.toThrow(/referrer is not registered/);
   expect(sent).toEqual([]);
   const registration=await sendV3UnifiedRegistration(walletProvider as any,wallet,ZeroAddress,config,{enabled:true});
   expect(registration).toMatch(/^0x[0-9a-f]{64}$/i);
   expect((await vault.users(wallet)).registered).toBe(true);
   const first=await sendV3UnifiedTestTokenDeposit(walletProvider as any,wallet,parseEther('10'),ZeroAddress,config,{enabled:true});
   expect(first).toMatch(/^0x[0-9a-f]{64}$/i);
   expect(await vault.positionCount(wallet)).toBe(1n);
   expect((await vault.positionOf(wallet,0)).principal).toBe(parseEther('10'));
   expect(await token.allowance(wallet,address)).toBe(0n);
   expect(sent).toHaveLength(4); // register, reset, exact approval, deposit
   selected=secondWallet;
   const cancelAfterApproval=vi.fn(async()=>false);
   await expect(sendV3UnifiedTestTokenDeposit(walletProvider as any,secondWallet,parseEther('10'),wallet,config,
    {enabled:true,reviewApprovedDeposit:cancelAfterApproval})).rejects.toThrow('Deposit not submitted');
   expect(cancelAfterApproval).toHaveBeenCalledWith(expect.stringMatching(/^0x[0-9a-f]{64}$/i));
   expect(await token.allowance(secondWallet,address)).toBe(parseEther('10'));
   expect(await vault.positionCount(secondWallet)).toBe(0n);expect(sent).toHaveLength(5);
   const secondDeposit=await sendV3UnifiedTestTokenDeposit(walletProvider as any,secondWallet,parseEther('10'),wallet,config,{enabled:true});
   expect(secondDeposit).toMatch(/^0x[0-9a-f]{64}$/i);
   expect((await vault.users(secondWallet)).registered).toBe(true);
   expect((await vault.users(secondWallet)).referrer).toBe(wallet);
   expect(await vault.positionCount(secondWallet)).toBe(1n);
   expect(sent).toHaveLength(6); // exact approval and deposit, which registers
   expect(await token.balanceOf(await vault.FEE_WALLET_1())).toBe(parseEther('2'));
   expect(await token.balanceOf(await vault.FEE_WALLET_2())).toBe(parseEther('2'));
   expect(await token.balanceOf(await vault.OPERATIONS_WALLET())).toBe(parseEther('16'));
   expect(denied).toEqual([]);
   await expect(sendV3UnifiedTestTokenDeposit(walletProvider as any,secondWallet,parseEther('10'),wallet,
    {...config,unified:{...config.unified,bookRuntimeHash:'0x'+'00'.repeat(32)}},{enabled:true}))
    .rejects.toThrow(/independently verified/);
   expect(sent).toHaveLength(6);
  }finally{rpc.destroy();await (eip as any).disconnect();vi.unstubAllEnvs();}
 },120000);
});
