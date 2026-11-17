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

describe('unified testnet check-in on a local EVM',()=>{
 it('checks in once without accidentally accruing any grouped lot',async()=>{
  vi.stubEnv('VITE_V3_HOURLY_TEST','isolated-1h');
  const {sendV3UnifiedCheckIn}=await import('../src/v3-unified-checkin');
  const previous=process.cwd();let artifact;
  try{process.chdir('..');artifact=compileUnifiedTestnet().GlobalV3UnifiedTestnet;}finally{process.chdir(previous);}
  const mock='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
  const manager='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
  const fee='0x74015dedf36677485793f1714ec7bd4893907b26';
  const tokenArtifact=JSON.parse(fs.readFileSync('../artifacts/MockToken.json','utf8'));
  const eip=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
   miner:{blockGasLimit:30000000},wallet:{totalAccounts:3,defaultBalance:50}});
  shared.rpc=eip;
  const rpc=new BrowserProvider(eip as any,undefined,{cacheTimeout:-1});rpc.pollingInterval=20;
  try{
   const deployer=await rpc.getSigner(0),user=await rpc.getSigner(1),other=await rpc.getSigner(2);
   const wallet=await user.getAddress(),otherWallet=await other.getAddress();
   const tokenSource=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,deployer).deploy(18);
   await tokenSource.waitForDeployment();
   await eip.request({method:'evm_setAccountCode',params:[mock,await rpc.getCode(await tokenSource.getAddress())]});
   const token=new Contract(mock,tokenArtifact.abi,deployer);
   const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,deployer)
    .deploy(manager,mock,fee,{gasLimit:25000000});
   await vault.waitForDeployment();
   await (await token.mint(wallet,parseEther('1000'))).wait();
   await (await token.connect(user).getFunction('approve')(vault.target,parseEther('1000'))).wait();
   await (await vault.connect(user).getFunction('deposit')(parseEther('1000'),ZeroAddress)).wait();
   await (await vault.connect(user).getFunction('checkIn')()).wait();
   await eip.request({method:'evm_increaseTime',params:[3601]});await eip.request({method:'evm_mine',params:[]});
   await (await vault.accrueDaily(wallet,0)).wait();
   await (await vault.connect(user).getFunction('reinvest')(0,parseEther('3'))).wait();
   await eip.request({method:'evm_increaseTime',params:[3601]});
   for(let i=0;i<5;i++)await eip.request({method:'evm_mine',params:[]});
   const address=await vault.getAddress(),book=await vault.reinvestmentBook(),network=await vault.networkPlan();
   const config={address,runtimeHash:keccak256(await rpc.getCode(address)),deploymentTx:vault.deploymentTransaction()!.hash,
    unified:{book,bookRuntimeHash:keccak256(await rpc.getCode(book)),network,networkRuntimeHash:keccak256(await rpc.getCode(network))}};
   let sends=0;
   const walletProvider={request:async({method,params}:any)=>{
    if(method==='eth_sendTransaction')sends++;
    const result=await eip.request({method,params:params||[]});
    if(method==='eth_sendTransaction')for(let i=0;i<6;i++)await eip.request({method:'evm_mine',params:[]});
    return result;
   }};
   await expect(sendV3UnifiedCheckIn(walletProvider as any,wallet,config)).rejects.toThrow(/read-only/);
   const wrongHash={...config,unified:{...config.unified,bookRuntimeHash:'0x'+'00'.repeat(32)}};
   await expect(sendV3UnifiedCheckIn(walletProvider as any,wallet,wrongHash,{enabled:true})).rejects.toThrow(/independently verified/);
   await expect(sendV3UnifiedCheckIn(walletProvider as any,otherWallet,config,{enabled:true})).rejects.toThrow(/cannot check in/);
   expect(sends).toBe(0);
   const beforeGroup=await vault.positionOf(wallet,1),beforeLiability=await vault.profitLiability(),balance=await token.balanceOf(wallet);
   const progress:string[]=[];
   const sent=await sendV3UnifiedCheckIn(walletProvider as any,wallet,config,{enabled:true,onProgress:detail=>progress.push(detail.step)});
   expect(sent.accrualPerformed).toBe(false);
   expect(sent.hash).toMatch(/^0x[0-9a-f]{64}$/i);
   expect(progress).toEqual(['preflight','simulation','wallet_request','verification','confirmed']);
   expect((await vault.users(wallet)).lastCheckIn).toBe(sent.at);
   expect((await vault.positionOf(wallet,1)).availableProfit).toBe(beforeGroup.availableProfit);
   expect(await vault.profitLiability()).toBe(beforeLiability);
   expect(await token.balanceOf(wallet)).toBe(balance);
   await expect(sendV3UnifiedCheckIn(walletProvider as any,wallet,config,{enabled:true})).rejects.toThrow(/cooldown/);
   expect(sends).toBe(1);
  }finally{rpc.destroy();await (eip as any).disconnect();vi.unstubAllEnvs();}
 },120000);
});
